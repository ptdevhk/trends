import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { ingestDataValidator } from "./validators.js";

import {
    buildResumeAnalysisStorageKey,
    computeVerifiedRoleYears,
    isResumeAnalysisKeyForJobDescription,
    KNOWN_DIAGNOSTICS_SOURCE_KEYS,
    resolveResumeAnalysisSourceKey,
    isRecord,
} from "@trends/shared";
import { buildSearchText, mergeSearchTextWithIngestData } from "./search_text";
import {
    toStringValue,
    toOptionalStringValue,
    hasNonEmptyArray,
    readRecordArray,
    hasResumeFieldValue,
    hasWorkHistoryDescriptionEntries,
    splitQueryTokens,
    matchesAllTokens,
} from "./resume_helpers.js";
import {
    matchesDiagnosticsSourceKeys,
    buildDiagnosticsSourceFacetRows,
    projectIngestDiagnosticsRow,
    normalizeDiagnosticsSourceFilterValues,
    MAX_INGEST_DIAGNOSTICS_PAGE_SIZE,
    DIAGNOSTICS_SOURCE_FILTER_BATCH_MULTIPLIER,
    type IngestDiagnosticsRow,
} from "./lib/resumes_diagnostics.js";
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
    projectResumeDetailDoc,
    normalizeResumeListFilters,
    matchesResumeListFilters,
    sortResumeDocs,
    compareResumeListSort,
    resolveResumeListSortOrder,
    getIngestRuleScore,
    sortByIngestRuleScore,
} from "./lib/resumes_list_projections.js";
import type {
    ResumeListProjectedDoc,
    ResumeListPageArgs,
    SearchWithTagExpansionPageArgs,
    SearchWithTagExpansionScanPageArgs,
    DeleteResumesResult,
} from "./lib/resumes_list_projections.js";
import {
    DEFAULT_RESUME_LIMIT,
    MAX_SAFE_LIST_WITH_INGEST_LIMIT,
    FILTERED_PAGINATE_OVERFETCH_MULTIPLIER,
    MAX_SAFE_JD_PAGINATE_SCAN,
    MAX_RESUME_SCAN_BATCH_SIZE,
    PAGINATE_MAX_BYTES_READ,
    PAGINATE_MAX_ROWS_READ,
    MAX_SAFE_SEARCH_PAGINATE_SCAN,
    MAX_SAFE_SEARCH_PAGINATE_SCAN_UNFILTERED,
    resolveListWithIngestWindow,
    resolveSearchWithTagExpansionTakeLimit,
    resolveListWithIngestPageWindow,
    resolvePaginatedResumeOffsetCursor,
    resolvePaginatedResumePageLimit,
    buildPaginatedOffsetResult,
    resolveResumeScanBatchSize,
    resolveResumeBackupPageSize,
} from "./lib/resumes_pagination.js";
import {
    compareResumeBackupRows,
    createResumeBackupFilterSets,
    applyResumeBackupFilters,
    normalizeResumeBackupFetchLimit,
    normalizeResumeBackupArgs,
} from "./lib/resumes_backup.js";

// Re-export for backward compatibility
export {
    toStringValue,
    toOptionalStringValue,
    hasNonEmptyArray,
    readRecordArray,
    hasResumeFieldValue,
    hasWorkHistoryDescriptionEntries,
    toRuleScores,
    resolveRuleScoreLookupKeys,
    splitQueryTokens,
    matchesAllTokens,
} from "./resume_helpers.js";

// Re-export diagnostics helpers for backward compatibility
export {
    resolveDiagnosticsSourceKeyForResume,
    matchesDiagnosticsSourceKeys,
    buildDiagnosticsSourceFacetRows,
    projectIngestDiagnosticsRow,
    normalizeDiagnosticsSourceFilterValues,
} from "./lib/resumes_diagnostics.js";
export type {
    IngestDiagnosticsRow,
    DiagnosticsSourceFacetRow,
    IngestDiagnosticsBrandHit,
    IngestDiagnosticsTaggingEntry,
} from "./lib/resumes_diagnostics.js";

// Re-export tag expansion helpers for backward compatibility
export {
    buildTagExpansionSearchQuery,
    matchesTagExpansionSearchText,
    collectSearchTextProvenance,
} from "./lib/resumes_tag_expansion.js";
export type {
    TagExpansionKeywordGroup,
    SearchProvenance,
} from "./lib/resumes_tag_expansion.js";

// Re-export list projections for backward compatibility
export {
    projectResumeBaseContent,
    projectResumeListWorkHistory,
    projectResumeListContent,
    projectResumeDetailContent,
    projectResumeListIngestData,
    projectResumeListDoc,
    projectResumeDetailDoc,
    normalizeResumeListFilters,
    buildResumeFilterSearchText,
    matchesAllRequiredKeywords,
    hasMatchingRoleSignal,
    getResumeRoleYears,
    resolveResumeAge,
    matchesResumeListFilters,
    resolveResumeListSortOrder,
    compareResumeListSort,
    sortResumeDocs,
} from "./lib/resumes_list_projections.js";
export type {
    ResumeListProjectedDoc,
    ResumeListFilterArgs,
    ResumeListSortBy,
    ResumeListSortOrder,
    ResumeListPageArgs,
    SearchWithTagExpansionPageArgs,
    SearchWithTagExpansionScanPageArgs,
    DeleteResumesResult,
} from "./lib/resumes_list_projections.js";

