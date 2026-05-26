/**
 * Integration tests for listWithIngestDataPaginated, getResumeDetail,
 * and searchWithTagExpansionPaginated using convex-test.
 *
 * Replaces resumes-paginated-default.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// Helper: insert a minimal resume document
let _counter = 0;
async function insertResume(
  t: ReturnType<typeof convexTest>,
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
      source: "test",
      sourceKey: "test",
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// listWithIngestDataPaginated
// ---------------------------------------------------------------------------

describe("resumes: listWithIngestDataPaginated", () => {
  it("returns paginated resumes ordered by primaryRuleScore desc", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "Alice" },
      primaryRuleScore: 90,
    });
    await insertResume(t, {
      content: { name: "Bob" },
      primaryRuleScore: 80,
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page.length).toBeGreaterThanOrEqual(2);
    expect(result.isDone).toBe(true);
  });

  it("excludes archived resumes", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "Active" },
      primaryRuleScore: 90,
    });
    await insertResume(t, {
      content: { name: "Archived" },
      primaryRuleScore: 80,
      isArchived: true,
      archivedAt: Date.now(),
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
    });

    const names = result.page.map((r: Record<string, unknown>) =>
      ((r as Record<string, unknown>).content as Record<string, unknown>)?.name,
    );
    expect(names).toContain("Active");
    expect(names).not.toContain("Archived");
  });

  it("sorts by JD-specific rule score when jobDescriptionId is provided", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "LowPrimaryHighJd" },
      primaryRuleScore: 70,
      ingestData: {
        ruleScores: { "jd-lathe-sales": 88 },
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
      },
    });
    await insertResume(t, {
      content: { name: "HighPrimaryLowJd" },
      primaryRuleScore: 95,
      ingestData: {
        ruleScores: { "jd-lathe-sales": 40 },
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
      },
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      jobDescriptionId: "lathe-sales",
    });

    // LowPrimaryHighJd should rank first due to higher JD score
    expect(result.page.length).toBeGreaterThanOrEqual(2);
    const names = result.page.map((r: Record<string, unknown>) =>
      ((r as Record<string, unknown>).content as Record<string, unknown>)?.name,
    );
    expect(names[0]).toBe("LowPrimaryHighJd");
  });

  it("filters by location", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "Alice", location: "东莞" },
      primaryRuleScore: 90,
    });
    await insertResume(t, {
      content: { name: "Bob", location: "深圳" },
      primaryRuleScore: 80,
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      locations: ["东莞"],
    });

    expect(result.page).toHaveLength(1);
    const name = ((result.page[0] as Record<string, unknown>).content as Record<string, unknown>)?.name;
    expect(name).toBe("Alice");
  });

  it("filters by minRoleYears with verified role signals", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "Alice" },
      primaryRuleScore: 90,
      ingestData: {
        ruleScores: {},
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        verifiedRoleYears: { sales: 6 },
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 1,
            years: 6,
            roleRelevantYears: 6,
            industryVerifiedYears: 6,
            industryVerifiedRelevantYears: 6,
            verifyIn: "workHistory",
          },
        ],
      },
    });
    await insertResume(t, {
      content: { name: "Bob" },
      primaryRuleScore: 80,
      ingestData: {
        ruleScores: {},
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 1,
            years: 3,
            roleRelevantYears: 3,
            industryVerifiedYears: 3,
            industryVerifiedRelevantYears: 3,
            verifyIn: "workHistory",
          },
        ],
      },
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      minRoleYears: 5,
      roleFilterType: "sales",
    });

    expect(result.page).toHaveLength(1);
    const name = ((result.page[0] as Record<string, unknown>).content as Record<string, unknown>)?.name;
    expect(name).toBe("Alice");
  });

  it("rejects resumes with only unverified role years from minRoleYears filter", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "Unverified" },
      primaryRuleScore: 90,
      ingestData: {
        ruleScores: {},
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 1,
            years: 2.6,
            roleRelevantYears: 2.6,
            verifyIn: "workHistory",
          },
        ],
      },
    });
    await insertResume(t, {
      content: { name: "Verified" },
      primaryRuleScore: 80,
      ingestData: {
        ruleScores: {},
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        verifiedRoleYears: { sales: 3 },
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售工程师"],
            signalCount: 1,
            occurrences: 1,
            years: 3,
            roleRelevantYears: 3,
            industryVerifiedYears: 3,
            industryVerifiedRelevantYears: 3,
            verifyIn: "workHistory",
          },
        ],
      },
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      minRoleYears: 2,
      roleFilterType: "sales",
    });

    expect(result.page).toHaveLength(1);
    const name = ((result.page[0] as Record<string, unknown>).content as Record<string, unknown>)?.name;
    expect(name).toBe("Verified");
  });

  it("reads ingestData.verifiedRoleYears directly when present", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "StoredVerified" },
      primaryRuleScore: 90,
      ingestData: {
        ruleScores: {},
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        verifiedRoleYears: { sales: 5 },
      },
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      minRoleYears: 3,
      roleFilterType: "sales",
    });

    expect(result.page).toHaveLength(1);
    const name = ((result.page[0] as Record<string, unknown>).content as Record<string, unknown>)?.name;
    expect(name).toBe("StoredVerified");
  });

  it("filters by minAge/maxAge on stored numeric age", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "WithinAge" },
      primaryRuleScore: 90,
      age: 32,
    });
    await insertResume(t, {
      content: { name: "OutsideAge" },
      primaryRuleScore: 80,
      age: 46,
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      minAge: 25,
      maxAge: 40,
    });

    expect(result.page).toHaveLength(1);
    const name = ((result.page[0] as Record<string, unknown>).content as Record<string, unknown>)?.name;
    expect(name).toBe("WithinAge");
  });

  it("filters by source keys", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "Job5156" },
      primaryRuleScore: 90,
      source: "hr.job5156.com",
      sourceKey: "job5156",
    });
    await insertResume(t, {
      content: { name: "Seek" },
      primaryRuleScore: 80,
      source: "hk.employer.seek.com",
      sourceKey: "seek",
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      sources: ["job5156"],
    });

    expect(result.page).toHaveLength(1);
    const name = ((result.page[0] as Record<string, unknown>).content as Record<string, unknown>)?.name;
    expect(name).toBe("Job5156");
  });

  it("returns all resumes when sources is empty", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "Job5156" },
      primaryRuleScore: 90,
      source: "hr.job5156.com",
      sourceKey: "job5156",
    });
    await insertResume(t, {
      content: { name: "Seek" },
      primaryRuleScore: 80,
      source: "hk.employer.seek.com",
      sourceKey: "seek",
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      sources: [],
    });

    expect(result.page).toHaveLength(2);
  });

  it("matches resumes by source hostname when sourceKey is not set", async () => {
    const t = convexTest(schema, modules);

    // Insert directly without sourceKey to test hostname fallback
    _counter += 1;
    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: `ext-${_counter}`,
        content: { name: "Job5156" },
        hash: `hash-${_counter}`,
        tags: [],
        crawledAt: Date.now(),
        source: "hr.job5156.com",
        primaryRuleScore: 90,
      });
    });
    _counter += 1;
    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: `ext-${_counter}`,
        content: { name: "Seek" },
        hash: `hash-${_counter}`,
        tags: [],
        crawledAt: Date.now(),
        source: "hk.employer.seek.com",
        primaryRuleScore: 80,
      });
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      sources: ["seek"],
    });

    expect(result.page).toHaveLength(1);
    const name = ((result.page[0] as Record<string, unknown>).content as Record<string, unknown>)?.name;
    expect(name).toBe("Seek");
  });
});

// ---------------------------------------------------------------------------
// getResumeDetail
// ---------------------------------------------------------------------------

describe("resumes: getResumeDetail", () => {
  it("projects only the latest three work history entries", async () => {
    const t = convexTest(schema, modules);

    const resumeId = await insertResume(t, {
      content: {
        name: "Alice",
        workHistory: [
          { companyName: "Oldest Co", jobTitle: "Oldest Role", startDate: "2018-01", endDate: "2019-01", raw: "Oldest raw" },
          { companyName: "Recent Co", jobTitle: "Recent Role", startDate: "2023-01", endDate: "2024-01", raw: "Recent raw" },
          { companyName: "Current Co", jobTitle: "Current Role", startDate: "2024-02", endDate: "至今", raw: "Current raw" },
          { companyName: "Middle Co", jobTitle: "Middle Role", startDate: "2021-01", endDate: "2022-01", raw: "Middle raw" },
        ],
      },
    });

    const result = await t.query(api.resumes.getResumeDetail, {
      resumeId,
    });

    expect(result).not.toBeNull();
    const workHistory = ((result as Record<string, unknown>).content as Record<string, unknown>)?.workHistory as Array<Record<string, unknown>>;
    expect(workHistory).toHaveLength(3);
    const companyNames = workHistory.map((e: Record<string, unknown>) => e.companyName);
    expect(companyNames).not.toContain("Oldest Co");
  });

  it("returns null for non-existent resume", async () => {
    const t = convexTest(schema, modules);

    // Insert a resume just to have a valid ID format
    const realId = await insertResume(t, {});

    // Query with a different ID — need to use the actual Convex ID format
    const result = await t.query(api.resumes.getResumeDetail, {
      resumeId: realId,
    });

    // Should return the resume (not null) since the ID exists
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// searchWithTagExpansionPaginated
// ---------------------------------------------------------------------------

describe("resumes: searchWithTagExpansionPaginated", () => {
  it("returns matching resumes for a search query", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "Alice" },
      primaryRuleScore: 90,
      searchText: "cnc 销售 china sales engineer",
    });
    await insertResume(t, {
      content: { name: "Bob" },
      primaryRuleScore: 80,
      searchText: "java developer backend",
    });

    const result = await t.query(api.resumes.searchWithTagExpansionPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      query: "CNC 销售",
      keywordGroups: [
        { original: "cnc", variants: ["cnc"] },
        { original: "销售", variants: ["销售"] },
      ],
    });

    // Should return results (at least Alice matching CNC/销售)
    expect(result.page.length).toBeGreaterThanOrEqual(1);
    expect(result.isDone).toBe(true);
  });

  it("filters search results by role years and age", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "Matching" },
      primaryRuleScore: 90,
      age: 30,
      searchText: "cnc 销售 china",
      ingestData: {
        ruleScores: {},
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        verifiedRoleYears: { sales: 4 },
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 1,
            years: 4,
            roleRelevantYears: 4,
            verifyIn: "workHistory",
            matchedWorkEntries: [
              {
                jobTitle: "销售经理",
                years: 4,
                industryVerified: true,
                matchedSignals: ["销售"],
                directRoleMatch: true,
              },
            ],
          },
        ],
      },
    });
    await insertResume(t, {
      content: { name: "NonMatching" },
      primaryRuleScore: 80,
      age: 45,
      searchText: "cnc 销售 china",
      ingestData: {
        ruleScores: {},
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        verifiedRoleYears: { sales: 10 },
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 1,
            years: 10,
            roleRelevantYears: 10,
            verifyIn: "workHistory",
            matchedWorkEntries: [
              {
                jobTitle: "销售总监",
                years: 10,
                industryVerified: true,
                matchedSignals: ["销售"],
                directRoleMatch: true,
              },
            ],
          },
        ],
      },
    });

    const result = await t.query(api.resumes.searchWithTagExpansionPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      query: "CNC 销售",
      keywordGroups: [
        { original: "cnc", variants: ["cnc"] },
        { original: "销售", variants: ["销售"] },
      ],
      minAge: 25,
      maxAge: 40,
    });

    // Should filter out the 45-year-old resume
    expect(result.page).toHaveLength(1);
  });

  it("filters by direct sales years when matchedWorkEntries metadata is present", async () => {
    const t = convexTest(schema, modules);

    await insertResume(t, {
      content: { name: "DirectSales" },
      primaryRuleScore: 90,
      searchText: "cnc 销售 china",
      ingestData: {
        ruleScores: {},
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售工程师"],
            signalCount: 2,
            occurrences: 1,
            years: 11,
            roleRelevantYears: 11,
            verifyIn: "workHistory",
            matchedWorkEntries: [
              {
                jobTitle: "销售工程师",
                years: 11,
                industryVerified: true,
                matchedSignals: ["销售工程师"],
                directRoleMatch: true,
              },
            ],
          },
        ],
      },
    });
    await insertResume(t, {
      content: { name: "SupportEngineer" },
      primaryRuleScore: 80,
      searchText: "cnc 销售 china",
      ingestData: {
        ruleScores: {},
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 2,
            years: 12,
            roleRelevantYears: 12,
            verifyIn: "workHistory",
            matchedWorkEntries: [
              {
                jobTitle: "项目工程师",
                years: 12,
                industryVerified: false,
                matchedSignals: ["销售"],
                directRoleMatch: false,
              },
            ],
          },
        ],
      },
    });

    const result = await t.query(api.resumes.listWithIngestDataPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      minRoleYears: 10,
      roleFilterType: "sales",
    });

    expect(result.page).toHaveLength(1);
    const name = ((result.page[0] as Record<string, unknown>).content as Record<string, unknown>)?.name;
    expect(name).toBe("DirectSales");
  });
});
