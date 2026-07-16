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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";

const WRITE_SECRET = "test-analysis-tasks-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
    return;
  }
  process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
});

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

    const tasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });

    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("isolates task projections by workspace and keeps legacy records in dev", async () => {
    const t = createTest();
    const devTaskId = await insertTask(t, { workspaceSlug: "dev" });
    const legacyTaskId = await insertTask(t);
    const hrTaskId = await insertTask(t, { workspaceSlug: "hr" });
    const otherTaskId = await insertTask(t, { workspaceSlug: "other" });

    const devTasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(devTasks).toHaveLength(2);
    expect(devTasks.map((task) => task._id)).toEqual(expect.arrayContaining([devTaskId, legacyTaskId]));

    const hrTasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(hrTasks.map((task) => task._id)).toEqual([hrTaskId]);

    const otherTasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "other",
      writeSecret: WRITE_SECRET,
    });
    expect(otherTasks.map((task) => task._id)).toEqual([otherTaskId]);
  });

  it("applies the task limit after workspace filtering", async () => {
    const t = createTest();
    const devTaskId = await insertTask(t, { workspaceSlug: "dev" });
    const legacyTaskId = await insertTask(t);
    for (let index = 0; index < 25; index += 1) {
      await insertTask(t, { workspaceSlug: "hr" });
    }

    const devTasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(devTasks).toHaveLength(2);
    expect(devTasks.map((task) => task._id)).toEqual(expect.arrayContaining([devTaskId, legacyTaskId]));

    const hrTasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(hrTasks).toHaveLength(20);
    expect(hrTasks.every((task) => task.workspaceSlug === "hr")).toBe(true);
  });

  it("merges explicit-dev and legacy-unscoped tasks before applying the newest-20 limit", async () => {
    const t = createTest();
    const expectedIds: string[] = [];

    // Older foreign noise that must never appear in the merged top-20.
    for (let index = 0; index < 30; index += 1) {
      await insertTask(t, { workspaceSlug: "hr", status: "completed" });
    }
    // Explicit dev + legacy unscoped candidates for the merged ranking window.
    for (let index = 0; index < 15; index += 1) {
      expectedIds.push(await insertTask(t, { workspaceSlug: "dev", status: "pending" }));
    }
    for (let index = 0; index < 15; index += 1) {
      expectedIds.push(await insertTask(t, { status: "completed" }));
    }
    // More foreign noise after the candidates (newer by insertion order).
    for (let index = 0; index < 30; index += 1) {
      await insertTask(t, { workspaceSlug: "hr", status: "failed" });
    }

    const devTasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });

    expect(devTasks).toHaveLength(20);
    expect(devTasks.every((task) => task.workspaceSlug === "dev" || task.workspaceSlug === undefined)).toBe(true);
    // Newest 20 of the 30 allowed candidates (15 explicit + 15 legacy), never the later HR noise.
    expect(devTasks.map((task) => task._id)).toEqual(expectedIds.slice(-20).reverse());
  });

  it("summarizes only the requested workspace without counting foreign tasks", async () => {
    const t = createTest();

    await insertTask(t, { workspaceSlug: "dev", status: "pending" });
    await insertTask(t, { status: "completed" }); // legacy → dev
    await insertTask(t, { workspaceSlug: "hr", status: "failed" });
    await insertTask(t, { workspaceSlug: "hr", status: "pending" });
    for (let index = 0; index < 40; index += 1) {
      await insertTask(t, { workspaceSlug: "other", status: "cancelled" });
    }

    const devSummary = await t.query(api.analysis_tasks.getSummary, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(devSummary).toEqual({
      total: 2,
      pending: 1,
      processing: 0,
      completed: 1,
      failed: 0,
      cancelled: 0,
    });

    const hrSummary = await t.query(api.analysis_tasks.getSummary, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(hrSummary).toEqual({
      total: 2,
      pending: 1,
      processing: 0,
      completed: 0,
      failed: 1,
      cancelled: 0,
    });
  });

  it("uses workspace-oriented indexes for list and getSummary instead of a global full-table collect", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(new URL("../convex/analysis_tasks.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");

    const listHandler = source.match(/export const list = query\(\{[\s\S]*?handler:\s*async[\s\S]*?\n\}\);/);
    const summaryHandler = source.match(/export const getSummary = query\(\{[\s\S]*?handler:\s*async[\s\S]*?\n\}\);/);
    expect(listHandler?.[0]).toBeTruthy();
    expect(summaryHandler?.[0]).toBeTruthy();

    // Handlers must route through the workspace-scoped loader (not a global collect).
    expect(listHandler![0]).toContain("loadWorkspaceAnalysisTasks");
    expect(summaryHandler![0]).toContain("loadWorkspaceAnalysisTasks");
    expect(listHandler![0]).not.toMatch(/\.query\("analysis_tasks"\)\s*\n?\s*\.order\("desc"\)\s*\n?\s*\.collect\(\)/);
    expect(summaryHandler![0]).not.toMatch(/\.query\("analysis_tasks"\)\s*\.collect\(\)/);

    // Shared query helper uses the workspace index; loader calls it for explicit (+ legacy for dev).
    expect(source).toMatch(/function queryAnalysisTasksByWorkspace[\s\S]*?withIndex\("by_workspace"/);
    expect(source).toContain("loadWorkspaceAnalysisTasks");
    expect(source).toContain("queryAnalysisTasksByWorkspace");
    expect(source).not.toMatch(
      /export const list = query\(\{[\s\S]*?\.query\("analysis_tasks"\)\s*\n?\s*\.order\("desc"\)\s*\n?\s*\.collect\(\)/,
    );
    expect(source).not.toMatch(
      /export const getSummary = query\(\{[\s\S]*?\.query\("analysis_tasks"\)\s*\.collect\(\)/,
    );
  });

  it("declares a workspace index on analysis_tasks", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(new URL("../convex/schema.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");
    const analysisTable = source.match(/analysis_tasks:\s*defineTable\(\{[\s\S]*?\}\)\s*[\s\S]*?(?=\n\s{4}[a-z_]+:\s*defineTable)/);
    expect(analysisTable?.[0]).toBeTruthy();
    expect(analysisTable![0]).toContain('.index("by_workspace", ["workspaceSlug"])');
  });

  it("returns summary counts by status", async () => {
    const t = createTest();

    await insertTask(t, { status: "pending" });
    await insertTask(t, { status: "completed" });
    await insertTask(t, { status: "failed" });

    const summary = await t.query(api.analysis_tasks.getSummary, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });

    expect(summary.pending).toBeGreaterThanOrEqual(1);
    expect(summary.completed).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.total).toBeGreaterThanOrEqual(3);
  });

  it("rejects task metadata reads without the service secret", async () => {
    const t = createTest();

    await expect(t.query(api.analysis_tasks.list, { workspaceSlug: "hr" }))
      .rejects.toThrow("Unauthorized Convex read");
    await expect(t.query(api.analysis_tasks.getSummary, { workspaceSlug: "hr" }))
      .rejects.toThrow("Unauthorized Convex read");
  });

  it("requires the service secret for the global processing count", async () => {
    const t = createTest();

    await insertTask(t, { status: "processing", workspaceSlug: "hr" });

    await expect(t.query(api.analysis_tasks.countProcessing, {}))
      .rejects.toThrow("Unauthorized Convex read");
    await expect(t.query(api.analysis_tasks.countProcessing, { writeSecret: WRITE_SECRET }))
      .resolves.toBe(1);
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
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      keywords: ["python", "sales"],
      resumeIds: [resumeId],
    });

    expect(result).toEqual({
      queued: true,
      taskId: expect.any(String),
      dispatchedAt: expect.any(Number),
      reused: false,
    });

    const tasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("pending");
    expect(tasks[0].workspaceSlug).toBe("dev");
    expect(tasks[0].config.keywords).toEqual(["python", "sales"]);
  });

  it("rejects missing or mismatched service secrets before creating a task", async () => {
    const t = createTest();
    const resumeId = await insertResume(t);

    await expect(t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "dev",
      keywords: ["sales"],
      resumeIds: [resumeId],
    })).rejects.toThrow("Unauthorized Convex write");
    await expect(t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "dev",
      writeSecret: "wrong-secret",
      keywords: ["sales"],
      resumeIds: [resumeId],
    })).rejects.toThrow("Unauthorized Convex write");

    expect(await t.run((ctx) => ctx.db.query("analysis_tasks").collect())).toEqual([]);
  });

  it("persists normal tasks for the requested HR workspace", async () => {
    const t = createTest();
    const resumeId = await t.run((ctx) => ctx.db.insert("resumes", {
      externalId: "hr-analysis-resume",
      content: { name: "Synthetic HR Resume" },
      hash: "hr-analysis-resume-hash",
      tags: [],
      crawledAt: 1,
      source: "test",
      workspaceSlug: "hr",
    }));

    const result = await t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
      keywords: ["sales"],
      resumeIds: [resumeId],
    });
    expect(result).toMatchObject({ queued: true, reused: false });

    const tasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].workspaceSlug).toBe("hr");
  });

  it("does not reuse matching job keys across workspaces", async () => {
    const t = createTest();
    const devResumeId = await insertResume(t);
    const hrResumeId = await t.run((ctx) => ctx.db.insert("resumes", {
      externalId: "hr-reuse-resume",
      content: { name: "Synthetic HR Reuse Resume" },
      hash: "hr-reuse-resume-hash",
      tags: [],
      crawledAt: 1,
      source: "test",
      workspaceSlug: "hr",
    }));

    const devResult = await t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      keywords: ["sales"],
      resumeIds: [devResumeId],
    });
    const hrResult = await t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
      keywords: ["sales"],
      resumeIds: [hrResumeId],
    });

    expect(devResult).toMatchObject({ queued: true, reused: false });
    expect(hrResult).toMatchObject({ queued: true, reused: false });
    if (!devResult.queued || !hrResult.queued) {
      throw new Error("Expected both workspace dispatches to queue");
    }
    expect(hrResult.taskId).not.toBe(devResult.taskId);
  });

  it("throws when neither jobDescriptionContent nor keywords provided", async () => {
    const t = createTest();

    const resumeId = await insertResume(t);

    await expect(
      t.mutation(api.analysis_tasks.dispatch, {
        workspaceSlug: "dev",
        writeSecret: WRITE_SECRET,
        resumeIds: [resumeId],
      }),
    ).rejects.toThrow("Either jobDescriptionContent or keywords is required");
  });

  // P1 context plumbing tests — RED: these test new fields not yet accepted
  it("accepts relatedExpContext and stores it in task.config", async () => {
    const t = createTest();
    const resumeId = await insertResume(t);

    const taskId = await t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      keywords: ["cnc", "sales"],
      resumeIds: [resumeId],
      relatedExpContext: {
        roleFilterType: "sales",
        minRoleYears: 1,
        market: "CN",
        locale: "zh",
      },
    });

    expect(taskId).toBeDefined();
    const tasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(tasks[0].config.relatedExpContext).toBeDefined();
    expect(tasks[0].config.relatedExpContext?.roleFilterType).toBe("sales");
    expect(tasks[0].config.relatedExpContext?.minRoleYears).toBe(1);
    expect(tasks[0].config.relatedExpContext?.market).toBe("CN");
    expect(tasks[0].config.relatedExpContext?.locale).toBe("zh");
  });

  it("dispatch without relatedExpContext is backward-compatible", async () => {
    const t = createTest();
    const resumeId = await insertResume(t);

    const taskId = await t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      keywords: ["python"],
      resumeIds: [resumeId],
    });

    expect(taskId).toBeDefined();
    const tasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    // relatedExpContext is optional — absent when not provided
    expect(tasks[0].config.relatedExpContext).toBeUndefined();
  });

  it("relatedExpContext with partial fields is accepted", async () => {
    const t = createTest();
    const resumeId = await insertResume(t);

    const taskId = await t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      keywords: ["sales"],
      resumeIds: [resumeId],
      relatedExpContext: {
        roleFilterType: "any",
      },
    });

    expect(taskId).toBeDefined();
    const tasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(tasks[0].config.relatedExpContext?.roleFilterType).toBe("any");
    expect(tasks[0].config.relatedExpContext?.minRoleYears).toBeUndefined();
  });

  it("rejects a personal-seat foreign resume before creating a normal task", async () => {
    const t = createTest();
    const foreignResumeId = await t.run((ctx) => ctx.db.insert("resumes", {
      externalId: "foreign-analysis-resume",
      content: { name: "Synthetic Foreign Resume" },
      hash: "foreign-analysis-resume-hash",
      tags: [],
      crawledAt: 1,
      source: "test",
      workspaceSlug: "alice-personal",
    }));

    await expect(t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      keywords: ["sales"],
      resumeIds: [foreignResumeId],
    })).rejects.toThrow("belongs to workspace");
  });

  it("allows system-team shared corpus resumes from hr when stamped as dev", async () => {
    const t = createTest();
    const sharedResumeId = await t.run((ctx) => ctx.db.insert("resumes", {
      externalId: "shared-dev-stamped-resume",
      content: { name: "Shared Operational Resume" },
      hash: "shared-dev-stamped-resume-hash",
      tags: [],
      crawledAt: 1,
      source: "test",
      workspaceSlug: "dev",
    }));

    const result = await t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
      keywords: ["sales"],
      resumeIds: [sharedResumeId],
    });
    expect(result.queued).toBe(true);
  });

  it("allows unscoped shared-corpus resumes from hr", async () => {
    const t = createTest();
    const unscopedResumeId = await t.run((ctx) => ctx.db.insert("resumes", {
      externalId: "unscoped-shared-resume",
      content: { name: "Unscoped Shared Resume" },
      hash: "unscoped-shared-resume-hash",
      tags: [],
      crawledAt: 1,
      source: "test",
    }));

    const result = await t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
      keywords: ["sales"],
      resumeIds: [unscopedResumeId],
    });
    expect(result.queued).toBe(true);
  });

  it("rejects a missing resume before creating a normal task", async () => {
    const t = createTest();
    const resumeId = await insertResume(t);
    await t.run((ctx) => ctx.db.delete(resumeId));

    await expect(t.mutation(api.analysis_tasks.dispatch, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      keywords: ["sales"],
      resumeIds: [resumeId],
    })).rejects.toThrow("no longer exists");
    expect(await t.run((ctx) => ctx.db.query("analysis_tasks").collect())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe("analysis_tasks: cancel", () => {
  it("cancels a pending task", async () => {
    const t = createTest();

    const taskId = await insertTask(t, { status: "pending" });

    await t.mutation(api.analysis_tasks.cancel, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });

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

    await t.mutation(api.analysis_tasks.cancel, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });

    // Status should remain completed
    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("completed");
  });

  it("does not cancel a task from another workspace", async () => {
    const t = createTest();
    const taskId = await insertTask(t, { workspaceSlug: "hr" });

    await expect(t.mutation(api.analysis_tasks.cancel, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    })).resolves.toBeNull();

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("pending");
  });

  it("rejects missing or mismatched secrets before cancelling a task", async () => {
    const t = createTest();
    const taskId = await insertTask(t, { workspaceSlug: "dev" });

    await expect(t.mutation(api.analysis_tasks.cancel, {
      taskId,
      workspaceSlug: "dev",
    })).rejects.toThrow("Unauthorized Convex write");
    await expect(t.mutation(api.analysis_tasks.cancel, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: "wrong-secret",
    })).rejects.toThrow("Unauthorized Convex write");

    const task = await t.query(internal.analysis_tasks.getTask, { taskId });
    expect(task!.status).toBe("pending");
    expect(task!.completedAt).toBeUndefined();
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

    const tasks = await t.query(api.analysis_tasks.list, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
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
