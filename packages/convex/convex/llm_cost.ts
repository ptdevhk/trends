import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getRemainingBudget, todayPeriod } from "./lib/parallelism";

/**
 * Record LLM usage for a workspace on the current day.
 * Upserts the daily cost tracking record with accumulated token counts.
 */
export const recordUsage = internalMutation({
    args: {
        workspaceId: v.string(),
        inputTokens: v.number(),
        outputTokens: v.number(),
        confirmCount: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const period = todayPeriod();
        const existing = await ctx.db
            .query("llm_cost_tracking")
            .withIndex("by_workspace_period", (q) =>
                q.eq("workspaceId", args.workspaceId).eq("period", period),
            )
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                inputTokens: existing.inputTokens + args.inputTokens,
                outputTokens: existing.outputTokens + args.outputTokens,
                confirmCount: existing.confirmCount + (args.confirmCount ?? 0),
                updatedAt: Date.now(),
            });
        } else {
            await ctx.db.insert("llm_cost_tracking", {
                workspaceId: args.workspaceId,
                period,
                inputTokens: args.inputTokens,
                outputTokens: args.outputTokens,
                confirmCount: args.confirmCount ?? 0,
                updatedAt: Date.now(),
            });
        }
    },
});

/**
 * Get the current cost budget for a workspace.
 * Returns remaining tokens and confirm slots for today's period.
 */
export const getBudget = query({
    args: {
        workspaceId: v.string(),
    },
    handler: async (ctx, args) => {
        const period = todayPeriod();
        const record = await ctx.db
            .query("llm_cost_tracking")
            .withIndex("by_workspace_period", (q) =>
                q.eq("workspaceId", args.workspaceId).eq("period", period),
            )
            .first();
        return getRemainingBudget(record);
    },
});
