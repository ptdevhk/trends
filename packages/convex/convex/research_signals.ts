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

const kindValidator = v.union(
  v.literal("company_mention"),
  v.literal("hiring_signal"),
  v.literal("market_move"),
  v.literal("sales_trigger"),
);

const evidenceValidator = v.object({
  newsItemId: v.optional(v.id("news_items")),
  title: v.string(),
  url: v.optional(v.string()),
  platform: v.string(),
  seenAt: v.number(),
  snippet: v.optional(v.string()),
});

/**
 * Insert a research signal. Evidence must be a nested object (not flattened).
 * Dedupes by companyKey + kind + evidence title + platform + seenAt when a close match exists.
 */
export const upsert = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
    kind: kindValidator,
    title: v.string(),
    summary: v.optional(v.string()),
    evidence: evidenceValidator,
    score: v.optional(v.number()),
    capturedAt: v.number(),
    ingestRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = args.companyKey.trim().toLowerCase();

    // Soft dedupe: same company + kind + evidence title within same ingest run
    const recent = await ctx.db
      .query("research_signals")
      .withIndex("by_company_captured", (q) => q.eq("companyKey", companyKey))
      .order("desc")
      .take(50);

    const existing = recent.find(
      (row) =>
        row.kind === args.kind &&
        row.evidence.title === args.evidence.title &&
        row.evidence.platform === args.evidence.platform &&
        (args.ingestRunId
          ? row.ingestRunId === args.ingestRunId
          : row.evidence.seenAt === args.evidence.seenAt),
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        summary: args.summary,
        evidence: args.evidence,
        score: args.score,
        ingestRunId: args.ingestRunId,
      });
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("research_signals", {
      companyKey,
      kind: args.kind,
      title: args.title,
      summary: args.summary,
      evidence: args.evidence,
      score: args.score,
      capturedAt: args.capturedAt,
      ingestRunId: args.ingestRunId,
    });
    return { id, created: true };
  },
});

export const listByCompany = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
    limit: v.optional(v.number()),
    kind: v.optional(kindValidator),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const companyKey = args.companyKey.trim().toLowerCase();
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

    const rows = await ctx.db
      .query("research_signals")
      .withIndex("by_company_captured", (q) => q.eq("companyKey", companyKey))
      .order("desc")
      .take(limit * 2);

    const filtered = args.kind ? rows.filter((r) => r.kind === args.kind) : rows;
    return filtered.slice(0, limit);
  },
});
