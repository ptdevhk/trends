/**
 * Integration tests for backfillIngestData migration using convex-test.
 *
 * Replaces migrations-batching.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";


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
      sourceKey: "51job",
      ...overrides,
    });
  });
}

describe("migration: backfillIngestData", () => {
  it("schedules only unprocessed resumes and returns the next cursor", async () => {
    const t = createTest();

    // Insert 2 resumes: one without ingestData (unprocessed), one with (already processed)
    await insertResume(t); // No ingestData — should be scheduled
    await insertResume(t, {
      ingestData: {
        evidenceText: "already processed",
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        ruleScores: {},
        experienceLevel: "unknown",
        computedAt: 1,
        skillsVersion: 1,
      },
      primaryRuleScore: 0,
      searchText: "",
    });

    const result = await t.action(api.migrations.backfillIngestData, {
      limit: 100,
    });

    // The unprocessed resume should be scheduled
    expect(result.scheduled).toBe(1);
    expect(result.batches).toBe(1);
    expect(result.scannedResumes).toBe(2);
    // Small dataset fits in one batch — no more pages
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });

  it("returns zero scheduled when all resumes are already processed", async () => {
    const t = createTest();

    await insertResume(t, {
      ingestData: {
        evidenceText: "done",
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        ruleScores: {},
        experienceLevel: "mid",
        computedAt: Date.now(),
        skillsVersion: 1,
      },
      primaryRuleScore: 50,
      searchText: "indexed",
    });

    const result = await t.action(api.migrations.backfillIngestData, {
      limit: 100,
    });

    expect(result.scheduled).toBe(0);
    expect(result.batches).toBe(0);
    expect(result.scannedResumes).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it("returns zero scheduled when no resumes exist", async () => {
    const t = createTest();

    const result = await t.action(api.migrations.backfillIngestData, {
      limit: 100,
    });

    expect(result.scheduled).toBe(0);
    expect(result.batches).toBe(0);
    expect(result.scannedResumes).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });
});
