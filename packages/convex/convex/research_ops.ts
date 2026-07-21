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

const platformBreakdownValidator = v.object({
  platform: v.string(),
  nativeCount: v.number(),
  shadowCount: v.number(),
  ratio: v.number(),
  zeroWithShadow: v.boolean(),
});

const goldenCompanyResultValidator = v.object({
  companyKey: v.string(),
  signalCount: v.number(),
  pass: v.boolean(),
});

export const startIngestRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    startedAt: v.number(),
    enabledPlatforms: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const existing = await ctx.db
      .query("research_ingest_runs")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first();
    if (existing) {
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("research_ingest_runs", {
      runId: args.runId,
      startedAt: args.startedAt,
      status: "running",
      enabledPlatforms: args.enabledPlatforms,
    });
    return { id, created: true };
  },
});

export const finishIngestRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    finishedAt: v.number(),
    status: v.union(v.literal("success"), v.literal("failed")),
    newsInserted: v.optional(v.number()),
    newsUpdated: v.optional(v.number()),
    signalsInserted: v.optional(v.number()),
    unresolvedMentions: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const existing = await ctx.db
      .query("research_ingest_runs")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first();
    if (!existing) {
      throw new Error(`Unknown ingest run: ${args.runId}`);
    }
    await ctx.db.patch(existing._id, {
      finishedAt: args.finishedAt,
      status: args.status,
      newsInserted: args.newsInserted,
      newsUpdated: args.newsUpdated,
      signalsInserted: args.signalsInserted,
      unresolvedMentions: args.unresolvedMentions,
      error: args.error,
    });
    return { id: existing._id };
  },
});

export const getIngestRun = query({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return await ctx.db
      .query("research_ingest_runs")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first();
  },
});

export const recordParityRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    parityRunId: v.string(),
    evaluatedAt: v.number(),
    windowStart: v.number(),
    windowEnd: v.number(),
    enabledPlatforms: v.array(v.string()),
    nativeTotal: v.number(),
    shadowTotal: v.number(),
    aggregateRatio: v.number(),
    platformBreakdown: v.array(platformBreakdownValidator),
    goldenCompanyResults: v.array(goldenCompanyResultValidator),
    nativeNonEmpty: v.boolean(),
    green: v.boolean(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);

    // Compute greenStreak from previous latest row
    const previous = await ctx.db
      .query("research_parity_runs")
      .withIndex("by_evaluated_at")
      .order("desc")
      .first();

    let greenStreak = 0;
    if (args.green) {
      greenStreak = (previous?.greenStreak ?? 0) + 1;
      // If previous was not green, start streak at 1
      if (previous && !previous.green) {
        greenStreak = 1;
      }
      if (!previous) {
        greenStreak = 1;
      }
    } else {
      greenStreak = 0;
    }

    const existing = await ctx.db
      .query("research_parity_runs")
      .withIndex("by_parity_run_id", (q) => q.eq("parityRunId", args.parityRunId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        evaluatedAt: args.evaluatedAt,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd,
        enabledPlatforms: args.enabledPlatforms,
        nativeTotal: args.nativeTotal,
        shadowTotal: args.shadowTotal,
        aggregateRatio: args.aggregateRatio,
        platformBreakdown: args.platformBreakdown,
        goldenCompanyResults: args.goldenCompanyResults,
        nativeNonEmpty: args.nativeNonEmpty,
        green: args.green,
        greenStreak,
      });
      return { id: existing._id, greenStreak, created: false };
    }

    const id = await ctx.db.insert("research_parity_runs", {
      parityRunId: args.parityRunId,
      evaluatedAt: args.evaluatedAt,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      enabledPlatforms: args.enabledPlatforms,
      nativeTotal: args.nativeTotal,
      shadowTotal: args.shadowTotal,
      aggregateRatio: args.aggregateRatio,
      platformBreakdown: args.platformBreakdown,
      goldenCompanyResults: args.goldenCompanyResults,
      nativeNonEmpty: args.nativeNonEmpty,
      green: args.green,
      greenStreak,
    });
    return { id, greenStreak, created: true };
  },
});

export const latestParity = query({
  args: {
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return await ctx.db
      .query("research_parity_runs")
      .withIndex("by_evaluated_at")
      .order("desc")
      .first();
  },
});

export const listRecentParity = query({
  args: {
    writeSecret: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    return await ctx.db
      .query("research_parity_runs")
      .withIndex("by_evaluated_at")
      .order("desc")
      .take(limit);
  },
});
