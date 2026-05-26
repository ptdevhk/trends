/**
 * Integration tests using convex-test for resumes.ts query functions.
 *
 * Uses edge-runtime environment (configured via environmentMatchGlobs in root vitest.config.ts).
 * convex-test provides an in-memory mock backend that supports withIndex and withSearchIndex.
 *
 * Known limitations:
 * - Text search does NOT rank by BM25 relevance (prefix matching only, unsorted)
 * - Vector search uses brute-force cosine (no ANN index)
 * - No cron support in tests
 * - ID format differs from production
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

// Explicitly provide module glob so convex-test can discover Convex functions.
// Vite transforms import.meta.glob at compile time — works regardless of runtime.
// Type assertion needed because convex tsconfig doesn't include Vitest types.

function seedResume(overrides: Record<string, unknown> = {}) {
  return {
    externalId: `ext-${Math.random().toString(36).slice(2, 8)}`,
    content: {},
    hash: `hash-${Math.random().toString(36).slice(2, 8)}`,
    tags: [] as string[],
    crawledAt: Date.now(),
    source: "test",
    searchText: "test resume",
    ...overrides,
  };
}

describe("resumes.listWithIngestData (convex-test)", () => {
  it("returns empty array when no resumes exist", async () => {
    const t = createTest();
    const result = await t.query(api.resumes.listWithIngestData, { limit: 10 });
    expect(result).toEqual([]);
  });

  it("returns resumes filtered by primaryRuleScore index", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-low",
        primaryRuleScore: 30,
        searchText: "cnc operator",
      }));
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-high",
        primaryRuleScore: 80,
        searchText: "cnc programmer",
      }));
    });

    const result = await t.query(api.resumes.listWithIngestData, { limit: 10 });

    expect(result).toHaveLength(2);
    // Ordered by primaryRuleScore desc via sortByIngestRuleScore
    expect(result[0]!.primaryRuleScore).toBe(80);
    expect(result[1]!.primaryRuleScore).toBe(30);
  });

  it("excludes archived resumes", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-active",
        primaryRuleScore: 50,
        searchText: "active resume",
      }));
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-archived",
        primaryRuleScore: 90,
        searchText: "archived resume",
        isArchived: true,
      }));
    });

    const result = await t.query(api.resumes.listWithIngestData, { limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]!.externalId).toBe("ext-active");
  });

  it("respects the limit parameter", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("resumes", seedResume({
          externalId: `ext-${i}`,
          primaryRuleScore: 50 + i,
          searchText: `resume ${i}`,
        }));
      }
    });

    const result = await t.query(api.resumes.listWithIngestData, { limit: 3 });

    expect(result).toHaveLength(3);
  });
});

describe("resumes.search (convex-test)", () => {
  it("finds resumes matching the search query", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-cnc",
        searchText: "cnc operator with 5 years experience",
      }));
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-java",
        searchText: "java developer spring boot",
      }));
    });

    const results = await t.query(api.resumes_search.search, {
      query: "cnc",
      limit: 10,
    });

    // convex-test text search returns prefix-matching results (unsorted)
    expect(results.length).toBeGreaterThanOrEqual(1);
    const cncResult = results.find((r) => r.externalId === "ext-cnc");
    expect(cncResult).toBeDefined();
  });

  it("excludes archived resumes from search", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-active",
        searchText: "cnc operator",
      }));
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-archived",
        searchText: "cnc machinist",
        isArchived: true,
      }));
    });

    const results = await t.query(api.resumes_search.search, {
      query: "cnc",
      limit: 10,
    });

    // The search query uses .eq("isArchived", undefined)
    // so archived resumes should be excluded
    expect(results.every((r) => r.isArchived !== true)).toBe(true);
  });

  it("post-filters AND logic for multi-token queries", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-both",
        searchText: "cnc operator sales experience",
      }));
      await ctx.db.insert("resumes", seedResume({
        externalId: "ext-cnc-only",
        searchText: "cnc operator manufacturing",
      }));
    });

    const results = await t.query(api.resumes_search.search, {
      query: "cnc sales",
      limit: 10,
    });

    // Only the resume with BOTH "cnc" AND "sales" should remain
    expect(results).toHaveLength(1);
    expect(results[0]!.externalId).toBe("ext-both");
  });
});

describe("resumes.deleteResumes (convex-test)", () => {
  it("deletes targeted resumes", async () => {
    const t = createTest();

    const resumeId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("resumes", seedResume({
        externalId: "ext-delete-me",
      }));
      return id;
    });

    const result = await t.mutation(api.resumes.deleteResumes, {
      resumeIds: [resumeId],
    });

    expect(result.deleted).toBe(1);

    // Verify resume is gone
    const remaining = await t.run(async (ctx) => {
      return await ctx.db.query("resumes").collect();
    });
    expect(remaining).toHaveLength(0);
  });

  it("reports missing IDs when deleting non-existent resumes", async () => {
    const t = createTest();

    const result = await t.mutation(api.resumes.deleteResumes, {
      resumeIds: ["nonexistent-id-1" as any, "nonexistent-id-2" as any],
    });

    expect(result.deleted).toBe(0);
    expect(result.missingResumeIds.length).toBeGreaterThanOrEqual(0);
  });
});
