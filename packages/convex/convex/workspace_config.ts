import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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

/**
 * Validator for workspace config values. Eliminates v.any() by using nested
 * v.record/v.array unions with jsonPrimitive leaves (string | number | boolean | null).
 * Supports up to 3 levels of nesting — sufficient for all current configKey shapes:
 *   custom-keywords, filter-presets, agent-overrides, rule-weights,
 *   learning-log, resume-field-usage-policy, summary-profiles, bias_audit_anomaly_alert.
 *
 * BFF layer (workspace-config-service.ts) validates per-key shapes;
 * this validator enforces structural validity at the Convex layer.
 */
const jsonPrimitive = v.union(v.string(), v.number(), v.boolean(), v.null());
const jsonL1 = v.union(jsonPrimitive, v.array(jsonPrimitive), v.record(v.string(), jsonPrimitive));
const jsonL2 = v.union(jsonPrimitive, v.array(jsonL1), v.record(v.string(), jsonL1));
const jsonL3 = v.union(jsonPrimitive, v.array(jsonL2), v.record(v.string(), jsonL1));
const configValueValidator = v.union(jsonPrimitive, v.array(jsonL3), v.record(v.string(), jsonL3));

export const upsert = mutation({
    args: {
        workspaceSlug: v.string(),
        configKey: v.string(),
        configValue: configValueValidator,
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
