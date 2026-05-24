/**
 * Integration tests for cron target functions using convex-test.
 *
 * Covers the 3 cron targets defined in crons.ts:
 * - ai_summary_cache.cleanupExpired (interval: 1h)
 * - analysis_tasks.sweepStuckTasks (daily: 03:00 UTC)
 * - resume_tasks.sweepStuckTasks (daily: 03:15 UTC)
 *
 * Crons themselves are not tested — their target functions are invoked
 * directly via t.mutation() to verify correct behavior.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// ---------------------------------------------------------------------------
// ai_summary_cache.cleanupExpired
// ---------------------------------------------------------------------------

describe("cron: ai_summary_cache.cleanupExpired", () => {
  it("deletes expired cache entries and leaves active ones", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    // Insert expired entries
    await t.run(async (ctx) => {
      await ctx.db.insert("ai_summary_cache", {
        urlHash: "h1",
        workspaceSlug: "ws-a",
        query: "q1",
        resultCount: 5,
        resultSetHash: "rsh1",
        summary: "expired summary 1",
        model: "gpt-4",
        generatedAt: now - 7200000,
        expiresAt: now - 1000,
      });
      await ctx.db.insert("ai_summary_cache", {
        urlHash: "h2",
        workspaceSlug: "ws-a",
        query: "q2",
        resultCount: 3,
        resultSetHash: "rsh2",
        summary: "expired summary 2",
        model: "gpt-4",
        generatedAt: now - 3600000,
        expiresAt: now - 500,
      });
      // Active entry — should survive
      await ctx.db.insert("ai_summary_cache", {
        urlHash: "h3",
        workspaceSlug: "ws-a",
        query: "q3",
        resultCount: 10,
        resultSetHash: "rsh3",
        summary: "active summary",
        model: "gpt-4",
        generatedAt: now,
        expiresAt: now + 3600000,
      });
    });

    const result = await t.mutation(internal.ai_summary_cache.cleanupExpired, {
      now,
    });

    expect(result.deleted).toBe(2);

    // Verify only the active entry remains
    const remaining = await t.run(async (ctx) => {
      return ctx.db.query("ai_summary_cache").collect();
    });
    expect(remaining.length).toBe(1);
    expect(remaining[0].summary).toBe("active summary");
  });

  it("deletes nothing when all entries are active", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("ai_summary_cache", {
        urlHash: "h1",
        workspaceSlug: "ws-b",
        query: "q1",
        resultCount: 5,
        resultSetHash: "rsh1",
        summary: "active 1",
        model: "gpt-4",
        generatedAt: now,
        expiresAt: now + 3600000,
      });
    });

    const result = await t.mutation(internal.ai_summary_cache.cleanupExpired, {
      now,
    });

    expect(result.deleted).toBe(0);
  });

  it("deletes nothing when cache is empty", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.ai_summary_cache.cleanupExpired, {
      now: Date.now(),
    });

    expect(result.deleted).toBe(0);
  });

  it("uses Date.now() as default when now arg is omitted", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    // Insert one already-expired entry
    await t.run(async (ctx) => {
      await ctx.db.insert("ai_summary_cache", {
        urlHash: "h1",
        workspaceSlug: "ws-c",
        query: "q1",
        resultCount: 1,
        resultSetHash: "rsh1",
        summary: "old",
        model: "gpt-4",
        generatedAt: now - 7200000,
        expiresAt: now - 1000,
      });
    });

    const result = await t.mutation(
      internal.ai_summary_cache.cleanupExpired,
      {},
    );

    expect(result.deleted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// analysis_tasks.sweepStuckTasks
// ---------------------------------------------------------------------------

describe("cron: analysis_tasks.sweepStuckTasks", () => {
  it("marks processing tasks older than 24h as failed", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const staleStartedAt = now - 25 * 60 * 60 * 1000; // 25h ago

    let staleId: Id<"analysis_tasks">;
    let freshId: Id<"analysis_tasks">;

    await t.run(async (ctx) => {
      // Stale processing task — should be swept
      staleId = await ctx.db.insert("analysis_tasks", {
        config: { resumeCount: 10 },
        status: "processing",
        progress: { current: 3, total: 10, skipped: 0 },
        startedAt: staleStartedAt,
      });

      // Fresh processing task — should survive
      freshId = await ctx.db.insert("analysis_tasks", {
        config: { resumeCount: 5 },
        status: "processing",
        progress: { current: 1, total: 5, skipped: 0 },
        startedAt: now - 12 * 60 * 60 * 1000, // 12h ago — not stale
      });

      // Completed task — should survive regardless of age
      await ctx.db.insert("analysis_tasks", {
        config: { resumeCount: 8 },
        status: "completed",
        progress: { current: 8, total: 8, skipped: 0 },
        startedAt: staleStartedAt,
        completedAt: now,
      });
    });

    const result = await t.mutation(
      internal.analysis_tasks.sweepStuckTasks,
      {},
    );

    expect(result.swept).toBe(1);

    // Verify stale task is now failed
    const swept = await t.run(async (ctx) => {
      return ctx.db.get(staleId!);
    });
    expect(swept?.status).toBe("failed");
    expect(swept?.error).toBe("Swept: stuck in processing for >24h");
    expect(swept?.completedAt).toBeDefined();

    // Verify fresh processing task is untouched
    const fresh = await t.run(async (ctx) => {
      return ctx.db.get(freshId!);
    });
    expect(fresh?.status).toBe("processing");
    expect(fresh?.error).toBeUndefined();
  });

  it("sweeps nothing when no tasks are stuck", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      // Pending task — not processing, not swept
      await ctx.db.insert("analysis_tasks", {
        config: { resumeCount: 5 },
        status: "pending",
        progress: { current: 0, total: 5, skipped: 0 },
      });

      // Recently started processing task
      await ctx.db.insert("analysis_tasks", {
        config: { resumeCount: 3 },
        status: "processing",
        progress: { current: 1, total: 3, skipped: 0 },
        startedAt: now - 1000,
      });
    });

    const result = await t.mutation(
      internal.analysis_tasks.sweepStuckTasks,
      {},
    );

    expect(result.swept).toBe(0);
  });

  it("sweeps nothing when collection is empty", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(
      internal.analysis_tasks.sweepStuckTasks,
      {},
    );

    expect(result.swept).toBe(0);
  });

  it("sweeps multiple stuck tasks", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const staleStartedAt = now - 48 * 60 * 60 * 1000; // 48h ago

    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("analysis_tasks", {
          config: { resumeCount: i + 1 },
          status: "processing",
          progress: { current: 0, total: i + 1, skipped: 0 },
          startedAt: staleStartedAt,
        });
      }
    });

    const result = await t.mutation(
      internal.analysis_tasks.sweepStuckTasks,
      {},
    );

    expect(result.swept).toBe(3);

    // Verify all are now failed
    const tasks = await t.run(async (ctx) => {
      return ctx.db
        .query("analysis_tasks")
        .withIndex("by_status", (q) => q.eq("status", "failed"))
        .collect();
    });
    expect(tasks.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// resume_tasks.sweepStuckTasks (collection_tasks)
// ---------------------------------------------------------------------------

describe("cron: resume_tasks.sweepStuckTasks", () => {
  it("marks stuck collection tasks older than 24h as failed", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const staleStartedAt = now - 25 * 60 * 60 * 1000;

    let staleId: Id<"collection_tasks">;
    let freshId: Id<"collection_tasks">;

    await t.run(async (ctx) => {
      // Stale processing task — should be swept
      staleId = await ctx.db.insert("collection_tasks", {
        config: { keyword: "python", location: "上海", limit: 50 },
        status: "processing",
        progress: { current: 10, total: 50, page: 1 },
        startedAt: staleStartedAt,
      });

      // Fresh processing task — should survive
      freshId = await ctx.db.insert("collection_tasks", {
        config: { keyword: "java", location: "北京", limit: 30 },
        status: "processing",
        progress: { current: 5, total: 30, page: 1 },
        startedAt: now - 6 * 60 * 60 * 1000,
      });

      // Completed task — should survive
      await ctx.db.insert("collection_tasks", {
        config: { keyword: "go", location: "深圳", limit: 20 },
        status: "completed",
        progress: { current: 20, total: 20, page: 2 },
        startedAt: staleStartedAt,
        completedAt: now,
      });
    });

    const result = await t.mutation(
      internal.resume_tasks.sweepStuckTasks,
      {},
    );

    expect(result.swept).toBe(1);

    // Verify stale task is now failed
    const swept = await t.run(async (ctx) => {
      return ctx.db.get(staleId!);
    });
    expect(swept?.status).toBe("failed");
    expect(swept?.error).toBe("Swept: stuck in processing for >24h");

    // Verify fresh processing task is untouched
    const fresh = await t.run(async (ctx) => {
      return ctx.db.get(freshId!);
    });
    expect(fresh?.status).toBe("processing");
    expect(fresh?.error).toBeUndefined();
  });

  it("sweeps nothing when no collection tasks are stuck", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("collection_tasks", {
        config: { keyword: "test", location: "广州", limit: 10 },
        status: "pending",
        progress: { current: 0, total: 10, page: 0 },
      });

      await ctx.db.insert("collection_tasks", {
        config: { keyword: "test2", location: "杭州", limit: 15 },
        status: "processing",
        progress: { current: 3, total: 15, page: 1 },
        startedAt: now - 1000,
      });
    });

    const result = await t.mutation(
      internal.resume_tasks.sweepStuckTasks,
      {},
    );

    expect(result.swept).toBe(0);
  });

  it("sweeps nothing when collection is empty", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(
      internal.resume_tasks.sweepStuckTasks,
      {},
    );

    expect(result.swept).toBe(0);
  });

  it("does not set completedAt on swept collection tasks (unlike analysis_tasks)", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    let staleId: Id<"collection_tasks">;

    await t.run(async (ctx) => {
      staleId = await ctx.db.insert("collection_tasks", {
        config: { keyword: "rust", location: "成都", limit: 5 },
        status: "processing",
        progress: { current: 1, total: 5, page: 1 },
        startedAt: now - 30 * 60 * 60 * 1000,
      });
    });

    await t.mutation(internal.resume_tasks.sweepStuckTasks, {});

    const swept = await t.run(async (ctx) => {
      return ctx.db.get(staleId!);
    });
    expect(swept?.status).toBe("failed");
    // collection_tasks sweepStuckTasks does NOT set completedAt
    // (unlike analysis_tasks which does)
    expect(swept?.completedAt).toBeUndefined();
  });
});
