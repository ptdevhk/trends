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
    sortResumeDocs,
    sortByIngestRuleScore,
} from "./lib/resumes_list_projections.js";
import { readActiveResumeAnalysis } from "./lib/resume_analysis_read.js";
import {
    matchesResumeDigestFilters,
} from "./lib/resume_digests.js";
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

const CANDIDATE_STATUS_VALUES = [
    "new",
    "shortlisted",
    "rejected",
    "contacted",
    "interviewing",
    "interviewed_pass",
    "interviewed_reject",
    "appeal_submitted",
    "human_review",
    "upheld",
    "reversed",
    "offer",
    "hired",
    "withdrawn",
] as const;

type CandidateStatus = typeof CANDIDATE_STATUS_VALUES[number];
type CandidateStatusCounts = Record<CandidateStatus, number>;
const CANDIDATE_STATUS_SET: ReadonlySet<string> = new Set(CANDIDATE_STATUS_VALUES);

function createCandidateStatusCounts(): CandidateStatusCounts {
    return {
        new: 0,
        shortlisted: 0,
        rejected: 0,
        contacted: 0,
        interviewing: 0,
        interviewed_pass: 0,
        interviewed_reject: 0,
        appeal_submitted: 0,
        human_review: 0,
        upheld: 0,
        reversed: 0,
        offer: 0,
        hired: 0,
        withdrawn: 0,
    };
}

function isCandidateStatus(value: string): value is CandidateStatus {
    return CANDIDATE_STATUS_SET.has(value);
}

function resolveCandidateStatus(value: string | undefined): CandidateStatus {
    return value && isCandidateStatus(value) ? value : "new";
}

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
    getResumeDocsByIdentityKeys,
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

