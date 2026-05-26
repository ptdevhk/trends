import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { collectionTaskResultsValidator, ingestDataValidator, analysisResultValidator, resumeAnalysisValidator, jsonRecordValidator } from "./validators.js";
import { resolveSubmitResumeParallelism } from "./lib/parallelism";
import { deriveResumeIdentity } from "./lib/resume_identity";
import { parseAgeFromContent } from "./lib/age";
import { resolveDiagnosticsSourceKeyForResume } from "./resumes";
import {
    mergeTags,
    areStringArraysEqual,
    applyParsedAgePatch,
    normalizeOptionalPositiveInt,
    resolveStoredSearchText,
    shouldScheduleIngest,
    applyRestoreStateFields,
} from "./lib/resume_task_helpers.js";

// Backward-compatible re-exports
export type { RestoreState } from "./lib/resume_task_helpers.js";
export {
    mergeTags,
    normalizeOptionalPositiveInt,
    shallowEqualNumberRecord,
    shouldScheduleIngest,
} from "./lib/resume_task_helpers.js";

const DEFAULT_WORKER_HEALTH_FRESHNESS_MS = 15_000;
const DEFAULT_STALE_PENDING_MS = 180_000;

// List recent tasks for monitoring
export const list = query({
    args: {},
    handler: async (ctx) => {
        // Always include all active tasks (pending/processing) regardless of age
        const pendingTasks = await ctx.db
            .query("collection_tasks")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .take(100);
        const processingTasks = await ctx.db
            .query("collection_tasks")
            .withIndex("by_status", (q) => q.eq("status", "processing"))
            .take(100);
        // Plus the 20 most recent finished tasks
        const activeIds = new Set([...pendingTasks, ...processingTasks].map(t => t._id));
        const recent = await ctx.db
            .query("collection_tasks")
            .order("desc")
            .take(20);
        const finishedRecent = recent.filter(t => !activeIds.has(t._id));
        return [...pendingTasks, ...processingTasks, ...finishedRecent]
            .sort((a, b) => b._creationTime - a._creationTime);
    },
});

export const getById = query({
    args: {
        taskId: v.id("collection_tasks"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.taskId);
    },
});