// Re-export pagination helpers for backward compatibility
export {
    DEFAULT_RESUME_LIMIT,
    MAX_SAFE_LIST_WITH_INGEST_LIMIT,
    MAX_SAFE_LIST_WITH_INGEST_OVERFETCH,
    FILTERED_PAGINATE_OVERFETCH_MULTIPLIER,
    MAX_SAFE_JD_PAGINATE_SCAN,
    MAX_RESUME_SCAN_BATCH_SIZE,
    PAGINATE_MAX_BYTES_READ,
    PAGINATE_MAX_ROWS_READ,
    MAX_SAFE_SEARCH_PAGINATE_SCAN,
    MAX_SAFE_SEARCH_PAGINATE_SCAN_UNFILTERED,
    MAX_SAFE_SEARCH_TAKE_LIMIT,
    resolveListWithIngestWindow,
    resolveSearchWithTagExpansionTakeLimit,
    resolveListWithIngestPageWindow,
    resolvePaginatedResumeOffsetCursor,
    resolvePaginatedResumePageLimit,
    buildPaginatedOffsetResult,
    resolveResumeScanBatchSize,
    resolveResumeBackupPageSize,
} from "./lib/resumes_pagination.js";

// Re-export backup helpers for backward compatibility
export {
    projectResumeBackupRow,
    normalizeResumeBackupFilterValues,
    normalizeResumeBackupSourceHosts,
    compareResumeBackupRows,
    createResumeBackupFilterSets,
    applyResumeBackupFilters,
    normalizeResumeBackupFetchLimit,
    normalizeResumeBackupRequestedLimit,
    normalizeResumeBackupArgs,
} from "./lib/resumes_backup.js";
export type {
    ResumeBackupRow,
    ResumeBackupFilterArgs,
} from "./lib/resumes_backup.js";

export type ResumeScanRow = {
    _id: Doc<"resumes">["_id"];
    content: Doc<"resumes">["content"];
    ingestData: Doc<"resumes">["ingestData"];
    primaryRuleScore: Doc<"resumes">["primaryRuleScore"];
    searchText: Doc<"resumes">["searchText"];
};

export type ResumeUsageScanRow = {
    analysis?: Doc<"resumes">["analysis"];
    analyses?: Doc<"resumes">["analyses"];
};

export type ResumeWorkflowDatasetRow = {
    source: Doc<"resumes">["source"];
    content?: {
        profileType?: string;
    };
};

export type ResumeFieldCoverageDatasetRow = {
    source: Doc<"resumes">["source"];
    profileType?: string;
    profileUrl: boolean;
    resumeId: boolean;
    workHistoryCount: number;
    workHistoryHasDescription: boolean;
    profileEducation: boolean;
    jobIntention: boolean;
    expectedSalary: boolean;
    selfIntro: boolean;
    skills: boolean;
};

