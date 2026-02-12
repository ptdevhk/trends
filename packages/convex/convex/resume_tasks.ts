import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { buildSearchText } from "./search_text";
import { resolveSubmitResumeParallelism } from "./lib/parallelism";

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
        const dedupedResumes = new Map<string, (typeof args.resumes)[number]>();
        for (const resume of args.resumes) {
            dedupedResumes.set(resume.externalId, resume);
        }

        const resumes = Array.from(dedupedResumes.values());
        const deduped = totalInput - resumes.length;
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

                const resume = resumes[currentIndex];
                const existing = await ctx.db
                    .query("resumes")
                    .withIndex("by_externalId", (q) => q.eq("externalId", resume.externalId))
                    .unique();
                const searchText = buildSearchText(resume.content);

                if (existing) {
                    if (existing.hash !== resume.hash) {
                        await ctx.db.patch(existing._id, {
                            content: resume.content,
                            hash: resume.hash,
                            crawledAt: Date.now(),
                            searchText,
                        });
                        updated += 1;
                    } else if (!existing.searchText) {
                        await ctx.db.patch(existing._id, {
                            searchText,
                        });
                        updated += 1;
                    } else {
                        unchanged += 1;
                    }
                } else {
                    await ctx.db.insert("resumes", {
                        externalId: resume.externalId,
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

        return { success: true, count: tasks.length + resumes.length };
    },
});
