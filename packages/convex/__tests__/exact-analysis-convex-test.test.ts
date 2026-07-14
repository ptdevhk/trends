import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildKeywordAnalysisId,
  buildResumeAnalysisStorageKey,
  getCurrentResumeAiPromptVersion,
} from "@trends/shared";

import { api, internal } from "../convex/_generated/api.js";
import * as analysisTasksModule from "../convex/analysis_tasks.js";
import { classifyResumes } from "../convex/analysis_tasks.js";
import type { Id } from "../convex/_generated/dataModel.js";
import {
  createTest,
  seedResume,
  seedResumeAnalysesColdRow,
} from "./test-helpers.js";

const WRITE_SECRET = "test-exact-analysis-secret";
const PROMPT_VERSION = getCurrentResumeAiPromptVersion();

type TestContext = ReturnType<typeof createTest>;

function queuedResult(
  result: Awaited<ReturnType<typeof dispatchExact>>,
) {
  if (!result.queued) {
    throw new Error("Expected exact analysis dispatch to queue");
  }
  return result;
}

async function dispatchExact(
  t: TestContext,
  resumeIds: Id<"resumes">[],
  overrides: Record<string, unknown> = {},
) {
  return t.mutation(api.analysis_tasks.dispatchExact, {
    workspaceSlug: "dev",
    writeSecret: WRITE_SECRET,
    keywords: ["cnc", "sales"],
    resumeIds,
    ...overrides,
  });
}

async function scheduledFunctions(t: TestContext) {
  return t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
}

async function storedTasks(t: TestContext) {
  return t.run((ctx) => ctx.db.query("analysis_tasks").collect());
}

function analysisValue(overrides: Record<string, unknown> = {}) {
  return {
    score: 88,
    summary: "Strong exact match",
    highlights: ["CNC"],
    recommendation: "strong_match",
    jobDescriptionId: "jd-exact",
    promptVersion: PROMPT_VERSION,
    locale: "zh-Hans",
    analyzedAt: 2_000,
    ...overrides,
  };
}

async function completeTask(
  t: TestContext,
  taskId: Id<"analysis_tasks">,
  status: "completed" | "failed" | "cancelled" = "completed",
) {
  await t.mutation(internal.analysis_tasks.complete, {
    taskId,
    status,
    results: {
      analyzed: status === "completed" ? 1 : 0,
      skipped: 0,
      failed: status === "failed" ? 1 : 0,
      avgScore: status === "completed" ? 88 : 0,
      highScoreCount: status === "completed" ? 1 : 0,
    },
  });
}

