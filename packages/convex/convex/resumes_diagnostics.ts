/**
 * Diagnostic and dataset query definitions for resume analytics.
 *
 * Extracted from resumes.ts to reduce its size. Contains ingest diagnostics,
 * source facets, workflow dataset, and field coverage queries.
 */
import { action, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { KNOWN_DIAGNOSTICS_SOURCE_KEYS, isRecord } from "@trends/shared";
import {
    toOptionalStringValue,
    hasNonEmptyArray,
    readRecordArray,
    hasResumeFieldValue,
    hasWorkHistoryDescriptionEntries,
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
    PAGINATE_MAX_BYTES_READ,
    PAGINATE_MAX_ROWS_READ,
    resolveResumeScanBatchSize,
} from "./lib/resumes_pagination.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Query / Action definitions
// ---------------------------------------------------------------------------

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
                    internal.resumes_diagnostics.countSourceKeyPage,
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
        for (const [key, countVal] of entries) {
            if (countVal > 0) {
                counts.set(key, countVal);
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
