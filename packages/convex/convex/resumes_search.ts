import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
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
import { buildResumeDigest } from "./lib/resume_digests.js";
import { readActiveResumeAnalysis } from "./lib/resume_analysis_read.js";
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

async function getResumeDocsByDigestRows(
    ctx: QueryCtx,
    digests: Doc<"resume_digests">[],
): Promise<Doc<"resumes">[]> {
    const docs = await Promise.all(digests.map((digest) => ctx.db.get(digest.resumeId)));
    // Guard against stale digests: the digest search filters .eq("isArchived", undefined)
    // but the digest row may lag a recent resume archive. Re-check the source doc.
    return docs.filter((doc): doc is Doc<"resumes"> => doc !== null && doc.isArchived !== true);
}

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

    const digestMatches = searchQuery
        ? await ctx.db
            .query("resume_digests")
            .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery).eq("isArchived", undefined))
            .take(takeLimit)
        : [];
    const matches = await getResumeDocsByDigestRows(ctx, digestMatches);

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

    const digestPage = searchQuery
        ? await ctx.db
            .query("resume_digests")
            .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery).eq("isArchived", undefined))
            .paginate({
                ...args.paginationOpts,
                numItems: pageSize,
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            })
        : {
            page: [] as Doc<"resume_digests">[],
            continueCursor: "",
            isDone: true,
        };
    const fullDocs = await getResumeDocsByDigestRows(ctx, digestPage.page);

    return {
        expansion: {
            original: args.query,
            expanded: expandedTerms,
            groups: keywordGroups,
            mode,
        },
        page: fullDocs.flatMap((doc) => {
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
        continueCursor: digestPage.continueCursor,
        isDone: digestPage.isDone,
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

        const digestMatches = await ctx.db
            .query("resume_digests")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.query).eq("isArchived", undefined))
            .take(fetchLimit);
        const matches = await getResumeDocsByDigestRows(ctx, digestMatches);

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

        const digestMatches = await ctx.db
            .query("resume_digests")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.query).eq("isArchived", undefined))
            .take(fetchLimit);
        const matches = await getResumeDocsByDigestRows(ctx, digestMatches);

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

        const digestMatches = searchQuery
            ? await ctx.db
                .query("resume_digests")
                .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery).eq("isArchived", undefined))
                .take(fetchLimit)
            : [];
        const matches = await getResumeDocsByDigestRows(ctx, digestMatches);

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

// Digest scan — lightweight candidate discovery for AND-mode BFF path.
// Each row is <1KB (vs ~27KB+ for scanResumePageSlim), so we can page 1000
// rows safely without hitting the Convex 16 MiB byte limit.
export const scanResumeDigestPage = query({
    args: {
        cursor: v.optional(v.string()),
        numItems: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const numItems = Math.min(args.numItems ?? 1000, 1000);
        const page = await ctx.db
            .query("resume_digests")
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
                resumeId: doc.resumeId,
                identityKey: doc.identityKey,
                source: doc.source,
                sourceKey: doc.sourceKey,
                searchText: doc.searchText,
                isArchived: doc.isArchived,
                primaryRuleScore: doc.primaryRuleScore,
                crawledAt: doc.crawledAt,
                age: doc.age,
                locationText: doc.locationText,
                educationLevel: doc.educationLevel,
                salaryMin: doc.salaryMin,
                salaryMax: doc.salaryMax,
                experienceYears: doc.experienceYears,
                roleTypes: doc.roleTypes,
                roleYearsByType: doc.roleYearsByType,
            })),
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});

// ── Digest helpers ────────────────────────────────────────────────────────

export async function doUpsertResumeDigest(
    ctx: MutationCtx,
    resume: Doc<"resumes">,
): Promise<void> {
    const existing = await ctx.db
        .query("resume_digests")
        .withIndex("by_resumeId", (q) => q.eq("resumeId", resume._id))
        .first();
    // Phase 4 Step 3a: source display fields from the ACTIVE cold analysis
    // (with legacy hot fallback) rather than the hot doc. Avoids per-resume
    // over-count of cleared (archived) analyses.
    const activeAnalysis = await readActiveResumeAnalysis(ctx, resume);
    const digest = buildResumeDigest(resume, Date.now(), activeAnalysis);
    if (existing) {
        await ctx.db.patch(existing._id, digest);
    } else {
        await ctx.db.insert("resume_digests", digest);
    }
}

