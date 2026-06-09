import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

import { DEFAULT_WORKSPACE_SLUG } from "./sessions";

function normalizeWorkspaceSlug(input: string | undefined): string {
    const normalized = input?.trim();
    return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
}

function normalizeIdentityKey(value: string): string {
    return value.trim();
}

function requireWriteSecret(writeSecret: string | undefined): void {
    const expected = process.env.CONVEX_WRITE_SECRET;
    if (!expected || writeSecret !== expected) {
        throw new Error("Unauthorized Convex write");
    }
}

export const list = query({
    args: {
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        return await ctx.db
            .query("candidate_blocks")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
            .take(500);
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
            .query("candidate_blocks")
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
        reason: v.optional(v.string()),
        blockedBy: v.optional(v.string()),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKey = normalizeIdentityKey(args.identityKey);
        if (!identityKey) {
            throw new Error("identityKey is required");
        }

        const now = Date.now();
        const existing = await ctx.db
            .query("candidate_blocks")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .unique();

        if (existing) {
            await ctx.db.patch(existing._id, {
                reason: args.reason,
                blockedBy: args.blockedBy,
                blockedAt: now,
            });
            return existing._id;
        }

        return await ctx.db.insert("candidate_blocks", {
            workspaceSlug,
            identityKey,
            reason: args.reason,
            blockedBy: args.blockedBy,
            blockedAt: now,
        });
    },
});

export const updateReason = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        identityKey: v.string(),
        reason: v.optional(v.string()),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKey = normalizeIdentityKey(args.identityKey);
        if (!identityKey) {
            throw new Error("identityKey is required");
        }

        const existing = await ctx.db
            .query("candidate_blocks")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .unique();

        if (!existing) {
            return false;
        }

        await ctx.db.patch(existing._id, {
            reason: args.reason,
        });

        return true;
    },
});

export const bulkUpsert = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        identityKeys: v.array(v.string()),
        reason: v.optional(v.string()),
        blockedBy: v.optional(v.string()),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKeys = Array.from(
            new Set(args.identityKeys.map((item) => normalizeIdentityKey(item)).filter((item) => item.length > 0))
        );

        let updated = 0;
        let inserted = 0;
        const now = Date.now();

        // Fetch all existing blocks for this workspace in one query
        const existingBlocks = await ctx.db
            .query("candidate_blocks")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
            .take(500);
        const existingMap = new Map(existingBlocks.map((block) => [block.identityKey, block]));

        for (const identityKey of identityKeys) {
            const existing = existingMap.get(identityKey);

            if (existing) {
                await ctx.db.patch(existing._id, {
                    reason: args.reason,
                    blockedBy: args.blockedBy,
                    blockedAt: now,
                });
                updated += 1;
                continue;
            }

            await ctx.db.insert("candidate_blocks", {
                workspaceSlug,
                identityKey,
                reason: args.reason,
                blockedBy: args.blockedBy,
                blockedAt: now,
            });
            inserted += 1;
        }

        return {
            total: identityKeys.length,
            inserted,
            updated,
        };
    },
});

export const remove = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        identityKey: v.string(),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKey = normalizeIdentityKey(args.identityKey);
        if (!identityKey) {
            return false;
        }

        const existing = await ctx.db
            .query("candidate_blocks")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .unique();

        if (!existing) {
            return false;
        }

        await ctx.db.delete(existing._id);
        return true;
    },
});
