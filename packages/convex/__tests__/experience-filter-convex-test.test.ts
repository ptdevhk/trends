/**
 * Integration tests for experience/salary/skills filter graceful degradation
 * using convex-test.
 *
 * Replaces experience-filter-graceful-degradation.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { buildResumeDigest } from "../convex/lib/resume_digests.js";


// Helper: insert a resume for filter testing + mirror production digest upsert
let _counter = 0;
async function insertResume(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  _counter += 1;
  return t.run(async (ctx) => {
    const resumeId = await ctx.db.insert("resumes", {
      externalId: `ext-${_counter}`,
      content: { name: `User ${_counter}` },
      hash: `hash-${_counter}`,
      tags: [],
      crawledAt: Date.now(),
      source: "seek",
      sourceKey: "seek",
      primaryRuleScore: 50,
      ...overrides,
    });
    const resume = await ctx.db.get(resumeId);
    if (resume) {
      await ctx.db.insert("resume_digests", buildResumeDigest(resume, Date.now()) as any);
    }
    return resumeId;
  });
}

describe("skills filter uses full searchText", () => {
  it("matches skills from full searchText", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Eve", experience: "" },
      searchText: "eve sales fanuc cnc malaysia",
      ingestData: {
        industryTags: ["cnc", "sales"],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        ruleScores: {},
      },
    });

    const result = await t.query(api.resumes_search.searchWithTagExpansionPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      query: "cnc sales",
      keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
      skills: ["fanuc"],
    });

    // "fanuc" is in searchText → should match
    expect(result.page.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes resumes without matching skills in searchText", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Frank", experience: "" },
      searchText: "frank sales cnc malaysia",
      ingestData: {
        industryTags: ["cnc", "sales"],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        ruleScores: {},
      },
    });

    const result = await t.query(api.resumes_search.searchWithTagExpansionPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      query: "cnc sales",
      keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
      skills: ["mazak"],
    });

    // "mazak" not in searchText → excluded
    expect(result.page).toHaveLength(0);
  });
});

describe("requiredKeywords filter uses full searchText", () => {
  it("matches required keywords from full searchText", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Grace", experience: "" },
      searchText: "grace engineer machine tools cnc malaysia",
      ingestData: {
        industryTags: ["cnc"],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        ruleScores: {},
      },
    });

    const result = await t.query(api.resumes_search.searchWithTagExpansionPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      query: "cnc",
      keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
      requiredKeywords: ["machine tools"],
    });

    // "machine tools" is in searchText → should match
    expect(result.page.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes resumes missing required keywords in searchText", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Hank", experience: "" },
      searchText: "hank sales cnc malaysia",
      ingestData: {
        industryTags: ["cnc", "sales"],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        ruleScores: {},
      },
    });

    const result = await t.query(api.resumes_search.searchWithTagExpansionPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      query: "cnc sales",
      keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
      requiredKeywords: ["machine tools"],
    });

    // "machine tools" not in searchText → excluded
    expect(result.page).toHaveLength(0);
  });
});
