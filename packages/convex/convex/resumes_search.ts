import { action, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import {
    splitQueryTokens,
    matchesAllTokens,
} from "./resume_helpers.js";
import {
    normalizeTagExpansionKeywordGroups,
    collectExpandedTerms,
    selectTagExpansionAnchorGroup,
    dedupeProvenance as _dedupeProvenance,
    buildTagExpansionSearchQuery,
    matchesTagExpansionSearchText,
    collectSearchTextProvenance,
    type TagExpansionKeywordGroup,
    type SearchProvenance,
} from "./lib/resumes_tag_expansion.js";
import {
    projectResumeListDoc,
    normalizeResumeListFilters,
    matchesResumeListFilters,
    compareResumeListSort,
    resolveResumeListSortOrder,
    sortByIngestRuleScore,
    getIngestRuleScore,
} from "./lib/resumes_list_projections.js";
import type {
    ResumeListProjectedDoc,
    SearchWithTagExpansionPageArgs,
    SearchWithTagExpansionScanPageArgs,
} from "./lib/resumes_list_projections.js";
import {
    FILTERED_PAGINATE_OVERFETCH_MULTIPLIER,
    PAGINATE_MAX_BYTES_READ,
    PAGINATE_MAX_ROWS_READ,
    MAX_SAFE_SEARCH_PAGINATE_SCAN,
    MAX_SAFE_SEARCH_PAGINATE_SCAN_UNFILTERED,
    resolveSearchWithTagExpansionTakeLimit,
    resolveListWithIngestWindow,
    resolveListWithIngestPageWindow,
    resolvePaginatedResumeOffsetCursor,
    resolvePaginatedResumePageLimit,
    buildPaginatedOffsetResult,
} from "./lib/resumes_pagination.js";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function compareResumes(
    left: Doc<"resumes">,
    right: Doc<"resumes">,
    jobDescriptionId: string | undefined
): number {
    const ruleDiff = getIngestRuleScore(right, jobDescriptionId) - getIngestRuleScore(left, jobDescriptionId);
    if (ruleDiff !== 0) {
        return ruleDiff;
    }

    const primaryRuleDiff = (right.primaryRuleScore || 0) - (left.primaryRuleScore || 0);
    if (primaryRuleDiff !== 0) {
        return primaryRuleDiff;
    }

    return right.crawledAt - left.crawledAt;
}

function mergeResumeDocs(
    docs: Doc<"resumes">[],
    provenanceByResumeId: Map<string, SearchProvenance[]>,
    jobDescriptionId: string | undefined,
    limit: number
): Array<{ resume: Doc<"resumes">; provenance: SearchProvenance[] }> {
    const merged = new Map<string, { resume: Doc<"resumes">; provenance: SearchProvenance[] }>();

    for (const doc of docs) {
        const identityKey = typeof doc.identityKey === "string" && doc.identityKey.trim().length > 0
            ? doc.identityKey
            : String(doc._id);
        const incomingProvenance = provenanceByResumeId.get(String(doc._id)) ?? [];
        const existing = merged.get(identityKey);

        if (!existing) {
            merged.set(identityKey, {
                resume: doc,
                provenance: _dedupeProvenance(incomingProvenance),
            });
            continue;
        }

        const preferredResume = compareResumes(existing.resume, doc, jobDescriptionId) <= 0
            ? existing.resume
            : doc;
        merged.set(identityKey, {
            resume: preferredResume,
            provenance: _dedupeProvenance([...existing.provenance, ...incomingProvenance]),
        });
    }

    return Array.from(merged.values())
        .sort((left, right) => {
            if (right.provenance.length !== left.provenance.length) {
                return right.provenance.length - left.provenance.length;
            }
            return compareResumes(left.resume, right.resume, jobDescriptionId);
        })
        .slice(0, limit);
}

function resolveSearchWithTagExpansionMatch(
    doc: Doc<"resumes">,
    keywordGroups: TagExpansionKeywordGroup[],
    mode: "AND" | "OR",
    sourceMapping: Record<string, string>,
): SearchProvenance[] | null {
    const normalizedSearchText = (doc.searchText || "").toLowerCase();
    const matched = matchesTagExpansionSearchText(normalizedSearchText, keywordGroups, mode);

    if (!matched) {
        return null;
    }

    const provenance = collectSearchTextProvenance(normalizedSearchText, keywordGroups, sourceMapping);
    return provenance.length > 0 ? provenance : null;
}

async function runSearchWithTagExpansionPageQuery(
    ctx: QueryCtx,
    args: SearchWithTagExpansionPageArgs
): Promise<{
    expansion: {
        original: string;
        expanded: string[];
        groups: TagExpansionKeywordGroup[];
        mode: "AND" | "OR";
    };
    total: number;
    results: Array<{ resume: Doc<"resumes">; provenance: SearchProvenance[] }>;
}> {
    const { offset, pageLimit } = resolveListWithIngestPageWindow(args.limit, args.offset);
    const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
    const filters = normalizeResumeListFilters(args);
    const mode = args.mode ?? "AND";
    const keywordGroups = normalizeTagExpansionKeywordGroups(args.keywordGroups);
    const expandedTerms = collectExpandedTerms(keywordGroups);

    if (expandedTerms.length === 0 || keywordGroups.length === 0) {
        return {
            expansion: {
                original: args.query,
                expanded: [],
                groups: [],
                mode,
            },
            total: 0,
            results: [],
        };
    }

    const sourceMapping = Object.fromEntries(
        (args.sourceMappings ?? []).map((entry) => [entry.term, entry.expandedFrom])
    );
    const provenanceByResumeId = new Map<string, SearchProvenance[]>();
    const searchQuery = buildTagExpansionSearchQuery(keywordGroups, mode);
    const takeLimit = resolveSearchWithTagExpansionTakeLimit({
        limit: args.limit,
        offset: args.offset,
        hasFilters: filters !== undefined,
        jobDescriptionId,
    });

    const matches = searchQuery
        ? await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery).eq("isArchived", undefined))
            .take(takeLimit)
        : [];

    const filteredDocs = matches.filter((doc) => {
        const provenance = resolveSearchWithTagExpansionMatch(
            doc,
            keywordGroups,
            mode,
            sourceMapping,
        );
        if (!provenance) {
            return false;
        }
        provenanceByResumeId.set(String(doc._id), provenance);
        return true;
    });

    const merged = mergeResumeDocs(filteredDocs, provenanceByResumeId, jobDescriptionId, takeLimit)
        .filter((entry) => matchesResumeListFilters(entry.resume, filters));
    let sorted = merged;
    if (args.sortBy) {
        const sortBy = args.sortBy;
        sorted = [...merged].sort((left, right) => compareResumeListSort(
            left.resume,
            right.resume,
            sortBy,
            resolveResumeListSortOrder(args.sortOrder)
        ));
    }

    return {
        expansion: {
            original: args.query,
            expanded: expandedTerms,
            groups: keywordGroups,
            mode,
        },
        total: sorted.length,
        results: sorted.slice(offset, offset + pageLimit),
    };
}