// Dispatch a new collection task
export const dispatch = mutation({
    args: {
        keyword: v.string(),
        location: v.string(),
        limit: v.number(),
        maxPages: v.optional(v.number()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
        autoAnalyze: v.optional(v.boolean()),
        analysisTopN: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const minAge = normalizeOptionalPositiveInt(args.minAge);
        const maxAge = normalizeOptionalPositiveInt(args.maxAge);
        if (typeof minAge === "number" && typeof maxAge === "number" && minAge > maxAge) {
            throw new Error("minAge cannot be greater than maxAge");
        }

        const taskId = await ctx.db.insert("collection_tasks", {
            config: {
                keyword: args.keyword,
                location: args.location,
                limit: args.limit,
                maxPages: args.maxPages ?? 10,
                minAge,
                maxAge,
                autoAnalyze: args.autoAnalyze,
                analysisTopN: args.analysisTopN,
            },
            status: "pending",
            progress: {
                current: 0,
                total: 0,
                page: 0,
            },
        });
        return taskId;
    },
});

// Worker claims a pending task
export const claim = mutation({
    args: {
        workerId: v.string(),
    },
    handler: async (ctx, args) => {
        // Find a pending task
        const task = await ctx.db
            .query("collection_tasks")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .first();

        if (!task) return null;

        // Atomically update status to processing
        await ctx.db.patch(task._id, {
            status: "processing",
            workerId: args.workerId,
            startedAt: Date.now(),
        });

        return task;
    },
});

export const heartbeat = mutation({
    args: {
        workerId: v.string(),
        state: v.union(v.literal("idle"), v.literal("processing"), v.literal("error")),
        activeTaskId: v.optional(v.id("collection_tasks")),
        lastError: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("collection_workers")
            .withIndex("by_workerId", (q) => q.eq("workerId", args.workerId))
            .unique();

        if (existing) {
            await ctx.db.patch(existing._id, {
                state: args.state,
                lastHeartbeatAt: now,
                activeTaskId: args.activeTaskId,
                lastError: args.lastError,
            });
            return existing._id;
        }

        return await ctx.db.insert("collection_workers", {
            workerId: args.workerId,
            state: args.state,
            lastHeartbeatAt: now,
            activeTaskId: args.activeTaskId,
            lastError: args.lastError,
        });
    },
});

export const getWorkerHealth = query({
    args: {
        freshnessMs: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const freshnessMs = args.freshnessMs ?? DEFAULT_WORKER_HEALTH_FRESHNESS_MS;
        const workers = await ctx.db
            .query("collection_workers")
            .withIndex("by_lastHeartbeatAt")
            .order("desc")
            .take(100);

        const workerStates = workers.map((worker) => {
            const ageMs = now - worker.lastHeartbeatAt;
            const healthy = ageMs <= freshnessMs && worker.state !== "error";
            return {
                workerId: worker.workerId,
                state: worker.state,
                activeTaskId: worker.activeTaskId ?? null,
                lastError: worker.lastError ?? null,
                lastHeartbeatAt: worker.lastHeartbeatAt,
                ageMs,
                healthy,
            };
        });

        const healthyWorkers = workerStates.filter((worker) => worker.healthy).length;
        return {
            now,
            freshnessMs,
            totalWorkers: workerStates.length,
            healthyWorkers,
            hasHealthyWorker: healthyWorkers > 0,
            workers: workerStates,
        };
    },
});

export const failStalePending = mutation({
    args: {
        staleMs: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const staleMs = args.staleMs ?? DEFAULT_STALE_PENDING_MS;
        const staleThreshold = now - staleMs;
        const pendingTasks = await ctx.db
            .query("collection_tasks")
            .withIndex("by_status", (q) => q.eq("status", "pending").lt("_creationTime", staleThreshold))
            .take(100);

        let failed = 0;
        const failedTaskIds: string[] = [];

        for (const task of pendingTasks) {

            await ctx.db.patch(task._id, {
                status: "failed",
                completedAt: now,
                error: `Marked failed by stale-pending reconciliation after ${Math.round(staleMs / 1_000)}s without worker pickup.`,
            });
            failed += 1;
            failedTaskIds.push(String(task._id));
        }

        return {
            checked: pendingTasks.length,
            failed,
            staleMs,
            failedTaskIds,
        };
    },
});

// Update task progress
export const updateProgress = mutation({
    args: {
        taskId: v.id("collection_tasks"),
        current: v.number(),
        page: v.number(),
        total: v.optional(v.number()),
        lastStatus: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task) return null;

        if (task.status === "cancelled") {
            return { status: "cancelled" };
        }

        await ctx.db.patch(args.taskId, {
            progress: {
                current: args.current,
                page: args.page,
                total: args.total ?? 0,
            },
            lastStatus: args.lastStatus,
        });

        return { status: task.status };
    },
});

// Complete a task
export const complete = mutation({
    args: {
        taskId: v.id("collection_tasks"),
        status: v.union(v.literal("completed"), v.literal("failed")),
        error: v.optional(v.string()),
        results: v.optional(collectionTaskResultsValidator),
    },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task || task.status === "cancelled") {
            return;
        }
        await ctx.db.patch(args.taskId, {
            status: args.status,
            completedAt: Date.now(),
            error: args.error,
            ...(args.results ? { results: args.results } : {}),
        });
    },
});

// Cancel a task
export const cancel = mutation({
    args: {
        taskId: v.id("collection_tasks"),
    },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task || (task.status !== "pending" && task.status !== "processing")) {
            return;
        }
        await ctx.db.patch(args.taskId, {
            status: "cancelled",
            completedAt: Date.now(),
        });
    },
});

