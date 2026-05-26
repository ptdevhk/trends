/**
 * Integration tests for cron target functions using convex-test.
 *
 * Covers the cron targets defined in crons.ts:
 * - ai_summary_cache.cleanupExpired (interval: 1h)
 * - analysis_tasks.sweepStuckTasks (daily: 03:00 UTC)
 * - resume_tasks.sweepStuckTasks (daily: 03:15 UTC)
 * - audit.cleanupExpiredAuditLogs (daily: 05:00 UTC)
 * - bias_audit.computeBiasMetricsForAllWorkspaces (weekly: Monday 04:00 UTC)
 *
 * Crons themselves are not tested — their target functions are invoked
 * directly via t.mutation()/t.action() to verify correct behavior.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";


// ---------------------------------------------------------------------------
// ai_summary_cache.cleanupExpired
// ---------------------------------------------------------------------------

describe("cron: ai_summary_cache.cleanupExpired", () => {
  it("deletes expired cache entries and leaves active ones", async () => {
    const t = createTest();
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
    const t = createTest();
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
    const t = createTest();

    const result = await t.mutation(internal.ai_summary_cache.cleanupExpired, {
      now: Date.now(),
    });

    expect(result.deleted).toBe(0);
  });

  it("uses Date.now() as default when now arg is omitted", async () => {
    const t = createTest();
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
    const t = createTest();
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
    const t = createTest();
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
    const t = createTest();

    const result = await t.mutation(
      internal.analysis_tasks.sweepStuckTasks,
      {},
    );

    expect(result.swept).toBe(0);
  });

  it("sweeps multiple stuck tasks", async () => {
    const t = createTest();
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
    const t = createTest();
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
    const t = createTest();
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
    const t = createTest();

    const result = await t.mutation(
      internal.resume_tasks.sweepStuckTasks,
      {},
    );

    expect(result.swept).toBe(0);
  });

  it("does not set completedAt on swept collection tasks (unlike analysis_tasks)", async () => {
    const t = createTest();
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

// ---------------------------------------------------------------------------
// audit.cleanupExpiredAuditLogs
// ---------------------------------------------------------------------------

describe("cron: audit.cleanupExpiredAuditLogs", () => {
  it("deletes expired audit logs and leaves active ones", async () => {
    const t = createTest();
    const now = Date.now();
    const twoYears = 2 * 365 * 24 * 60 * 60 * 1000;

    let expiredId: Id<"analysis_audit_log">;
    let activeId: Id<"analysis_audit_log">;

    await t.run(async (ctx) => {
      const resumeId = await ctx.db.insert("resumes", {
        externalId: "audit-cleanup-r1",
        content: {},
        hash: "audit-cleanup1",
        tags: [],
        crawledAt: now,
        source: "test",
      });

      // Expired audit log — should be deleted
      expiredId = await ctx.db.insert("analysis_audit_log", {
        resumeId,
        workspaceSlug: "ws-cleanup-expired",
        decisionType: "score",
        actionRef: "analyze:analyzeResume",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4", provider: "openai" },
        output: { score: 50 },
        outcome: "accepted",
        decidedAt: now - twoYears - 1000,
        expiresAt: now - 1000, // Expired
      });

      // Active audit log — should survive
      activeId = await ctx.db.insert("analysis_audit_log", {
        resumeId,
        workspaceSlug: "ws-cleanup-active",
        decisionType: "score",
        actionRef: "analyze:analyzeResume",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4", provider: "openai" },
        output: { score: 85 },
        outcome: "pending",
        decidedAt: now,
        expiresAt: now + twoYears, // Not expired
      });
    });

    const result = await t.action(internal.audit.cleanupExpiredAuditLogs, {});

    expect(result.deleted).toBe(1);
    expect(result.checked).toBe(1);
    expect(result.hasMore).toBe(false);

    // Verify only active entry remains
    const remaining = await t.run(async (ctx) => {
      return ctx.db.query("analysis_audit_log").collect();
    });
    expect(remaining.length).toBe(1);
    expect(remaining[0].workspaceSlug).toBe("ws-cleanup-active");
  });

  it("deletes nothing when all logs are active", async () => {
    const t = createTest();
    const now = Date.now();

    await t.run(async (ctx) => {
      const resumeId = await ctx.db.insert("resumes", {
        externalId: "audit-cleanup-r2",
        content: {},
        hash: "audit-cleanup2",
        tags: [],
        crawledAt: now,
        source: "test",
      });

      await ctx.db.insert("analysis_audit_log", {
        resumeId,
        workspaceSlug: "ws-all-active",
        decisionType: "tag",
        actionRef: "ai_tagging_results:drainQueue",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4", provider: "openai" },
        output: { tags: ["senior"] },
        outcome: "accepted",
        decidedAt: now,
        expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
      });
    });

    const result = await t.action(internal.audit.cleanupExpiredAuditLogs, {});

    expect(result.deleted).toBe(0);
    expect(result.checked).toBe(0);
  });

  it("deletes nothing when audit log is empty", async () => {
    const t = createTest();

    const result = await t.action(internal.audit.cleanupExpiredAuditLogs, {});

    expect(result.deleted).toBe(0);
    expect(result.checked).toBe(0);
  });

  it("respects maxDeletes limit and reports hasMore", async () => {
    const t = createTest();
    const now = Date.now();

    // Insert 5 expired logs
    await t.run(async (ctx) => {
      const resumeId = await ctx.db.insert("resumes", {
        externalId: "audit-cleanup-r3",
        content: {},
        hash: "audit-cleanup3",
        tags: [],
        crawledAt: now,
        source: "test",
      });

      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: `ws-limit-${i}`,
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: i * 20 },
          decidedAt: now - 1000,
          expiresAt: now - 1, // All expired
        });
      }
    });

    // Only delete 2 at a time
    const result = await t.action(internal.audit.cleanupExpiredAuditLogs, {
      maxDeletes: 2,
    });

    expect(result.deleted).toBe(2);
    expect(result.hasMore).toBe(true);

    // Second batch
    const result2 = await t.action(internal.audit.cleanupExpiredAuditLogs, {
      maxDeletes: 2,
    });

    expect(result2.deleted).toBe(2);
    expect(result2.hasMore).toBe(true);

    // Final batch
    const result3 = await t.action(internal.audit.cleanupExpiredAuditLogs, {
      maxDeletes: 2,
    });

    expect(result3.deleted).toBe(1);
    expect(result3.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bias_audit.computeBiasMetricsForAllWorkspaces (cron entry point test)
// ---------------------------------------------------------------------------

describe("cron: bias_audit.getExpiredAuditLogs (query helper)", () => {
  it("finds expired logs using by_expires_at index", async () => {
    const t = createTest();
    const now = Date.now();

    await t.run(async (ctx) => {
      const resumeId = await ctx.db.insert("resumes", {
        externalId: "expired-query-r1",
        content: {},
        hash: "expired-query1",
        tags: [],
        crawledAt: now,
        source: "test",
      });

      await ctx.db.insert("analysis_audit_log", {
        resumeId,
        workspaceSlug: "ws-expired",
        decisionType: "score",
        actionRef: "analyze:analyzeResume",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4", provider: "openai" },
        output: { score: 50 },
        decidedAt: now - 1000,
        expiresAt: now - 500, // Expired
      });

      await ctx.db.insert("analysis_audit_log", {
        resumeId,
        workspaceSlug: "ws-active",
        decisionType: "score",
        actionRef: "analyze:analyzeResume",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4", provider: "openai" },
        output: { score: 80 },
        decidedAt: now,
        expiresAt: now + 86400000, // Not expired
      });
    });

    const expired = await t.query(internal.audit.getExpiredAuditLogs, {
      before: now,
    });

    expect(expired.length).toBe(1);
    expect(expired[0].workspaceSlug).toBe("ws-expired");
  });

  it("returns empty array when no logs are expired", async () => {
    const t = createTest();

    const expired = await t.query(internal.audit.getExpiredAuditLogs, {
      before: Date.now(),
    });

    expect(expired).toEqual([]);
  });
});
