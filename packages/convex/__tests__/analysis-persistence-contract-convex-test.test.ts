import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildResumeAnalysisStorageKey,
  resolveResumeAnalysisSourceKey,
} from "@trends/shared";

import { api, internal } from "../convex/_generated/api.js";
import { normalizeAnalysisResult } from "../convex/analyze.js";
import {
  createTest,
  getResumeAnalysesColdRow,
  seedResume,
} from "./test-helpers.js";

const JOB_DESCRIPTION_ID = "jd-analysis-persistence";
const SOURCE = "hr.job5156.com";
const LOCALE = "zh-Hans";

const INGEST_DATA = {
  industryTags: ["machine tools"],
  synonymHits: ["cnc"],
  brandHits: [],
  brandOrigin: "domestic" as const,
  productClass: "tool_accessory" as const,
  companyHits: [],
  industryDbV2Raw: 0,
  roleSignals: [],
  ruleScores: {},
  experienceLevel: "senior",
  computedAt: 1,
  skillsVersion: 1,
};

const LLM_RESULT = {
  score: 30,
  summary: "刀具销售经历与整机岗位存在差距。",
  highlights: ["具备销售经历"],
  concerns: ["LLM concern: imported-machine experience is unverified"],
  recommendation: "potential",
  breakdown: { related_exp: 30, industry_db: 0 },
  keyFactors: [
    { factor: "related_exp", weight: 0.5, value: "Tool-accessory sales only" },
  ],
};

function installLlmResponse(payload: Record<string, unknown> = LLM_RESULT): void {
  vi.stubEnv("AI_API_KEY", "test-analysis-key");
  vi.stubEnv("AI_OUTPUT_LOCALE", LOCALE);
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: {},
    }),
  })));
}

