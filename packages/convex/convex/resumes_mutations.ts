import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { ingestDataValidator, resumeAnalysisValidator } from "./validators.js";
import { doUpsertResumeDigest, doUpsertResumeAnalysis } from "./resumes_search.js";

import {
    buildResumeAnalysisStorageKey,
    isResumeAnalysisKeyForJobDescription,
    resolveResumeAnalysisSourceKey,
} from "@trends/shared";
import { buildSearchText, mergeSearchTextWithIngestData } from "./search_text";
import type {
    DeleteResumesResult,
} from "./lib/resumes_list_projections.js";
import { readActiveResumeAnalysis } from "./lib/resume_analysis_read.js";
import {
    PAGINATE_MAX_BYTES_READ,
    PAGINATE_MAX_ROWS_READ,
    resolveResumeScanBatchSize,
} from "./lib/resumes_pagination.js";

// ---------------------------------------------------------------------------
// Workspace access guard (defense-in-depth)
// ---------------------------------------------------------------------------

/**
 * Verify that requested resume IDs belong to the given workspace.
 * When workspaceSlug is absent, the guard is skipped (backward compat with
 * existing BFF-only auth path).
 *
 * Throws on first mismatch to prevent partial execution.
 */
async function requireWorkspaceAccess(ctx: MutationCtx, resumeIds: string[], workspaceSlug?: string): Promise<void> {
    if (!workspaceSlug) return;
    for (const id of resumeIds) {
        const normalizedId = ctx.db.normalizeId("resumes", id);
        if (!normalizedId) continue;
        const resume = await ctx.db.get(normalizedId);
        const resumeWs = resume?.workspaceSlug;
        if (typeof resumeWs === "string" && resumeWs !== workspaceSlug) {
            throw new Error(
                `Workspace access denied: resume ${id} belongs to workspace "${resumeWs}", not "${workspaceSlug}"`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal mutations
// ---------------------------------------------------------------------------

export const updateAnalysis = internalMutation({
    args: {
        resumeId: v.id("resumes"),
        analysis: resumeAnalysisValidator,
    },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) throw new Error("Resume not found");

        // Phase 4 Step 3a: source the cached analyses map from the ACTIVE cold
        // row (with legacy hot fallback) instead of the hot doc. Stop writing
        // analysis/analyses onto the hot resumes doc — the cold table is now
        // authoritative; the digest upsert reads display fields from it.
        const activeAnalysis = await readActiveResumeAnalysis(ctx, resume);
        const analyses = { ...(activeAnalysis.analyses ?? {}) };
        const analysisKey = buildResumeAnalysisStorageKey(args.analysis.jobDescriptionId, {
            sourceKey: resolveResumeAnalysisSourceKey({ source: resume.source }),
            locale: args.analysis.locale,
        });

        analyses[analysisKey] = args.analysis;

        // Phase 3: propagate to digest (display fields) + cold analysis table.
        // doUpsertResumeAnalysis makes the cold row active and authoritative.
        const updated = await ctx.db.get(args.resumeId);
        if (updated) {
            await doUpsertResumeAnalysis(ctx, args.resumeId, args.analysis, analyses);
            await doUpsertResumeDigest(ctx, updated);
        }
    },
});

export const updateAnalysisBatch = internalMutation({
    args: {
        updates: v.array(v.object({
            resumeId: v.id("resumes"),
            analysis: resumeAnalysisValidator,
        })),
    },
    handler: async (ctx, args) => {
        await Promise.all(args.updates.map(async (update) => {
            const resume = await ctx.db.get(update.resumeId);
            if (!resume) return;

            // Phase 4 Step 3a: cold-only. Source the cached map from the active
            // cold row (legacy hot fallback); do not write analysis/analyses hot.
            const activeAnalysis = await readActiveResumeAnalysis(ctx, resume);
            const analyses = { ...(activeAnalysis.analyses ?? {}) };
            const analysisKey = buildResumeAnalysisStorageKey(update.analysis.jobDescriptionId, {
                sourceKey: resolveResumeAnalysisSourceKey({ source: resume.source }),
                locale: update.analysis.locale,
            });
            analyses[analysisKey] = update.analysis;

            const updated = await ctx.db.get(update.resumeId);
            if (updated) {
                await doUpsertResumeAnalysis(ctx, update.resumeId, update.analysis, analyses);
                await doUpsertResumeDigest(ctx, updated);
            }
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
            await ctx.runMutation(internal.resumes_search.upsertResumeDigest, { resumeId: update.resumeId });
        }));
    },
});

// ---------------------------------------------------------------------------
// Internal queries (scan batches)
// ---------------------------------------------------------------------------

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

        // Phase 4 Step 1: source analysis/analyses from the cold resume_analyses
        // table instead of the hot resume doc, so JD-usage counts survive the
        // upcoming removal of analysis/analyses from the resumes schema.
        //
        // Only ACTIVE rows contribute. A non-surgical clearAnalyses archives the
        // cold row but leaves its analysis/analyses fields populated (only the
        // status flips); the hot doc, by contrast, is set to undefined. Reading
        // without the status guard would therefore over-count archived resumes.
        // status === undefined is treated as active (pre-Phase-1 rows).
        const rows = await Promise.all(
            page.page.map(async (resume): Promise<ResumeUsageScanRow> => {
                const coldRow = await ctx.db
                    .query("resume_analyses")
                    .withIndex("by_resume", (q) => q.eq("resumeId", resume._id))
                    .unique();
                if (!coldRow || coldRow.status === "archived") {
                    return { analysis: undefined, analyses: undefined };
                }
                return { analysis: coldRow.analysis, analyses: coldRow.analyses };
            }),
        );

        return {
            continueCursor: page.continueCursor,
            isDone: page.isDone,
            page: rows,
        };
    },
});

