/**
 * Integration tests for resume hard-reset and clear-analyses using convex-test.
 *
 * Replaces the hand-crafted mock test (resumes-hard-reset.test.ts)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";


// Helper: insert a minimal resume document
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
      sourceKey: "51job",
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// hardResetIngestData
// ---------------------------------------------------------------------------

describe("resumes: hardResetIngestData", () => {
  it("clears computed ingest and analysis fields while preserving raw data", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Alice" },
      ingestData: {
        evidenceText: "computed",
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        ruleScores: {},
        experienceLevel: "unknown",
        computedAt: Date.now(),
        skillsVersion: 1,
      },
      analysis: {
        score: 88,
        summary: "summary",
        highlights: [],
        recommendation: "yes",
      },
      primaryRuleScore: 88,
      searchText: "alice sales",
    });

    const result = await t.mutation(api.resumes.hardResetIngestData, {});

    expect(result.cleared).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();

    // Verify raw fields are preserved, computed fields are cleared
    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });

    expect(resumes[0].content).toEqual({ name: "Alice" });
    expect(resumes[0].ingestData).toBeUndefined();
    expect(resumes[0].analysis).toBeUndefined();
    expect(resumes[0].primaryRuleScore).toBeUndefined();
    expect(resumes[0].searchText).toBeUndefined();
  });

  it("skips resumes without computed fields", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Bob" },
    });

    const result = await t.mutation(api.resumes.hardResetIngestData, {});

    expect(result.cleared).toBe(0);
  });

  it("processes multiple resumes in a batch", async () => {
    const t = createTest();

    // Insert one with computed fields, one without
    await insertResume(t, {
      content: { name: "With Data" },
      ingestData: {
        evidenceText: "computed",
        industryTags: ["software"],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        ruleScores: {},
        experienceLevel: "senior",
        computedAt: Date.now(),
        skillsVersion: 1,
      },
      primaryRuleScore: 50,
      searchText: "with data search",
    });

    await insertResume(t, {
      content: { name: "Without Data" },
    });

    const result = await t.mutation(api.resumes.hardResetIngestData, {});

    expect(result.cleared).toBe(1);
  });

  it("returns hasMore: true when there are more resumes than batch size", async () => {
    const t = createTest();

    // Insert enough resumes to exceed a small batch
    for (let i = 0; i < 3; i++) {
      await insertResume(t, {
        content: { name: `Resume ${i}` },
        primaryRuleScore: i * 10,
        searchText: `search ${i}`,
      });
    }

    const result = await t.mutation(api.resumes.hardResetIngestData, {
      batchSize: 2,
    });

    // With 3 resumes and batch size 2, there should be more
    expect(result.cleared).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clearAnalyses
// ---------------------------------------------------------------------------

describe("resumes: clearAnalyses", () => {
  it("clears analysis and analyses fields on specified resumes", async () => {
    const t = createTest();

    const resumeId = await insertResume(t, {
      content: { name: "Analyzed" },
      analysis: {
        score: 85,
        summary: "good candidate",
        highlights: ["experienced"],
        recommendation: "yes",
      },
      analyses: {
        default: { score: 85 },
      },
    });

    await t.mutation(api.resumes.clearAnalyses, {
      resumeIds: [resumeId],
    });

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });

    expect(resumes[0].analysis).toBeUndefined();
    expect(resumes[0].analyses).toBeUndefined();
    // Other fields preserved
    expect(resumes[0].content).toEqual({ name: "Analyzed" });
  });

  it("handles resumes without analysis gracefully", async () => {
    const t = createTest();

    const resumeId = await insertResume(t, {
      content: { name: "No Analysis" },
    });

    // Should not throw
    await t.mutation(api.resumes.clearAnalyses, {
      resumeIds: [resumeId],
    });

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });

    expect(resumes[0].content).toEqual({ name: "No Analysis" });
  });
});
