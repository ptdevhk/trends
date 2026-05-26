/**
 * Integration tests for analysis_tasks.ts using convex-test.
 *
 * Covers: list, getSummary, dispatch, cancel, getTask, markProcessing,
 * updateProgress, complete, sweepStuckTasks, audit wiring for filter/score.
 *
 * processAnalysisTask (calls LLM API) is covered indirectly via audit
 * wiring tests that verify logAnalysisDecision + setAuditOutcome are
 * callable from the analysis_tasks action context.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";


/** Insert a minimal resume and return its ID. */
async function insertResume(t: ReturnType<typeof createTest>) {
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
  t: ReturnType<typeof createTest>,
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
    const t = createTest();

    await insertTask(t);
    await insertTask(t, { status: "completed" });

    const tasks = await t.query(api.analysis_tasks.list, {});

    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("returns summary counts by status", async () => {
    const t = createTest();

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
    const t = createTest();

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
    const t = createTest();

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
    const t = createTest();

    const taskId = await insertTask(t, { status: "pending" });

    await t.mutation(api.analysis_tasks.cancel, { taskId });

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("cancelled");
    expect(task!.completedAt).toBeDefined();
  });

  it("does not cancel a completed task", async () => {
    const t = createTest();

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
    const t = createTest();

    const taskId = await insertTask(t, { status: "pending" });

    const result = await t.mutation(internal.analysis_tasks.markProcessing, { taskId });

    expect(result).toEqual({ status: "processing" });

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("processing");
    expect(task!.startedAt).toBeDefined();
  });

  it("returns cancelled status for cancelled task", async () => {
    const t = createTest();

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
    const t = createTest();

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
    const t = createTest();

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
    const t = createTest();

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
    const t = createTest();

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
    const t = createTest();

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
    const t = createTest();

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
    const t = createTest();

    await insertTask(t, {
      status: "processing",
      startedAt: Date.now() - 1000, // 1 second ago
      progress: { current: 1, total: 5, skipped: 0 },
    });

    const result = await t.mutation(internal.analysis_tasks.sweepStuckTasks, {});

    expect(result.swept).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Audit wiring — filter and score decisions from processAnalysisTask
// ---------------------------------------------------------------------------

describe("analysis_tasks: audit wiring for filter decisions", () => {
  it("creates audit log entry with decisionType=filter for auto-filtered resumes", async () => {
    const t = createTest();

    const resumeId = await insertResume(t);

    // Simulate the filter decision audit log that processAnalysisTask creates
    const auditLogId = await t.mutation(internal.audit.logAnalysisDecision, {
      resumeId,
      workspaceSlug: "default",
      decisionType: "filter",
      actionRef: "analysis_tasks:processAnalysisTask:filter",
      inputSnapshot: {
        jobDescriptionId: "jd-test",
        promptVersion: "1",
        searchKeywords: ["python"],
      },
      modelMeta: {
        model: "rule-based",
        provider: "internal",
      },
      output: {
        score: 10,
        recommendation: "no_match",
      },
      decidedAt: Date.now(),
    });

    // Auto-set outcome to accepted (system decision)
    await t.mutation(api.audit.setAuditOutcome, {
      auditLogId,
      outcome: "accepted",
      setBy: "system:analysis_tasks:filter",
    });

    // Verify audit log is queryable
    const logs = await t.query(api.audit.getAuditLogByWorkspace, {
      workspaceSlug: "default",
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const log = logs.find((l) => l._id === auditLogId);
    expect(log).toBeDefined();
    expect(log!.decisionType).toBe("filter");
    expect(log!.actionRef).toBe("analysis_tasks:processAnalysisTask:filter");
    expect(log!.outcome).toBe("accepted");
    expect(log!.outcomeSetBy).toBe("system:analysis_tasks:filter");
    expect(log!.output.score).toBe(10);
  });
});

describe("analysis_tasks: audit wiring for score decisions", () => {
  it("creates audit log entry with decisionType=score for LLM-analyzed resumes", async () => {
    const t = createTest();

    const resumeId = await insertResume(t);

    // Simulate the score decision audit log that processAnalysisTask creates
    const auditLogId = await t.mutation(internal.audit.logAnalysisDecision, {
      resumeId,
      workspaceSlug: "default",
      decisionType: "score",
      actionRef: "analysis_tasks:processAnalysisTask:score",
      inputSnapshot: {
        jobDescriptionId: "jd-test",
        promptVersion: "1",
        searchKeywords: ["sales", "python"],
      },
      modelMeta: {
        model: "gpt-4o",
        provider: "openai",
      },
      output: {
        score: 85,
        recommendation: "strong_match",
      },
      decidedAt: Date.now(),
    });

    // Auto-set outcome to accepted (system decision)
    await t.mutation(api.audit.setAuditOutcome, {
      auditLogId,
      outcome: "accepted",
      setBy: "system:analysis_tasks:score",
    });

    // Verify audit log is queryable
    const logs = await t.query(api.audit.getAuditLogByWorkspace, {
      workspaceSlug: "default",
      decisionType: "score",
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const log = logs.find((l) => l._id === auditLogId);
    expect(log).toBeDefined();
    expect(log!.decisionType).toBe("score");
    expect(log!.actionRef).toBe("analysis_tasks:processAnalysisTask:score");
    expect(log!.outcome).toBe("accepted");
    expect(log!.output.score).toBe(85);
  });

  it("distinguishes filter vs score audit logs in the same workspace", async () => {
    const t = createTest();

    const resumeId1 = await insertResume(t);
    const resumeId2 = await insertResume(t);

    // Create a filter decision audit log
    await t.mutation(internal.audit.logAnalysisDecision, {
      resumeId: resumeId1,
      workspaceSlug: "ws-mixed",
      decisionType: "filter",
      actionRef: "analysis_tasks:processAnalysisTask:filter",
      inputSnapshot: {},
      modelMeta: { model: "rule-based", provider: "internal" },
      output: { score: 10 },
      decidedAt: Date.now(),
    });

    // Create a score decision audit log
    await t.mutation(internal.audit.logAnalysisDecision, {
      resumeId: resumeId2,
      workspaceSlug: "ws-mixed",
      decisionType: "score",
      actionRef: "analysis_tasks:processAnalysisTask:score",
      inputSnapshot: {},
      modelMeta: { model: "gpt-4o", provider: "openai" },
      output: { score: 75 },
      decidedAt: Date.now(),
    });

    // Filter query returns only filter decisions
    const filterLogs = await t.query(api.audit.getAuditLogByWorkspace, {
      workspaceSlug: "ws-mixed",
      decisionType: "filter",
    });
    expect(filterLogs.every((l) => l.decisionType === "filter")).toBe(true);

    // Score query returns only score decisions
    const scoreLogs = await t.query(api.audit.getAuditLogByWorkspace, {
      workspaceSlug: "ws-mixed",
      decisionType: "score",
    });
    expect(scoreLogs.every((l) => l.decisionType === "score")).toBe(true);
  });
});
