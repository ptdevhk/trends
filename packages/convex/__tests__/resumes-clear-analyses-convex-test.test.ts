/**
 * Integration tests for clearAnalyses using convex-test.
 *
 * Replaces resumes-clear-analyses.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest, seedResumeAnalysesColdRow, getResumeAnalysesColdRow } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";


// Helper: insert a minimal resume document with analysis
let _resumeCounter = 0;
const fixtureAnalysis = {
  score: 88,
  summary: "Good candidate",
  highlights: ["experienced"],
  recommendation: "yes",
  jobDescriptionId: "jd-1",
};
const fixtureAnalyses = {
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
};
async function insertResumeWithAnalysis(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  _resumeCounter += 1;
  const resumeId = await t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `ext-${_resumeCounter}`,
      content: { name: "Test User" },
      hash: `hash-${_resumeCounter}`,
      tags: [],
      crawledAt: Date.now(),
      source: "test",
      sourceKey: "51job",
      analysis: fixtureAnalysis,
      analyses: fixtureAnalyses,
      ...overrides,
    });
  });
  // Phase 4 Step 3a: analysis/analyses are cold-authoritative now. Mirror the
  // fixture onto the cold resume_analyses row so clearAnalyses (which reads +
  // archives the cold row) has something to act on.
  await seedResumeAnalysesColdRow(t, resumeId, {
    analysis: fixtureAnalysis,
    analyses: fixtureAnalyses,
  });
  return resumeId;
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

    // Phase 4 Step 3a: a non-surgical clear archives the cold row (it does
    // NOT null the hot doc fields anymore). Assert the cold row is archived.
    const coldRow = await getResumeAnalysesColdRow(t, resumeId);
    expect(coldRow).not.toBeNull();
    expect(coldRow?.status).toBe("archived");
  });

  it("clears only analyses matching jobDescriptionId", async () => {
    const t = createTest();

    const resumeId = await insertResumeWithAnalysis(t);

    const result = await t.mutation(api.resumes.clearAnalyses, {
      resumeIds: [resumeId],
      jobDescriptionId: "jd-1",
    });

    expect(result.cleared).toBe(1);

    // Phase 4 Step 3a: surgical (jobDescriptionId) clear removes the matching
    // key from the cold analyses map and nulls the current analysis when it
    // matches the JD. jd-2 remains; the row stays active.
    const coldRow = await getResumeAnalysesColdRow(t, resumeId);
    expect(coldRow).not.toBeNull();
    expect(coldRow?.analysis).toBeUndefined();
    expect(coldRow?.analyses).toBeDefined();
    expect(Object.keys(coldRow?.analyses ?? {})).not.toContain("source:job5156|analysis:jd-1");
    expect(Object.keys(coldRow?.analyses ?? {})).toContain("source:seek|analysis:jd-2");
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
