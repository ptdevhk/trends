import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
    args: {
        workspaceSlug: v.string(),
        urlHash: v.string(),
    },
    handler: async (ctx, args) => {
        const records = await ctx.db
            .query("ai_summary_cache")
            .withIndex("by_workspace_url_hash", (q) => q.eq("workspaceSlug", args.workspaceSlug).eq("urlHash", args.urlHash))
            .collect();

        return records.sort((left, right) => right.generatedAt - left.generatedAt)[0] ?? null;
    },
});

export const upsert = mutation({
    args: {
        urlHash: v.string(),
        workspaceSlug: v.string(),
        query: v.string(),
        facets: v.optional(v.string()),
        resultCount: v.number(),
        resultSetHash: v.string(),
        summary: v.string(),
        model: v.string(),
        generatedAt: v.number(),
        expiresAt: v.number(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("ai_summary_cache")
            .withIndex("by_workspace_url_hash", (q) => q.eq("workspaceSlug", args.workspaceSlug).eq("urlHash", args.urlHash))
            .collect();

        const [primaryRecord, ...duplicateRecords] = existing.sort((left, right) => right.generatedAt - left.generatedAt);
        for (const record of duplicateRecords) {
            await ctx.db.delete(record._id);
        }

        if (primaryRecord) {
            await ctx.db.patch(primaryRecord._id, args);
            return primaryRecord._id;
        }

        return await ctx.db.insert("ai_summary_cache", args);
    },
});

export const cleanupExpired = internalMutation({
    args: {
        now: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const now = args.now ?? Date.now();
        const records = await ctx.db.query("ai_summary_cache").collect();
        const expiredRecords = records.filter((record) => record.expiresAt <= now);

        for (const record of expiredRecords) {
            await ctx.db.delete(record._id);
        }

        return {
            deleted: expiredRecords.length,
        };
    },
});