// Submit a batch of resumes
export const submitResumes = mutation({
    args: {
        resumes: v.array(
            v.object({
                externalId: v.string(),
                content: jsonRecordValidator,
                hash: v.string(),
                source: v.string(),
                tags: v.array(v.string()),
                restoreState: v.optional(v.object({
                    crawledAt: v.optional(v.number()),
                    isArchived: v.optional(v.boolean()),
                    archivedAt: v.optional(v.number()),
                    searchText: v.optional(v.string()),
                    primaryRuleScore: v.optional(v.number()),
                    ingestData: v.optional(ingestDataValidator),
                    analysis: v.optional(resumeAnalysisValidator),
                    analyses: v.optional(v.record(v.string(), analysisResultValidator)),
                })),
            })
        ),
    },
    handler: async (ctx, args) => {
        const totalInput = args.resumes.length;
        const dedupedResumes = new Map<string, {
            resume: (typeof args.resumes)[number];
            identityKey: string;
        }>();
        let identityDeduped = 0;
        for (const resume of args.resumes) {
            const identity = deriveResumeIdentity({
                content: resume.content,
                externalId: resume.externalId,
                source: resume.source,
            });
            if (dedupedResumes.has(identity.identityKey)) {
                identityDeduped += 1;
            }
            dedupedResumes.set(identity.identityKey, {
                resume,
                identityKey: identity.identityKey,
            });
        }

        const resumes = Array.from(dedupedResumes.values());
        const deduped = totalInput - resumes.length;
        let identityMatched = 0;
        let inserted = 0;
        let updated = 0;
        let unchanged = 0;
        let nextIndex = 0;
        const parallelism = resolveSubmitResumeParallelism(resumes.length);
        const ingestProcessIds: Id<"resumes">[] = [];

        const worker = async (): Promise<void> => {
            while (true) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                if (currentIndex >= resumes.length) {
                    return;
                }

                const entry = resumes[currentIndex];
                const resume = entry.resume;
                const restoreState = resume.restoreState;
                let existing = await ctx.db
                    .query("resumes")
                    .withIndex("by_identityKey", (q) => q.eq("identityKey", entry.identityKey))
                    .unique();
                if (existing) {
                    identityMatched += 1;
                }

                if (!existing) {
                    existing = await ctx.db
                        .query("resumes")
                        .withIndex("by_externalId", (q) => q.eq("externalId", resume.externalId))
                        .unique();
                    }

                const parsedAge = parseAgeFromContent(resume.content);

                if (existing) {
                    const nextTags = mergeTags(existing.tags, resume.tags);
                    const tagsChanged = !areStringArraysEqual(existing.tags, nextTags);
                    if (existing.hash !== resume.hash) {
                        const patch: {
                            externalId: string;
                            identityKey: string;
                            content: Record<string, any>;
                            hash: string;
                            crawledAt: number;
                            source: string;
                            tags: string[];
                            searchText: string;
                            sourceKey?: string;
                            primaryRuleScore?: number;
                            ingestData?: Doc<"resumes">["ingestData"];
                            analysis?: Doc<"resumes">["analysis"];
                            analyses?: Doc<"resumes">["analyses"];
                            age?: number;
                        } = {
                            externalId: resume.externalId,
                            identityKey: entry.identityKey,
                            content: resume.content,
                            hash: resume.hash,
                            crawledAt: restoreState?.crawledAt ?? Date.now(),
                            source: resume.source,
                            tags: nextTags,
                            searchText: resolveStoredSearchText(resume.content, restoreState),
                            sourceKey: resolveDiagnosticsSourceKeyForResume({ source: resume.source, content: resume.content }),
                        };
                        applyRestoreStateFields(patch, restoreState);
                        applyParsedAgePatch(patch, parsedAge, existing.age);
                        await ctx.db.patch(existing._id, patch);
                        updated += 1;
                        if (shouldScheduleIngest(restoreState)) {
                            ingestProcessIds.push(existing._id);
                        }
                        continue;
                    }

                    const patch: {
                        searchText?: string;
                        identityKey?: string;
                        tags?: string[];
                        primaryRuleScore?: number;
                        ingestData?: Doc<"resumes">["ingestData"];
                        analysis?: Doc<"resumes">["analysis"];
                        analyses?: Doc<"resumes">["analyses"];
                        age?: number;
                    } = {};

                    const restoredSearchText = resolveStoredSearchText(resume.content, restoreState);
                    if ((!existing.searchText && restoredSearchText) || (restoreState?.searchText && existing.searchText !== restoredSearchText)) {
                        patch.searchText = restoredSearchText;
                    }
                    if (existing.identityKey !== entry.identityKey) {
                        patch.identityKey = entry.identityKey;
                    }
                    if (tagsChanged) {
                        patch.tags = nextTags;
                    }
                    applyRestoreStateFields(patch, restoreState);
                    applyParsedAgePatch(patch, parsedAge, existing.age);

                    if (Object.keys(patch).length > 0) {
                        await ctx.db.patch(existing._id, patch);
                        updated += 1;
                        if (shouldScheduleIngest(restoreState)) {
                            ingestProcessIds.push(existing._id);
                        }
                    } else {
                        unchanged += 1;
                    }
                } else {
                    const insertPayload: {
                        externalId: string;
                        identityKey: string;
                        content: Record<string, any>;
                        hash: string;
                        searchText: string;
                        tags: string[];
                        source: string;
                        crawledAt: number;
                        sourceKey?: string;
                        primaryRuleScore?: number;
                        ingestData?: Doc<"resumes">["ingestData"];
                        analysis?: Doc<"resumes">["analysis"];
                        analyses?: Doc<"resumes">["analyses"];
                        age?: number;
                        needsEmbedding?: boolean;
                    } = {
                        externalId: resume.externalId,
                        identityKey: entry.identityKey,
                        content: resume.content,
                        hash: resume.hash,
                        searchText: resolveStoredSearchText(resume.content, restoreState),
                        tags: resume.tags,
                        source: resume.source,
                        crawledAt: restoreState?.crawledAt ?? Date.now(),
                        sourceKey: resolveDiagnosticsSourceKeyForResume({ source: resume.source, content: resume.content }),
                        needsEmbedding: true,
                    };
                    applyRestoreStateFields(insertPayload, restoreState);
                    applyParsedAgePatch(insertPayload, parsedAge);
                    const newId = await ctx.db.insert("resumes", insertPayload);
                    inserted += 1;
                    if (shouldScheduleIngest(restoreState)) {
                        ingestProcessIds.push(newId);
                    }
                }
            }
        };

        const workers = Array.from({ length: parallelism }, () => worker());
        await Promise.all(workers);

        // Schedule ingest computation for new/updated resumes (M3)
        if (ingestProcessIds.length > 0) {
            const BATCH = 50;
            for (let i = 0; i < ingestProcessIds.length; i += BATCH) {
                await ctx.scheduler.runAfter(0, internal.ingest_agent.processNewResumes, {
                    resumeIds: ingestProcessIds.slice(i, i + BATCH),
                });
            }
        }

        const now = Date.now();
        await ctx.db.insert("sync_events", {
            source: "browser-extension",
            status: "success",
            submitted: resumes.length,
            inserted,
            updated,
            unchanged,
            timestamp: now,
        });

        const cutoff = now - 3_600_000;
        const staleEvents = await ctx.db
            .query("sync_events")
            .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
            .take(20);
        for (const event of staleEvents) {
            await ctx.db.delete(event._id);
        }

        return {
            input: totalInput,
            submitted: resumes.length,
            deduped,
            identityDeduped,
            identityMatched,
            inserted,
            updated,
            unchanged,
        };
    },
});

