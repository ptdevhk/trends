import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { buildSearchText } from "./search_text";
import { resolveSubmitResumeParallelism } from "./lib/parallelism";
import { deriveResumeIdentity } from "./lib/resume_identity";

const DEFAULT_WORKER_HEALTH_FRESHNESS_MS = 15_000;
const DEFAULT_STALE_PENDING_MS = 180_000;

function mergeTags(existing: string[], incoming: string[]): string[] {
    return Array.from(new Set([...existing, ...incoming]));
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}

// List recent tasks for monitoring
export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query("collection_tasks")
            .order("desc")
            .take(20);
    },
});

// Dispatch a new collection task
export const dispatch = mutation({
    args: {
        keyword: v.string(),
        location: v.string(),
        limit: v.number(),
        maxPages: v.optional(v.number()),
        autoAnalyze: v.optional(v.boolean()),
        analysisTopN: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const taskId = await ctx.db.insert("collection_tasks", {
            config: {
                keyword: args.keyword,
                location: args.location,
                limit: args.limit,
                maxPages: args.maxPages ?? 10,
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
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .collect();

        let failed = 0;
        const failedTaskIds: string[] = [];

        for (const task of pendingTasks) {
            if (task._creationTime > staleThreshold) {
                continue;
            }

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
        results: v.optional(v.object({
            extracted: v.number(),
            submitted: v.number(),
            deduped: v.number(),
            identityDeduped: v.optional(v.number()),
            identityMatched: v.optional(v.number()),
            legacyExternalIdMatched: v.optional(v.number()),
            inserted: v.number(),
            updated: v.number(),
            unchanged: v.number(),
            autoAnalyzed: v.optional(v.number()),
            autoAnalysisTaskId: v.optional(v.string()),
        })),
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
                content: v.any(),
                hash: v.string(),
                source: v.string(),
                tags: v.array(v.string()),
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
        let legacyExternalIdMatched = 0;
        let inserted = 0;
        let updated = 0;
        let unchanged = 0;
        let nextIndex = 0;
        const parallelism = resolveSubmitResumeParallelism(resumes.length);

        const worker = async (): Promise<void> => {
            while (true) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                if (currentIndex >= resumes.length) {
                    return;
                }

                const entry = resumes[currentIndex];
                const resume = entry.resume;
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
                    if (existing) {
                        legacyExternalIdMatched += 1;
                    }
                }

                const searchText = buildSearchText(resume.content);

                if (existing) {
                    const nextTags = mergeTags(existing.tags, resume.tags);
                    const tagsChanged = !areStringArraysEqual(existing.tags, nextTags);
                    if (existing.hash !== resume.hash) {
                        await ctx.db.patch(existing._id, {
                            externalId: resume.externalId,
                            identityKey: entry.identityKey,
                            content: resume.content,
                            hash: resume.hash,
                            crawledAt: Date.now(),
                            source: resume.source,
                            tags: nextTags,
                            searchText,
                        });
                        updated += 1;
                        continue;
                    }

                    const patch: {
                        searchText?: string;
                        identityKey?: string;
                        tags?: string[];
                    } = {};

                    if (!existing.searchText) {
                        patch.searchText = searchText;
                    }
                    if (existing.identityKey !== entry.identityKey) {
                        patch.identityKey = entry.identityKey;
                    }
                    if (tagsChanged) {
                        patch.tags = nextTags;
                    }

                    if (Object.keys(patch).length > 0) {
                        await ctx.db.patch(existing._id, patch);
                        updated += 1;
                    } else {
                        unchanged += 1;
                    }
                } else {
                    await ctx.db.insert("resumes", {
                        externalId: resume.externalId,
                        identityKey: entry.identityKey,
                        content: resume.content,
                        hash: resume.hash,
                        searchText,
                        tags: resume.tags,
                        source: resume.source,
                        crawledAt: Date.now(),
                    });
                    inserted += 1;
                }
            }
        };

        const workers = Array.from({ length: parallelism }, () => worker());
        await Promise.all(workers);

        return {
            input: totalInput,
            submitted: resumes.length,
            deduped,
            identityDeduped,
            identityMatched,
            legacyExternalIdMatched,
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
        const tasks = await ctx.db.query("collection_tasks").collect();
        const stats = {
            total: tasks.length,
            pending: tasks.filter(t => t.status === "pending").length,
            processing: tasks.filter(t => t.status === "processing").length,
            completed: tasks.filter(t => t.status === "completed").length,
            failed: tasks.filter(t => t.status === "failed").length,
            cancelled: tasks.filter(t => t.status === "cancelled").length,
            activeWorkers: Array.from(new Set(tasks.filter(t => t.status === "processing").map(t => t.workerId).filter(Boolean))).length
        };
        return stats;
    },
});

export const resetDatabase = mutation({
    args: {},
    handler: async (ctx) => {
        const tasks = await ctx.db.query("collection_tasks").collect();
        for (const task of tasks) {
            await ctx.db.delete(task._id);
        }

        const resumes = await ctx.db.query("resumes").collect();
        for (const resume of resumes) {
            await ctx.db.delete(resume._id);
        }

        const workers = await ctx.db.query("collection_workers").collect();
        for (const worker of workers) {
            await ctx.db.delete(worker._id);
        }

        return { success: true, count: tasks.length + resumes.length + workers.length };
    },
});
