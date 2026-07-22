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
 * Soft-dedupe:
 * - With ingestRunId: companyKey + kind + ingestRunId (curated/showcase seed identity)
 * - Without: companyKey + kind + evidence title + platform + seenAt
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

    const recent = await ctx.db
      .query("research_signals")
      .withIndex("by_company_captured", (q) => q.eq("companyKey", companyKey))
      .order("desc")
      .take(100);

    const existing = recent.find((row) => {
      if (row.kind !== args.kind) {
        return false;
      }
      if (args.ingestRunId) {
        return row.ingestRunId === args.ingestRunId;
      }
      return (
        row.evidence.title === args.evidence.title &&
        row.evidence.platform === args.evidence.platform &&
        row.evidence.seenAt === args.evidence.seenAt
      );
    });

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        summary: args.summary,
        evidence: args.evidence,
        score: args.score,
        ingestRunId: args.ingestRunId,
        capturedAt: args.capturedAt,
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

/**
 * Delete all signals for a company with ingestRunId matching prefix (showcase re-seed cleanup).
 */
export const deleteByCompanyIngestRunPrefix = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
    ingestRunIdPrefix: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = args.companyKey.trim().toLowerCase();
    const prefix = args.ingestRunIdPrefix;
    const rows = await ctx.db
      .query("research_signals")
      .withIndex("by_company_captured", (q) => q.eq("companyKey", companyKey))
      .collect();
    let deleted = 0;
    for (const row of rows) {
      if (typeof row.ingestRunId === "string" && row.ingestRunId.startsWith(prefix)) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});

/**
 * Delete all research_signals whose ingestRunId starts with prefix (e.g. demo-seed purge).
 * Ops path; full table scan — acceptable for local/dev volumes.
 */
export const deleteByIngestRunPrefix = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    ingestRunIdPrefix: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const prefix = args.ingestRunIdPrefix;
    if (!prefix || !prefix.trim()) {
      throw new Error("ingestRunIdPrefix required");
    }
    const rows = await ctx.db.query("research_signals").collect();
    let deleted = 0;
    for (const row of rows) {
      if (typeof row.ingestRunId === "string" && row.ingestRunId.startsWith(prefix)) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { deleted };
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