function normalizeRequestedResumeIds(resumeIds: string[]): string[] {
    const normalizedIds: string[] = [];
    const seen = new Set<string>();

    for (const resumeId of resumeIds) {
        const token = resumeId.trim();
        if (!token || seen.has(token)) {
            continue;
        }
        seen.add(token);
        normalizedIds.push(token);
    }

    return normalizedIds;
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

async function runListWithIngestDataPageQuery(
    ctx: QueryCtx,
    args: ResumeListPageArgs
): Promise<{
    total: number;
    results: Doc<"resumes">[];
}> {
    const { offset, pageLimit, scanLimit, overfetchLimit } = resolveListWithIngestPageWindow(args.limit, args.offset);
    const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
    const filters = normalizeResumeListFilters(args);
    const candidates = await ctx.db
        .query("resumes")
        .withIndex("by_primaryRuleScore")
        .order("desc")
        .filter((q) => q.neq(q.field("isArchived"), true))
        .take(overfetchLimit);
    const sorted = sortResumeDocs(candidates, {
        jobDescriptionId,
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
    })
        .filter((resume) => matchesResumeListFilters(resume, filters))
        .slice(0, scanLimit);

    return {
        total: sorted.length,
        results: sorted.slice(offset, offset + pageLimit),
    };
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

export const count = action({
    args: {},
    handler: async (ctx) => {
        let total = 0;
        let cursor: string | undefined;

        while (true) {
            const page = await ctx.runQuery(api.resumes.listWorkflowDatasetPage, {
                limit: MAX_RESUME_SCAN_BATCH_SIZE,
                ...(cursor ? { cursor } : {}),
            });

            total += page.page.length;
            if (page.isDone) {
                return total;
            }

            cursor = page.continueCursor ?? undefined;
            if (!cursor) {
                throw new Error("listWorkflowDatasetPage returned an unfinished page without a continueCursor");
            }
        }
    },
});

export const fieldCoverage = query({
    args: {
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const resumes = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: args.batchSize ?? 200,
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });

        let missingSearchText = 0;
        let missingVerifiedRoleYears = 0;
        let hasRoleSignals = 0;
        let hasVerifiedRoleYears = 0;

        for (const resume of resumes.page) {
            if (!resume.searchText) {
                missingSearchText += 1;
            }
            if (resume.ingestData?.roleSignals && resume.ingestData.roleSignals.length > 0) {
                hasRoleSignals += 1;
                const computed = computeVerifiedRoleYears(resume.ingestData.roleSignals);
                const existing = resume.ingestData.verifiedRoleYears;
                if (!shallowEqualNumberRecord(existing, computed)) {
                    missingVerifiedRoleYears += 1;
                }
                if (existing && Object.keys(existing).length > 0) {
                    hasVerifiedRoleYears += 1;
                }
            }
        }

        return {
            scanned: resumes.page.length,
            missingSearchText,
            missingVerifiedRoleYears,
            hasRoleSignals,
            hasVerifiedRoleYears,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

function shallowEqualNumberRecord(
    a: Record<string, number> | undefined,
    b: Record<string, number>,
): boolean {
    if (!a) {
        return Object.keys(b).length === 0;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

export const list = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const limit = args.limit || DEFAULT_RESUME_LIMIT;
        return await ctx.db.query("resumes").order("desc").filter((q) => q.neq(q.field("isArchived"), true)).take(limit);
    },
});

export const listForBackup = query({
    args: {
        paginationOpts: paginationOptsValidator,
        resumeIds: v.optional(v.array(v.string())),
        sourceHosts: v.optional(v.array(v.string())),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const normalizedArgs = normalizeResumeBackupArgs(args);
        const fetchLimit = normalizeResumeBackupFetchLimit(normalizedArgs.limit, normalizedArgs.resumeIds);
        const filterSets = createResumeBackupFilterSets(normalizedArgs);
        const pageSize = resolveResumeBackupPageSize(fetchLimit);
        const page = await ctx.db
            .query("resumes")
            .withIndex("by_crawledAt")
            .order("desc")
            .paginate({
                ...args.paginationOpts,
                numItems: pageSize,
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });

        const filtered = applyResumeBackupFilters(page.page, filterSets).sort(compareResumeBackupRows);

        return {
            page: filtered,
            continueCursor: page.continueCursor,
            isDone: page.isDone,
        };
    },
});

export const listWithIngestData = query({
    args: {
        limit: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { limit, overfetchLimit } = resolveListWithIngestWindow(args.limit);
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        const candidates = await ctx.db
            .query("resumes")
            .withIndex("by_primaryRuleScore")
            .order("desc")
            .filter((q) => q.neq(q.field("isArchived"), true))
            .take(overfetchLimit);
        return sortByIngestRuleScore(candidates, jobDescriptionId)
            .slice(0, limit)
            .map(projectResumeListDoc);
    },
});

export const getSummaryWindow = query({
    args: {
        fromTimestamp: v.number(),
        toTimestamp: v.number(),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query("resumes")
            .withIndex("by_crawledAt", (q) =>
                q.gte("crawledAt", args.fromTimestamp).lt("crawledAt", args.toTimestamp)
            )
            .filter((q) => q.neq(q.field("isArchived"), true))
            .take(10000);

        const bySource = new Map<string, number>();
        for (const row of rows) {
            const sourceKey = row.source.trim() || "unknown";
            bySource.set(sourceKey, (bySource.get(sourceKey) ?? 0) + 1);
        }

        return {
            total: rows.length,
            bySource: Array.from(bySource.entries())
                .map(([key, count]) => ({ key, count }))
                .sort((left, right) => {
                    if (right.count !== left.count) {
                        return right.count - left.count;
                    }
                    return left.key.localeCompare(right.key);
                }),
        };
    },
});

export const listNewForWindow = query({
    args: {
        fromTimestamp: v.number(),
        toTimestamp: v.number(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const maxResults = Math.min(args.limit ?? 100, 500);
        const rows = await ctx.db
            .query("resumes")
            .withIndex("by_crawledAt", (q) =>
                q.gte("crawledAt", args.fromTimestamp).lt("crawledAt", args.toTimestamp)
            )
            .filter((q) => q.neq(q.field("isArchived"), true))
            .order("desc")
            .take(maxResults);

        return rows.map((row) => {
            const content = isRecord(row.content) ? row.content : {};
            const analysis = isRecord(row.analysis) ? row.analysis : undefined;

            return {
                resumeId: String(row._id),
                name: toOptionalStringValue(content.name),
                source: toStringValue(row.source) || "unknown",
                location: toOptionalStringValue(content.location),
                experience: toOptionalStringValue(content.experience),
                education: toOptionalStringValue(content.education),
                score: typeof analysis?.score === "number" ? analysis.score : undefined,
                recommendation: typeof analysis?.recommendation === "string" ? analysis.recommendation : undefined,
                crawledAt: row.crawledAt,
            };
        });
    },
});

export const listWithIngestDataPage = query({
    args: {
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
        const result = await runListWithIngestDataPageQuery(ctx, args);
        return {
            total: result.total,
            results: result.results.map(projectResumeListDoc),
        };
    },
});

export const listWithIngestDataPaginated = query({
    args: {
        paginationOpts: paginationOptsValidator,
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
        const filters = normalizeResumeListFilters(args);
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        if (!args.sortBy) {
            const requestedPageSize = resolvePaginatedResumePageLimit(args.paginationOpts.numItems);
            const numItems = jobDescriptionId
                ? Math.min(
                    Math.max(
                        requestedPageSize,
                        filters ? Math.ceil(requestedPageSize * 1.5) : requestedPageSize
                    ),
                    MAX_SAFE_JD_PAGINATE_SCAN
                )
                : filters
                    ? Math.min(requestedPageSize * FILTERED_PAGINATE_OVERFETCH_MULTIPLIER, MAX_SAFE_LIST_WITH_INGEST_LIMIT)
                    : requestedPageSize;
            const page = await ctx.db
                .query("resumes")
                .withIndex("by_primaryRuleScore")
                .order("desc")
                .filter((q) => q.neq(q.field("isArchived"), true))
                .paginate({
                    ...args.paginationOpts,
                    numItems,
                    maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                    maximumRowsRead: PAGINATE_MAX_ROWS_READ,
                });

            const filtered = filters
                ? page.page.filter((resume) => matchesResumeListFilters(resume, filters))
                : page.page;
            const ranked = jobDescriptionId
                ? sortByIngestRuleScore(filtered, jobDescriptionId)
                : filtered;

            return {
                page: ranked.map(projectResumeListDoc),
                continueCursor: page.continueCursor,
                isDone: page.isDone,
            };
        }

        const offset = resolvePaginatedResumeOffsetCursor(args.paginationOpts.cursor);
        const limit = resolvePaginatedResumePageLimit(args.paginationOpts.numItems);
        const page = await runListWithIngestDataPageQuery(ctx, {
            ...args,
            limit,
            offset,
        });

        return buildPaginatedOffsetResult(page.results.map(projectResumeListDoc), page.total, offset);
    },
});

function buildDiagnosticsBaseQuery(ctx: QueryCtx, archived: boolean) {
    return ctx.db
        .query("resumes")
        .withIndex("by_primaryRuleScore")
        .order("desc")
        .filter((q) => archived ? q.eq(q.field("isArchived"), true) : q.neq(q.field("isArchived"), true));
}

async function runDiagnosticsPageQuery(
    ctx: QueryCtx,
    args: {
        archived: boolean;
        paginationOpts: {
            cursor: string | null;
            numItems: number;
        };
        sourceKeys?: string[];
    }
): Promise<{
    page: IngestDiagnosticsRow[];
    continueCursor: string;
    isDone: boolean;
}> {
    const requestedPageSize = Math.min(args.paginationOpts.numItems, MAX_INGEST_DIAGNOSTICS_PAGE_SIZE);
    const normalizedSourceKeys = normalizeDiagnosticsSourceFilterValues(args.sourceKeys);
    if (!normalizedSourceKeys || normalizedSourceKeys.length === 0) {
        const page = await buildDiagnosticsBaseQuery(ctx, args.archived).paginate({
            ...args.paginationOpts,
            numItems: requestedPageSize,
            maximumBytesRead: PAGINATE_MAX_BYTES_READ,
            maximumRowsRead: PAGINATE_MAX_ROWS_READ,
        });

        return {
            page: page.page.map(projectIngestDiagnosticsRow),
            continueCursor: page.continueCursor,
            isDone: page.isDone,
        };
    }

    // Convex allows only a single .paginate() per query invocation.
    // Do one oversized page, filter in-memory, and let the API caller
    // continue with the returned cursor for more results.
    const sourceKeySet = new Set(normalizedSourceKeys);
    const scanBatchSize = Math.min(
        requestedPageSize * DIAGNOSTICS_SOURCE_FILTER_BATCH_MULTIPLIER,
        MAX_INGEST_DIAGNOSTICS_PAGE_SIZE * DIAGNOSTICS_SOURCE_FILTER_BATCH_MULTIPLIER,
    );

    const page = await buildDiagnosticsBaseQuery(ctx, args.archived).paginate({
        cursor: args.paginationOpts.cursor,
        numItems: scanBatchSize,
        maximumBytesRead: PAGINATE_MAX_BYTES_READ,
        maximumRowsRead: PAGINATE_MAX_ROWS_READ,
    });

    const matched = page.page
        .filter((resume) => matchesDiagnosticsSourceKeys(resume, sourceKeySet))
        .slice(0, requestedPageSize)
        .map(projectIngestDiagnosticsRow);

    return {
        page: matched,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
    };
}

export const listIngestDiagnostics = query({
    args: {
        paginationOpts: paginationOptsValidator,
        sourceKeys: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return runDiagnosticsPageQuery(ctx, {
            archived: false,
            paginationOpts: args.paginationOpts,
            sourceKeys: args.sourceKeys,
        });
    },
});

export const listArchivedDiagnostics = query({
    args: {
        paginationOpts: paginationOptsValidator,
        sourceKeys: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return runDiagnosticsPageQuery(ctx, {
            archived: true,
            paginationOpts: args.paginationOpts,
            sourceKeys: args.sourceKeys,
        });
    },
});

export const listDiagnosticsSourceFacets = action({
    args: {
        archived: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const archived = args.archived === true;

        async function countForKey(sourceKey: string): Promise<[string, number]> {
            let cursor: string | null = null;
            let count = 0;
            let isDone = false;
            while (!isDone) {
                const result: { count: number; cursor: string | null; isDone: boolean } = await ctx.runQuery(
                    internal.resumes.countSourceKeyPage,
                    { sourceKey, archived, cursor: cursor ?? undefined },
                );
                count += result.count;
                cursor = result.cursor;
                isDone = result.isDone;
            }
            return [sourceKey, count];
        }

        const entries = await Promise.all(KNOWN_DIAGNOSTICS_SOURCE_KEYS.map(countForKey));
        const counts = new Map<string, number>();
        for (const [key, count] of entries) {
            if (count > 0) {
                counts.set(key, count);
            }
        }

        return buildDiagnosticsSourceFacetRows(counts);
    },
});

export const countSourceKeyPage = internalQuery({
    args: {
        sourceKey: v.string(),
        archived: v.boolean(),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
            .paginate({ cursor: args.cursor ?? null, numItems: 50, maximumBytesRead: PAGINATE_MAX_BYTES_READ, maximumRowsRead: PAGINATE_MAX_ROWS_READ });
        let count = 0;
        for (const r of page.page) {
            if (args.archived ? r.isArchived === true : r.isArchived !== true) {
                count += 1;
            }
        }
        return {
            count,
            cursor: page.continueCursor,
            isDone: page.isDone,
        };
    },
});

export const listWorkflowDatasetPage = query({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .filter((q) => q.neq(q.field("isArchived"), true))
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.limit),
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });

        return {
            continueCursor: page.continueCursor,
            isDone: page.isDone,
            page: page.page.map((resume): ResumeWorkflowDatasetRow => {
                const content = isRecord(resume.content) ? resume.content : {};
                const profileType = toOptionalStringValue(content.profileType);
                return {
                    source: resume.source,
                    ...(profileType ? { content: { profileType } } : {}),
                };
            }),
        };
    },
});

