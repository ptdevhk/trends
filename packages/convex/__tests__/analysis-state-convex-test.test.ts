/**
 * Integration tests for analysis_tasks state machine functions using convex-test.
 *
 * Covers internal mutation functions:
 * - markProcessing (pending → processing transition)
 * - updateProgress (progress tracking with monotonic guards)
 * - complete (terminal state transition with cancellation guard)
 *
 * Uses convex-test with real schema validation — no mocks.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";


// Helper: insert a minimal resume document matching schema requirements
let _resumeCounter = 0;
async function insertResume(
  t: ReturnType<typeof createTest>,
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

// Helper: dispatch an analysis task and return the taskId
async function dispatchAnalysisTask(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  const resumeId = await insertResume(t);
  const result = await t.mutation(api.analysis_tasks.dispatch, {
    keywords: ["test"],
    resumeIds: [resumeId],
    ...overrides,
  });
  if (!result.queued) {
    throw new Error("dispatch did not queue (maintenance mode?)");
  }
  return result.taskId;
}

// ---------------------------------------------------------------------------
// markProcessing
// ---------------------------------------------------------------------------

describe("analysis_tasks: markProcessing", () => {
  it("transitions a pending task to processing", async () => {
    const t = createTest();

    const taskId = await dispatchAnalysisTask(t);

    const result = await t.mutation(internal.analysis_tasks.markProcessing, {
      taskId,
    });

    expect(result).toEqual({ status: "processing" });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("processing");
    expect(task?.startedAt).toBeDefined();
  });

  it("returns cancelled status for cancelled tasks", async () => {
    const t = createTest();

    const taskId = await dispatchAnalysisTask(t);

    // Cancel the task first
    await t.mutation(api.analysis_tasks.cancel, { taskId });

    const result = await t.mutation(internal.analysis_tasks.markProcessing, {
      taskId,
    });

    expect(result).toEqual({ status: "cancelled" });
  });

  it("returns null for nonexistent tasks", async () => {
    const t = createTest();

    // Create and delete a task to get a valid-format ID that no longer exists
    const tempResumeId = await insertResume(t);
    const tempResult = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["temp"],
      resumeIds: [tempResumeId],
    });
    if (!tempResult.queued) {
      throw new Error("dispatch did not queue (maintenance mode?)");
    }
    const tempTaskId = tempResult.taskId;
    await t.run(async (ctx) => {
      await ctx.db.delete(tempTaskId);
    });

    const result = await t.mutation(internal.analysis_tasks.markProcessing, {
      taskId: tempTaskId,
    });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateProgress
// ---------------------------------------------------------------------------

describe("analysis_tasks: updateProgress", () => {
  it("updates progress on a processing task", async () => {
    const t = createTest();

    const taskId = await dispatchAnalysisTask(t);

    await t.mutation(internal.analysis_tasks.markProcessing, { taskId });

    const result = await t.mutation(internal.analysis_tasks.updateProgress, {
      taskId,
      current: 5,
      skipped: 1,
      lastStatus: "Analyzing resume 5",
    });

    expect(result).toEqual({ status: "processing" });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.progress.current).toBe(5);
    expect(task?.progress.skipped).toBe(1);
    expect(task?.lastStatus).toBe("Analyzing resume 5");
  });

  it("is monotonic — does not decrease current/skipped", async () => {
    const t = createTest();

    const taskId = await dispatchAnalysisTask(t);

    await t.mutation(internal.analysis_tasks.markProcessing, { taskId });

    // Set progress to 10
    await t.mutation(internal.analysis_tasks.updateProgress, {
      taskId,
      current: 10,
      skipped: 3,
    });

    // Try to set progress to 5 (should be clamped to 10)
    await t.mutation(internal.analysis_tasks.updateProgress, {
      taskId,
      current: 5,
      skipped: 1,
    });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.progress.current).toBe(10);
    expect(task?.progress.skipped).toBe(3);
  });

  it("returns cancelled status for cancelled tasks", async () => {
    const t = createTest();

    const taskId = await dispatchAnalysisTask(t);

    await t.mutation(api.analysis_tasks.cancel, { taskId });

    const result = await t.mutation(internal.analysis_tasks.updateProgress, {
      taskId,
      current: 5,
      skipped: 0,
    });

    expect(result).toEqual({ status: "cancelled" });
  });
});

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

describe("analysis_tasks: complete", () => {
  it("completes a processing task with results", async () => {
    const t = createTest();

    const taskId = await dispatchAnalysisTask(t);

    await t.mutation(internal.analysis_tasks.markProcessing, { taskId });

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

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("completed");
    expect(task?.results?.analyzed).toBe(10);
    expect(task?.completedAt).toBeDefined();
    expect(task?.lastStatus).toBe("Completed");
  });

  it("fails a processing task with error", async () => {
    const t = createTest();

    const taskId = await dispatchAnalysisTask(t);

    await t.mutation(internal.analysis_tasks.markProcessing, { taskId });

    await t.mutation(internal.analysis_tasks.complete, {
      taskId,
      status: "failed",
      error: "LLM API timeout",
    });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("LLM API timeout");
  });

  it("cannot un-cancel a cancelled task", async () => {
    const t = createTest();

    const taskId = await dispatchAnalysisTask(t);

    // Cancel the task
    await t.mutation(api.analysis_tasks.cancel, { taskId });

    // Try to complete it — should remain cancelled
    await t.mutation(internal.analysis_tasks.complete, {
      taskId,
      status: "completed",
    });

    const task = await t.run(async (ctx) => {
      return ctx.db.get(taskId);
    });
    expect(task?.status).toBe("cancelled");
  });
});
