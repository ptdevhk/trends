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
    normalizeAiApiBase,
    isProviderModelForm,
} from "@trends/shared";

const RESUME_WORK_HISTORY_LIMIT_KEY = "resumeWorkHistoryLimit";
const AI_ROUTING_KEY = "aiRouting";

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

export type AiRoutingSettings = {
    apiBase: string | null;
    model: string | null;
    fallbackModel: string | null;
    updatedAt?: number;
    updatedBy?: string;
};

async function readAiRoutingSettings(
    ctx: Pick<QueryCtx | MutationCtx, "db">,
): Promise<AiRoutingSettings> {
    const row = await ctx.db
        .query("system_settings")
        .withIndex("by_key", (q) => q.eq("key", AI_ROUTING_KEY))
        .unique();
    const value = row?.value as
        | { apiBase?: unknown; model?: unknown; fallbackModel?: unknown }
        | undefined;
    const read = (v: unknown): string | null =>
        typeof v === "string" && v.length > 0 ? v : null;
    return {
        apiBase: read(value?.apiBase),
        model: read(value?.model),
        fallbackModel: read(value?.fallbackModel),
        ...(row ? { updatedAt: row.updatedAt, updatedBy: row.updatedBy } : {}),
    };
}

export const getAiRoutingSettings = query({
    args: {},
    handler: async (ctx) => readAiRoutingSettings(ctx),
});

export const getAiRoutingSettingsInternal = internalQuery({
    args: {},
    handler: async (ctx) => readAiRoutingSettings(ctx),
});

export const setAiRoutingSettings = mutation({
    args: {
        apiBase: v.optional(v.string()),
        model: v.optional(v.string()),
        fallbackModel: v.optional(v.string()),
        updatedBy: v.string(),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const value: { apiBase?: string; model?: string; fallbackModel?: string } = {};

        if (args.apiBase !== undefined) {
            const normalized = normalizeAiApiBase(args.apiBase);
            if (normalized) {
                value.apiBase = normalized;
            }
            // empty string clears → field omitted from stored value (env fallback)
        }
        if (args.model !== undefined) {
            if (args.model.trim() && !isProviderModelForm(args.model.trim())) {
                throw new Error(
                    "AI model must be in provider/model form (e.g. openai/deepseek-v4-flash).",
                );
            }
            if (args.model.trim()) {
                value.model = args.model.trim();
            }
        }
        if (args.fallbackModel !== undefined) {
            if (args.fallbackModel.trim() && !isProviderModelForm(args.fallbackModel.trim())) {
                throw new Error(
                    "AI fallback model must be in provider/model form (e.g. openai/deepseek-v4-flash-e).",
                );
            }
            if (args.fallbackModel.trim()) {
                value.fallbackModel = args.fallbackModel.trim();
            }
        }

        const existing = await ctx.db
            .query("system_settings")
            .withIndex("by_key", (q) => q.eq("key", AI_ROUTING_KEY))
            .unique();
        const patch = {
            value,
            reason: args.reason,
            updatedAt: Date.now(),
            updatedBy: args.updatedBy,
        };

        if (existing) {
            await ctx.db.patch(existing._id, patch);
        } else {
            await ctx.db.insert("system_settings", {
                key: AI_ROUTING_KEY,
                ...patch,
            });
        }

        return await readAiRoutingSettings(ctx);
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
