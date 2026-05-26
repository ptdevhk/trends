/**
 * Integration tests for clearAnalyses using convex-test.
 *
 * Replaces resumes-clear-analyses.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";


// Helper: insert a minimal resume document with analysis
let _resumeCounter = 0;
async function insertResumeWithAnalysis(
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
      sourceKey: "51job",
      analysis: {
        score: 88,
        summary: "Good candidate",
        highlights: ["experienced"],
        recommendation: "yes",
        jobDescriptionId: "jd-1",
      },
      analyses: {
        "source:job5156|analysis:jd-1": {
          score: 88,
          summary: "Good candidate",
          highlights: [],
          recommendation: "yes",
        },
        "source:seek|analysis:jd-2": {
          score: 51,
          summary: "Average candidate",
          highlights: [],
          recommendation: "maybe",
        },
      },
      ...overrides,
    });
  });
}

describe("resumes: clearAnalyses", () => {
  it("clears all analyses when no jobDescriptionId filter", async () => {
    const t = createTest();

    const resumeId = await insertResumeWithAnalysis(t);

    const result = await t.mutation(api.resumes.clearAnalyses, {
      resumeIds: [resumeId],
    });

    expect(result.cleared).toBe(1);
    expect(result.hasMore).toBe(false);

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });

    expect(resumes[0].analysis).toBeUndefined();
    expect(resumes[0].analyses).toBeUndefined();
  });

  it("clears only analyses matching jobDescriptionId", async () => {
    const t = createTest();

    const resumeId = await insertResumeWithAnalysis(t);

    const result = await t.mutation(api.resumes.clearAnalyses, {
      resumeIds: [resumeId],
      jobDescriptionId: "jd-1",
    });

    expect(result.cleared).toBe(1);

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });

    // jd-1 analysis should be cleared, jd-2 should remain
    expect(resumes[0].analysis).toBeUndefined();
    expect(resumes[0].analyses).toBeDefined();
    expect(Object.keys(resumes[0].analyses!)).not.toContain("source:job5156|analysis:jd-1");
    expect(Object.keys(resumes[0].analyses!)).toContain("source:seek|analysis:jd-2");
  });

  it("skips resumes without analysis", async () => {
    const t = createTest();

    // Insert a resume without analysis
    _resumeCounter += 1;
    const resumeId = await t.run(async (ctx) => {
      return ctx.db.insert("resumes", {
        externalId: `ext-${_resumeCounter}`,
        content: { name: "No Analysis" },
        hash: `hash-${_resumeCounter}`,
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "51job",
      });
    });

    const result = await t.mutation(api.resumes.clearAnalyses, {
      resumeIds: [resumeId],
    });

    expect(result.cleared).toBe(0);
  });

  it("paginates full-table clear for large datasets", async () => {
    const t = createTest();

    // Insert 3 resumes with analysis
    for (let i = 0; i < 3; i++) {
      await insertResumeWithAnalysis(t);
    }

    const result = await t.mutation(api.resumes.clearAnalyses, {
      batchSize: 2,
    });

    // First batch clears up to 2
    expect(result.cleared).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).not.toBeNull();
  });
});
