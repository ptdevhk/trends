import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";

export const get = query({
    args: { key: v.string() },
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query("system_settings")
            .withIndex("by_key", (q) => q.eq("key", args.key))
            .unique();
        return row?.value ?? null;
    },
});

export const set = mutation({
    args: {
        key: v.string(),
        value: v.any(),
        updatedBy: v.string(),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("system_settings")
            .withIndex("by_key", (q) => q.eq("key", args.key))
            .unique();
        if (existing) {
            await ctx.db.patch(existing._id, {
                value: args.value,
                reason: args.reason,
                updatedAt: Date.now(),
                updatedBy: args.updatedBy,
            });
        } else {
            await ctx.db.insert("system_settings", {
                key: args.key,
                value: args.value,
                reason: args.reason,
                updatedAt: Date.now(),
                updatedBy: args.updatedBy,
            });
        }
    },
});

export const isMaintenanceMode = query({
    args: {},
    handler: async (ctx) => {
        const row = await ctx.db
            .query("system_settings")
            .withIndex("by_key", (q) => q.eq("key", "maintenanceMode"))
            .unique();
        return row?.value === true;
    },
});

// Internal version for use from cron handlers and actions via ctx.runQuery
export const isMaintenanceModeInternal = internalQuery({
    args: {},
    handler: async (ctx) => {
        const row = await ctx.db
            .query("system_settings")
            .withIndex("by_key", (q) => q.eq("key", "maintenanceMode"))
            .unique();
        return row?.value === true;
    },
});
