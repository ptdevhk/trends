import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildResumeAnalysisStorageKey,
  getCurrentResumeAiPromptVersion,
} from "@trends/shared";

import { api, internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { createExactAnalysisIdentity } from "../convex/lib/exact_analysis_task.js";
import {
  createTest,
  seedResumeAnalysesColdRow,
} from "./test-helpers.js";

const WRITE_SECRET = "test-exact-task-audit-export-secret";
const PROMPT_VERSION = getCurrentResumeAiPromptVersion();
const DISPATCHED_AT = 1_750_000_000_001;
const COMPLETED_AT = 1_750_000_000_100;

type TestContext = ReturnType<typeof createTest>;

type AuditAnalysisState =
  | "ready"
  | "not_targeted"
  | "cold_row_missing"
  | "analysis_map_missing"
  | "analysis_key_missing"
  | "job_description_mismatch"
  | "prompt_version_mismatch"
  | "timestamp_missing"
  | "not_newer_than_dispatch";

type AuditRow = {
  currentResumeId: string;
  canonicalIdentityKey: string;
  externalId: string;
  profileResumeId?: string;
  profileUrl?: string;
  source: string;
  sourceKey: string;
  workspaceSlug: string;
  name?: string;
  age?: string | number;
  location?: string;
  taskId: string;
  taskStatus: "completed";
  taskWorkspaceSlug: string;
  taskDispatchedAt: number;
  taskCompletedAt: number;
  expectedJobDescriptionId: string;
  expectedPromptVersion: number;
  expectedAnalysisKey: string;
  exactCohortMember: boolean;
  analysisState: AuditAnalysisState;
  analysisReasons: string[];
  currentAnalysisKey?: string;
  currentJobDescriptionId?: string;
  currentPromptVersion?: number;
  currentLocale?: string;
  currentQueryLocation?: string;
  currentAnalyzedAt?: number;
  finalAiScore?: number;
  currentRecommendation?: string;
  currentBreakdown?: Record<string, number>;
  relatedExpAuditFactor?: number;
  relatedExpContribution?: number;
  industryDbContribution?: number;
  currentAISummary?: string;
  currentHighlights?: string[];
  currentConcerns?: string[];
  currentKeyFactors?: Array<Record<string, unknown>>;
  evidenceBandMax?: number;
  relatedExpCoverage?: string;
  missingReasons?: string[];
  effectiveRelatedExp?: number;
  llmRelatedExp?: number;
  recommendationMax?: number;
  relatedExpContextHash?: string;
  relatedExpRubricVersion?: string;
  brandHits?: Array<Record<string, unknown>>;
  brandOrigin?: string;
  productClass?: string;
  companyHits?: string[];
  roleSignals?: Array<Record<string, unknown>>;
  matchedWorkEntries?: Array<Record<string, unknown>>;
  evidenceText?: string;
  market?: string;
  ruleScores?: Record<string, number>;
  ruleScore?: number;
};

type AuditPage = {
  task: {
    taskId: string;
    status: "completed";
    dispatchMode: "exact";
    workspaceSlug: string;
    dispatchedAt: number;
    completedAt: number;
    expectedJobDescriptionId: string;
    expectedPromptVersion: number;
    targetCount: number;
  };
  counts: {
    scanned: number;
    exported: number;
    targeted: number;
    ready: number;
  };
  page: AuditRow[];
  continueCursor: string;
  isDone: boolean;
};

async function getAuditPage(
  t: TestContext,
  args: {
    taskId: Id<"analysis_tasks">;
    workspaceSlug: string;
    writeSecret?: string;
    cursor?: string;
    limit: number;
  },
): Promise<AuditPage | null> {
  // Test-first bridge: the production query intentionally does not exist at RED.
  const queryRef = (
    api.analysis_tasks as unknown as {
      getExactAuditExportPage: typeof api.analysis_tasks.getExactStatus;
    }
  ).getExactAuditExportPage;
  return await t.query(queryRef, args as never) as unknown as AuditPage | null;
}

function resumeDocument(index: number, overrides: Record<string, unknown> = {}) {
  return {
    externalId: `audit-resume-${index}`,
    identityKey: `resumeId:audit-resume-${index}`,
    content: {
      name: `Candidate ${index}`,
      resumeId: `profile-${index}`,
      profileResumeId: `profile-${index}`,
      profileUrl: `https://example.com/candidates/${index}`,
      location: "Dongguan",
    },
    hash: `audit-hash-${index}`,
    tags: [],
    crawledAt: index + 1,
    source: "hr.job5156.com",
    sourceKey: "job5156",
    workspaceSlug: "dev",
    ...overrides,
  };
}

function seedResume(
  t: TestContext,
  index: number,
  overrides: Record<string, unknown> = {},
) {
  return t.run((ctx) => ctx.db.insert("resumes", resumeDocument(index, overrides)));
}

async function seedCompletedExactTask(
  t: TestContext,
  targetResumeIds: Id<"resumes">[],
  overrides: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    const config = (overrides.config ?? {
      jobDescriptionId: "jd-exact",
      promptVersion: PROMPT_VERSION,
      resumeCount: targetResumeIds.length,
    }) as { jobDescriptionId?: unknown };
    const expectedJobDescriptionId = typeof config.jobDescriptionId === "string"
      ? config.jobDescriptionId
      : "jd-exact";
    const hasIdentityOverride = Object.prototype.hasOwnProperty.call(
      overrides,
      "targetAnalysisIdentities",
    );
    const targetAnalysisIdentities = hasIdentityOverride
      ? undefined
      : await Promise.all(targetResumeIds.map(async (resumeId) => {
        const resume = await ctx.db.get(resumeId);
        if (!resume) {
          throw new Error(`Expected audit resume ${String(resumeId)}`);
        }
        return createExactAnalysisIdentity(expectedJobDescriptionId, resume);
      }));

    return ctx.db.insert("analysis_tasks", {
      dispatchMode: "exact",
      workspaceSlug: "dev",
      targetResumeIds,
      targetAnalysisIdentities,
      dispatchedAt: DISPATCHED_AT,
      completedAt: COMPLETED_AT,
      config: {
        jobDescriptionId: "jd-exact",
        promptVersion: PROMPT_VERSION,
        resumeCount: targetResumeIds.length,
      },
      status: "completed",
      progress: {
        current: targetResumeIds.length,
        total: targetResumeIds.length,
        skipped: 0,
      },
      ...overrides,
    });
  });
}

