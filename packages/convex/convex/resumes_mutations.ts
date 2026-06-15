import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { ingestDataValidator, relatedExpEvidenceValidator } from "./validators.js";
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
import {
    PAGINATE_MAX_BYTES_READ,
    PAGINATE_MAX_ROWS_READ,
    resolveResumeScanBatchSize,
} from "./lib/resumes_pagination.js";

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
            /** P1: evidence ceiling result — stored for audit/display */
            relatedExpEvidence: v.optional(relatedExpEvidenceValidator),
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

        // Phase 3: propagate to digest (display fields) + cold analysis table
        const updated = await ctx.db.get(args.resumeId);
        if (updated) {
            await doUpsertResumeDigest(ctx, updated);
            await doUpsertResumeAnalysis(ctx, updated);
        }
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

            // Phase 3: propagate to digest + cold analysis table
            const updated = await ctx.db.get(update.resumeId);
            if (updated) {
                await doUpsertResumeDigest(ctx, updated);
                await doUpsertResumeAnalysis(ctx, updated);
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

// ---------------------------------------------------------------------------
// Public mutations
// ---------------------------------------------------------------------------

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
            await ctx.runMutation(internal.resumes_search.upsertResumeDigest, { resumeId: resume._id });
            cleared += 1;
        }

        return {
            cleared,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});
