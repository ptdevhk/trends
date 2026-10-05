/**
 * Tag expansion search helpers extracted from resumes.ts.
 *
 * Pure functions for building tag expansion search queries,
 * matching search text against keyword groups, and collecting
 * search provenance for UI display.
 */
import {
    expandLatinPhraseIndexTerms,
    isLatinMultiWordPhrase,
    latinPhraseTokens,
    matchesKeywordGroupSoft,
} from "@trends/shared";
import { MAX_SEARCH_INDEX_TERMS } from "./resumes_pagination.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TagExpansionKeywordGroup = {
    original: string;
    variants: string[];
};

export type MatchSource = "searchText" | "industryTags" | "companyHits" | "synonymHits";

export type SearchProvenance = {
    term: string;
    source: MatchSource;
    expandedFrom?: string;
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function matchesTagExpansionGroup(searchText: string, group: TagExpansionKeywordGroup): boolean {
    return matchesKeywordGroupSoft(searchText, group);
}

export function selectTagExpansionAnchorGroup(keywordGroups: TagExpansionKeywordGroup[]): TagExpansionKeywordGroup {
    const [firstGroup, ...remainingGroups] = keywordGroups;
    if (!firstGroup) {
        throw new Error("Keyword groups are required for tag expansion search");
    }

    return remainingGroups.reduce((selected, candidate) => {
        if (candidate.variants.length !== selected.variants.length) {
            return candidate.variants.length < selected.variants.length ? candidate : selected;
        }
        return candidate.original.length > selected.original.length ? candidate : selected;
    }, firstGroup);
}

export function collectExpandedTerms(keywordGroups: TagExpansionKeywordGroup[]): string[] {
    return expandLatinPhraseIndexTerms(keywordGroups.flatMap((group) => group.variants));
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export function normalizeTagExpansionKeywordGroups(
    keywordGroups: Array<{ original: string; variants: string[] }>
): TagExpansionKeywordGroup[] {
    return keywordGroups
        .map((group) => ({
            original: group.original.trim().toLowerCase(),
            variants: Array.from(
                new Set(
                    group.variants
                        .map((term) => term.trim().toLowerCase())
                        .filter((term) => term.length >= 2)
                )
            ),
        }))
        .filter((group) => group.original.length >= 1 && group.variants.length > 0);
}

export function dedupeProvenance(items: SearchProvenance[]): SearchProvenance[] {
    const seen = new Set<string>();
    const deduped: SearchProvenance[] = [];

    for (const item of items) {
        const key = `${item.source}|${item.term}|${item.expandedFrom ?? ""}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(item);
    }

    return deduped;
}

/**
 * Capped anchor-group join for the scan-page path: the same 16-term
 * Convex search-index limit the AND query builder applies, shared by
 * both call sites so neither can emit an over-limit query string.
 */
export function buildAnchorScanSearchQuery(anchor: TagExpansionKeywordGroup): string {
    return expandLatinPhraseIndexTerms(anchor.variants)
        .slice(0, MAX_SEARCH_INDEX_TERMS)
        .join(" ");
}

export function buildTagExpansionSearchQuery(
    keywordGroups: TagExpansionKeywordGroup[],
    mode: "AND" | "OR"
): string {
    if (keywordGroups.length === 0) {
        return "";
    }

    if (mode === "AND") {
        // The anchor group is the one with the fewest variants; cap the
        // expression at the Convex 16-term limit so oversized variant lists
        // cannot produce a runtime-rejected query string.
        return buildAnchorScanSearchQuery(selectTagExpansionAnchorGroup(keywordGroups));
    }

    return collectExpandedTerms(keywordGroups)
        .slice(0, MAX_SEARCH_INDEX_TERMS)
        .join(" ");
}

export function matchesTagExpansionSearchText(
    searchText: string,
    keywordGroups: TagExpansionKeywordGroup[],
    mode: "AND" | "OR"
): boolean {
    return mode === "AND"
        ? keywordGroups.every((group) => matchesTagExpansionGroup(searchText, group))
        : keywordGroups.some((group) => matchesTagExpansionGroup(searchText, group));
}

export function collectSearchTextProvenance(
    searchText: string,
    keywordGroups: TagExpansionKeywordGroup[],
    sourceMapping: Record<string, string>
): SearchProvenance[] {
    const matches: SearchProvenance[] = [];
    const seen = new Set<string>();
    const normalizedText = searchText.toLowerCase();

    for (const group of keywordGroups) {
        let groupHit = false;
        for (const term of group.variants) {
            if (!normalizedText.includes(term)) {
                continue;
            }
            if (seen.has(term)) {
                groupHit = true;
                continue;
            }
            seen.add(term);
            groupHit = true;
            matches.push({
                term,
                source: "searchText",
                expandedFrom: sourceMapping[term],
            });
        }

        if (groupHit) {
            continue;
        }

        const softSources = [group.original, ...group.variants].filter(isLatinMultiWordPhrase);
        for (const phrase of softSources) {
            const tokens = latinPhraseTokens(phrase);
            if (tokens.length < 2 || !tokens.every((token) => normalizedText.includes(token))) {
                continue;
            }
            for (const token of tokens) {
                if (seen.has(token)) {
                    continue;
                }
                seen.add(token);
                matches.push({
                    term: token,
                    source: "searchText",
                    expandedFrom: sourceMapping[phrase] ?? phrase,
                });
            }
            break;
        }
    }

    return matches;
}