async function getResumeDocsFromDigests(
    ctx: QueryCtx,
    digests: Doc<"resume_digests">[],
): Promise<Doc<"resumes">[]> {
    const docs = await Promise.all(digests.map((digest) => ctx.db.get(digest.resumeId)));
    // Guard against stale digests: the digest row may lag a recent resume archive.
    return docs.filter((doc): doc is Doc<"resumes"> => doc !== null && doc.isArchived !== true);
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
    const digestCandidates = await ctx.db
        .query("resume_digests")
        .withIndex("by_primaryRuleScore")
        .order("desc")
        .take(overfetchLimit);
    const digestFiltered = filters
        ? digestCandidates.filter((digest) => matchesResumeDigestFilters(digest, filters))
        : digestCandidates;
    const candidates = await getResumeDocsFromDigests(ctx, digestFiltered);
    const sorted = sortResumeDocs(candidates, {
        jobDescriptionId,
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
    })
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

        // Phase 4 Step 2: source analysis/analyses from the cold resume_analyses
        // table (joined per resume via by_resume) so backups stay complete after
        // the hot fields are removed. Only ACTIVE rows contribute — archived rows
        // retain stale fields (non-surgical clear flips status only), so reading
        // without the guard would snapshot analyses that are no longer live.
        // Mirrors the active-only contract in listResumeUsageBatch.
        const backupRows = await Promise.all(
            filtered.map(async (row) => {
                const coldRow = await ctx.db
                    .query("resume_analyses")
                    .withIndex("by_resume", (q) => q.eq("resumeId", row._id))
                    .unique();
                if (!coldRow || coldRow.status === "archived") {
                    return { ...row, analysis: undefined, analyses: undefined };
                }
                return { ...row, analysis: coldRow.analysis, analyses: coldRow.analyses };
            }),
        );

        return {
            page: backupRows,
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
        const digestCandidates = await ctx.db
            .query("resume_digests")
            .withIndex("by_primaryRuleScore")
            .order("desc")
            .take(overfetchLimit);
        const candidates = await getResumeDocsFromDigests(ctx, digestCandidates);
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

        // Phase 4 Step 3a: source analysis from the active cold row (archived
        // filtered, legacy hot fallback) so the new-resume feed shows scores
        // without depending on the hot doc's analysis field.
        const resolved = await Promise.all(
            rows.map(async (row) => ({
                row,
                active: await readActiveResumeAnalysis(ctx, row),
            })),
        );
        return resolved.map(({ row, active }) => {
            const content = isRecord(row.content) ? row.content : {};
            const analysis = isRecord(active.analysis) ? active.analysis : undefined;

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
        sources: v.optional(v.array(v.string())),
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
                .query("resume_digests")
                .withIndex("by_primaryRuleScore")
                .order("desc")
                .paginate({
                    ...args.paginationOpts,
                    numItems,
                    maximumBytesRead: PAGINATE_MAX_BYTES_READ,
                    maximumRowsRead: PAGINATE_MAX_ROWS_READ,
                });

            const digestFiltered = filters
                ? page.page.filter((digest) => matchesResumeDigestFilters(digest, filters))
                : page.page;
            const fullDocs = await getResumeDocsFromDigests(ctx, digestFiltered);
            const ranked = jobDescriptionId
                ? sortByIngestRuleScore(fullDocs, jobDescriptionId)
                : fullDocs;

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

        return await projectResumeDetailDoc(ctx, resume);
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
    keywords: v.optional(v.array(v.string())),
    locations: v.optional(v.array(v.string())),
    minSalary: v.optional(v.number()),
    maxSalary: v.optional(v.number()),
    sources: v.optional(v.array(v.string())),
    showBlocked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { workspaceSlug, showBlocked, ...rawFilters } = args;

    // 1. Load workspace status overlay (resume_digest_statuses) first —
    //    it's workspace-scoped and populated by propagation hooks.
    //    Fall back to candidate_status for identities not yet in the overlay
    //    (e.g., after a restore that hasn't backfilled the overlay).
    const overlayStatuses = await ctx.db
      .query("resume_digest_statuses")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceSlug", workspaceSlug)
      )
      .collect();

    const statusByIdentity = new Map<string, string>();
    for (const s of overlayStatuses) {
      statusByIdentity.set(s.identityKey, s.status);
    }

    const candidateStatuses = await ctx.db
      .query("candidate_status")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceSlug", workspaceSlug)
      )
      .collect();
    for (const s of candidateStatuses) {
      if (!statusByIdentity.has(s.identityKey)) {
        statusByIdentity.set(s.identityKey, s.status);
      }
    }

    const blockedIdentities = new Set<string>();
    if (showBlocked !== true) {
      const blocks = await ctx.db
        .query("candidate_blocks")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceSlug", workspaceSlug)
        )
        .collect();
      for (const block of blocks) {
        blockedIdentities.add(block.identityKey);
      }
    }

    // 2. Build normalized filters (always exclude archived)
    const filters = normalizeResumeListFilters({
      ...rawFilters,
      showArchived: false,
    });

    // 3. Scan digest rows for candidate discovery.
    // Digest rows are <1KB each, so we can scan far more than the cold
    // resumes path (~27KB/doc) without hitting the byte limit.
    const MAX_MATCHES = 5000;
    const counts = createCandidateStatusCounts();
    let totalMatched = 0;
    let overflow = false;

    const page = await ctx.db
      .query("resume_digests")
      .paginate({
        cursor: null,
        numItems: MAX_MATCHES,
        maximumBytesRead: 10 * 1024 * 1024,
      });

    for (const digest of page.page) {
      if (totalMatched >= MAX_MATCHES) {
        overflow = true;
        break;
      }
      if (!matchesResumeDigestFilters(digest, filters)) {
        continue;
      }
      const identityKey = digest.identityKey ?? "";
      if (identityKey && blockedIdentities.has(identityKey)) {
        continue;
      }
      const status = statusByIdentity.get(identityKey) ?? "new";
      const bucket = resolveCandidateStatus(status);
      counts[bucket] += 1;
      totalMatched += 1;
    }

    // If the page isn't done, we hit the row limit before reading all digests
    if (!page.isDone) {
      overflow = true;
    }

    return {
      ...counts,
      total: totalMatched,
      overflow,
    };
  },
});