// Upsert the cold resume_analyses row (full analysis blob) for a resume.
// Called after analysis writes to keep the cold table in sync.
//
// Soft-clear interaction (Phase 3 completion bundle): every upsert resets
// status to "active" and clears archivedAt. This makes re-analyze-after-clear
// restore the row naturally — clearAnalyses flips to archived, the next
// analysis write flips it back.
// Upsert the cold resume_analyses row (full analysis blob) for a resume.
// Called after analysis writes to keep the cold table in sync.
//
// Soft-clear interaction (Phase 3 completion bundle): every upsert resets
// status to "active" and clears archivedAt. This makes re-analyze-after-clear
// restore the row naturally — clearAnalyses flips to archived, the next
// analysis write flips it back.
//
// Phase 4 prep: analysis/analyses are passed explicitly rather than read off
// the hot `resumes` doc. This decouples the cold-row write from the hot-doc
// shape so that a future schema change removing those hot fields only needs to
// rework call sites (source from args/cold table), not this helper. Hot fields
// are retained for now — backup, JD-usage matching, and migrations still read
// them — so behavior is identical.
export async function doUpsertResumeAnalysis(
    ctx: MutationCtx,
    resumeId: Id<"resumes">,
    analysis: Doc<"resume_analyses">["analysis"],
    analyses: Doc<"resume_analyses">["analyses"],
): Promise<void> {
    const existing = await ctx.db
        .query("resume_analyses")
        .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
        .first();
    const patch = {
        analysis,
        analyses,
        status: "active" as const,
        archivedAt: undefined,
        updatedAt: Date.now(),
    };
    if (existing) {
        await ctx.db.patch(existing._id, patch);
    } else {
        await ctx.db.insert("resume_analyses", { resumeId, ...patch });
    }
}

// Internal mutation — called by writes in resumes_mutations.ts to keep
// digest in sync after resume insert/update.
export const upsertResumeDigest = internalMutation({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) return; // deleted — digest already removed or will be GC'd
        await doUpsertResumeDigest(ctx, resume);
    },
});

// Internal mutation — called after analysis writes to keep the cold
// resume_analyses table in sync.
export const upsertResumeAnalysis = internalMutation({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) return;
        // Phase 4 Step 3a: source from the active cold row (legacy hot fallback).
        // This makes the sync idempotent — re-running on an already-cold resume
        // is a no-op — and removes the dependency on the hot doc for the active case.
        const activeAnalysis = await readActiveResumeAnalysis(ctx, resume);
        await doUpsertResumeAnalysis(
            ctx,
            args.resumeId,
            activeAnalysis.analysis,
            activeAnalysis.analyses ?? {},
        );
    },
});

// Test-only mutation for Convex test seeders — upserts a single digest.
export const upsertResumeDigestForTest = mutation({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) throw new Error(`Resume not found: ${args.resumeId}`);
        await doUpsertResumeDigest(ctx, resume);
    },
});

// Idempotent backfill: paginate through all resumes and upsert digests.
// Safe to re-run — existing digests are updated in place.
export const backfillResumeDigests = mutation({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const numItems = Math.min(args.limit ?? 100, 200);
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems,
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });
        for (const resume of page.page) {
            await doUpsertResumeDigest(ctx, resume);
        }
        return {
            processed: page.page.length,
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});

