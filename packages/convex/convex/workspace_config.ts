import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { jsonValueValidator } from "./validators.js";

export const get = query({
    args: {
        workspaceSlug: v.string(),
        configKey: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("workspace_config")
            .withIndex("by_workspace_key", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("configKey", args.configKey)
            )
            .unique();
    },
});

export const upsert = mutation({
    args: {
        workspaceSlug: v.string(),
        configKey: v.string(),
        configValue: jsonValueValidator,
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("workspace_config")
            .withIndex("by_workspace_key", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("configKey", args.configKey)
            )
            .unique();

        const updatedAt = Date.now();
        if (existing) {
            await ctx.db.patch(existing._id, {
                configValue: args.configValue,
                updatedAt,
            });
            return existing._id;
        }

        return await ctx.db.insert("workspace_config", {
            workspaceSlug: args.workspaceSlug,
            configKey: args.configKey,
            configValue: args.configValue,
            updatedAt,
        });
    },
});

export const listForWorkspace = query({
    args: {
        workspaceSlug: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("workspace_config")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", args.workspaceSlug))
            .collect();
    },
});

export const remove = mutation({
    args: {
        workspaceSlug: v.string(),
        configKey: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("workspace_config")
            .withIndex("by_workspace_key", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("configKey", args.configKey)
            )
            .unique();

        if (!existing) {
            return false;
        }

        await ctx.db.delete(existing._id);
        return true;
    },
});