async function runSearchWithTagExpansionScanPageQuery(
    ctx: QueryCtx,
    args: SearchWithTagExpansionScanPageArgs
): Promise<{
    expansion: {
        original: string;
        expanded: string[];
        groups: TagExpansionKeywordGroup[];
        mode: "AND" | "OR";
    };
    page: Array<{ resume: ResumeListProjectedDoc; provenance: SearchProvenance[] }>;
    continueCursor: string;
    isDone: boolean;
}> {
    const filters = normalizeResumeListFilters(args);
    const mode = args.mode ?? "AND";
    const keywordGroups = normalizeTagExpansionKeywordGroups(args.keywordGroups);
    const expandedTerms = collectExpandedTerms(keywordGroups);

    if (expandedTerms.length === 0 || keywordGroups.length === 0) {
        return {
            expansion: {
                original: args.query,
                expanded: [],
                groups: [],
                mode,
            },
            page: [],
            continueCursor: "",
            isDone: true,
        };
    }

    const sourceMapping = Object.fromEntries(
        (args.sourceMappings ?? []).map((entry) => [entry.term, entry.expandedFrom])
    );
    const searchQuery = buildTagExpansionSearchQuery(keywordGroups, mode);
    const requestedPageSize = Math.max(Math.trunc(args.paginationOpts.numItems), 1);
    const hasActiveFilters = filters !== undefined;
    const pageSize = hasActiveFilters
        ? Math.min(requestedPageSize * FILTERED_PAGINATE_OVERFETCH_MULTIPLIER, MAX_SAFE_SEARCH_PAGINATE_SCAN)
        : Math.min(requestedPageSize, MAX_SAFE_SEARCH_PAGINATE_SCAN_UNFILTERED);

    const searchPage = searchQuery
        ? await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery).eq("isArchived", undefined))
            .paginate({
                ...args.paginationOpts,
                numItems: pageSize,
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            })
        : {
            page: [] as Doc<"resumes">[],
            continueCursor: "",
            isDone: true,
        };

    return {
        expansion: {
            original: args.query,
            expanded: expandedTerms,
            groups: keywordGroups,
            mode,
        },
        page: searchPage.page.flatMap((doc) => {
            const provenance = resolveSearchWithTagExpansionMatch(
                doc,
                keywordGroups,
                mode,
                sourceMapping,
            );
            if (!provenance || !matchesResumeListFilters(doc, filters)) {
                return [];
            }

            return [{
                resume: projectResumeListDoc(doc),
                provenance,
            }];
        }),
        continueCursor: searchPage.continueCursor,
        isDone: searchPage.isDone,
    };
}