// ---------------------------------------------------------------------------
// Public mutations
// ---------------------------------------------------------------------------

export const clearAnalyses = mutation({
    args: {
        resumeIds: v.optional(v.array(v.id("resumes"))),
        jobDescriptionId: v.optional(v.string()),
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
        workspaceSlug: v.optional(v.string()),
        dryRun: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        if (args.resumeIds) {
            await requireWorkspaceAccess(ctx, args.resumeIds.map(String), args.workspaceSlug);
        }
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

            // Phase 4 Step 3a: clear is cold-authoritative. Resolve the active
            // cold analysis (legacy hot fallback) to decide skip + surgical
            // matching; the cold row is the only thing we patch.
            const coldRow = await ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resume._id))
                .unique();
            const activeAnalysis = coldRow && coldRow.status !== "archived"
                ? { analysis: coldRow.analysis, analyses: coldRow.analyses }
                : { analysis: resume.analysis, analyses: resume.analyses };
            const hasAnalysis = activeAnalysis.analysis !== undefined
                || (activeAnalysis.analyses !== undefined && Object.keys(activeAnalysis.analyses).length > 0);
            if (!hasAnalysis) continue;

            // Surgical (jobDescriptionId) clear → remove matching keys from the
            // cold map; archive only if the map is empty AND no current analysis.
            if (args.jobDescriptionId && activeAnalysis.analyses) {
                const analyses = { ...activeAnalysis.analyses };
                const matchingKeys = Object.keys(analyses).filter((key) =>
                    isResumeAnalysisKeyForJobDescription(key, args.jobDescriptionId)
                );
                if (matchingKeys.length > 0) {
                    for (const key of matchingKeys) {
                        delete analyses[key];
                    }
                    const isCurrentAnalysis = activeAnalysis.analysis?.jobDescriptionId === args.jobDescriptionId;
                    // Sync cold row: archive only if map is now empty AND no current analysis.
                    if (coldRow && !args.dryRun) {
                        const remainingKeys = Object.keys(analyses).length;
                        const hasCurrent = isCurrentAnalysis ? false : activeAnalysis.analysis !== undefined;
                        if (remainingKeys === 0 && !hasCurrent) {
                            await ctx.db.patch(coldRow._id, {
                                status: "archived",
                                archivedAt: Date.now(),
                                analysis: undefined,
                                analyses: {},
                                updatedAt: Date.now(),
                            });
                        } else {
                            await ctx.db.patch(coldRow._id, {
                                analysis: isCurrentAnalysis ? undefined : coldRow.analysis,
                                analyses,
                                updatedAt: Date.now(),
                            });
                        }
                    }
                    cleared += 1;
                }
            } else {
                // Non-surgical clear: always archive the cold row.
                if (coldRow && !args.dryRun) {
                    await ctx.db.patch(coldRow._id, {
                        status: "archived",
                        archivedAt: Date.now(),
                        updatedAt: Date.now(),
                    });
                }
                cleared += 1;
            }
            // After a cold-authoritative clear, re-sync the digest so display
            // fields drop (the archived cold row is now filtered on read).
            if (!args.dryRun) {
                await doUpsertResumeDigest(ctx, resume);
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
        workspaceSlug: v.optional(v.string()),
    },
    returns: v.object({
        requested: v.number(),
        deleted: v.number(),
        missingResumeIds: v.array(v.string()),
        deletedAiTaggingResults: v.number(),
        patchedScreeningSessions: v.number(),
    }),
    handler: async (ctx, args): Promise<DeleteResumesResult> => {
        await requireWorkspaceAccess(ctx, args.resumeIds, args.workspaceSlug);
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

        // Batch digest lookups + deletes to avoid N+1 round-trips (same
        // pattern as ai_tagging_results cleanup above).
        const digestBatches: Array<Id<"resume_digests">> = [];
        const DIGEST_LOOKUP_BATCH = 50;
        for (let i = 0; i < existingResumeIds.length; i += DIGEST_LOOKUP_BATCH) {
            const batchIds = existingResumeIds.slice(i, i + DIGEST_LOOKUP_BATCH);
            const digestResults = await Promise.all(
                batchIds.map((resumeId) =>
                    ctx.db
                        .query("resume_digests")
                        .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
                        .collect()
                )
            );
            for (const batch of digestResults) {
                for (const digest of batch) {
                    digestBatches.push(digest._id);
                }
            }
        }
        for (const digestId of digestBatches) {
            await ctx.db.delete(digestId);
        }

        // Phase 3 completion: hard-delete resume_analyses rows for deleted
        // resumes. Resume is gone — no audit value in orphan cold-table rows.
        // Same batched by_resume lookup pattern as digest cleanup above.
        const analysesBatches: Array<Id<"resume_analyses">> = [];
        for (let i = 0; i < existingResumeIds.length; i += DIGEST_LOOKUP_BATCH) {
            const batchIds = existingResumeIds.slice(i, i + DIGEST_LOOKUP_BATCH);
            const analysesResults = await Promise.all(
                batchIds.map((resumeId) =>
                    ctx.db
                        .query("resume_analyses")
                        .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                        .collect()
                )
            );
            for (const batch of analysesResults) {
                for (const row of batch) {
                    analysesBatches.push(row._id);
                }
            }
        }
        for (const rowId of analysesBatches) {
            await ctx.db.delete(rowId);
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
        workspaceSlug: v.optional(v.string()),
    },
    returns: v.object({
        requested: v.number(),
        archived: v.number(),
        alreadyArchived: v.number(),
        missingResumeIds: v.array(v.string()),
    }),
    handler: async (ctx, args) => {
        await requireWorkspaceAccess(ctx, args.resumeIds, args.workspaceSlug);
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
            await ctx.runMutation(internal.resumes_search.upsertResumeDigest, { resumeId: resume._id });
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
        workspaceSlug: v.optional(v.string()),
    },
    returns: v.object({
        requested: v.number(),
        unarchived: v.number(),
        notArchived: v.number(),
        missingResumeIds: v.array(v.string()),
    }),
    handler: async (ctx, args) => {
        await requireWorkspaceAccess(ctx, args.resumeIds, args.workspaceSlug);
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
            await ctx.runMutation(internal.resumes_search.upsertResumeDigest, { resumeId: resume._id });
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
        dryRun: v.optional(v.boolean()),
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
                || resume.primaryRuleScore !== undefined
                || resume.searchText !== undefined;

            if (!hasComputedFields) {
                continue;
            }

            cleared += 1;
            if (args.dryRun) {
                continue;
            }

            // Phase 4 Step 3a: stop clearing analysis/analyses from the hot doc
            // (cold-authoritative). ingestData/score/searchText still cleared hot.
            await ctx.db.patch(resume._id, {
                ingestData: undefined,
                primaryRuleScore: undefined,
                searchText: undefined,
            });
            // Phase 3 completion: archive the cold resume_analyses row to
            // keep it in sync with the cleared hot doc. Soft-clear preserves
            // the analysis blob for audit/undo.
            const coldRow = await ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resume._id))
                .unique();
            if (coldRow && coldRow.status !== "archived") {
                await ctx.db.patch(coldRow._id, {
                    status: "archived",
                    archivedAt: Date.now(),
                    updatedAt: Date.now(),
                });
            }
            await ctx.runMutation(internal.resumes_search.upsertResumeDigest, { resumeId: resume._id });
        }

        return {
            cleared,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});
