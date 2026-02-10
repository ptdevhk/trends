
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
    args: { userId: v.optional(v.string()) },
    handler: async (ctx, args) => {
        // Fetch all system JDs
        const systemJDs = await ctx.db
            .query("job_descriptions")
            .filter((q) => q.eq(q.field("type"), "system"))
            .collect();

        // Fetch custom JDs (for now, all enabled custom JDs or user specific)
        let customJDs = await ctx.db
            .query("job_descriptions")
            .filter((q) => q.eq(q.field("type"), "custom"))
            .collect();

        if (args.userId) {
            customJDs = customJDs.filter(jd => jd.userId === args.userId || !jd.userId);
        }

        return [...systemJDs, ...customJDs].filter(jd => jd.enabled !== false).sort((a, b) => b.lastModified - a.lastModified);
    },
});

export const create = mutation({
    args: {
        title: v.string(),
        content: v.string(),
        type: v.union(v.literal("system"), v.literal("custom")),
        userId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const id = await ctx.db.insert("job_descriptions", {
            title: args.title,
            content: args.content,
            type: args.type,
            userId: args.userId,
            enabled: true,
            lastModified: Date.now(),
        });
        return id;
    },
});

export const update = mutation({
    args: {
        id: v.id("job_descriptions"),
        title: v.optional(v.string()),
        content: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        await ctx.db.patch(id, {
            ...updates,
            lastModified: Date.now(),
        });
    },
});

export const get = query({
    args: { id: v.id("job_descriptions") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});

export const list_all = query({
    handler: async (ctx) => {
        return await ctx.db.query("job_descriptions").collect();
    },
});


export const delete_jd = mutation({
    args: { id: v.id("job_descriptions") },
    handler: async (ctx, args) => {
        const jd = await ctx.db.get(args.id);
        if (!jd) throw new Error("Job description not found");
        if (jd.type === "system") throw new Error("Cannot delete system job descriptions");
        await ctx.db.delete(args.id);
    },
});