export const listFieldCoverageDatasetPage = query({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .filter((q) => q.neq(q.field("isArchived"), true))
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.limit),
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });

        return {
            continueCursor: page.continueCursor,
            isDone: page.isDone,
            page: page.page.map((resume): ResumeFieldCoverageDatasetRow => {
                const content = isRecord(resume.content) ? resume.content : {};
                const profileType = toOptionalStringValue(content.profileType);
                const workHistory = readRecordArray(content.workHistory);
                return {
                    source: resume.source,
                    ...(profileType ? { profileType } : {}),
                    profileUrl: hasResumeFieldValue(content, ["profileUrl", "profile_url", "profileURL", "url"]),
                    resumeId: hasResumeFieldValue(content, ["resumeId"]),
                    workHistoryCount: workHistory.length,
                    workHistoryHasDescription: hasWorkHistoryDescriptionEntries(workHistory),
                    profileEducation: hasNonEmptyArray(content.profileEducation),
                    jobIntention: hasResumeFieldValue(content, ["jobIntention"]),
                    expectedSalary: hasResumeFieldValue(content, ["expectedSalary"]),
                    selfIntro: hasResumeFieldValue(content, ["selfIntro"]),
                    skills: hasNonEmptyArray(content.skills),
                };
            }),
        };
    },
});

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

