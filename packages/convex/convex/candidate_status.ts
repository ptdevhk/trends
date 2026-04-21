import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

import { DEFAULT_WORKSPACE_SLUG } from "./sessions";
const DEFAULT_STATUS = "new";

function normalizeWorkspaceSlug(input: string | undefined): string {
    const normalized = input?.trim();
    return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
}

function normalizeIdentityKey(value: string): string {
    return value.trim();
}

export const listForBackup = query({
    args: {
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const rows = await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_status", (q) => q.eq("workspaceSlug", workspaceSlug))
            .collect();
        return rows.map((row) => ({
            identityKey: row.identityKey,
            status: row.status,
            notes: row.notes,
            updatedBy: row.updatedBy,
            updatedAt: row.updatedAt,
            history: row.history,
        }));
    },
});

export const list = query({
    args: {
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        return await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_status", (q) => q.eq("workspaceSlug", workspaceSlug))
            .collect();
    },
});

export const getByIdentity = query({
    args: {
        workspaceSlug: v.optional(v.string()),
        identityKey: v.string(),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKey = normalizeIdentityKey(args.identityKey);
        if (!identityKey) {
            return null;
        }

        return await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .unique();
    },
});

export const upsert = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        identityKey: v.string(),
        status: v.union(
            v.literal("new"),
            v.literal("contacted"),
            v.literal("interviewing"),
            v.literal("interviewed_pass"),
            v.literal("interviewed_reject"),
            v.literal("offer"),
            v.literal("hired"),
            v.literal("withdrawn")
        ),
        notes: v.optional(v.string()),
        updatedBy: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKey = normalizeIdentityKey(args.identityKey);
        if (!identityKey) {
            throw new Error("identityKey is required");
        }

        const now = Date.now();
        const existing = await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .unique();

        if (existing) {
            const nextHistory = [...(existing.history ?? [])];
            const statusChanged = existing.status !== args.status;
            if (statusChanged) {
                nextHistory.push({
                    status: existing.status,
                    updatedAt: existing.updatedAt,
                    notes: existing.notes,
                });
            }

            await ctx.db.patch(existing._id, {
                status: args.status,
                notes: args.notes,
                updatedBy: args.updatedBy,
                updatedAt: now,
                history: nextHistory,
            });

            return existing._id;
        }

        return await ctx.db.insert("candidate_status", {
            workspaceSlug,
            identityKey,
            status: args.status ?? DEFAULT_STATUS,
            notes: args.notes,
            updatedBy: args.updatedBy,
            updatedAt: now,
            history: [],
        });
    },
});