describe("analysis_tasks:dispatchExact", () => {
  beforeEach(() => {
    process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
    process.env.AI_OUTPUT_LOCALE = "zh-Hans";
  });

  afterEach(() => {
    delete process.env.CONVEX_WRITE_SECRET;
    delete process.env.AI_OUTPUT_LOCALE;
  });

  it("requires the configured write secret", async () => {
    const t = createTest();
    const resumeId = await seedResume(t);

    await expect(t.mutation(api.analysis_tasks.dispatchExact, {
      workspaceSlug: "dev",
      keywords: ["cnc"],
      resumeIds: [resumeId],
    })).rejects.toThrow(/Unauthorized Convex write/);
    await expect(t.mutation(api.analysis_tasks.dispatchExact, {
      workspaceSlug: "dev",
      writeSecret: "wrong-secret",
      keywords: ["cnc"],
      resumeIds: [resumeId],
    })).rejects.toThrow(/Unauthorized Convex write/);

    expect(await storedTasks(t)).toEqual([]);
    expect(await scheduledFunctions(t)).toEqual([]);
  });

  it("rejects empty workspace, empty targets, and 501 requested IDs", async () => {
    const t = createTest();
    const resumeId = await seedResume(t);

    await expect(dispatchExact(t, [resumeId], { workspaceSlug: " " }))
      .rejects.toThrow(/workspaceSlug/);
    await expect(dispatchExact(t, []))
      .rejects.toThrow(/at least one/);
    await expect(dispatchExact(t, Array.from({ length: 501 }, () => resumeId)))
      .rejects.toThrow(/at most 500/);

    expect(await storedTasks(t)).toEqual([]);
    expect(await scheduledFunctions(t)).toEqual([]);
  });

  it("deduplicates in caller order and persists exact task metadata", async () => {
    const t = createTest();
    const firstId = await seedResume(t, {
      externalId: "exact-first",
      workspaceSlug: "dev",
    });
    const secondId = await seedResume(t, {
      externalId: "exact-second",
      workspaceSlug: "dev",
    });

    const result = queuedResult(await dispatchExact(t, [secondId, firstId, secondId], {
      location: "Dongguan",
    }));
    expect(result).toEqual({
      queued: true,
      taskId: expect.any(String),
      dispatchedAt: expect.any(Number),
      reused: false,
    });

    const task = await t.query(internal.analysis_tasks.getTask, { taskId: result.taskId });
    const expectedAnalysisId = buildKeywordAnalysisId(["cnc", "sales"], {
      location: "Dongguan",
      promptVersion: PROMPT_VERSION,
    });
    expect(task).toMatchObject({
      dispatchMode: "exact",
      workspaceSlug: "dev",
      targetResumeIds: [secondId, firstId],
      dispatchedAt: result.dispatchedAt,
      config: {
        jobDescriptionId: expectedAnalysisId,
        keywords: ["cnc", "sales"],
        location: "Dongguan",
        promptVersion: PROMPT_VERSION,
        resumeCount: 2,
      },
      progress: { current: 0, total: 2, skipped: 0 },
    });

    const scheduled = await scheduledFunctions(t);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].name).toBe("analysis_tasks:processAnalysisTask");
    expect(scheduled[0].args[0]).toEqual({
      taskId: result.taskId,
      resumeIds: [secondId, firstId],
    });
  });

  it("validates every resume before inserting or scheduling", async () => {
    for (const scenario of ["missing", "archived", "workspace"] as const) {
      const t = createTest();
      const validId = await seedResume(t, {
        externalId: `valid-${scenario}`,
        workspaceSlug: "dev",
      });
      const invalidId = await seedResume(t, {
        externalId: `invalid-${scenario}`,
        workspaceSlug: scenario === "workspace" ? "hr" : "dev",
        ...(scenario === "archived" ? { isArchived: true } : {}),
      });
      if (scenario === "missing") {
        await t.run((ctx) => ctx.db.delete(invalidId));
      }

      await expect(dispatchExact(t, [validId, invalidId])).rejects.toThrow(
        scenario === "missing" ? /no longer exists/ : scenario,
      );
      expect(await storedTasks(t)).toEqual([]);
      expect(await scheduledFunctions(t)).toEqual([]);
    }
  });

  it("reuses only the same pending exact set and returns its original boundary", async () => {
    const t = createTest();
    const firstId = await seedResume(t, { externalId: "reuse-first", workspaceSlug: "dev" });
    const secondId = await seedResume(t, { externalId: "reuse-second", workspaceSlug: "dev" });
    const first = queuedResult(await dispatchExact(t, [firstId, secondId]));
    const originalBoundary = 1_700_000_000_123;
    await t.run((ctx) => ctx.db.patch(first.taskId, { dispatchedAt: originalBoundary }));

    const reused = queuedResult(await dispatchExact(t, [secondId, firstId]));
    expect(reused).toEqual({
      queued: true,
      taskId: first.taskId,
      dispatchedAt: originalBoundary,
      reused: true,
    });
    expect(await storedTasks(t)).toHaveLength(1);
    expect(await scheduledFunctions(t)).toHaveLength(1);
  });

  it("does not reuse a same-job task for a different exact cohort", async () => {
    const t = createTest();
    const firstId = await seedResume(t, { externalId: "cohort-first", workspaceSlug: "dev" });
    const secondId = await seedResume(t, { externalId: "cohort-second", workspaceSlug: "dev" });

    const first = queuedResult(await dispatchExact(t, [firstId]));
    const second = queuedResult(await dispatchExact(t, [secondId]));

    expect(second.taskId).not.toBe(first.taskId);
    expect(second.reused).toBe(false);
    expect(await storedTasks(t)).toHaveLength(2);
    expect(await scheduledFunctions(t)).toHaveLength(2);
  });

  it("returns maintenance refusal without task creation", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, { workspaceSlug: "dev" });
    await t.mutation(api.system_settings.set, {
      key: "maintenanceMode",
      value: true,
      updatedBy: "test",
    });

    expect(await dispatchExact(t, [resumeId])).toEqual({
      queued: false,
      reason: "maintenance",
    });
    expect(await storedTasks(t)).toEqual([]);
    expect(await scheduledFunctions(t)).toEqual([]);
  });

  it("returns maintenance refusal instead of reusing an existing exact task", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, { workspaceSlug: "dev" });
    queuedResult(await dispatchExact(t, [resumeId]));
    await t.mutation(api.system_settings.set, {
      key: "maintenanceMode",
      value: true,
      updatedBy: "test",
    });

    expect(await dispatchExact(t, [resumeId])).toEqual({
      queued: false,
      reason: "maintenance",
    });
    expect(await storedTasks(t)).toHaveLength(1);
    expect(await scheduledFunctions(t)).toHaveLength(1);
  });

  it("omits target arrays from the recent task list", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, { workspaceSlug: "dev" });
    const result = queuedResult(await dispatchExact(t, [resumeId]));

    const listed = await t.query(api.analysis_tasks.list, {});
    const listedTask = listed.find((task) => task._id === result.taskId);
    expect(listedTask).toBeDefined();
    expect(listedTask).not.toHaveProperty("targetResumeIds");

    const stored = await t.query(internal.analysis_tasks.getTask, { taskId: result.taskId });
    expect(stored?.targetResumeIds).toEqual([resumeId]);
  });

  it("keeps public dispatch compatible while returning its task boundary", async () => {
    const t = createTest();
    const resumeId = await seedResume(t);

    const first = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["python"],
      resumeIds: [resumeId],
    });
    expect(first).toEqual({
      queued: true,
      taskId: expect.any(String),
      dispatchedAt: expect.any(Number),
      reused: false,
    });
    if (!first.queued) throw new Error("Expected public dispatch to queue");

    const second = await t.mutation(api.analysis_tasks.dispatch, {
      keywords: ["python"],
      resumeIds: [resumeId],
    });
    expect(second).toEqual({
      queued: true,
      taskId: first.taskId,
      dispatchedAt: first.dispatchedAt,
      reused: true,
    });
  });

  it("does not apply the broad keyword prefilter to exact tasks", () => {
    const resumes = [
      { _id: "match", content: { summary: "CNC sales" } },
      { _id: "no-match", content: { summary: "Unrelated profile" } },
    ];
    const classifyForMode = classifyResumes as unknown as (
      rows: typeof resumes,
      keywords: string[],
      relatedExpContext: undefined,
      dispatchMode: "exact",
    ) => { toAnalyze: typeof resumes; toSkip: typeof resumes };

    const result = classifyForMode(resumes, ["cnc"], undefined, "exact");
    expect(result.toAnalyze.map((resume) => resume._id)).toEqual(["match", "no-match"]);
    expect(result.toSkip).toEqual([]);
  });

  it("forces exact analysis writes strictly past the dispatch boundary", () => {
    const resolveTimestamp = (
      analysisTasksModule as unknown as {
        resolveAnalysisWriteTimestamp?: (dispatchedAt: number | undefined, now: number) => number;
      }
    ).resolveAnalysisWriteTimestamp;

    expect(resolveTimestamp?.(1_000, 999)).toBe(1_001);
    expect(resolveTimestamp?.(1_000, 1_000)).toBe(1_001);
    expect(resolveTimestamp?.(1_000, 1_001)).toBe(1_001);
    expect(resolveTimestamp?.(undefined, 999)).toBe(999);
  });
});

