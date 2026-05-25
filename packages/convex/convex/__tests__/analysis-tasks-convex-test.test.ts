/**
 * Integration tests for analysis_tasks.ts using convex-test.
 *
 * Covers: list, getSummary, dispatch, cancel, getTask, markProcessing,
 * updateProgress, complete, sweepStuckTasks.
 *
 * Does NOT cover processAnalysisTask (calls LLM API).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

/** Insert a minimal resume and return its ID. */
async function insertResume(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: { name: "Test User" },
      hash: `h-${Math.random().toString(36).slice(2, 8)}`,
      tags: [],
      crawledAt: Date.now(),
      source: "test",
    });
  });
}

/** Insert a task directly for testing. */
async function insertTask(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("analysis_tasks", {
      idempotencyKey: undefined,
      jobKey: undefined,
      config: {
        jobDescriptionId: "jd-test",
        resumeCount: 1,
      },
      status: "pending",
      progress: { current: 0, total: 1, skipped: 0 },
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// list + getSummary
// ---------------------------------------------------------------------------

describe("analysis_tasks: list + getSummary", () => {
  it("returns tasks in desc order", async () => {
    const t = convexTest(schema, modules);

    await insertTask(t);
    await insertTask(t, { status: "completed" });

    const tasks = await t.query(api.analysis_tasks.list, {});

    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("returns summary counts by status", async () => {
    const t = convexTest(schema, modules);

    await insertTask(t, { status: "pending" });
    await insertTask(t, { status: "completed" });
    await insertTask(t, { status: "failed" });

    const summary = await t.query(api.analysis_tasks.getSummary, {});

    expect(summary.pending).toBeGreaterThanOrEqual(1);
    expect(summary.completed).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.total).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

describe("analysis_tasks: dispatch", () => {
  it("creates a task with keywords", async () => {
    const t = convexTest(schema, modules);

    const resumeId = await insertResume(t);

    const result = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["python", "sales"],
      resumeIds: [resumeId],
    });

    expect(result).toBeDefined();

    const tasks = await t.query(api.analysis_tasks.list, {});
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("pending");
    expect(tasks[0].config.keywords).toEqual(["python", "sales"]);
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
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe("analysis_tasks: cancel", () => {
  it("cancels a pending task", async () => {
    const t = convexTest(schema, modules);

    const taskId = await insertTask(t, { status: "pending" });

    await t.mutation(api.analysis_tasks.cancel, { taskId });

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("cancelled");
    expect(task!.completedAt).toBeDefined();
  });

  it("does not cancel a completed task", async () => {
    const t = convexTest(schema, modules);

    const taskId = await insertTask(t, {
      status: "completed",
      completedAt: Date.now(),
    });

    await t.mutation(api.analysis_tasks.cancel, { taskId });

    // Status should remain completed
    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// markProcessing
// ---------------------------------------------------------------------------

describe("analysis_tasks: markProcessing", () => {
  it("transitions pending task to processing", async () => {
    const t = convexTest(schema, modules);

    const taskId = await insertTask(t, { status: "pending" });

    const result = await t.mutation(internal.analysis_tasks.markProcessing, { taskId });

    expect(result).toEqual({ status: "processing" });

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("processing");
    expect(task!.startedAt).toBeDefined();
  });

  it("returns cancelled status for cancelled task", async () => {
    const t = convexTest(schema, modules);

    const taskId = await insertTask(t, { status: "cancelled" });

    const result = await t.mutation(internal.analysis_tasks.markProcessing, { taskId });

    expect(result).toEqual({ status: "cancelled" });
  });
});

// ---------------------------------------------------------------------------
// updateProgress
// ---------------------------------------------------------------------------

describe("analysis_tasks: updateProgress", () => {
  it("updates progress fields", async () => {
    const t = convexTest(schema, modules);

    const taskId = await insertTask(t, {
      status: "processing",
      progress: { current: 0, total: 5, skipped: 0 },
    });

    const result = await t.mutation(internal.analysis_tasks.updateProgress, {
      taskId,
      current: 3,
      skipped: 1,
      lastStatus: "Analyzing resume 3",
    });

    expect(result).toBeDefined();

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.progress.current).toBe(3);
    expect(task!.progress.skipped).toBe(1);
    expect(task!.lastStatus).toBe("Analyzing resume 3");
  });

  it("returns cancelled for cancelled task", async () => {
    const t = convexTest(schema, modules);

    const taskId = await insertTask(t, {
      status: "cancelled",
      progress: { current: 0, total: 5, skipped: 0 },
    });

    const result = await t.mutation(internal.analysis_tasks.updateProgress, {
      taskId,
      current: 1,
      skipped: 0,
    });

    expect(result).toEqual({ status: "cancelled" });
  });
});

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

describe("analysis_tasks: complete", () => {
  it("marks task as completed with results", async () => {
    const t = convexTest(schema, modules);

    const taskId = await insertTask(t, { status: "processing" });

    await t.mutation(internal.analysis_tasks.complete, {
      taskId,
      status: "completed",
      results: {
        analyzed: 10,
        skipped: 2,
        failed: 1,
        avgScore: 75.5,
        highScoreCount: 3,
      },
    });

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("completed");
    expect(task!.results!.analyzed).toBe(10);
    expect(task!.completedAt).toBeDefined();
    expect(task!.lastStatus).toBe("Completed");
  });

  it("marks task as failed with error", async () => {
    const t = convexTest(schema, modules);

    const taskId = await insertTask(t, { status: "processing" });

    await t.mutation(internal.analysis_tasks.complete, {
      taskId,
      status: "failed",
      error: "API rate limit exceeded",
    });

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("failed");
    expect(task!.error).toBe("API rate limit exceeded");
  });

  it("preserves cancelled status when task was already cancelled", async () => {
    const t = convexTest(schema, modules);

    const taskId = await insertTask(t, { status: "cancelled" });

    await t.mutation(internal.analysis_tasks.complete, {
      taskId,
      status: "completed",
      results: {
        analyzed: 5,
        skipped: 0,
        failed: 0,
        avgScore: 80,
        highScoreCount: 2,
      },
    });

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// sweepStuckTasks
// ---------------------------------------------------------------------------

describe("analysis_tasks: sweepStuckTasks", () => {
  it("sweeps tasks stuck in processing for >24h", async () => {
    const t = convexTest(schema, modules);

    const yesterday = Date.now() - 25 * 60 * 60 * 1000;

    await insertTask(t, {
      status: "processing",
      startedAt: yesterday,
      progress: { current: 1, total: 5, skipped: 0 },
    });

    const result = await t.mutation(internal.analysis_tasks.sweepStuckTasks, {});

    expect(result.swept).toBe(1);

    const tasks = await t.query(api.analysis_tasks.list, {});
    expect(tasks[0].status).toBe("failed");
    expect(tasks[0].error).toContain("stuck in processing");
  });

  it("does not sweep recently started tasks", async () => {
    const t = convexTest(schema, modules);

    await insertTask(t, {
      status: "processing",
      startedAt: Date.now() - 1000, // 1 second ago
      progress: { current: 1, total: 5, skipped: 0 },
    });

    const result = await t.mutation(internal.analysis_tasks.sweepStuckTasks, {});

    expect(result.swept).toBe(0);
  });
});
