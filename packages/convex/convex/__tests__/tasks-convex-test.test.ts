/**
 * Integration tests for analysis_tasks and resume_tasks using convex-test.
 *
 * Covers the highest-risk untested Convex functions:
 * - analysis_tasks.dispatch (task creation with idempotency)
 * - analysis_tasks.cancel (task cancellation)
 * - resume_tasks.dispatch (collection task creation)
 * - resume_tasks.cancel (collection task cancellation)
 * - resume_tasks.resetDatabase (bulk delete with partial/pagination)
 *
 * Uses convex-test with real schema validation — no mocks.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// Helper: insert a minimal resume document matching schema requirements
let _resumeCounter = 0;
async function insertResume(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
) {
  _resumeCounter += 1;
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `ext-${_resumeCounter}`,
      content: { name: "Test User" },
      hash: `hash-${_resumeCounter}`,
      tags: [],
      crawledAt: Date.now(),
      source: "test",
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// analysis_tasks.dispatch
// ---------------------------------------------------------------------------

describe("analysis_tasks: dispatch", () => {
  it("creates an analysis task with keywords", async () => {
    const t = convexTest(schema, modules);

    const resumeId1 = await insertResume(t);
    const resumeId2 = await insertResume(t);

    const taskId = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["python", "react"],
      location: "Shanghai",
      resumeIds: [resumeId1, resumeId2],
    });

    expect(taskId).toBeDefined();

    const tasks = await t.run(async (ctx) => {
      return ctx.db.query("analysis_tasks").collect();
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("pending");
    expect(tasks[0].config.keywords).toEqual(["python", "react"]);
    expect(tasks[0].config.location).toBe("Shanghai");
    expect(tasks[0].config.resumeCount).toBe(2);
    expect(tasks[0].idempotencyKey).toBeDefined();
    expect(tasks[0].jobKey).toBeDefined();
  });

  it("creates an analysis task with jobDescriptionContent", async () => {
    const t = convexTest(schema, modules);

    const resumeId = await insertResume(t);

    const taskId = await t.mutation(api.analysis_tasks.dispatch, {
      jobDescriptionContent: "We need a senior developer...",
      resumeIds: [resumeId],
    });

    expect(taskId).toBeDefined();

    const tasks = await t.run(async (ctx) => {
      return ctx.db.query("analysis_tasks").collect();
    });
    expect(tasks[0].config.jobDescriptionContent).toBe("We need a senior developer...");
  });

  it("throws when neither jobDescriptionContent nor keywords provided", async () => {
    const t = convexTest(schema, modules);

    const resumeId = await insertResume(t);

    await expect(
      t.mutation(api.analysis_tasks.dispatch, {
        resumeIds: [resumeId],
      }),
    ).rejects.toThrow("Either jobDescriptionContent or keywords is required");
  });

  it("deduplicates resume IDs", async () => {
    const t = convexTest(schema, modules);

    const resumeId = await insertResume(t);

    const taskId = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["test"],
      resumeIds: [resumeId, resumeId, resumeId],
    });

    expect(taskId).toBeDefined();

    const tasks = await t.run(async (ctx) => {
      return ctx.db.query("analysis_tasks").collect();
    });
    // Deduped from 3 to 1
    expect(tasks[0].config.resumeCount).toBe(1);
  });

  it("returns existing task when idempotency key matches", async () => {
    const t = convexTest(schema, modules);

    const resumeId = await insertResume(t);

    const first = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["python"],
      location: "Beijing",
      resumeIds: [resumeId],
    });

    const second = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["python"],
      location: "Beijing",
      resumeIds: [resumeId],
    });

    // Same idempotency key → same task returned
    expect(second).toBe(first);

    const tasks = await t.run(async (ctx) => {
      return ctx.db.query("analysis_tasks").collect();
    });
    expect(tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// analysis_tasks.cancel
// ---------------------------------------------------------------------------

describe("analysis_tasks: cancel", () => {
  it("cancels a pending task", async () => {
    const t = convexTest(schema, modules);

    const resumeId = await insertResume(t);
    const taskId = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["test"],
      resumeIds: [resumeId],
    });

    await t.mutation(api.analysis_tasks.cancel, { taskId });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("cancelled");
    expect(task?.completedAt).toBeDefined();
  });

  it("is a no-op for already completed tasks", async () => {
    const t = convexTest(schema, modules);

    const resumeId = await insertResume(t);
    const taskId = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["test"],
      resumeIds: [resumeId],
    });

    // Manually complete the task
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId as any, {
        status: "completed",
        completedAt: Date.now(),
      });
    });

    await t.mutation(api.analysis_tasks.cancel, { taskId });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    // Should remain completed, not changed to cancelled
    expect(task?.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// resume_tasks.dispatch
// ---------------------------------------------------------------------------

describe("resume_tasks: dispatch", () => {
  it("creates a collection task", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "python developer",
      location: "Shanghai",
      limit: 50,
    });

    expect(taskId).toBeDefined();

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("pending");
    expect(task?.config.keyword).toBe("python developer");
    expect(task?.config.location).toBe("Shanghai");
    expect(task?.config.limit).toBe(50);
  });

  it("throws when minAge > maxAge", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.resume_tasks.dispatch, {
        keyword: "test",
        location: "test",
        limit: 10,
        minAge: 40,
        maxAge: 25,
      }),
    ).rejects.toThrow("minAge cannot be greater than maxAge");
  });

  it("accepts optional fields", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
      maxPages: 5,
      minAge: 25,
      maxAge: 40,
      autoAnalyze: true,
      analysisTopN: 20,
    });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.config.maxPages).toBe(5);
    expect(task?.config.autoAnalyze).toBe(true);
    expect(task?.config.analysisTopN).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// resume_tasks.cancel
// ---------------------------------------------------------------------------

describe("resume_tasks: cancel", () => {
  it("cancels a pending collection task", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    await t.mutation(api.resume_tasks.cancel, { taskId });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("cancelled");
    expect(task?.completedAt).toBeDefined();
  });

  it("is a no-op for completed tasks", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    // Manually complete
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId as any, {
        status: "completed",
        completedAt: Date.now(),
      });
    });

    await t.mutation(api.resume_tasks.cancel, { taskId });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// resume_tasks.resetDatabase
// ---------------------------------------------------------------------------

describe("resume_tasks: resetDatabase", () => {
  it("deletes all data from reset tables when under batch size", async () => {
    const t = convexTest(schema, modules);

    // Insert a resume and a collection task
    await insertResume(t);
    await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    const result = await t.mutation(api.resume_tasks.resetDatabase, {});

    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(result.count).toBeGreaterThanOrEqual(2);
    expect(result.deleted.resumes).toBeGreaterThanOrEqual(1);
    expect(result.deleted.collection_tasks).toBeGreaterThanOrEqual(1);
  });

  it("returns zero count when tables are empty", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.resume_tasks.resetDatabase, {});

    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(result.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resume_tasks.claim
// ---------------------------------------------------------------------------

describe("resume_tasks: claim", () => {
  it("claims the oldest pending task", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    const claimed = await t.mutation(api.resume_tasks.claim, {
      workerId: "worker-1",
    });

    expect(claimed).toBeDefined();
    expect(claimed!._id).toBe(taskId);

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("processing");
    expect(task?.workerId).toBe("worker-1");
    expect(task?.startedAt).toBeDefined();
  });

  it("returns null when no pending tasks", async () => {
    const t = convexTest(schema, modules);

    const claimed = await t.mutation(api.resume_tasks.claim, {
      workerId: "worker-1",
    });

    expect(claimed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resume_tasks.heartbeat
// ---------------------------------------------------------------------------

describe("resume_tasks: heartbeat", () => {
  it("creates a new worker on first heartbeat", async () => {
    const t = convexTest(schema, modules);

    const workerId = await t.mutation(api.resume_tasks.heartbeat, {
      workerId: "worker-1",
      state: "idle",
    });

    expect(workerId).toBeDefined();

    const workers = await t.run(async (ctx) => {
      return ctx.db.query("collection_workers").collect();
    });
    expect(workers).toHaveLength(1);
    expect(workers[0].workerId).toBe("worker-1");
    expect(workers[0].state).toBe("idle");
  });

  it("updates existing worker on subsequent heartbeat", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.resume_tasks.heartbeat, {
      workerId: "worker-1",
      state: "idle",
    });

    await t.mutation(api.resume_tasks.heartbeat, {
      workerId: "worker-1",
      state: "processing",
    });

    const workers = await t.run(async (ctx) => {
      return ctx.db.query("collection_workers").collect();
    });
    expect(workers).toHaveLength(1);
    expect(workers[0].state).toBe("processing");
  });

  it("stores activeTaskId and lastError", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    await t.mutation(api.resume_tasks.heartbeat, {
      workerId: "worker-1",
      state: "error",
      activeTaskId: taskId,
      lastError: "connection timeout",
    });

    const workers = await t.run(async (ctx) => {
      return ctx.db.query("collection_workers").collect();
    });
    expect(workers[0].state).toBe("error");
    expect(workers[0].activeTaskId).toBe(taskId);
    expect(workers[0].lastError).toBe("connection timeout");
  });
});

// ---------------------------------------------------------------------------
// resume_tasks.getWorkerHealth
// ---------------------------------------------------------------------------

describe("resume_tasks: getWorkerHealth", () => {
  it("reports healthy workers", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.resume_tasks.heartbeat, {
      workerId: "worker-1",
      state: "idle",
    });

    const health = await t.query(api.resume_tasks.getWorkerHealth, {});

    expect(health.totalWorkers).toBe(1);
    expect(health.healthyWorkers).toBe(1);
    expect(health.workers).toHaveLength(1);
    expect(health.workers[0].healthy).toBe(true);
  });

  it("reports unhealthy workers when in error state", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.resume_tasks.heartbeat, {
      workerId: "worker-1",
      state: "error",
      lastError: "crashed",
    });

    const health = await t.query(api.resume_tasks.getWorkerHealth, {});

    expect(health.totalWorkers).toBe(1);
    expect(health.healthyWorkers).toBe(0);
    expect(health.workers[0].healthy).toBe(false);
  });

  it("returns zeros when no workers exist", async () => {
    const t = convexTest(schema, modules);

    const health = await t.query(api.resume_tasks.getWorkerHealth, {});

    expect(health.totalWorkers).toBe(0);
    expect(health.healthyWorkers).toBe(0);
    expect(health.workers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resume_tasks.complete
// ---------------------------------------------------------------------------

describe("resume_tasks: complete", () => {
  it("completes a processing task", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    await t.mutation(api.resume_tasks.claim, { workerId: "worker-1" });

    await t.mutation(api.resume_tasks.complete, {
      taskId,
      status: "completed",
    });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("completed");
    expect(task?.completedAt).toBeDefined();
  });

  it("fails a processing task with error", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    await t.mutation(api.resume_tasks.claim, { workerId: "worker-1" });

    await t.mutation(api.resume_tasks.complete, {
      taskId,
      status: "failed",
      error: "network timeout",
    });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("network timeout");
  });

  it("is a no-op for cancelled tasks", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    await t.mutation(api.resume_tasks.cancel, { taskId });

    await t.mutation(api.resume_tasks.complete, {
      taskId,
      status: "completed",
    });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    // Should remain cancelled
    expect(task?.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// resume_tasks.updateProgress
// ---------------------------------------------------------------------------

describe("resume_tasks: updateProgress", () => {
  it("updates progress on a processing task", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    await t.mutation(api.resume_tasks.claim, { workerId: "worker-1" });

    await t.mutation(api.resume_tasks.updateProgress, {
      taskId,
      current: 5,
      page: 2,
      total: 50,
      lastStatus: "Scraping page 3",
    });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.progress.current).toBe(5);
    expect(task?.progress.page).toBe(2);
    expect(task?.progress.total).toBe(50);
    expect(task?.lastStatus).toBe("Scraping page 3");
  });

  it("returns cancelled status for cancelled tasks", async () => {
    const t = convexTest(schema, modules);

    const taskId = await t.mutation(api.resume_tasks.dispatch, {
      keyword: "test",
      location: "test",
      limit: 10,
    });

    await t.mutation(api.resume_tasks.cancel, { taskId });

    const result = await t.mutation(api.resume_tasks.updateProgress, {
      taskId,
      current: 5,
      page: 2,
    });

    expect(result).toEqual({ status: "cancelled" });
  });
});
