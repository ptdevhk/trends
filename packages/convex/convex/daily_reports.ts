import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

export const upsertReport = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    date: v.string(),
    packJson: v.string(),
    html: v.string(),
    source: v.string(),
    fallbackFromDate: v.optional(v.string()),
    builtAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);

    const existing = await ctx.db
      .query("daily_reports")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        packJson: args.packJson,
        html: args.html,
        source: args.source,
        fallbackFromDate: args.fallbackFromDate,
        builtAt: args.builtAt,
      });
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("daily_reports", {
      date: args.date,
      packJson: args.packJson,
      html: args.html,
      source: args.source,
      fallbackFromDate: args.fallbackFromDate,
      builtAt: args.builtAt,
    });

    return { id, created: true };
  },
});

export const getByDate = query({
  args: {
    writeSecret: v.optional(v.string()),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return await ctx.db
      .query("daily_reports")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();
  },
});

export const listDates = query({
  args: {
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = await ctx.db
      .query("daily_reports")
      .withIndex("by_date")
      .order("desc")
      .collect();

    return rows.map((row) => ({
      date: row.date,
      source: row.source,
      builtAt: row.builtAt,
    }));
  },
});
