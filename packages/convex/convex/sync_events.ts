import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const STALE_EVENT_MS = 3_600_000;
const MAX_CLEANUP_BATCH = 20;

export const recordError = mutation({
    args: {
        source: v.string(),
        error: v.string(),
    },
    handler: async (ctx, { source, error }) => {
        await ctx.db.insert("sync_events", {
            source,
            status: "error",
            submitted: 0,
            inserted: 0,
            updated: 0,
            unchanged: 0,
            error,
            timestamp: Date.now(),
        });
    },
});

export const getLatest = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query("sync_events")
            .withIndex("by_timestamp")
            .order("desc")
            .first();
    },
});

export const cleanup = mutation({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - STALE_EVENT_MS;
        const staleEvents = await ctx.db
            .query("sync_events")
            .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
            .take(MAX_CLEANUP_BATCH);

        for (const event of staleEvents) {
            await ctx.db.delete(event._id);
        }

        return {
            deleted: staleEvents.length,
            cutoff,
        };
    },
});
