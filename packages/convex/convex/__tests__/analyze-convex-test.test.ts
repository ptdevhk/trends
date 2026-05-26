/**
 * Convex-test integration for analyze.ts storeConfirmResult.
 *
 * storeConfirmResult is the only Convex mutation in analyze.ts that can be
 * tested without mocking external LLM APIs.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api.js";


// Helper: insert a minimal resume document
async function insertResume(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: "ext-confirm-test",
      content: { name: "Test User" },
      hash: "hash-confirm-test",
      tags: [],
      crawledAt: Date.now(),
      source: "test",
      searchText: "test resume",
      ...overrides,
    });
  });
}

describe("analyze: storeConfirmResult", () => {
  it("stores confirm result in analyses map", async () => {
    const t = createTest();

    const resumeId = await insertResume(t, {
      analysis: {
        score: 70,
        summary: "Original analysis",
        highlights: ["exp 1"],
        recommendation: "match",
        jobDescriptionId: "default",
        promptVersion: 1,
        locale: "zh-Hans",
        analyzedAt: Date.now() - 60_000,
      },
    });

    const confirmTime = Date.now();
    await t.mutation(internal.analyze.storeConfirmResult, {
      resumeId,
      analysis: {
        score: 85,
        summary: "Confirm: strong match",
        highlights: ["exp 1", "exp 2"],
        recommendation: "strong_match",
        promptVersion: 1,
        locale: "zh-Hans",
        analyzedAt: confirmTime,
      },
    });

    const resume = await t.run(async (ctx) => ctx.db.get(resumeId));

    // Should set confirmedScore and confirmedAt
    expect(resume?.confirmedScore).toBe(85);
    expect(resume?.confirmedAt).toBe(confirmTime);

    // Should store in analyses map under confirm: key
    const analyses = resume?.analyses;
    expect(analyses).toBeDefined();
    const confirmKey = `confirm:${confirmTime}`;
    expect(analyses![confirmKey]).toBeDefined();
    expect(analyses![confirmKey].score).toBe(85);
    expect(analyses![confirmKey].summary).toBe("Confirm: strong match");
  });

  it("preserves existing analyses when adding confirm result", async () => {
    const t = createTest();

    const existingAnalysis = {
      score: 60,
      summary: "Existing",
      highlights: ["h1"],
      recommendation: "potential",
      jobDescriptionId: "jd-existing",
      promptVersion: 1,
      locale: "en",
      analyzedAt: Date.now() - 120_000,
    };

    const resumeId = await insertResume(t, {
      analyses: {
        "source:test|analysis:existing": existingAnalysis,
      },
    });

    const confirmTime = Date.now();
    await t.mutation(internal.analyze.storeConfirmResult, {
      resumeId,
      analysis: {
        score: 90,
        summary: "Confirm result",
        highlights: ["h2"],
        recommendation: "strong_match",
        promptVersion: 1,
        locale: "zh-Hans",
        analyzedAt: confirmTime,
      },
    });

    const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
    const analyses = resume?.analyses;

    // Original analysis should still exist
    expect(analyses!["source:test|analysis:existing"]).toBeDefined();
    expect(analyses!["source:test|analysis:existing"].score).toBe(60);

    // Confirm result should be added
    const confirmKey = `confirm:${confirmTime}`;
    expect(analyses![confirmKey]).toBeDefined();
    expect(analyses![confirmKey].score).toBe(90);
  });

  it("throws when resume not found", async () => {
    const t = createTest();

    // Create and delete a resume to get a valid but non-existent ID
    const resumeId = await insertResume(t);
    await t.run(async (ctx) => { await ctx.db.delete(resumeId); });

    await expect(
      t.mutation(internal.analyze.storeConfirmResult, {
        resumeId,
        analysis: {
          score: 50,
          summary: "Test",
          highlights: [],
          recommendation: "potential",
          promptVersion: 1,
          locale: "en",
          analyzedAt: Date.now(),
        },
      }),
    ).rejects.toThrow("Resume not found");
  });

  it("stores breakdown and keyFactors in confirm result", async () => {
    const t = createTest();

    const resumeId = await insertResume(t);

    const confirmTime = Date.now();
    await t.mutation(internal.analyze.storeConfirmResult, {
      resumeId,
      analysis: {
        score: 78,
        summary: "Good match",
        highlights: ["exp"],
        recommendation: "match",
        breakdown: { related_exp: 60, industry_db: 18 },
        keyFactors: [
          { factor: "experience", weight: 0.6, value: "7 years in CNC" },
        ],
        jobDescriptionId: "jd-test",
        promptVersion: 2,
        locale: "en",
        queryLocation: "Shanghai",
        analyzedAt: confirmTime,
      },
    });

    const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
    const confirmKey = `confirm:${confirmTime}`;
    const confirmResult = resume?.analyses![confirmKey];

    expect(confirmResult.breakdown).toEqual({ related_exp: 60, industry_db: 18 });
    expect(confirmResult.keyFactors).toHaveLength(1);
    expect(confirmResult.keyFactors[0].factor).toBe("experience");
    expect(confirmResult.jobDescriptionId).toBe("jd-test");
    expect(confirmResult.promptVersion).toBe(2);
    expect(confirmResult.locale).toBe("en");
    expect(confirmResult.queryLocation).toBe("Shanghai");
  });
});
