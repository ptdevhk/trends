import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
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

function requireReadSecret(writeSecret: string | undefined): void {
    const expected = process.env.CONVEX_WRITE_SECRET;
    if (!expected || writeSecret !== expected) {
        throw new Error("Unauthorized Convex read");
    }
}

function newestFirst<T extends { blockedAt: number; _creationTime: number }>(blocks: T[]): T[] {
    return blocks.sort((left, right) =>
        right.blockedAt - left.blockedAt || right._creationTime - left._creationTime
    );
}

export const list = query({
    args: {
        workspaceSlug: v.optional(v.string()),
        paginationOpts: paginationOptsValidator,
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireReadSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        return await ctx.db
            .query("candidate_blocks")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
            .paginate(args.paginationOpts);
    },
});

export const getByIdentity = query({
    args: {
        workspaceSlug: v.optional(v.string()),
        identityKey: v.string(),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireReadSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKey = normalizeIdentityKey(args.identityKey);
        if (!identityKey) {
            return null;
        }

        const blocks = await ctx.db
            .query("candidate_blocks")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .collect();
        return newestFirst(blocks)[0] ?? null;
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
        const existingBlocks = newestFirst(await ctx.db
            .query("candidate_blocks")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .collect());
        const [existing, ...duplicates] = existingBlocks;

        if (existing) {
            await ctx.db.patch(existing._id, {
                reason: args.reason,
                blockedBy: args.blockedBy,
                blockedAt: now,
            });
            for (const duplicate of duplicates) {
                await ctx.db.delete(duplicate._id);
            }
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

        const existingBlocks = newestFirst(await ctx.db
            .query("candidate_blocks")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .collect());
        const [existing, ...duplicates] = existingBlocks;

        if (!existing) {
            return false;
        }

        await ctx.db.patch(existing._id, {
            reason: args.reason,
        });
        for (const duplicate of duplicates) {
            await ctx.db.delete(duplicate._id);
        }

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

        for (const identityKey of identityKeys) {
            const existingBlocks = newestFirst(await ctx.db
                .query("candidate_blocks")
                .withIndex("by_workspace_identity", (q) =>
                    q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
                )
                .collect());
            const [existing, ...duplicates] = existingBlocks;

            if (existing) {
                await ctx.db.patch(existing._id, {
                    reason: args.reason,
                    blockedBy: args.blockedBy,
                    blockedAt: now,
                });
                for (const duplicate of duplicates) {
                    await ctx.db.delete(duplicate._id);
                }
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
            .collect();

        if (existing.length === 0) {
            return false;
        }

        for (const block of existing) {
            await ctx.db.delete(block._id);
        }
        return true;
    },
});