export const getResume = internalQuery({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.resumeId);
    },
});

export const getResumeDetail = query({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) {
            return null;
        }

        return projectResumeDetailDoc(resume);
    },
});

export const getByIdsForExport = query({
    args: {
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        const docs = await Promise.all(args.resumeIds.map((resumeId) => ctx.db.get(resumeId)));
        return docs
            .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
            .map((doc) => {
                const content = isRecord(doc.content) ? doc.content : {};
                return {
                    resumeId: String(doc._id),
                    resume: {
                        externalId: doc.externalId,
                        name: toOptionalStringValue(content.name),
                        jobIntention: toOptionalStringValue(content.jobIntention),
                        location: toOptionalStringValue(content.location),
                        age: toOptionalStringValue(content.age) ?? (typeof doc.age === "number" ? String(doc.age) : undefined),
                        experience: toOptionalStringValue(content.experience),
                        education: toOptionalStringValue(content.education),
                        expectedSalary: toOptionalStringValue(content.expectedSalary),
                        profileUrl: toOptionalStringValue(content.profileUrl)
                            ?? toOptionalStringValue(content.profile_url)
                            ?? toOptionalStringValue(content.profileURL)
                            ?? toOptionalStringValue(content.url),
                        source: doc.source,
                        selfIntro: toOptionalStringValue(content.selfIntro),
                        workHistory: Array.isArray(content.workHistory) ? content.workHistory : undefined,
                        ingestData: doc.ingestData ? {
                            industryTags: doc.ingestData.industryTags,
                            brandHits: doc.ingestData.brandHits,
                            companyHits: doc.ingestData.companyHits,
                            industryDbV2Raw: doc.ingestData.industryDbV2Raw,
                            roleSignals: doc.ingestData.roleSignals,
                        } : undefined,
                    },
                };
            });
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

// Keep scanResumePageSlim and getResumeDocsByIds for backward compatibility
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
            const page = await ctx.runQuery(internal.resumes.collectSearchIndexDocIds, {
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
            const docs = await ctx.runQuery(internal.resumes.getResumesByIds, {
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

export const updateAnalysis = internalMutation({
    args: {
        resumeId: v.id("resumes"),
        analysis: v.object({
            score: v.number(),
            summary: v.string(),
            highlights: v.array(v.string()),
            recommendation: v.string(),
            breakdown: v.optional(v.record(v.string(), v.number())),
            keyFactors: v.optional(v.array(v.object({
                factor: v.string(),
                weight: v.optional(v.number()),
                value: v.string(),
            }))),
            jobDescriptionId: v.optional(v.string()),
            promptVersion: v.optional(v.number()),
            locale: v.optional(v.string()),
            queryLocation: v.optional(v.string()),
            analyzedAt: v.optional(v.number()),
        }),
    },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) throw new Error("Resume not found");

        const analyses = resume.analyses || {};
        const analysisKey = buildResumeAnalysisStorageKey(args.analysis.jobDescriptionId, {
            sourceKey: resolveResumeAnalysisSourceKey({ source: resume.source }),
            locale: args.analysis.locale,
        });

        analyses[analysisKey] = args.analysis;

        await ctx.db.patch(args.resumeId, {
            analysis: args.analysis, // Keep current for backward compat / easy access
            analyses: analyses,      // Store in cache
        });
    },
});

export const updateAnalysisBatch = internalMutation({
    args: {
        updates: v.array(v.object({
            resumeId: v.id("resumes"),
            analysis: v.object({
                score: v.number(),
                summary: v.string(),
                highlights: v.array(v.string()),
                recommendation: v.string(),
                breakdown: v.optional(v.record(v.string(), v.number())),
                keyFactors: v.optional(v.array(v.object({
                    factor: v.string(),
                    weight: v.optional(v.number()),
                    value: v.string(),
                }))),
                jobDescriptionId: v.optional(v.string()),
                promptVersion: v.optional(v.number()),
                locale: v.optional(v.string()),
                queryLocation: v.optional(v.string()),
                analyzedAt: v.optional(v.number()),
            }),
        })),
    },
    handler: async (ctx, args) => {
        await Promise.all(args.updates.map(async (update) => {
            const resume = await ctx.db.get(update.resumeId);
            if (!resume) return;

            const analyses = resume.analyses || {};
            const analysisKey = buildResumeAnalysisStorageKey(update.analysis.jobDescriptionId, {
                sourceKey: resolveResumeAnalysisSourceKey({ source: resume.source }),
                locale: update.analysis.locale,
            });
            analyses[analysisKey] = update.analysis;

            await ctx.db.patch(update.resumeId, {
                analysis: update.analysis,
                analyses: analyses,
            });
        }));
    },
});

export const updateIngestDataBatch = internalMutation({
    args: {
        updates: v.array(v.object({
            resumeId: v.id("resumes"),
            ingestData: ingestDataValidator,
            companyPatternAliasTokens: v.optional(v.string()),
            primaryRuleScore: v.optional(v.number()),
        })),
    },
    handler: async (ctx, args) => {
        await Promise.all(args.updates.map(async (update) => {
            const resume = await ctx.db.get(update.resumeId);
            if (!resume) return;

            const patch: Partial<Doc<"resumes">> = {
                ingestData: update.ingestData,
                primaryRuleScore: update.primaryRuleScore ?? 0,
            };

            const existingSearchText = resume.searchText || "";
            // After hard reset, searchText is empty — rebuild from content + ingest tokens.
            // When searchText already exists, just merge ingest tokens on top.
            const baseSearchText = existingSearchText || buildSearchText(resume.content);
            const nextSearchText = mergeSearchTextWithIngestData(baseSearchText, {
                industryTags: update.ingestData.industryTags,
                synonymHits: update.ingestData.synonymHits,
                brandHits: update.ingestData.brandHits,
                companyHits: update.ingestData.companyHits,
                companyPatternAliasTokens: update.companyPatternAliasTokens?.trim().toLowerCase(),
            });

            if (nextSearchText !== existingSearchText) {
                patch.searchText = nextSearchText;
            }

            await ctx.db.patch(update.resumeId, patch);
        }));
    },
});

export const listResumeScanBatch = internalQuery({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.limit),
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });

        return {
            continueCursor: page.continueCursor,
            isDone: page.isDone,
            page: page.page.map((resume): ResumeScanRow => ({
                _id: resume._id,
                content: resume.content,
                ingestData: resume.ingestData,
                primaryRuleScore: resume.primaryRuleScore,
                searchText: resume.searchText,
            })),
        };
    },
});

export const listResumeUsageBatch = internalQuery({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.limit),
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });

        return {
            continueCursor: page.continueCursor,
            isDone: page.isDone,
            page: page.page.map((resume): ResumeUsageScanRow => ({
                analysis: resume.analysis,
                analyses: resume.analyses,
            })),
        };
    },
});