// ---------------------------------------------------------------------------
// Public search queries
// ---------------------------------------------------------------------------

export const search = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number())
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 50;
        const tokens = splitQueryTokens(args.query);
        const fetchLimit = tokens.length > 1 ? Math.max(limit * 5, 500) : limit;

        const matches = await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.query).eq("isArchived", undefined))
            .take(fetchLimit);

        // Convex full-text search uses OR. Post-filter to enforce AND.
        const filtered = tokens.length > 1
            ? matches.filter((doc) => matchesAllTokens(doc.searchText, tokens))
            : matches;

        return filtered.slice(0, limit);
    },
});

export const searchWithIngestData = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 50;
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        const tokens = splitQueryTokens(args.query);
        // Over-fetch to compensate for AND post-filtering on OR results
        const fetchLimit = tokens.length > 1 ? Math.max(limit * 5, 500) : Math.max(limit, 200);

        const matches = await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.query).eq("isArchived", undefined))
            .take(fetchLimit);

        // Convex full-text search uses OR. Post-filter to enforce AND.
        const filtered = tokens.length > 1
            ? matches.filter((doc) => matchesAllTokens(doc.searchText, tokens))
            : matches;

        if (!jobDescriptionId) {
            return filtered.slice(0, limit);
        }

        return sortByIngestRuleScore(filtered, jobDescriptionId).slice(0, limit);
    },
});

