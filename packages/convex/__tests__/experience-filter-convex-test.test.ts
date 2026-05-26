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


// Helper: insert a resume for filter testing
let _counter = 0;
async function insertResume(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  _counter += 1;
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
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
  });
}

describe("minExperience filter graceful degradation", () => {
  it("resumes with empty experience pass minExperience filter", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Alice", experience: "" },
      searchText: "cnc sales malaysia",
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
      minExperience: 1,
    });

    // Empty experience is unknown, so minExperience filter is skipped (graceful degradation)
    expect(result.page.length).toBeGreaterThanOrEqual(1);
  });

  it("resumes with unparseable experience pass minExperience filter", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Bob", experience: "?" },
      searchText: "cnc sales malaysia",
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
      minExperience: 1,
    });

    expect(result.page.length).toBeGreaterThanOrEqual(1);
  });

  it("resumes with unknown experience are excluded by maxExperience", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Carol", experience: "" },
      searchText: "cnc sales malaysia",
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
      maxExperience: 5,
    });

    // Unknown experience + maxExperience → excluded (cannot guarantee cap)
    expect(result.page).toHaveLength(0);
  });

  it("resumes with known high experience pass minExperience", async () => {
    const t = createTest();

    await insertResume(t, {
      content: { name: "Dave", experience: "5" },
      searchText: "cnc sales china",
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
      minExperience: 1,
    });

    expect(result.page.length).toBeGreaterThanOrEqual(1);
  });
});

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

describe("experience from workHistory date ranges", () => {
  it("resumes with empty experience but workHistory dates pass minExperience filter", async () => {
    const t = createTest();

    await insertResume(t, {
      content: {
        name: "Iris",
        experience: "",
        workHistory: [
          { companyName: "Acme Co", jobTitle: "Sales Manager", startDate: "2018-01", endDate: "2023-06" },
        ],
      },
      searchText: "iris sales manager cnc malaysia",
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
      minExperience: 3,
    });

    // ~5 years computed from dates, meets minExperience: 3
    expect(result.page.length).toBeGreaterThanOrEqual(1);
  });

  it("resumes with short workHistory dates are excluded by minExperience", async () => {
    const t = createTest();

    await insertResume(t, {
      content: {
        name: "Jack",
        experience: "",
        workHistory: [
          { companyName: "Startup", jobTitle: "Junior Sales", startDate: "2024-01", endDate: "2025-01" },
        ],
      },
      searchText: "jack junior sales cnc malaysia",
      ingestData: {
        industryTags: ["cnc", "sales"],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "junior",
        computedAt: 1,
        skillsVersion: 1,
        ruleScores: {},
      },
    });

    const result = await t.query(api.resumes_search.searchWithTagExpansionPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      query: "cnc sales",
      keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
      minExperience: 3,
    });

    // ~1 year computed, below minExperience: 3 → excluded
    expect(result.page).toHaveLength(0);
  });

  it("resumes with empty experience and no parseable workHistory dates still pass minExperience", async () => {
    const t = createTest();

    await insertResume(t, {
      content: {
        name: "Kate",
        experience: "",
        workHistory: [
          { companyName: "Old Co", jobTitle: "Sales", years: "?" },
        ],
      },
      searchText: "kate sales cnc malaysia",
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
      minExperience: 1,
    });

    // No date ranges → experience unknown → graceful degradation, passes
    expect(result.page.length).toBeGreaterThanOrEqual(1);
  });
});