// Get summary statistics for debugging
export const getSummary = query({
    args: {},
    handler: async (ctx) => {
        const [pending, processing, completed, failed, cancelled] = await Promise.all([
            ctx.db.query("collection_tasks").withIndex("by_status", q => q.eq("status", "pending")).take(500),
            ctx.db.query("collection_tasks").withIndex("by_status", q => q.eq("status", "processing")).take(500),
            ctx.db.query("collection_tasks").withIndex("by_status", q => q.eq("status", "completed")).order("desc").take(100),
            ctx.db.query("collection_tasks").withIndex("by_status", q => q.eq("status", "failed")).order("desc").take(100),
            ctx.db.query("collection_tasks").withIndex("by_status", q => q.eq("status", "cancelled")).order("desc").take(100),
        ]);
        const stats = {
            total: pending.length + processing.length + completed.length + failed.length + cancelled.length,
            pending: pending.length,
            processing: processing.length,
            completed: completed.length,
            failed: failed.length,
            cancelled: cancelled.length,
            activeWorkers: Array.from(new Set(processing.map(t => t.workerId).filter(Boolean))).length
        };
        return stats;
    },
});

export const getSummaryWindow = query({
    args: {
        fromTimestamp: v.number(),
        toTimestamp: v.number(),
    },
    handler: async (ctx, args) => {
        const matching = await ctx.db
            .query("collection_tasks")
            .withIndex("by_completedAt", (q) =>
                q.gte("completedAt", args.fromTimestamp).lt("completedAt", args.toTimestamp)
            )
            .collect();

        const byStatus = new Map<string, number>();
        for (const task of matching) {
            byStatus.set(task.status, (byStatus.get(task.status) ?? 0) + 1);
        }

        return {
            total: matching.length,
            byStatus: Array.from(byStatus.entries())
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

const RESET_TABLES = [
    "collection_tasks",
    "resumes",
    "collection_workers",
    "candidate_blocks",
    "candidate_status",
    "analysis_tasks",
    "screening_sessions",
    "search_history",
    "sync_events",
    "industry_db_cohorts",
] as const;

type ResetTableName = (typeof RESET_TABLES)[number];

const RESET_BATCH_SIZE = 50;

export const resetDatabaseBatch = internalMutation({
    args: {
        tableIndex: v.number(),
        totalDeleted: v.number(),
    },
    handler: async (ctx, { tableIndex, totalDeleted }) => {
        let deleted = totalDeleted;
        let currentIndex = tableIndex;

        while (currentIndex < RESET_TABLES.length) {
            const tableName = RESET_TABLES[currentIndex] as ResetTableName;
            const batch = await ctx.db.query(tableName).take(RESET_BATCH_SIZE);

            if (batch.length === 0) {
                currentIndex += 1;
                continue;
            }

            for (const doc of batch) {
                await ctx.db.delete(doc._id);
            }
            deleted += batch.length;

            if (batch.length === RESET_BATCH_SIZE) {
                await ctx.scheduler.runAfter(0, internal.resume_tasks.resetDatabaseBatch, {
                    tableIndex: currentIndex,
                    totalDeleted: deleted,
                });
                return;
            }

            currentIndex += 1;
        }
    },
});

export const resetDatabase = mutation({
    args: {},
    handler: async (ctx) => {
        const counts: Record<string, number> = {};
        let count = 0;

        for (const tableName of RESET_TABLES) {
            const batch = await ctx.db.query(tableName as ResetTableName).take(RESET_BATCH_SIZE);
            for (const doc of batch) {
                await ctx.db.delete(doc._id);
            }
            counts[tableName] = batch.length;
            count += batch.length;

            if (batch.length === RESET_BATCH_SIZE) {
                await ctx.scheduler.runAfter(0, internal.resume_tasks.resetDatabaseBatch, {
                    tableIndex: RESET_TABLES.indexOf(tableName),
                    totalDeleted: count,
                });
                return {
                    success: true,
                    count,
                    partial: true,
                    deleted: counts,
                };
            }
        }

        return {
            success: true,
            count,
            partial: false,
            deleted: counts,
        };
    },
});

/**
 * Sweep collection tasks stuck in "processing" for >24 hours back to "failed".
 * Called by the daily cron job to prevent silent pipeline stalls.
 */
export const sweepStuckTasks = internalMutation({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const stuck = await ctx.db
            .query("collection_tasks")
            .withIndex("by_status", (q) => q.eq("status", "processing"))
            .filter((q) => q.lt(q.field("startedAt"), cutoff))
            .take(100);

        for (const task of stuck) {
            await ctx.db.patch(task._id, {
                status: "failed",
                error: "Swept: stuck in processing for >24h",
            });
        }

        return { swept: stuck.length };
    },
});
