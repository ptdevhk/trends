import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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

/**
 * Upsert a news item by contentHash.
 * First-seen capturedAt is preserved; mutable fields (title/url/rank/snippet) refresh.
 */
export const upsertItem = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    sourceId: v.string(),
    platform: v.string(),
    externalId: v.optional(v.string()),
    title: v.string(),
    url: v.optional(v.string()),
    rank: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    capturedAt: v.number(),
    rawSnippet: v.optional(v.string()),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const existing = await ctx.db
      .query("news_items")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", args.contentHash))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sourceId: args.sourceId,
        platform: args.platform,
        externalId: args.externalId,
        title: args.title,
        url: args.url,
        rank: args.rank,
        publishedAt: args.publishedAt,
        rawSnippet: args.rawSnippet,
        // capturedAt stays first-seen
      });
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("news_items", {
      sourceId: args.sourceId,
      platform: args.platform,
      externalId: args.externalId,
      title: args.title,
      url: args.url,
      rank: args.rank,
      publishedAt: args.publishedAt,
      capturedAt: args.capturedAt,
      rawSnippet: args.rawSnippet,
      contentHash: args.contentHash,
    });
    return { id, created: true };
  },
});

export const listRecent = query({
  args: {
    writeSecret: v.optional(v.string()),
    limit: v.optional(v.number()),
    platform: v.optional(v.string()),
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const since = args.since ?? 0;

    let rows;
    if (args.platform) {
      rows = await ctx.db
        .query("news_items")
        .withIndex("by_platform_captured", (q) =>
          q.eq("platform", args.platform!).gte("capturedAt", since),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("news_items")
        .withIndex("by_captured_at", (q) => q.gte("capturedAt", since))
        .order("desc")
        .take(limit);
    }
    return rows;
  },
});

export const getById = query({
  args: {
    writeSecret: v.optional(v.string()),
    id: v.id("news_items"),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return await ctx.db.get(args.id as Id<"news_items">);
  },
});