// Idempotent backfill: paginate through all candidate_status rows and
// upsert resume_digest_statuses overlay rows. Safe to re-run — existing
// overlay rows are updated in place. Required after a restore where the
// overlay table may not exist in the backup (pre-Phase-2 backups).
export const backfillResumeDigestStatuses = mutation({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const numItems = Math.min(args.limit ?? 100, 200);
        const page = await ctx.db
            .query("candidate_status")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems,
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });

        let processed = 0;
        for (const status of page.page) {
            // Look up the resume via the digest overlay's by_identityKey index.
            const digest = await ctx.db
                .query("resume_digests")
                .withIndex("by_identityKey", (q) => q.eq("identityKey", status.identityKey))
                .first();
            if (!digest) {
                continue;
            }

            const existing = await ctx.db
                .query("resume_digest_statuses")
                .withIndex("by_workspace_identity", (q) =>
                    q.eq("workspaceSlug", status.workspaceSlug).eq("identityKey", status.identityKey)
                )
                .unique();

            if (existing) {
                await ctx.db.patch(existing._id, {
                    status: status.status,
                    updatedAt: status.updatedAt,
                });
            } else {
                await ctx.db.insert("resume_digest_statuses", {
                    resumeId: digest.resumeId,
                    identityKey: status.identityKey,
                    workspaceSlug: status.workspaceSlug,
                    status: status.status,
                    updatedAt: status.updatedAt,
                });
            }
            processed += 1;
        }

        return {
            processed,
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});

// Idempotent backfill: paginate through all resumes and upsert resume_analyses
// rows (full analysis blob). Safe to re-run — existing rows are updated in place.
export const backfillResumeAnalyses = mutation({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const numItems = Math.min(args.limit ?? 100, 200);
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems,
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });
        for (const resume of page.page) {
            await doUpsertResumeAnalysis(ctx, resume._id, resume.analysis, resume.analyses);
        }
        return {
            processed: page.page.length,
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});
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
        // Phase 4 Step 3a: overlay the ACTIVE cold analysis (archived filtered,
        // legacy hot fallback) so AND-mode search results show scores without
        // depending on the hot doc's analysis fields. Batched cold fetch avoids N+1.
        const docsById = new Map<string, Doc<"resumes">>();
        for (const doc of docs) {
            if (doc) docsById.set(doc._id, doc);
        }
        const coldRows = await Promise.all(
            [...docsById.keys()].map((id) =>
                ctx.db
                    .query("resume_analyses")
                    .withIndex("by_resume", (q) => q.eq("resumeId", id as Id<"resumes">))
                    .unique(),
            ),
        );
        const coldById = new Map<string, Doc<"resume_analyses">>();
        for (const row of coldRows) {
            if (row && row.status !== "archived") coldById.set(row.resumeId, row);
        }
        return [...docsById.values()].map((doc) => {
            const cold = coldById.get(doc._id);
            // Active cold row wins; else legacy hot fallback (removed in Step 3c).
            const analysis = cold ? cold.analysis : doc.analysis;
            const analyses = cold ? cold.analyses : doc.analyses;
            return {
                _id: doc._id,
                _creationTime: doc._creationTime,
                searchText: doc.searchText,
                isArchived: doc.isArchived,
                source: doc.source,
                primaryRuleScore: doc.primaryRuleScore,
                age: doc.age,
                content: doc.content,
                ingestData: doc.ingestData,
                analysis,
                analyses,
                identityKey: doc.identityKey,
                externalId: doc.externalId,
                tags: doc.tags,
                crawledAt: doc.crawledAt,
            };
        });
    },
});

export const getResumeDocsByIdentityKeys = query({
    args: {
        identityKeys: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const keys = Array.from(
            new Set(
                args.identityKeys
                    .map((key) => key.trim())
                    .filter((key) => key.length > 0)
            )
        ).slice(0, 2000);
        const docs: Doc<"resumes">[] = [];
        const seenDocIds = new Set<string>();

        for (const key of keys) {
            let doc = await ctx.db
                .query("resumes")
                .withIndex("by_identityKey", (q) => q.eq("identityKey", key))
                .order("desc")
                .first();

            if (!doc) {
                const resumeId = ctx.db.normalizeId("resumes", key);
                doc = resumeId ? await ctx.db.get(resumeId) : null;
            }

            if (!doc || doc.isArchived === true || seenDocIds.has(String(doc._id))) {
                continue;
            }

            seenDocIds.add(String(doc._id));
            docs.push(doc);
        }

        return docs.map((doc) => projectResumeListDoc(doc));
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
            .query("resume_digests")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.searchQuery).eq("isArchived", undefined))
            .paginate({
                cursor: args.cursor ?? null,
                numItems: Math.min(args.numItems ?? 256, 256),
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });
        return {
            ids: page.page.map((digest) => String(digest.resumeId)),
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