export const clearAnalyses = mutation({
    args: {
        resumeIds: v.optional(v.array(v.id("resumes"))),
        jobDescriptionId: v.optional(v.string()),
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = args.resumeIds
            ? undefined
            : await ctx.db
                .query("resumes")
                .order("desc")
                .paginate({
                    cursor: args.cursor ?? null,
                    numItems: resolveResumeScanBatchSize(args.batchSize),
                    maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                    maximumRowsRead: PAGINATE_MAX_ROWS_READ,
                });
        const resumes = args.resumeIds
            ? await Promise.all(args.resumeIds.map((id) => ctx.db.get(id)))
            : page?.page ?? [];

        let cleared = 0;
        for (const resume of resumes) {
            if (!resume) continue;
            if (!resume.analysis && !resume.analyses) continue;

            if (args.jobDescriptionId && resume.analyses) {
                const analyses = { ...resume.analyses };
                const matchingKeys = Object.keys(analyses).filter((key) =>
                    isResumeAnalysisKeyForJobDescription(key, args.jobDescriptionId)
                );
                if (matchingKeys.length > 0) {
                    for (const key of matchingKeys) {
                        delete analyses[key];
                    }
                    const isCurrentAnalysis = resume.analysis?.jobDescriptionId === args.jobDescriptionId;
                    await ctx.db.patch(resume._id, {
                        analyses,
                        ...(isCurrentAnalysis ? { analysis: undefined } : {}),
                    });
                    cleared += 1;
                }
            } else {
                await ctx.db.patch(resume._id, {
                    analysis: undefined,
                    analyses: undefined,
                });
                cleared += 1;
            }
        }

        if (args.resumeIds) {
            return { cleared, hasMore: false, cursor: null };
        }

        return {
            cleared,
            hasMore: page ? !page.isDone : false,
            cursor: page && !page.isDone ? page.continueCursor : null,
        };
    },
});

