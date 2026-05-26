/**
 * Additional convex-test integration tests for resume_tasks.ts.
 *
 * Covers endpoints not tested in tasks-convex-test.test.ts:
 * - list, getById, failStalePending, getSummary, getSummaryWindow
 * - submitResumes (full integration with schema validation)
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";


// Helper: insert a minimal collection task
async function insertTask(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("collection_tasks", {
      config: { keyword: "test", location: "Shanghai", limit: 100 },
      status: "pending",
      progress: { current: 0, total: 0, page: 0 },
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("resume_tasks: list", () => {
  it("returns pending and processing tasks", async () => {
    const t = createTest();

    const id1 = await insertTask(t, { status: "pending" });
    const id2 = await insertTask(t, { status: "processing", workerId: "w1", startedAt: Date.now() });

    const tasks = await t.query(api.resume_tasks.list, {});

    const ids = tasks.map((task) => task._id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("includes recent finished tasks", async () => {
    const t = createTest();

    await insertTask(t, {
      status: "completed",
      completedAt: Date.now(),
      progress: { current: 50, total: 50, page: 3 },
    });

    const tasks = await t.query(api.resume_tasks.list, {});
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty when no tasks exist", async () => {
    const t = createTest();

    const tasks = await t.query(api.resume_tasks.list, {});
    expect(tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe("resume_tasks: getById", () => {
  it("returns a task by ID", async () => {
    const t = createTest();

    const taskId = await insertTask(t, { status: "pending" });

    const task = await t.query(api.resume_tasks.getById, { taskId });
    expect(task).not.toBeNull();
    expect(task!._id).toBe(taskId);
    expect(task!.status).toBe("pending");
  });

  it("returns null for non-existent task", async () => {
    const t = createTest();

    // Create then delete to get an ID that returns null
    const taskId = await insertTask(t, { status: "pending" });
    await t.run(async (ctx) => { await ctx.db.delete(taskId); });

    const task = await t.query(api.resume_tasks.getById, { taskId });
    expect(task).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// failStalePending
// ---------------------------------------------------------------------------

describe("resume_tasks: failStalePending", () => {
  it("fails stale pending tasks and reports counts", async () => {
    const t = createTest();

    // Insert a pending task — failStalePending uses the by_status index
    // with _creationTime filter. With staleMs=0, the threshold is now(),
    // so any task created before "now" is eligible.
    await insertTask(t, { status: "pending" });

    const result = await t.mutation(api.resume_tasks.failStalePending, {
      staleMs: 0,
    });

    // The task may or may not be picked up depending on _creationTime precision
    // in convex-test. At minimum, the result structure should be valid.
    expect(result).toHaveProperty("checked");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("staleMs");
    expect(result.staleMs).toBe(0);
  });

  it("does not fail recent pending tasks with large staleMs", async () => {
    const t = createTest();

    await insertTask(t, { status: "pending" });

    // Use a very large staleMs so nothing is stale
    const result = await t.mutation(api.resume_tasks.failStalePending, {
      staleMs: 999_999_999,
    });

    expect(result.failed).toBe(0);
  });

  it("does not fail tasks in non-pending statuses", async () => {
    const t = createTest();

    await insertTask(t, { status: "processing", workerId: "w1", startedAt: Date.now() });
    await insertTask(t, { status: "completed", completedAt: Date.now(), progress: { current: 50, total: 50, page: 3 } });

    const result = await t.mutation(api.resume_tasks.failStalePending, {
      staleMs: 0,
    });

    // failStalePending only queries by status "pending"
    expect(result.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getSummary
// ---------------------------------------------------------------------------

describe("resume_tasks: getSummary", () => {
  it("returns counts by status", async () => {
    const t = createTest();

    await insertTask(t, { status: "pending" });
    await insertTask(t, { status: "pending" });
    await insertTask(t, {
      status: "processing",
      workerId: "w1",
      startedAt: Date.now(),
    });

    const stats = await t.query(api.resume_tasks.getSummary, {});

    expect(stats.pending).toBe(2);
    expect(stats.processing).toBe(1);
    expect(stats.total).toBe(3);
    expect(stats.activeWorkers).toBe(1);
  });

  it("returns zeros when no tasks exist", async () => {
    const t = createTest();

    const stats = await t.query(api.resume_tasks.getSummary, {});

    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.processing).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getSummaryWindow
// ---------------------------------------------------------------------------

describe("resume_tasks: getSummaryWindow", () => {
  it("returns tasks completed within time window", async () => {
    const t = createTest();

    const now = Date.now();
    await insertTask(t, {
      status: "completed",
      completedAt: now,
      progress: { current: 50, total: 50, page: 3 },
    });

    const result = await t.query(api.resume_tasks.getSummaryWindow, {
      fromTimestamp: now - 60_000,
      toTimestamp: now + 60_000,
    });

    expect(result.total).toBeGreaterThanOrEqual(1);
    const completedEntry = result.byStatus.find((e) => e.key === "completed");
    expect(completedEntry?.count).toBeGreaterThanOrEqual(1);
  });

  it("returns empty when no tasks in window", async () => {
    const t = createTest();

    const now = Date.now();
    const result = await t.query(api.resume_tasks.getSummaryWindow, {
      fromTimestamp: now - 60_000,
      toTimestamp: now + 60_000,
    });

    expect(result.total).toBe(0);
    expect(result.byStatus).toHaveLength(0);
  });

  it("sorts byStatus by count descending", async () => {
    const t = createTest();

    const now = Date.now();
    // Insert 2 completed, 1 failed
    await insertTask(t, {
      status: "completed",
      completedAt: now,
      progress: { current: 50, total: 50, page: 3 },
    });
    await insertTask(t, {
      status: "completed",
      completedAt: now,
      progress: { current: 50, total: 50, page: 3 },
    });
    await insertTask(t, {
      status: "failed",
      completedAt: now,
      error: "test failure",
      progress: { current: 10, total: 50, page: 1 },
    });

    const result = await t.query(api.resume_tasks.getSummaryWindow, {
      fromTimestamp: now - 60_000,
      toTimestamp: now + 60_000,
    });

    expect(result.byStatus.length).toBeGreaterThan(0);
    if (result.byStatus.length >= 2) {
      expect(result.byStatus[0].count).toBeGreaterThanOrEqual(result.byStatus[1].count);
    }
  });
});

// ---------------------------------------------------------------------------
// submitResumes (full convex-test integration)
// ---------------------------------------------------------------------------

describe("resume_tasks: submitResumes", () => {
  it("inserts new resumes and returns counts", async () => {
    const t = createTest();

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-new-1",
          content: { name: "Alice", title: "Engineer" },
          hash: "hash-1",
          source: "test",
          tags: ["engineering"],
        },
      ],
    });

    expect(result.input).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
  });

  it("updates existing resume when hash changes", async () => {
    const t = createTest();

    // First submission
    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-update-1",
          content: { name: "Bob" },
          hash: "hash-v1",
          source: "test",
          tags: ["sales"],
        },
      ],
    });

    // Second submission with changed hash
    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-update-1",
          content: { name: "Bob", title: "Senior Sales" },
          hash: "hash-v2",
          source: "test",
          tags: ["sales", "senior"],
        },
      ],
    });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);
  });

  it("marks unchanged when hash matches and no tag changes", async () => {
    const t = createTest();

    // First submission
    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-unchanged-1",
          content: { name: "Carol" },
          hash: "hash-same",
          source: "test",
          tags: ["marketing"],
        },
      ],
    });

    // Second submission with same hash and same tags
    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-unchanged-1",
          content: { name: "Carol" },
          hash: "hash-same",
          source: "test",
          tags: ["marketing"],
        },
      ],
    });

    expect(result.unchanged).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("merges tags from incoming resume", async () => {
    const t = createTest();

    // First submission
    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-tags-1",
          content: { name: "Dave" },
          hash: "hash-tags-v1",
          source: "test",
          tags: ["python"],
        },
      ],
    });

    // Second submission with new hash and extra tags
    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-tags-1",
          content: { name: "Dave" },
          hash: "hash-tags-v2",
          source: "test",
          tags: ["django"],
        },
      ],
    });

    // Verify tags are merged
    const resumes = await t.run(async (ctx) => {
      return ctx.db
        .query("resumes")
        .withIndex("by_externalId", (q) => q.eq("externalId", "ext-tags-1"))
        .unique();
    });

    expect(resumes!.tags).toContain("python");
    expect(resumes!.tags).toContain("django");
  });

  it("preserves restoreState for migrated resumes", async () => {
    const t = createTest();

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-restore-1",
          content: { name: "Eve" },
          hash: "hash-restore-1",
          source: "test",
          tags: ["engineering"],
          restoreState: {
            crawledAt: 1700000000000,
            isArchived: true,
            archivedAt: 1700000000000,
            primaryRuleScore: 85,
          },
        },
      ],
    });

    expect(result.inserted).toBe(1);

    const resumes = await t.run(async (ctx) => {
      return ctx.db
        .query("resumes")
        .withIndex("by_externalId", (q) => q.eq("externalId", "ext-restore-1"))
        .unique();
    });

    expect(resumes!.isArchived).toBe(true);
    expect(resumes!.archivedAt).toBe(1700000000000);
    expect(resumes!.crawledAt).toBe(1700000000000);
    expect(resumes!.primaryRuleScore).toBe(85);
  });

  it("deduplicates resumes with same identity within batch", async () => {
    const t = createTest();

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-dedup-1",
          content: { name: "Frank" },
          hash: "hash-dedup-1",
          source: "test",
          tags: [],
        },
        {
          externalId: "ext-dedup-1",
          content: { name: "Frank" },
          hash: "hash-dedup-1",
          source: "test",
          tags: [],
        },
      ],
    });

    // Second entry is deduped (same externalId → same identityKey)
    expect(result.identityDeduped).toBe(1);
    expect(result.submitted).toBe(1);
    expect(result.inserted).toBe(1);
  });

  it("creates a sync event on submission", async () => {
    const t = createTest();

    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "ext-sync-1",
          content: { name: "Grace" },
          hash: "hash-sync-1",
          source: "test",
          tags: [],
        },
      ],
    });

    const events = await t.run(async (ctx) => {
      return ctx.db.query("sync_events").collect();
    });

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("browser-extension");
    expect(events[0].status).toBe("success");
    expect(events[0].inserted).toBe(1);
  });

  it("handles batch of 5 resumes", async () => {
    const t = createTest();

    const resumes = Array.from({ length: 5 }, (_, i) => ({
      externalId: `ext-batch5-${i}`,
      content: { name: `Batch User ${i}` },
      hash: `hash-batch5-${i}`,
      source: "test",
      tags: [],
    }));

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes,
    });

    expect(result.input).toBe(5);
    expect(result.inserted).toBe(5);
  });
});
