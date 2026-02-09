import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Dispatch a new collection task
export const dispatch = mutation({
    args: {
        keyword: v.string(),
        location: v.string(),
        limit: v.number(),
        maxPages: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const taskId = await ctx.db.insert("collection_tasks", {
            config: {
                keyword: args.keyword,
                location: args.location,
                limit: args.limit,
                maxPages: args.maxPages ?? 10,
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
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.taskId, {
            progress: {
                current: args.current,
                page: args.page,
                total: args.total ?? 0, // Keep existing total if not provided? simplified
            },
        });
    },
});

// Complete a task
export const complete = mutation({
    args: {
        taskId: v.id("collection_tasks"),
        status: v.union(v.literal("completed"), v.literal("failed")),
        error: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.taskId, {
            status: args.status,
            completedAt: Date.now(),
            error: args.error,
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
        for (const resume of args.resumes) {
            const existing = await ctx.db
                .query("resumes")
                .withIndex("by_externalId", (q) => q.eq("externalId", resume.externalId))
                .unique();

            if (existing) {
                // Optimistic: Only update if hash changed or tags need merging
                // For now, simpler to just skip heavy updates if hash matches
                if (existing.hash !== resume.hash) {
                    await ctx.db.patch(existing._id, {
                        content: resume.content,
                        hash: resume.hash,
                        crawledAt: Date.now(),
                        // merge tags logic could go here
                    });
                }
            } else {
                await ctx.db.insert("resumes", {
                    externalId: resume.externalId,
                    content: resume.content,
                    hash: resume.hash,
                    tags: resume.tags,
                    source: resume.source,
                    crawledAt: Date.now(),
                });
            }
        }
    },
});