export const searchWithTagExpansion = query({
    args: {
        query: v.string(),
        keywordGroups: v.array(v.object({
            original: v.string(),
            variants: v.array(v.string()),
        })),
        mode: v.optional(v.union(v.literal("AND"), v.literal("OR"))),
        sourceMappings: v.optional(v.array(v.object({
            term: v.string(),
            expandedFrom: v.string(),
        }))),
        limit: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { limit, overfetchLimit } = resolveListWithIngestWindow(args.limit);
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        const mode = args.mode ?? "AND";
        const keywordGroups = normalizeTagExpansionKeywordGroups(args.keywordGroups);
        const expandedTerms = collectExpandedTerms(keywordGroups);

        if (expandedTerms.length === 0 || keywordGroups.length === 0) {
            return {
                expansion: {
                    original: args.query,
                    expanded: [],
                    groups: [],
                    mode,
                },
                results: [],
            };
        }

        const sourceMapping = Object.fromEntries(
            (args.sourceMappings ?? []).map((entry) => [entry.term, entry.expandedFrom])
        );
        const provenanceByResumeId = new Map<string, SearchProvenance[]>();
        const fetchLimit = overfetchLimit;
        const searchQuery = buildTagExpansionSearchQuery(keywordGroups, mode);

        const matches = searchQuery
            ? await ctx.db
                .query("resumes")
                .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery).eq("isArchived", undefined))
                .take(fetchLimit)
            : [];

        const filteredDocs = matches.filter((doc) => {
            const normalizedSearchText = (doc.searchText || "").toLowerCase();
            const matched = matchesTagExpansionSearchText(normalizedSearchText, keywordGroups, mode);

            if (!matched) {
                return false;
            }

            const provenance = collectSearchTextProvenance(normalizedSearchText, keywordGroups, sourceMapping);
            if (provenance.length === 0) {
                return false;
            }

            provenanceByResumeId.set(String(doc._id), provenance);
            return true;
        });

        return {
            expansion: {
                original: args.query,
                expanded: expandedTerms,
                groups: keywordGroups,
                mode,
            },
            results: mergeResumeDocs(filteredDocs, provenanceByResumeId, jobDescriptionId, limit)
                .map((entry) => ({
                    resume: projectResumeListDoc(entry.resume),
                    provenance: entry.provenance,
                })),
        };
    },
});

