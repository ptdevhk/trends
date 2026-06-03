import { action, internalQuery, query, type QueryCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import {
    computeVerifiedRoleYears,
    isRecord,
} from "@trends/shared";
import {
    toStringValue,
    toOptionalStringValue,
} from "./resume_helpers.js";
import {
    projectResumeListDoc,
    projectResumeDetailDoc,
    normalizeResumeListFilters,
    matchesResumeListFilters,
    sortResumeDocs,
    sortByIngestRuleScore,
} from "./lib/resumes_list_projections.js";
import type {
    ResumeListPageArgs,
} from "./lib/resumes_list_projections.js";
import {
    DEFAULT_RESUME_LIMIT,
    MAX_SAFE_LIST_WITH_INGEST_LIMIT,
    FILTERED_PAGINATE_OVERFETCH_MULTIPLIER,
    MAX_SAFE_JD_PAGINATE_SCAN,
    MAX_RESUME_SCAN_BATCH_SIZE,
    PAGINATE_MAX_BYTES_READ,
    PAGINATE_MAX_ROWS_READ,
    resolveListWithIngestWindow,
    resolveListWithIngestPageWindow,
    resolvePaginatedResumeOffsetCursor,
    resolvePaginatedResumePageLimit,
    buildPaginatedOffsetResult,
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


// Re-export diagnostics query types for backward compatibility
export type { ResumeWorkflowDatasetRow, ResumeFieldCoverageDatasetRow } from "./resumes_diagnostics.js";

// Re-export diagnostics query definitions for backward compatibility
export {
    listIngestDiagnostics,
    listArchivedDiagnostics,
    listDiagnosticsSourceFacets,
    listWorkflowDatasetPage,
    listFieldCoverageDatasetPage,
} from "./resumes_diagnostics.js";

// Re-export search query definitions for backward compatibility
export {
    search,
    searchWithIngestData,
    searchWithTagExpansion,
    searchWithTagExpansionPage,
    searchWithTagExpansionPaginated,
    searchWithTagExpansionScanPage,
    searchWithTagExpansionAndMode,
    scanResumePageByTime,
    scanResumePageSlim,
    getResumes,
    getResumeDocsByIds,
    collectSearchIndexDocIds,
    getResumesByIds,
} from "./resumes_search.js";

// Re-export mutation definitions for backward compatibility
export {
    updateAnalysis,
    updateAnalysisBatch,
    updateIngestDataBatch,
    listResumeScanBatch,
    listResumeUsageBatch,
    clearAnalyses,
    deleteResumes,
    archiveResumes,
    unarchiveResumes,
    hardResetIngestData,
} from "./resumes_mutations.js";
export type {
    ResumeScanRow,
    ResumeUsageScanRow,
} from "./resumes_mutations.js";

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


export const count = action({
    args: {},
    handler: async (ctx) => {
        let total = 0;
        let cursor: string | undefined;

        while (true) {
            const page = await ctx.runQuery(api.resumes_diagnostics.listWorkflowDatasetPage, {
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

export const countResumesByStatus = query({
    args: {
        workspaceSlug: v.string(),
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
        const { workspaceSlug, ...rawFilters } = args;

        // 1. Load candidate_status for workspace
        const statuses = await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_status", (q) =>
                q.eq("workspaceSlug", workspaceSlug)
            )
            .take(1000);

        const statusByIdentity = new Map<string, string>();
        for (const s of statuses) {
            statusByIdentity.set(s.identityKey, s.status);
        }

        // 2. Build normalized filters (always exclude archived)
        const filters = normalizeResumeListFilters({
            ...rawFilters,
            showArchived: false,
        });

        // 3. Paginate through all non-archived resumes, counting by status
        const MAX_MATCHES = 5000;
        const counts: Record<string, number> = { new: 0, shortlisted: 0, rejected: 0 };
        let totalMatched = 0;
        let cursor: string | null = null;
        let overflow = false;
        const BATCH_SIZE = 200;

        while (true) {
            const page = await ctx.db
                .query("resumes")
                .filter((q) => q.neq(q.field("isArchived"), true))
                .paginate({
                    cursor,
                    numItems: BATCH_SIZE,
                    maximumBytesRead: 10 * 1024 * 1024,
                });

            for (const resume of page.page) {
                if (totalMatched >= MAX_MATCHES) {
                    overflow = true;
                    break;
                }
                if (matchesResumeListFilters(resume, filters)) {
                    const identityKey = resume.identityKey ?? "";
                    const status = statusByIdentity.get(identityKey) ?? "new";
                    if (status in counts) {
                        counts[status] += 1;
                    } else {
                        // Treat unknown statuses as "new"
                        counts.new += 1;
                    }
                    totalMatched += 1;
                }
            }

            if (overflow || page.isDone) break;
            cursor = page.continueCursor;
        }

        return {
            new: counts.new ?? 0,
            shortlisted: counts.shortlisted ?? 0,
            rejected: counts.rejected ?? 0,
            total: totalMatched,
            overflow,
        };
    },
});
