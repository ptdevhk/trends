import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
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
        // Skip during maintenance mode (restore quiesce)
        if (await ctx.runQuery(internal.system_settings.isMaintenanceModeInternal, {})) {
            console.log("[Cron] Skipping — maintenance mode active");
            return { deleted: 0 };
        }

        const now = args.now ?? Date.now();
        let deleted = 0;

        // Batch deletes to avoid unbounded collect
        let batch = await ctx.db
            .query("ai_summary_cache")
            .withIndex("by_expires_at", (q) => q.lte("expiresAt", now))
            .take(100);

        while (batch.length > 0) {
            for (const record of batch) {
                await ctx.db.delete(record._id);
            }
            deleted += batch.length;
            batch = await ctx.db
                .query("ai_summary_cache")
                .withIndex("by_expires_at", (q) => q.lte("expiresAt", now))
                .take(100);
        }

        return {
            deleted,
        };
    },
});

export const count = query({
    args: {},
    handler: async (ctx) => {
        const all = await ctx.db.query("ai_summary_cache").collect();
        return all.length;
    },
});
