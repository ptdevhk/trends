/**
 * Pure helper functions extracted from resumes.ts.
 *
 * These functions have no Convex dependency (no ctx, Doc, or query/mutation types).
 * They are re-exported by resumes.ts for backward compatibility.
 */
import { isRecord } from "@trends/shared";
import { MAX_SEARCH_INDEX_TERMS } from "./lib/resumes_pagination.js";

// ---------------------------------------------------------------------------
// String / value helpers
// ---------------------------------------------------------------------------

export function toStringValue(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    if (value === null || value === undefined) {
        return "";
    }
    return String(value).trim();
}

export function toOptionalStringValue(value: unknown): string | undefined {
    const normalized = toStringValue(value);
    return normalized.length > 0 ? normalized : undefined;
}

export function hasNonEmptyArray(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}

export function readRecordArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isRecord);
}

export function hasResumeFieldValue(content: Record<string, unknown>, keys: string[]): boolean {
    return keys.some((key) => Boolean(toOptionalStringValue(content[key])));
}

export function hasWorkHistoryDescriptionEntries(value: unknown): boolean {
    return readRecordArray(value).some((entry) => Boolean(toOptionalStringValue(entry.description)));
}

// ---------------------------------------------------------------------------
// Rule score helpers
// ---------------------------------------------------------------------------

export function toRuleScores(value: unknown): Record<string, number> {
    if (!isRecord(value)) {
        return {};
    }

    const scores: Record<string, number> = {};
    for (const [key, rawScore] of Object.entries(value)) {
        if (typeof rawScore === "number" && Number.isFinite(rawScore)) {
            scores[key] = rawScore;
        }
    }
    return scores;
}

export function resolveRuleScoreLookupKeys(jobDescriptionId: string | undefined): string[] {
    const normalized = toOptionalStringValue(jobDescriptionId);
    if (!normalized) {
        return [];
    }

    const keys = new Set<string>([normalized]);
    if (normalized.startsWith("jd-")) {
        const legacySlug = normalized.slice(3).trim();
        if (legacySlug) {
            keys.add(legacySlug);
        }
    } else {
        keys.add(`jd-${normalized}`);
    }

    return Array.from(keys);
}

// ---------------------------------------------------------------------------
// Search text helpers
// ---------------------------------------------------------------------------

export function splitQueryTokens(query: string): string[] {
    return query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length >= 1)
        // Bound the multi-token AND loop to the Convex 16-term expression cap:
        // each token becomes one index query, and an unbounded token count is
        // an unbounded sequence of index scans per request.
        .slice(0, MAX_SEARCH_INDEX_TERMS);
}

export function matchesAllTokens(searchText: string | undefined, tokens: string[]): boolean {
    if (tokens.length <= 1) {
        return true;
    }
    const normalizedText = (searchText || "").toLowerCase();
    return tokens.every((token) => normalizedText.includes(token));
}