export const searchWithTagExpansionPage = query({
    args: {
        query: v.string(),
        keywordGroups: v.array(v.object({
            original: v.string(),
            variants: v.array(v.string()),
        })),
        mode: v.optional(v.union(v.literal("AND"), v.literal("OR"))),
        sourceMappings: v.optional(v.array(v.object({
            term: v.string(),
            expandedFrom: v.string(),
        }))),
        limit: v.optional(v.number()),
        offset: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
        sortBy: v.optional(v.union(v.literal("name"), v.literal("experience"), v.literal("extractedAt"))),
        sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
        minExperience: v.optional(v.number()),
        maxExperience: v.optional(v.number()),
        minRoleYears: v.optional(v.number()),
        roleFilterType: v.optional(v.string()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
        education: v.optional(v.array(v.string())),
        skills: v.optional(v.array(v.string())),
        requiredKeywords: v.optional(v.array(v.string())),
        locations: v.optional(v.array(v.string())),
        minSalary: v.optional(v.number()),
        maxSalary: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const result = await runSearchWithTagExpansionPageQuery(ctx, args);
        return {
            expansion: result.expansion,
            total: result.total,
            results: result.results.map((entry) => ({
                resume: projectResumeListDoc(entry.resume),
                provenance: entry.provenance,
            })),
        };
    },
});

export const searchWithTagExpansionPaginated = query({
    args: {
        paginationOpts: paginationOptsValidator,
        query: v.string(),
        keywordGroups: v.array(v.object({
            original: v.string(),
            variants: v.array(v.string()),
        })),
        mode: v.optional(v.union(v.literal("AND"), v.literal("OR"))),
        sourceMappings: v.optional(v.array(v.object({
            term: v.string(),
            expandedFrom: v.string(),
        }))),
        jobDescriptionId: v.optional(v.string()),
        sortBy: v.optional(v.union(v.literal("name"), v.literal("experience"), v.literal("extractedAt"))),
        sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
        minExperience: v.optional(v.number()),
        maxExperience: v.optional(v.number()),
        minRoleYears: v.optional(v.number()),
        roleFilterType: v.optional(v.string()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
        education: v.optional(v.array(v.string())),
        skills: v.optional(v.array(v.string())),
        requiredKeywords: v.optional(v.array(v.string())),
        locations: v.optional(v.array(v.string())),
        minSalary: v.optional(v.number()),
        maxSalary: v.optional(v.number()),
        sources: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        if (!args.jobDescriptionId?.trim() && !args.sortBy) {
            const requestedPageSize = resolvePaginatedResumePageLimit(args.paginationOpts.numItems);
            const page = await runSearchWithTagExpansionScanPageQuery(ctx, {
                ...args,
                paginationOpts: {
                    ...args.paginationOpts,
                    numItems: requestedPageSize,
                },
            });

            return {
                page: page.page,
                continueCursor: page.continueCursor,
                isDone: page.isDone,
            };
        }

        const offset = resolvePaginatedResumeOffsetCursor(args.paginationOpts.cursor);
        const limit = resolvePaginatedResumePageLimit(args.paginationOpts.numItems);
        const page = await runSearchWithTagExpansionPageQuery(ctx, {
            ...args,
            limit,
            offset,
        });

        return buildPaginatedOffsetResult(page.results.map((entry) => ({
            resume: projectResumeListDoc(entry.resume),
            provenance: entry.provenance,
        })), page.total, offset);
    },
});

export const searchWithTagExpansionScanPage = query({
    args: {
        paginationOpts: paginationOptsValidator,
        query: v.string(),
        keywordGroups: v.array(v.object({
            original: v.string(),
            variants: v.array(v.string()),
        })),
        mode: v.optional(v.union(v.literal("AND"), v.literal("OR"))),
        sourceMappings: v.optional(v.array(v.object({
            term: v.string(),
            expandedFrom: v.string(),
        }))),
        minExperience: v.optional(v.number()),
        maxExperience: v.optional(v.number()),
        minRoleYears: v.optional(v.number()),
        roleFilterType: v.optional(v.string()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
        education: v.optional(v.array(v.string())),
        skills: v.optional(v.array(v.string())),
        requiredKeywords: v.optional(v.array(v.string())),
        locations: v.optional(v.array(v.string())),
        minSalary: v.optional(v.number()),
        maxSalary: v.optional(v.number()),
        sources: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const page = await runSearchWithTagExpansionScanPageQuery(ctx, args);
        return {
            expansion: page.expansion,
            page: page.page,
            continueCursor: page.continueCursor,
            isDone: page.isDone,
        };
    },
});

// ---------------------------------------------------------------------------
// AND-mode full-table-scan search action
// ---------------------------------------------------------------------------

// ─── AND-mode full-table-scan search ─────────────────────────────────
//
// Convex search indexes return at most 1024 results per query, ordered
// by BM25 relevance.  Resumes with long searchText (6KB+ from detailed
// AI analysis / synonym lists) score low for any single term and are
// ranked beyond the 1024-position cutoff, making them invisible to the
// search index even though their searchText contains the term.
//
// Full-table-scan approach:
//   1. Paginate ALL resumes (by _creationTime) in small batches via
//      scanResumePageByTime.  Each batch is ~50 docs ≈ 650 KB,
//      well under the 16 MiB per-query limit.
//   2. For each batch, check searchText for AND-mode keyword matches
//      (matchesTagExpansionSearchText) and resume list filters.
//      Non-matches are discarded immediately.
//   3. Collect matching docs and return the full result set.

export const searchWithTagExpansionAndMode = action({
    args: {
        query: v.string(),
        keywordGroups: v.array(v.object({
            original: v.string(),
            variants: v.array(v.string()),
        })),
        sourceMappings: v.optional(v.array(v.object({
            term: v.string(),
            expandedFrom: v.string(),
        }))),
        minExperience: v.optional(v.number()),
        maxExperience: v.optional(v.number()),
        minRoleYears: v.optional(v.number()),
        roleFilterType: v.optional(v.string()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
        education: v.optional(v.array(v.string())),
        skills: v.optional(v.array(v.string())),
        requiredKeywords: v.optional(v.array(v.string())),
        locations: v.optional(v.array(v.string())),
        minSalary: v.optional(v.number()),
        maxSalary: v.optional(v.number()),
        showArchived: v.optional(v.boolean()),
        sources: v.optional(v.array(v.string())),
        jobDescriptionId: v.optional(v.string()),
        sortBy: v.optional(v.union(v.literal("name"), v.literal("experience"), v.literal("extractedAt"))),
        sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    },
    handler: async (ctx, args) => {
        const keywordGroups = normalizeTagExpansionKeywordGroups(args.keywordGroups);
        const expandedTerms = collectExpandedTerms(keywordGroups);

        if (expandedTerms.length === 0 || keywordGroups.length === 0) {
            return {
                expansion: {
                    original: args.query,
                    expanded: [],
                    groups: [],
                    mode: "AND" as const,
                },
                total: 0,
                results: [],
            };
        }

        const sourceMapping = Object.fromEntries(
            (args.sourceMappings ?? []).map((entry) => [entry.term, entry.expandedFrom])
        );

        // Anchor-scan approach: Collect doc IDs matching the anchor group
        // (fewest variants) from the search index, then batch-fetch and
        // filter for all groups + resume list filters in-memory.
        //
        // NOTE: The Convex search index scans at most 1024 results per query
        // (BM25-ranked).  Resumes with long searchText that score low for
        // the anchor terms may be missed.  The BFF AND-mode path handles
        // the full-table-scan case for complete results.
        const anchorGroup = selectTagExpansionAnchorGroup(keywordGroups);
        const anchorSearchQuery = anchorGroup.variants.join(" ");
        const anchorIds: string[] = [];
        let cursor: string | undefined;

        while (true) {
            const page = await ctx.runQuery(internal.resumes_search.collectSearchIndexDocIds, {
                searchQuery: anchorSearchQuery,
                ...(cursor ? { cursor } : {}),
                numItems: 256,
            });
            for (const id of page.ids) {
                anchorIds.push(id);
            }
            if (page.isDone || !page.cursor) {
                break;
            }
            cursor = page.cursor;
        }

        if (anchorIds.length === 0) {
            return {
                expansion: {
                    original: args.query,
                    expanded: expandedTerms,
                    groups: keywordGroups,
                    mode: "AND" as const,
                },
                total: 0,
                results: [],
            };
        }

        // Batch-fetch full docs and filter in-memory.
        const BATCH_FETCH_SIZE = 16;
        const filters = normalizeResumeListFilters(args);
        const provenanceByResumeId = new Map<string, SearchProvenance[]>();
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        const matchedDocs: Doc<"resumes">[] = [];

        for (let i = 0; i < anchorIds.length; i += BATCH_FETCH_SIZE) {
            const batchIds = anchorIds.slice(i, i + BATCH_FETCH_SIZE)
                .map((id) => id as unknown as Id<"resumes">);
            const docs = await ctx.runQuery(internal.resumes_search.getResumesByIds, {
                resumeIds: batchIds,
            });

            for (const doc of docs) {
                const provenance = resolveSearchWithTagExpansionMatch(
                    doc,
                    keywordGroups,
                    "AND",
                    sourceMapping,
                );
                if (!provenance) {
                    continue;
                }
                if (!matchesResumeListFilters(doc, filters)) {
                    continue;
                }
                provenanceByResumeId.set(String(doc._id), provenance);
                matchedDocs.push(doc);
            }
        }

        const merged = mergeResumeDocs(matchedDocs, provenanceByResumeId, jobDescriptionId, matchedDocs.length);

        // Sort
        let sorted = merged;
        if (args.sortBy) {
            sorted = [...merged].sort((left, right) => compareResumeListSort(
                left.resume,
                right.resume,
                args.sortBy!,
                resolveResumeListSortOrder(args.sortOrder),
            ));
        }

        return {
            expansion: {
                original: args.query,
                expanded: expandedTerms,
                groups: keywordGroups,
                mode: "AND" as const,
            },
            total: sorted.length,
            results: sorted.map((entry) => ({
                resume: projectResumeListDoc(entry.resume),
                provenance: entry.provenance,
            })),
        };
    },
});

// ---------------------------------------------------------------------------
// Scan queries for BFF AND-mode search
// ---------------------------------------------------------------------------

// Lightweight scan page for AND-mode BFF full-table-scan.
// Returns only fields needed for BFF-side filtering (not full docs)
// to minimize wire transfer — most scanned docs are discarded.
// Two-phase approach: phase 1 scans with slim projection (no content)
// to find matching IDs; phase 2 fetches full docs for matches only.
export const scanResumePageByTime = query({
    args: {
        cursor: v.optional(v.string()),
        numItems: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const numItems = Math.min(args.numItems ?? 50, 50);
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems,
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });
        return {
            docs: page.page.map((doc) => ({
                _id: doc._id,
                _creationTime: doc._creationTime,
                searchText: doc.searchText,
                isArchived: doc.isArchived,
                source: doc.source,
                primaryRuleScore: doc.primaryRuleScore,
                age: doc.age,
                content: doc.content,
                ingestData: doc.ingestData,
            })),
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});

// Slim scan page for AND-mode phase 1 — no content/ingestData.
// BFF uses this for the initial filter pass, then fetches full
// docs for matches via scanResumePageByTime or getResumeByIds.
export const scanResumePageSlim = query({
    args: {
        cursor: v.optional(v.string()),
        numItems: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // Reduced from 1000 to 200 to stay well under 16 MiB byte limit
        // With ~27KB average doc size: 200 × 27KB = ~5.4MB, safely under limit
        const numItems = Math.min(args.numItems ?? 200, 200);
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems,
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });
        return {
            docs: page.page.map((doc) => ({
                _id: doc._id,
                searchText: doc.searchText,
                isArchived: doc.isArchived,
                source: doc.source,
                primaryRuleScore: doc.primaryRuleScore,
                age: doc.age,
            })),
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});

// Keep getResumes for backward compatibility
// These are used by the API resume list for AND-mode search
// getResumes added to resolve production "function not found" errors
export const getResumes = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<Doc<"resumes">[]> => {
        const limit = Math.min(args.limit ?? 50, 200);
        return await ctx.db
            .query("resumes")
            .order("desc")
            .filter((q) => q.neq(q.field("isArchived"), true))
            .take(limit);
    },
});

export const getResumeDocsByIds = query({
    args: {
        ids: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
        return docs.filter((doc): doc is Doc<"resumes"> => doc !== null).map((doc) => ({
            _id: doc._id,
            _creationTime: doc._creationTime,
            searchText: doc.searchText,
            isArchived: doc.isArchived,
            source: doc.source,
            primaryRuleScore: doc.primaryRuleScore,
            age: doc.age,
            content: doc.content,
            ingestData: doc.ingestData,
            analysis: doc.analysis,
            analyses: doc.analyses,
            identityKey: doc.identityKey,
            externalId: doc.externalId,
            tags: doc.tags,
            crawledAt: doc.crawledAt,
        }));
    },
});

// ---------------------------------------------------------------------------
// Internal queries
// ---------------------------------------------------------------------------

export const collectSearchIndexDocIds = internalQuery({
    args: {
        searchQuery: v.string(),
        cursor: v.optional(v.string()),
        numItems: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.searchQuery).eq("isArchived", undefined))
            .paginate({
                cursor: args.cursor ?? null,
                numItems: Math.min(args.numItems ?? 256, 256),
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });
        return {
            ids: page.page.map((doc) => String(doc._id)),
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});

export const getResumesByIds = internalQuery({
    args: {
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        const docs = await Promise.all(args.resumeIds.map((resumeId) => ctx.db.get(resumeId)));
        return docs.filter((doc): doc is NonNullable<typeof doc> => doc !== null);
    },
});
