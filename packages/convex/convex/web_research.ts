import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULT_MONTHLY_CAP = 1000;

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

export const getQuota = query({
    args: { provider: v.string(), month: v.string(), writeSecret: v.string() },
    handler: async (ctx, args) => {
        requireReadSecret(args.writeSecret);
        const row = await ctx.db
            .query("web_research_quota")
            .withIndex("by_provider_month", (q) =>
                q.eq("provider", args.provider).eq("month", args.month))
            .unique();
        return {
            used: row?.used ?? 0,
            cap: row?.cap ?? DEFAULT_MONTHLY_CAP,
            month: args.month,
        };
    },
});

export const recordUse = mutation({
    args: {
        provider: v.string(),
        month: v.string(),
        credits: v.number(),
        writeSecret: v.string(),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        const row = await ctx.db
            .query("web_research_quota")
            .withIndex("by_provider_month", (q) =>
                q.eq("provider", args.provider).eq("month", args.month))
            .unique();
        const used = (row?.used ?? 0) + args.credits;
        if (row) {
            await ctx.db.patch(row._id, { used, updatedAt: Date.now() });
        } else {
            await ctx.db.insert("web_research_quota", {
                provider: args.provider,
                month: args.month,
                used,
                cap: DEFAULT_MONTHLY_CAP,
                updatedAt: Date.now(),
            });
        }
        return { used, cap: DEFAULT_MONTHLY_CAP, month: args.month };
    },
});