describe("analysis_tasks:getExactStatus", () => {
  beforeEach(() => {
    process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
    process.env.AI_OUTPUT_LOCALE = "zh-Hans";
  });

  afterEach(() => {
    delete process.env.CONVEX_WRITE_SECRET;
    delete process.env.AI_OUTPUT_LOCALE;
  });

  it("enforces secret, task existence, and task workspace", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, { workspaceSlug: "dev" });
    const dispatch = queuedResult(await dispatchExact(t, [resumeId]));

    await expect(t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
    })).rejects.toThrow(/Unauthorized Convex write/);
    await expect(t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: "wrong-secret",
    })).rejects.toThrow(/Unauthorized Convex write/);
    await expect(t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
    })).rejects.toThrow(/workspace/i);

    await t.run((ctx) => ctx.db.delete(dispatch.taskId));
    expect(await t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    })).toBeNull();
  });

  it("verifies a completed explicit-JD analysis under its exact source/locale key", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "ready-explicit",
      source: "hr.job5156.com",
      workspaceSlug: "dev",
    });
    const dispatch = queuedResult(await dispatchExact(t, [resumeId], {
      keywords: undefined,
      jobDescriptionId: "jd-exact",
      jobDescriptionTitle: "CNC Sales",
      jobDescriptionContent: "CNC machine tool sales",
    }));
    const expectedKey = buildResumeAnalysisStorageKey("jd-exact", {
      sourceKey: "job5156",
      locale: "zh-Hans",
    });
    await seedResumeAnalysesColdRow(t, resumeId, {
      status: "active",
      analyses: {
        [expectedKey]: analysisValue({ analyzedAt: dispatch.dispatchedAt + 1 }),
      },
    });
    await completeTask(t, dispatch.taskId);

    const status = await t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(status?.verification).toMatchObject({
      allReady: true,
      ready: 1,
      pending: 0,
      invalid: 0,
      dispatchedAt: dispatch.dispatchedAt,
    });
    expect(status?.verification.targets[0]).toEqual(expect.objectContaining({
      currentResumeId: String(resumeId),
      state: "ready",
      expectedAnalysisKey: expectedKey,
      expectedJobDescriptionId: "jd-exact",
      expectedPromptVersion: PROMPT_VERSION,
      actualJobDescriptionId: "jd-exact",
      actualPromptVersion: PROMPT_VERSION,
      analyzedAt: dispatch.dispatchedAt + 1,
      reasons: [],
    }));
  });

  it("verifies keyword analysis in the SEEK source:seek|locale:en lane", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "ready-seek",
      source: "my.employer.seek.com",
      workspaceSlug: "dev",
    });
    const dispatch = queuedResult(await dispatchExact(t, [resumeId], {
      keywords: ["CNC", "Sales"],
      location: "Malaysia",
    }));
    const expectedAnalysisId = buildKeywordAnalysisId(["cnc", "sales"], {
      location: "Malaysia",
      promptVersion: PROMPT_VERSION,
    });
    const expectedKey = buildResumeAnalysisStorageKey(expectedAnalysisId, {
      sourceKey: "seek",
      locale: "en",
    });
    expect(expectedKey).toBe(`source:seek|locale:en|analysis:${expectedAnalysisId}`);
    await seedResumeAnalysesColdRow(t, resumeId, {
      analyses: {
        [expectedKey]: analysisValue({
          jobDescriptionId: expectedAnalysisId,
          locale: "en",
          analyzedAt: dispatch.dispatchedAt + 1,
        }),
      },
    });
    await completeTask(t, dispatch.taskId);

    const status = await t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(status?.verification.allReady).toBe(true);
    expect(status?.verification.targets[0].expectedAnalysisKey).toBe(expectedKey);
  });

  it.each([
    ["missing analysis", "missing", "analysis_missing"],
    ["wrong key", "wrong-key", "analysis_key_mismatch"],
    ["wrong job ID", "wrong-job", "analysis_job_description_mismatch"],
    ["wrong prompt version", "wrong-version", "analysis_prompt_version_mismatch"],
    ["missing analyzedAt", "missing-time", "analysis_timestamp_missing"],
    ["analyzed before dispatch", "before-time", "analysis_not_newer_than_dispatch"],
    ["analyzed at dispatch", "equal-time", "analysis_not_newer_than_dispatch"],
  ])("marks completed target invalid for %s", async (_label, mode, expectedReason) => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: `invalid-${mode}`,
      source: "hr.job5156.com",
      workspaceSlug: "dev",
    });
    const dispatch = queuedResult(await dispatchExact(t, [resumeId], {
      keywords: undefined,
      jobDescriptionId: "jd-exact",
      jobDescriptionContent: "CNC sales",
    }));
    const expectedKey = buildResumeAnalysisStorageKey("jd-exact", {
      sourceKey: "job5156",
      locale: "zh-Hans",
    });
    const value = analysisValue({
      ...(mode === "wrong-job" ? { jobDescriptionId: "jd-other" } : {}),
      ...(mode === "wrong-version" ? { promptVersion: PROMPT_VERSION - 1 } : {}),
      ...(mode === "missing-time" ? { analyzedAt: undefined } : {}),
      ...(mode === "before-time" ? { analyzedAt: dispatch.dispatchedAt - 1 } : {}),
      ...(mode === "equal-time" ? { analyzedAt: dispatch.dispatchedAt } : {}),
      ...(!["missing-time", "before-time", "equal-time"].includes(mode)
        ? { analyzedAt: dispatch.dispatchedAt + 1 }
        : {}),
    });
    const analyses = mode === "missing"
      ? {}
      : mode === "wrong-key"
        ? { "source:job5156|locale:zh-hans|analysis:jd-other": value }
        : { [expectedKey]: value };
    await seedResumeAnalysesColdRow(t, resumeId, { analyses });
    await completeTask(t, dispatch.taskId);

    const status = await t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(status?.verification).toMatchObject({
      allReady: false,
      ready: 0,
      pending: 0,
      invalid: 1,
    });
    expect(status?.verification.targets[0]).toMatchObject({
      state: "invalid",
      reasons: expect.arrayContaining([expectedReason]),
    });
  });

  it("rejects archived cold analysis even when legacy hot analysis matches", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "archived-cold-row",
      source: "hr.job5156.com",
      workspaceSlug: "dev",
    });
    const dispatch = queuedResult(await dispatchExact(t, [resumeId], {
      keywords: undefined,
      jobDescriptionId: "jd-exact",
      jobDescriptionContent: "CNC sales",
    }));
    const expectedKey = buildResumeAnalysisStorageKey("jd-exact", {
      sourceKey: "job5156",
      locale: "zh-Hans",
    });
    const readyValue = analysisValue({ analyzedAt: dispatch.dispatchedAt + 1 });
    await t.run((ctx) => ctx.db.patch(resumeId, { analyses: { [expectedKey]: readyValue } }));
    await seedResumeAnalysesColdRow(t, resumeId, {
      status: "archived",
      archivedAt: dispatch.dispatchedAt,
      analyses: { [expectedKey]: readyValue },
    });
    await completeTask(t, dispatch.taskId);

    const status = await t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(status?.verification.targets[0]).toMatchObject({
      state: "invalid",
      reasons: ["analysis_cold_row_missing"],
    });
  });

  it("marks missing, archived, and cross-workspace resumes invalid", async () => {
    const t = createTest();
    const missingId = await seedResume(t, { externalId: "status-missing", workspaceSlug: "dev" });
    const archivedId = await seedResume(t, { externalId: "status-archived", workspaceSlug: "dev" });
    const wrongWorkspaceId = await seedResume(t, { externalId: "status-workspace", workspaceSlug: "dev" });
    const dispatch = queuedResult(await dispatchExact(t, [missingId, archivedId, wrongWorkspaceId]));
    await t.run(async (ctx) => {
      await ctx.db.delete(missingId);
      await ctx.db.patch(archivedId, { isArchived: true });
      await ctx.db.patch(wrongWorkspaceId, { workspaceSlug: "hr" });
    });
    await completeTask(t, dispatch.taskId);

    const status = await t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(status?.verification).toMatchObject({ allReady: false, ready: 0, pending: 0, invalid: 3 });
    expect(status?.verification.targets.map((target) => target.reasons)).toEqual([
      ["resume_missing"],
      ["resume_archived"],
      ["workspace_mismatch"],
    ]);
  });

  it("reports valid targets pending while the task is pending or processing", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, { workspaceSlug: "dev" });
    const dispatch = queuedResult(await dispatchExact(t, [resumeId]));

    const pending = await t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(pending?.verification).toMatchObject({ ready: 0, pending: 1, invalid: 0, allReady: false });
    expect(pending?.verification.targets[0]).toMatchObject({ state: "pending", reasons: ["task_pending"] });

    await t.mutation(internal.analysis_tasks.markProcessing, { taskId: dispatch.taskId });
    const processing = await t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(processing?.verification.targets[0]).toMatchObject({ state: "pending", reasons: ["task_processing"] });
  });

  it.each(["failed", "cancelled"] as const)("never reports a %s task ready", async (taskStatus) => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: `terminal-${taskStatus}`,
      source: "hr.job5156.com",
      workspaceSlug: "dev",
    });
    const dispatch = queuedResult(await dispatchExact(t, [resumeId], {
      keywords: undefined,
      jobDescriptionId: "jd-exact",
      jobDescriptionContent: "CNC sales",
    }));
    const expectedKey = buildResumeAnalysisStorageKey("jd-exact", {
      sourceKey: "job5156",
      locale: "zh-Hans",
    });
    await seedResumeAnalysesColdRow(t, resumeId, {
      analyses: {
        [expectedKey]: analysisValue({ analyzedAt: dispatch.dispatchedAt + 1 }),
      },
    });
    await completeTask(t, dispatch.taskId, taskStatus);

    const status = await t.query(api.analysis_tasks.getExactStatus, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(status?.verification).toMatchObject({ allReady: false, ready: 0, pending: 0, invalid: 1 });
    expect(status?.verification.targets[0]).toMatchObject({
      state: "invalid",
      reasons: [`task_${taskStatus}`],
    });
  });
});
