import { v } from "convex/values";
import {
    query,
    mutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "./_generated/server";
import {
    MAX_RESUME_WORK_HISTORY_LIMIT,
    MIN_RESUME_WORK_HISTORY_LIMIT,
    normalizeResumeWorkHistoryLimit,
} from "@trends/shared";

const RESUME_WORK_HISTORY_LIMIT_KEY = "resumeWorkHistoryLimit";

async function readSettingValue(
    ctx: Pick<QueryCtx | MutationCtx, "db">,
    key: string,
): Promise<unknown> {
    const row = await ctx.db
        .query("system_settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
    return row?.value ?? null;
}

async function readResumeWorkHistoryLimit(
    ctx: Pick<QueryCtx | MutationCtx, "db">,
): Promise<number> {
    return normalizeResumeWorkHistoryLimit(
        await readSettingValue(ctx, RESUME_WORK_HISTORY_LIMIT_KEY),
    );
}

export const get = query({
    args: { key: v.string() },
    handler: async (ctx, args) => readSettingValue(ctx, args.key),
});

export const getResumeWorkHistoryLimit = query({
    args: {},
    handler: async (ctx) => readResumeWorkHistoryLimit(ctx),
});

export const getResumeWorkHistoryLimitInternal = internalQuery({
    args: {},
    handler: async (ctx) => readResumeWorkHistoryLimit(ctx),
});

export const setResumeWorkHistoryLimit = mutation({
    args: {
        limit: v.number(),
        updatedBy: v.string(),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (
            !Number.isInteger(args.limit)
            || args.limit < MIN_RESUME_WORK_HISTORY_LIMIT
            || args.limit > MAX_RESUME_WORK_HISTORY_LIMIT
        ) {
            throw new Error(
                `Resume work-history limit must be an integer between ${MIN_RESUME_WORK_HISTORY_LIMIT} and ${MAX_RESUME_WORK_HISTORY_LIMIT}.`,
            );
        }

        const existing = await ctx.db
            .query("system_settings")
            .withIndex("by_key", (q) => q.eq("key", RESUME_WORK_HISTORY_LIMIT_KEY))
            .unique();
        const patch = {
            value: args.limit,
            reason: args.reason,
            updatedAt: Date.now(),
            updatedBy: args.updatedBy,
        };

        if (existing) {
            await ctx.db.patch(existing._id, patch);
        } else {
            await ctx.db.insert("system_settings", {
                key: RESUME_WORK_HISTORY_LIMIT_KEY,
                ...patch,
            });
        }

        return args.limit;
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