export const deleteResumes = mutation({
    args: {
        resumeIds: v.array(v.string()),
    },
    returns: v.object({
        requested: v.number(),
        deleted: v.number(),
        missingResumeIds: v.array(v.string()),
        deletedAiTaggingResults: v.number(),
        patchedScreeningSessions: v.number(),
    }),
    handler: async (ctx, args): Promise<DeleteResumesResult> => {
        const requestedResumeIds = normalizeRequestedResumeIds(args.resumeIds);
        if (requestedResumeIds.length === 0) {
            return {
                requested: 0,
                deleted: 0,
                missingResumeIds: [],
                deletedAiTaggingResults: 0,
                patchedScreeningSessions: 0,
            };
        }

        const resolvedEntries = requestedResumeIds.map((resumeId) => ({
            requestedResumeId: resumeId,
            normalizedResumeId: ctx.db.normalizeId("resumes", resumeId),
        }));
        const missingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId === null)
            .map((entry) => entry.requestedResumeId);
        const normalizedResumeIds = resolvedEntries
            .flatMap((entry) => (entry.normalizedResumeId ? [entry.normalizedResumeId] : []));

        if (normalizedResumeIds.length === 0) {
            return {
                requested: requestedResumeIds.length,
                deleted: 0,
                missingResumeIds,
                deletedAiTaggingResults: 0,
                patchedScreeningSessions: 0,
            };
        }

        const resumes = await Promise.all(normalizedResumeIds.map((resumeId) => ctx.db.get(resumeId)));
        const existingResumes = resumes.filter((resume): resume is NonNullable<typeof resume> => resume !== null);
        const existingResumeIds = existingResumes.map((resume) => resume._id);
        const existingResumeIdStrings = new Set(existingResumeIds.map((resumeId) => String(resumeId)));
        const missingExistingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId !== null && !existingResumeIdStrings.has(String(entry.normalizedResumeId)))
            .map((entry) => entry.requestedResumeId);

        if (existingResumes.length === 0) {
            return {
                requested: requestedResumeIds.length,
                deleted: 0,
                missingResumeIds: [...missingResumeIds, ...missingExistingResumeIds],
                deletedAiTaggingResults: 0,
                patchedScreeningSessions: 0,
            };
        }

        let deletedAiTaggingResults = 0;
        // Collect all tagging results for all resumeIds in batches of 50 to avoid
        // unbounded concurrent queries that can exhaust Convex limits.
        const BATCH_SIZE = 50;
        const allTaggingResults: Array<{ _id: Id<"ai_tagging_results"> }> = [];
        for (let i = 0; i < existingResumeIds.length; i += BATCH_SIZE) {
            const batchIds = existingResumeIds.slice(i, i + BATCH_SIZE);
            const taggingBatches = await Promise.all(
                batchIds.map((resumeId) =>
                    ctx.db
                        .query("ai_tagging_results")
                        .withIndex("by_resume_profile", (q) => q.eq("resumeId", resumeId))
                        .collect()
                )
            );
            for (const batch of taggingBatches) {
                allTaggingResults.push(...batch);
            }
        }
        for (const taggingResult of allTaggingResults) {
            await ctx.db.delete(taggingResult._id);
            deletedAiTaggingResults += 1;
        }

        const deletedResumeIdStrings = new Set(existingResumeIds.map((resumeId) => String(resumeId)));
        let patchedScreeningSessions = 0;
        let cursor = null;
        let isDone = false;
        while (!isDone) {
            const result = await ctx.db.query("screening_sessions").paginate({ numItems: 100, cursor, maximumBytesRead: PAGINATE_MAX_BYTES_READ, maximumRowsRead: PAGINATE_MAX_ROWS_READ });
            for (const session of result.page) {
                const reviewedResumeIds = session.reviewedResumeIds.filter((resumeId) => !deletedResumeIdStrings.has(resumeId));
                if (reviewedResumeIds.length === session.reviewedResumeIds.length) {
                    continue;
                }

                await ctx.db.patch(session._id, { reviewedResumeIds });
                patchedScreeningSessions += 1;
            }
            cursor = result.continueCursor;
            isDone = result.isDone;
        }

        for (const resume of existingResumes) {
            await ctx.db.delete(resume._id);
        }

        return {
            requested: requestedResumeIds.length,
            deleted: existingResumes.length,
            missingResumeIds: [...missingResumeIds, ...missingExistingResumeIds],
            deletedAiTaggingResults,
            patchedScreeningSessions,
        };
    },
});