function analysisValue(overrides: Record<string, unknown> = {}) {
  return {
    score: 79,
    summary: "Persisted exact-task score",
    highlights: ["Direct CNC sales"],
    concerns: ["Limited premium-brand coverage"],
    recommendation: "match",
    breakdown: {
      related_exp: 78,
      industry_db: 40,
    },
    keyFactors: [{ factor: "role", value: "sales", weight: 0.5 }],
    jobDescriptionId: "jd-exact",
    promptVersion: PROMPT_VERSION,
    locale: "en",
    queryLocation: "Malaysia",
    analyzedAt: DISPATCHED_AT + 1,
    relatedExpEvidence: {
      evidenceBandMax: 65,
      coverage: "partial",
      missingReasons: ["outcome_missing"],
      effectiveRaw: 65,
      llmRaw: 78,
      recommendationMax: 80,
      contextHash: "context-hash",
      rubricVersion: "rubric-v2",
    },
    ...overrides,
  };
}

describe("analysis_tasks:getExactAuditExportPage", () => {
  beforeEach(() => {
    process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
    process.env.AI_OUTPUT_LOCALE = "zh-Hans";
  });

  afterEach(() => {
    delete process.env.CONVEX_WRITE_SECRET;
    delete process.env.AI_OUTPUT_LOCALE;
  });

  it("enforces the secret, nonempty workspace, exact task ID, and matching task workspace", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, 1);
    const taskId = await seedCompletedExactTask(t, [resumeId]);

    await expect(getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      limit: 100,
    })).rejects.toThrow(/Unauthorized Convex write/);
    await expect(getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: "wrong-secret",
      limit: 100,
    })).rejects.toThrow(/Unauthorized Convex write/);
    await expect(getAuditPage(t, {
      taskId,
      workspaceSlug: " ",
      writeSecret: WRITE_SECRET,
      limit: 100,
    })).rejects.toThrow(/workspace/i);
    await expect(getAuditPage(t, {
      taskId,
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
      limit: 100,
    })).rejects.toThrow(/workspace/i);

    await t.run((ctx) => ctx.db.delete(taskId));
    expect(await getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 100,
    })).toBeNull();
  });

  it.each(["pending", "processing", "failed", "cancelled"] as const)(
    "rejects a %s exact task",
    async (status) => {
      const t = createTest();
      const resumeId = await seedResume(t, 2);
      const taskId = await seedCompletedExactTask(t, [resumeId], { status });

      await expect(getAuditPage(t, {
        taskId,
        workspaceSlug: "dev",
        writeSecret: WRITE_SECRET,
        limit: 100,
      })).rejects.toThrow(/completed/i);
    },
  );

  it("rejects search-mode and malformed completed tasks", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, 3);
    const searchTaskId = await seedCompletedExactTask(t, [resumeId], { dispatchMode: "search" });
    await expect(getAuditPage(t, {
      taskId: searchTaskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 100,
    })).rejects.toThrow(/exact/i);

    const malformedTaskId = await seedCompletedExactTask(t, [resumeId], {
      completedAt: undefined,
      config: {
        jobDescriptionId: "",
        promptVersion: PROMPT_VERSION,
        resumeCount: 2,
      },
    });
    await expect(getAuditPage(t, {
      taskId: malformedTaskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 100,
    })).rejects.toThrow(/metadata|count/i);
  });

  it.each([
    { cursor: "", limit: 100, expected: /cursor/i },
    { cursor: undefined, limit: 0, expected: /limit/i },
    { cursor: undefined, limit: 201, expected: /limit/i },
    { cursor: undefined, limit: 1.5, expected: /limit/i },
  ])("rejects an invalid cursor or page limit", async ({ cursor, limit, expected }) => {
    const t = createTest();
    const resumeId = await seedResume(t, 4);
    const taskId = await seedCompletedExactTask(t, [resumeId]);

    await expect(getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      ...(cursor === undefined ? {} : { cursor }),
      limit,
    })).rejects.toThrow(expected);
  });

  it("includes active workspace rows, applies legacy-dev ownership, and excludes archived or foreign rows", async () => {
    const t = createTest();
    const explicitDevId = await seedResume(t, 10, { workspaceSlug: "dev" });
    const legacyDevId = await seedResume(t, 11, { workspaceSlug: undefined });
    await seedResume(t, 12, { workspaceSlug: "dev", isArchived: true });
    const existingHrId = await seedResume(t, 13, { workspaceSlug: "hr" });
    const devTaskId = await seedCompletedExactTask(t, [explicitDevId]);

    const devPage = await getAuditPage(t, {
      taskId: devTaskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 100,
    });
    expect(devPage?.page.map((row) => row.currentResumeId)).toEqual([
      String(explicitDevId),
      String(legacyDevId),
    ]);
    expect(devPage?.counts).toEqual({
      scanned: 4,
      exported: 2,
      targeted: 1,
      ready: 0,
    });

    const hrResumeId = await seedResume(t, 14, { workspaceSlug: "hr" });
    const hrTaskId = await seedCompletedExactTask(t, [hrResumeId], { workspaceSlug: "hr" });
    const hrPage = await getAuditPage(t, {
      taskId: hrTaskId,
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
      limit: 100,
    });
    expect(hrPage?.page.map((row) => row.currentResumeId)).toEqual([
      String(existingHrId),
      String(hrResumeId),
    ]);
  });

  it("returns exact source-locale cold evidence and complete task, identity, score, ingest, and cohort provenance", async () => {
    const t = createTest();
    const targetId = await seedResume(t, 20, {
      externalId: "seek-external-20",
      identityKey: "resumeId:seek-profile-20",
      age: 31,
      content: {
        name: "Alice Audit",
        profileResumeId: "seek-profile-20",
        profileUrl: "https://my.employer.seek.com/candidates/seek-profile-20",
        location: "Kuala Lumpur",
        age: "31 years",
      },
      source: "my.employer.seek.com",
      sourceKey: "seek",
      primaryRuleScore: 63,
      ingestData: {
        market: "MY",
        evidenceText: "Five years of CNC sales evidence",
        industryTags: ["machine-tools"],
        synonymHits: ["cnc"],
        brandHits: [{
          brand: "fanuc",
          role: "equipment",
          source: "workHistory",
          context: "sales",
          origin: "international",
          productClass: "complete_machine",
        }],
        brandOrigin: "international",
        productClass: "complete_machine",
        companyHits: ["fanuc"],
        roleSignals: [{
          type: "sales",
          matchedSignals: ["sales manager"],
          signalCount: 1,
          occurrences: 1,
          years: 5,
          industryVerifiedYears: 5,
          matchedWorkEntries: [{
            companyName: "Fanuc MY",
            jobTitle: "Sales Manager",
            years: 5,
            industryVerified: true,
            matchedSignals: ["sales manager"],
            directRoleMatch: true,
          }],
          verifyIn: "workHistory",
        }],
        ruleScores: { sales: 63, industry: 50 },
        experienceLevel: "senior",
        computedAt: 1_750_000_000_000,
        skillsVersion: 2,
      },
    });
    const nonTargetId = await seedResume(t, 21, {
      source: "my.employer.seek.com",
      sourceKey: "seek",
    });
    const taskId = await seedCompletedExactTask(t, [targetId]);
    const expectedKey = buildResumeAnalysisStorageKey("jd-exact", {
      sourceKey: "seek",
      locale: "en",
    });
    await seedResumeAnalysesColdRow(t, targetId, {
      status: "active",
      analyses: { [expectedKey]: analysisValue() },
    });

    const result = await getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 100,
    });

    expect(result?.task).toEqual({
      taskId: String(taskId),
      status: "completed",
      dispatchMode: "exact",
      workspaceSlug: "dev",
      dispatchedAt: DISPATCHED_AT,
      completedAt: COMPLETED_AT,
      expectedJobDescriptionId: "jd-exact",
      expectedPromptVersion: PROMPT_VERSION,
      targetCount: 1,
    });
    expect(result?.counts).toEqual({ scanned: 2, exported: 2, targeted: 1, ready: 1 });
    expect(result?.page[0]).toMatchObject({
      currentResumeId: String(targetId),
      canonicalIdentityKey: "resumeId:seek-profile-20",
      externalId: "seek-external-20",
      profileResumeId: "seek-profile-20",
      profileUrl: "https://my.employer.seek.com/candidates/seek-profile-20",
      source: "my.employer.seek.com",
      sourceKey: "seek",
      workspaceSlug: "dev",
      name: "Alice Audit",
      age: "31 years",
      location: "Kuala Lumpur",
      taskId: String(taskId),
      taskStatus: "completed",
      taskWorkspaceSlug: "dev",
      taskDispatchedAt: DISPATCHED_AT,
      taskCompletedAt: COMPLETED_AT,
      expectedJobDescriptionId: "jd-exact",
      expectedPromptVersion: PROMPT_VERSION,
      expectedAnalysisKey: expectedKey,
      exactCohortMember: true,
      analysisState: "ready",
      analysisReasons: [],
      currentAnalysisKey: expectedKey,
      currentJobDescriptionId: "jd-exact",
      currentPromptVersion: PROMPT_VERSION,
      currentLocale: "en",
      currentQueryLocation: "Malaysia",
      currentAnalyzedAt: DISPATCHED_AT + 1,
      finalAiScore: 79,
      currentRecommendation: "match",
      currentBreakdown: { related_exp: 78, industry_db: 40 },
      relatedExpAuditFactor: 78,
      relatedExpContribution: 39,
      industryDbContribution: 40,
      currentAISummary: "Persisted exact-task score",
      currentHighlights: ["Direct CNC sales"],
      currentConcerns: ["Limited premium-brand coverage"],
      currentKeyFactors: [{ factor: "role", value: "sales", weight: 0.5 }],
      evidenceBandMax: 65,
      relatedExpCoverage: "partial",
      missingReasons: ["outcome_missing"],
      effectiveRelatedExp: 65,
      llmRelatedExp: 78,
      recommendationMax: 80,
      relatedExpContextHash: "context-hash",
      relatedExpRubricVersion: "rubric-v2",
      brandHits: [{
        brand: "fanuc",
        role: "equipment",
        source: "workHistory",
        context: "sales",
        origin: "international",
        productClass: "complete_machine",
      }],
      brandOrigin: "international",
      productClass: "complete_machine",
      companyHits: ["fanuc"],
      evidenceText: "Five years of CNC sales evidence",
      market: "MY",
      ruleScores: { sales: 63, industry: 50 },
      ruleScore: 63,
    });
    expect(result?.page[0].roleSignals).toHaveLength(1);
    expect(result?.page[0].matchedWorkEntries).toEqual([{
      companyName: "Fanuc MY",
      jobTitle: "Sales Manager",
      years: 5,
      industryVerified: true,
      matchedSignals: ["sales manager"],
      directRoleMatch: true,
    }]);
    expect(result?.page[1]).toMatchObject({
      currentResumeId: String(nonTargetId),
      exactCohortMember: false,
      analysisState: "not_targeted",
      analysisReasons: ["not_targeted"],
    });
  });

  it("preserves a Job5156 dispatch-time lane after the runtime locale changes", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, 25, {
      source: "hr.job5156.com",
      sourceKey: "job5156",
      workspaceSlug: "dev",
    });
    process.env.AI_OUTPUT_LOCALE = "zh-Hans";
    const dispatch = await t.mutation(api.analysis_tasks.dispatchExact, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      keywords: ["CNC", "Sales"],
      location: "Dongguan",
      resumeIds: [resumeId],
    });
    if (!dispatch.queued) {
      throw new Error("Expected exact analysis dispatch to queue");
    }
    const task = await t.query(internal.analysis_tasks.getTask, { taskId: dispatch.taskId });
    if (!task) {
      throw new Error("Expected dispatched exact task");
    }
    const frozenKey = buildResumeAnalysisStorageKey(task.config.jobDescriptionId, {
      sourceKey: "job5156",
      locale: "zh-Hans",
    });
    await seedResumeAnalysesColdRow(t, resumeId, {
      analyses: {
        [frozenKey]: analysisValue({
          jobDescriptionId: task.config.jobDescriptionId,
          locale: "zh-Hans",
          analyzedAt: dispatch.dispatchedAt + 1,
        }),
      },
    });
    await t.mutation(internal.analysis_tasks.complete, {
      taskId: dispatch.taskId,
      status: "completed",
      results: {
        analyzed: 1,
        skipped: 0,
        failed: 0,
        avgScore: 79,
        highScoreCount: 0,
      },
    });

    process.env.AI_OUTPUT_LOCALE = "en";
    const result = await getAuditPage(t, {
      taskId: dispatch.taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 100,
    });

    expect(result?.page[0]).toMatchObject({
      currentResumeId: String(resumeId),
      expectedAnalysisKey: frozenKey,
      analysisState: "ready",
      currentAnalysisKey: frozenKey,
    });
    expect((task as unknown as { targetAnalysisIdentities?: unknown }).targetAnalysisIdentities).toEqual([
      {
        resumeId,
        sourceKey: "job5156",
        locale: "zh-Hans",
        expectedAnalysisKey: frozenKey,
      },
    ]);
  });

  it("rejects a completed legacy exact task without immutable target identities", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, 26);
    const taskId = await seedCompletedExactTask(t, [resumeId], {
      targetAnalysisIdentities: undefined,
    });

    await expect(getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 100,
    })).rejects.toThrow(/immutable.*identit/i);
  });

  it("does not fall back from an archived cold row to matching hot, bare, or latest analyses", async () => {
    const t = createTest();
    const expectedKey = buildResumeAnalysisStorageKey("jd-exact", {
      sourceKey: "job5156",
      locale: "zh-Hans",
    });
    const resumeId = await seedResume(t, 30, {
      analysis: analysisValue(),
      analyses: {
        [expectedKey]: analysisValue(),
        "jd-exact": analysisValue(),
        latest: analysisValue(),
      },
    });
    const taskId = await seedCompletedExactTask(t, [resumeId]);
    await seedResumeAnalysesColdRow(t, resumeId, {
      status: "archived",
      analyses: { [expectedKey]: analysisValue() },
    });

    const result = await getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 100,
    });
    expect(result?.page[0]).toMatchObject({
      analysisState: "cold_row_missing",
      analysisReasons: ["cold_row_missing"],
    });
    expect(result?.page[0]).not.toHaveProperty("currentAnalysisKey");
    expect(result?.page[0]).not.toHaveProperty("finalAiScore");
  });

  it("reports every missing or stale exact analysis state without exposing a fallback score", async () => {
    const t = createTest();
    const cases = [
      { key: "analysis-map", expected: "analysis_map_missing" },
      { key: "analysis-key", expected: "analysis_key_missing" },
      { key: "job", expected: "job_description_mismatch" },
      { key: "version", expected: "prompt_version_mismatch" },
      { key: "missing-time", expected: "timestamp_missing" },
      { key: "equal-time", expected: "not_newer_than_dispatch" },
      { key: "older-time", expected: "not_newer_than_dispatch" },
    ] as const;
    const resumeIds: Id<"resumes">[] = [];
    for (const [index, testCase] of cases.entries()) {
      resumeIds.push(await seedResume(t, 40 + index, { externalId: testCase.key }));
    }
    const taskId = await seedCompletedExactTask(t, resumeIds);
    const expectedKey = buildResumeAnalysisStorageKey("jd-exact", {
      sourceKey: "job5156",
      locale: "zh-Hans",
    });
    await seedResumeAnalysesColdRow(t, resumeIds[0], { status: "active" });
    await seedResumeAnalysesColdRow(t, resumeIds[1], {
      analyses: {
        "jd-exact": analysisValue(),
        latest: analysisValue(),
      },
    });
    await seedResumeAnalysesColdRow(t, resumeIds[2], {
      analyses: { [expectedKey]: analysisValue({ jobDescriptionId: "jd-other" }) },
    });
    await seedResumeAnalysesColdRow(t, resumeIds[3], {
      analyses: { [expectedKey]: analysisValue({ promptVersion: PROMPT_VERSION - 1 }) },
    });
    await seedResumeAnalysesColdRow(t, resumeIds[4], {
      analyses: { [expectedKey]: analysisValue({ analyzedAt: undefined }) },
    });
    await seedResumeAnalysesColdRow(t, resumeIds[5], {
      analyses: { [expectedKey]: analysisValue({ analyzedAt: DISPATCHED_AT }) },
    });
    await seedResumeAnalysesColdRow(t, resumeIds[6], {
      analyses: { [expectedKey]: analysisValue({ analyzedAt: DISPATCHED_AT - 1 }) },
    });

    const result = await getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 100,
    });
    const rowsByExternalId = new Map(result?.page.map((row) => [row.externalId, row]));
    for (const testCase of cases) {
      const row = rowsByExternalId.get(testCase.key);
      expect(row?.analysisState).toBe(testCase.expected);
      expect(row?.analysisReasons).toContain(testCase.expected);
      expect(row).not.toHaveProperty("finalAiScore");
    }
    expect(rowsByExternalId.get("job")).toMatchObject({
      currentAnalysisKey: expectedKey,
      currentJobDescriptionId: "jd-other",
      currentPromptVersion: PROMPT_VERSION,
    });
    expect(rowsByExternalId.get("version")).toMatchObject({
      currentAnalysisKey: expectedKey,
      currentJobDescriptionId: "jd-exact",
      currentPromptVersion: PROMPT_VERSION - 1,
    });
  });

  it("returns stable task provenance on every page and continues after an empty filtered page", async () => {
    const t = createTest();
    await seedResume(t, 60, { workspaceSlug: "hr" });
    const targetId = await seedResume(t, 61, { workspaceSlug: "dev" });
    const taskId = await seedCompletedExactTask(t, [targetId]);

    const first = await getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      limit: 1,
    });
    expect(first?.page).toEqual([]);
    expect(first?.counts).toEqual({ scanned: 1, exported: 0, targeted: 0, ready: 0 });
    expect(first?.isDone).toBe(false);
    expect(first?.continueCursor).not.toBe("");

    const second = await getAuditPage(t, {
      taskId,
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      cursor: first?.continueCursor,
      limit: 1,
    });
    expect(second?.page.map((row) => row.currentResumeId)).toEqual([String(targetId)]);
    expect(second?.isDone).toBe(true);
    expect(second?.task).toEqual(first?.task);
  });

  it("scans more than 2,000 active rows without truncation, duplication, or repeated cursors", async () => {
    const t = createTest();
    const resumeIds = await t.run(async (ctx) => {
      const ids: Id<"resumes">[] = [];
      for (let index = 0; index < 2_005; index += 1) {
        ids.push(await ctx.db.insert("resumes", resumeDocument(1_000 + index)));
      }
      return ids;
    });
    const taskId = await seedCompletedExactTask(t, [resumeIds[0]]);
    const exportedIds: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = await getAuditPage(t, {
        taskId,
        workspaceSlug: "dev",
        writeSecret: WRITE_SECRET,
        ...(cursor === undefined ? {} : { cursor }),
        limit: 200,
      });
      if (!page) {
        throw new Error("Expected audit export page");
      }
      exportedIds.push(...page.page.map((row) => row.currentResumeId));
      if (page.isDone) {
        break;
      }
      expect(page.continueCursor).not.toBe("");
      expect(cursors.has(page.continueCursor)).toBe(false);
      cursors.add(page.continueCursor);
      cursor = page.continueCursor;
    }

    expect(exportedIds).toHaveLength(2_005);
    expect(new Set(exportedIds).size).toBe(2_005);
    expect(exportedIds).toEqual(resumeIds.map(String));
  });
});