function expectedAnalysisKey(): string {
  return buildResumeAnalysisStorageKey(JOB_DESCRIPTION_ID, {
    sourceKey: resolveResumeAnalysisSourceKey({ source: SOURCE }),
    locale: LOCALE,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("persisted analysis contract", () => {
  it("persists scheduled normalized concerns and key factors in the active source/locale row", async () => {
    installLlmResponse();
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "scheduled-analysis-persistence",
      source: SOURCE,
      sourceKey: "job5156",
      ingestData: INGEST_DATA,
    });
    const resume = await t.run((ctx) => ctx.db.get(resumeId));
    const expected = normalizeAnalysisResult(LLM_RESULT, resume);

    const dispatch = await t.mutation(api.analysis_tasks.dispatch, {
      jobDescriptionId: JOB_DESCRIPTION_ID,
      jobDescriptionTitle: "Imported machine-tool sales",
      jobDescriptionContent: "Sell imported complete machines",
      resumeIds: [resumeId],
    });
    if (!dispatch.queued) {
      throw new Error("Expected analysis task to queue");
    }

    await expect(t.action(internal.analysis_tasks.processAnalysisTask, {
      taskId: dispatch.taskId,
      resumeIds: [resumeId],
    })).resolves.toEqual({ status: "completed" });

    const coldRow = await getResumeAnalysesColdRow(t, resumeId);
    expect(coldRow?.status).toBe("active");
    expect(coldRow?.analysis?.concerns).toEqual(expected.concerns);
    expect(coldRow?.analysis?.keyFactors).toEqual(expected.keyFactors);
    expect(coldRow?.analyses?.[expectedAnalysisKey()]?.concerns).toEqual(expected.concerns);
    expect(coldRow?.analyses?.[expectedAnalysisKey()]?.keyFactors).toEqual(expected.keyFactors);
    expect(expected.concerns[0]).toBe(LLM_RESULT.concerns[0]);
    expect(expected.concerns.some((concern) => concern.includes("国产"))).toBe(true);
    expect(expected.concerns.some((concern) => concern.includes("刀具"))).toBe(true);
  });

  it("persists direct normalized concerns and key factors and exposes them in resume detail", async () => {
    installLlmResponse();
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "direct-analysis-persistence",
      source: SOURCE,
      sourceKey: "job5156",
      ingestData: INGEST_DATA,
    });
    const resume = await t.run((ctx) => ctx.db.get(resumeId));
    const expected = normalizeAnalysisResult(LLM_RESULT, resume);

    await t.action(api.analyze.analyzeResume, {
      resumeId,
      jobDescriptionId: JOB_DESCRIPTION_ID,
      jobDescription: {
        title: "Imported machine-tool sales",
        requirements: "Sell imported complete machines",
      },
    });

    const coldRow = await getResumeAnalysesColdRow(t, resumeId);
    expect(coldRow?.analysis?.concerns).toEqual(expected.concerns);
    expect(coldRow?.analysis?.keyFactors).toEqual(expected.keyFactors);
    expect(coldRow?.analyses?.[expectedAnalysisKey()]?.concerns).toEqual(expected.concerns);
    expect(coldRow?.analyses?.[expectedAnalysisKey()]?.keyFactors).toEqual(expected.keyFactors);

    const detail = await t.query(api.resumes.getResumeDetail, { resumeId });
    expect(detail?.analysis?.concerns).toEqual(expected.concerns);
    expect(detail?.analysis?.keyFactors).toEqual(expected.keyFactors);
  });

  it("accepts concerns through the batch writer without stripping full analysis fields", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, { externalId: "batch-analysis-persistence" });
    const concerns = ["Needs imported-machine validation"];
    const keyFactors = [{ factor: "product", weight: 0.4, value: "Accessories" }];

    await t.mutation(internal.resumes.updateAnalysisBatch, {
      updates: [{
        resumeId,
        analysis: {
          score: 42,
          summary: "Partial fit",
          highlights: ["Sales"],
          concerns,
          recommendation: "potential",
          keyFactors,
          jobDescriptionId: JOB_DESCRIPTION_ID,
          locale: LOCALE,
          analyzedAt: 2,
        },
      }],
    });

    const coldRow = await getResumeAnalysesColdRow(t, resumeId);
    expect(coldRow?.analysis?.concerns).toEqual(concerns);
    expect(coldRow?.analysis?.keyFactors).toEqual(keyFactors);
  });

  it("persists normalized concerns and key factors through the public confirm action", async () => {
    installLlmResponse();
    const t = createTest();
    const workspaceId = "confirm-analysis-persistence";
    const resumeId = await seedResume(t, {
      externalId: "confirm-analysis-persistence",
      source: SOURCE,
      sourceKey: "job5156",
      ingestData: INGEST_DATA,
    });
    const resume = await t.run((ctx) => ctx.db.get(resumeId));
    const expected = normalizeAnalysisResult(LLM_RESULT, resume);
    const budget = await t.query(api.llm_cost.getBudget, { workspaceId });

    expect(budget.remainingConfirms).toBeGreaterThan(0);
    expect(budget.remainingTokens).toBeGreaterThan(0);
    await expect(t.action(api.analyze.confirmSearchResults, {
      workspaceId,
      resumeIds: [resumeId],
      query: "imported machine-tool sales",
    })).resolves.toMatchObject({
      confirmed: 1,
      results: [{ resumeId }],
    });

    const coldRow = await getResumeAnalysesColdRow(t, resumeId);
    const confirmEntries = Object.entries(coldRow?.analyses ?? {})
      .filter(([key]) => key.startsWith("confirm:"));
    expect(coldRow?.status).toBe("active");
    expect(confirmEntries).toHaveLength(1);
    expect(confirmEntries[0][1].concerns).toEqual(expected.concerns);
    expect(confirmEntries[0][1].keyFactors).toEqual(expected.keyFactors);
  });

  it("round-trips full analysis through restore and backup while accepting legacy optional omissions", async () => {
    const t = createTest();
    const concerns = ["Persist this concern"];
    const keyFactors = [{ factor: "experience", weight: 0.5, value: "Five years" }];
    const fullAnalysis = {
      score: 77,
      summary: "Full analysis",
      highlights: ["Relevant sales"],
      concerns,
      recommendation: "match",
      keyFactors,
      jobDescriptionId: JOB_DESCRIPTION_ID,
      promptVersion: 2,
      locale: LOCALE,
      analyzedAt: 4,
    };
    const legacyAnalysis = {
      score: 61,
      summary: "Historical analysis",
      highlights: [],
      recommendation: "potential",
      jobDescriptionId: "legacy-jd",
      analyzedAt: 1,
    };

    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [
        {
          externalId: "restore-full-analysis",
          content: { name: "Full" },
          hash: "restore-full-analysis-hash",
          source: SOURCE,
          tags: [],
          restoreState: {
            analysis: fullAnalysis,
            analyses: { [expectedAnalysisKey()]: fullAnalysis },
          },
        },
        {
          externalId: "restore-legacy-analysis",
          content: { name: "Legacy" },
          hash: "restore-legacy-analysis-hash",
          source: SOURCE,
          tags: [],
          restoreState: {
            analysis: legacyAnalysis,
            analyses: { "legacy-jd": legacyAnalysis },
          },
        },
      ],
    });

    const backup = await t.query(api.resumes.listForBackup, {
      paginationOpts: { cursor: null, numItems: 50 },
      resumeIds: ["restore-full-analysis", "restore-legacy-analysis"],
    });
    const fullRow = backup.page.find((row) => row.externalId === "restore-full-analysis");
    const legacyRow = backup.page.find((row) => row.externalId === "restore-legacy-analysis");

    expect(fullRow?.analysis?.concerns).toEqual(concerns);
    expect(fullRow?.analysis?.keyFactors).toEqual(keyFactors);
    expect(fullRow?.analyses?.[expectedAnalysisKey()]?.concerns).toEqual(concerns);
    expect(fullRow?.analyses?.[expectedAnalysisKey()]?.keyFactors).toEqual(keyFactors);
    expect(legacyRow?.analysis).toEqual(legacyAnalysis);
    expect(legacyRow?.analyses?.["legacy-jd"]).toEqual(legacyAnalysis);
  });
});
