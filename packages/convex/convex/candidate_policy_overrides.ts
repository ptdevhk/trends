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

function normalizeCompanyKey(value: string): string {
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

function newestFirst<T extends { updatedAt: number; _creationTime: number }>(overrides: T[]): T[] {
    return overrides.sort((left, right) =>
        right.updatedAt - left.updatedAt || right._creationTime - left._creationTime
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
            .query("candidate_policy_overrides")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
            .paginate(args.paginationOpts);
    },
});

export const getByResumeIdentity = query({
    args: {
        workspaceSlug: v.optional(v.string()),
        resumeIdentity: v.string(),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireReadSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const resumeIdentity = normalizeIdentityKey(args.resumeIdentity);
        if (!resumeIdentity) {
            return [];
        }

        return newestFirst(
            await ctx.db
                .query("candidate_policy_overrides")
                .withIndex("by_workspace_identity", (q) =>
                    q.eq("workspaceSlug", workspaceSlug).eq("resumeIdentity", resumeIdentity)
                )
                .collect()
        );
    },
});

export const set = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        resumeId: v.id("resumes"),
        resumeIdentity: v.string(),
        companyKey: v.string(),
        reason: v.string(),
        authorizedBy: v.optional(v.string()),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const resumeIdentity = normalizeIdentityKey(args.resumeIdentity);
        const companyKey = normalizeCompanyKey(args.companyKey);
        const reason = args.reason.trim();
        if (!resumeIdentity) {
            throw new Error("resumeIdentity is required");
        }
        if (!companyKey) {
            throw new Error("companyKey is required");
        }
        if (!reason) {
            throw new Error("reason is required");
        }

        const now = Date.now();
        const existing = newestFirst(await ctx.db
            .query("candidate_policy_overrides")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("resumeIdentity", resumeIdentity)
            )
            .collect());

        const existingForCompany = existing.filter((item) => item.companyKey === companyKey);
        const [current, ...duplicates] = existingForCompany;

        if (current) {
            await ctx.db.patch(current._id, {
                resumeId: args.resumeId,
                reason,
                authorizedBy: args.authorizedBy,
                updatedAt: now,
            });
            for (const duplicate of duplicates) {
                await ctx.db.delete(duplicate._id);
            }
            return current._id;
        }

        return await ctx.db.insert("candidate_policy_overrides", {
            workspaceSlug,
            resumeId: args.resumeId,
            resumeIdentity,
            companyKey,
            effect: "allow",
            reason,
            authorizedBy: args.authorizedBy,
            createdAt: now,
            updatedAt: now,
        });
    },
});

export const remove = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        resumeIdentity: v.string(),
        companyKey: v.string(),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const resumeIdentity = normalizeIdentityKey(args.resumeIdentity);
        const companyKey = normalizeCompanyKey(args.companyKey);
        if (!resumeIdentity || !companyKey) {
            return false;
        }

        const existing = await ctx.db
            .query("candidate_policy_overrides")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("resumeIdentity", resumeIdentity)
            )
            .collect();

        let removed = 0;
        for (const override of existing) {
            if (override.companyKey !== companyKey) {
                continue;
            }
            await ctx.db.delete(override._id);
            removed += 1;
        }
        return removed > 0;
    },
});