export const archiveResumes = mutation({
    args: {
        resumeIds: v.array(v.string()),
    },
    returns: v.object({
        requested: v.number(),
        archived: v.number(),
        alreadyArchived: v.number(),
        missingResumeIds: v.array(v.string()),
    }),
    handler: async (ctx, args) => {
        const requestedResumeIds = normalizeRequestedResumeIds(args.resumeIds);
        if (requestedResumeIds.length === 0) {
            return { requested: 0, archived: 0, alreadyArchived: 0, missingResumeIds: [] };
        }

        const resolvedEntries = requestedResumeIds.map((resumeId) => ({
            requestedResumeId: resumeId,
            normalizedResumeId: ctx.db.normalizeId("resumes", resumeId),
        }));
        const missingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId === null)
            .map((entry) => entry.requestedResumeId);
        const normalizedResumeIds = resolvedEntries
            .flatMap((entry) => (entry.normalizedResumeId ? [entry.normalizedResumeId] : []));

        if (normalizedResumeIds.length === 0) {
            return { requested: requestedResumeIds.length, archived: 0, alreadyArchived: 0, missingResumeIds };
        }

        const resumes = await Promise.all(normalizedResumeIds.map((resumeId) => ctx.db.get(resumeId)));
        const existingResumes = resumes.filter((resume): resume is NonNullable<typeof resume> => resume !== null);
        const existingResumeIdStrings = new Set(existingResumes.map((resume) => String(resume._id)));
        const missingExistingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId !== null && !existingResumeIdStrings.has(String(entry.normalizedResumeId)))
            .map((entry) => entry.requestedResumeId);

        let archived = 0;
        let alreadyArchived = 0;
        const now = Date.now();
        await Promise.all(existingResumes.map(async (resume) => {
            if (resume.isArchived === true) {
                alreadyArchived += 1;
                return;
            }
            await ctx.db.patch(resume._id, { isArchived: true, archivedAt: now });
            archived += 1;
        }));

        return {
            requested: requestedResumeIds.length,
            archived,
            alreadyArchived,
            missingResumeIds: [...missingResumeIds, ...missingExistingResumeIds],
        };
    },
});

export const unarchiveResumes = mutation({
    args: {
        resumeIds: v.array(v.string()),
    },
    returns: v.object({
        requested: v.number(),
        unarchived: v.number(),
        notArchived: v.number(),
        missingResumeIds: v.array(v.string()),
    }),
    handler: async (ctx, args) => {
        const requestedResumeIds = normalizeRequestedResumeIds(args.resumeIds);
        if (requestedResumeIds.length === 0) {
            return { requested: 0, unarchived: 0, notArchived: 0, missingResumeIds: [] };
        }

        const resolvedEntries = requestedResumeIds.map((resumeId) => ({
            requestedResumeId: resumeId,
            normalizedResumeId: ctx.db.normalizeId("resumes", resumeId),
        }));
        const missingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId === null)
            .map((entry) => entry.requestedResumeId);
        const normalizedResumeIds = resolvedEntries
            .flatMap((entry) => (entry.normalizedResumeId ? [entry.normalizedResumeId] : []));

        if (normalizedResumeIds.length === 0) {
            return { requested: requestedResumeIds.length, unarchived: 0, notArchived: 0, missingResumeIds };
        }

        const resumes = await Promise.all(normalizedResumeIds.map((resumeId) => ctx.db.get(resumeId)));
        const existingResumes = resumes.filter((resume): resume is NonNullable<typeof resume> => resume !== null);
        const existingResumeIdStrings = new Set(existingResumes.map((resume) => String(resume._id)));
        const missingExistingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId !== null && !existingResumeIdStrings.has(String(entry.normalizedResumeId)))
            .map((entry) => entry.requestedResumeId);

        let unarchived = 0;
        let notArchived = 0;
        await Promise.all(existingResumes.map(async (resume) => {
            if (resume.isArchived !== true) {
                notArchived += 1;
                return;
            }
            await ctx.db.patch(resume._id, { isArchived: undefined, archivedAt: undefined });
            unarchived += 1;
        }));

        return {
            requested: requestedResumeIds.length,
            unarchived,
            notArchived,
            missingResumeIds: [...missingResumeIds, ...missingExistingResumeIds],
        };
    },
});

export const hardResetIngestData = mutation({
    args: {
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const resumes = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.batchSize),
                maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                maximumRowsRead: PAGINATE_MAX_ROWS_READ,
            });
        let cleared = 0;

        for (const resume of resumes.page) {
            const hasComputedFields = resume.ingestData !== undefined
                || resume.analysis !== undefined
                || resume.analyses !== undefined
                || resume.primaryRuleScore !== undefined
                || resume.searchText !== undefined;

            if (!hasComputedFields) {
                continue;
            }

            await ctx.db.patch(resume._id, {
                ingestData: undefined,
                analysis: undefined,
                analyses: undefined,
                primaryRuleScore: undefined,
                searchText: undefined,
            });
            cleared += 1;
        }

        return {
            cleared,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});
