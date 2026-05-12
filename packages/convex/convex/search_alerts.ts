import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Create a new search alert subscription.
 */
export const create = mutation({
    args: {
        workspaceSlug: v.string(),
        searchProfileId: v.string(),
        name: v.string(),
        keywords: v.optional(v.array(v.string())),
        minScore: v.number(),
        createdBy: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        return ctx.db.insert("search_alerts", {
            ...args,
            enabled: true,
        });
    },
});

/**
 * Toggle alert enabled/disabled state.
 */
export const toggle = mutation({
    args: {
        alertId: v.id("search_alerts"),
        enabled: v.boolean(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.alertId, { enabled: args.enabled });
    },
});

/**
 * Delete a search alert.
 */
export const remove = mutation({
    args: {
        alertId: v.id("search_alerts"),
    },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.alertId);
    },
});

/**
 * List all alerts for a workspace.
 */
export const list = query({
    args: {
        workspaceSlug: v.string(),
    },
    handler: async (ctx, args) => {
        return ctx.db
            .query("search_alerts")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", args.workspaceSlug))
            .collect();
    },
});

/**
 * List enabled alerts for a workspace (used by ingest matching).
 */
export const listEnabled = query({
    args: {
        workspaceSlug: v.string(),
    },
    handler: async (ctx, args) => {
        return ctx.db
            .query("search_alerts")
            .withIndex("by_workspace_enabled", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("enabled", true)
            )
            .collect();
    },
});

/**
 * Mark an alert as notified (updates lastNotifiedAt).
 */
export const markNotified = mutation({
    args: {
        alertId: v.id("search_alerts"),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.alertId, { lastNotifiedAt: Date.now() });
    },
});
