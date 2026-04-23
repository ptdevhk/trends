import { describe, expect, it } from "vitest";

import { getResumeDetail, listWithIngestDataPaginated, searchWithTagExpansionPaginated } from "../resumes";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type PaginatedArgs = {
  paginationOpts: { cursor: string | null; numItems: number };
  jobDescriptionId?: string;
  sortBy?: "name" | "experience" | "extractedAt";
  sortOrder?: "asc" | "desc";
  minExperience?: number;
  maxExperience?: number;
  minRoleYears?: number;
  roleFilterType?: string;
  minAge?: number;
  maxAge?: number;
  education?: string[];
  skills?: string[];
  locations?: string[];
  minSalary?: number;
  maxSalary?: number;
};

type PaginatedResult = {
  page: unknown[];
  continueCursor: string;
  isDone: boolean;
};

type SearchPaginatedArgs = {
  paginationOpts: { cursor: string | null; numItems: number };
  query: string;
  keywordGroups: Array<{ original: string; variants: string[] }>;
  mode?: "AND" | "OR";
  sourceMappings?: Array<{ term: string; expandedFrom: string }>;
  jobDescriptionId?: string;
  sortBy?: "name" | "experience" | "extractedAt";
  sortOrder?: "asc" | "desc";
  minExperience?: number;
  maxExperience?: number;
  minRoleYears?: number;
  roleFilterType?: string;
  minAge?: number;
  maxAge?: number;
  education?: string[];
  skills?: string[];
  requiredKeywords?: string[];
  locations?: string[];
  minSalary?: number;
  maxSalary?: number;
};

type SearchPaginatedResult = {
  page: unknown[];
  continueCursor: string;
  isDone: boolean;
};

const handler = (
  listWithIngestDataPaginated as unknown as ConvexHandler<PaginatedArgs, PaginatedResult>
)._handler;
const searchPaginatedHandler = (
  searchWithTagExpansionPaginated as unknown as ConvexHandler<SearchPaginatedArgs, SearchPaginatedResult>
)._handler;
const getResumeDetailHandler = (
  getResumeDetail as unknown as ConvexHandler<{ resumeId: string }, unknown>
)._handler;

function buildResumeDoc(id: string, primaryRuleScore: number, ruleScores?: Record<string, number>) {
  return {
    _id: id,
    externalId: `test:${id}`,
    source: "test",
    tags: [],
    crawledAt: Date.now(),
    content: { name: id },
    ingestData: ruleScores ? {
      ruleScores,
      industryTags: [],
      experienceLevel: "mid",
      computedAt: 1,
      skillsVersion: 1,
    } : undefined,
    primaryRuleScore,
  };
}

function withFilterPassthrough(terminal: Record<string, unknown>) {
  return { ...terminal, filter: () => terminal };
}

describe("listWithIngestDataPaginated", () => {
  it("uses native paginate() for the default unfiltered path", async () => {
    let paginateCalled = false;
    let takeCalled = false;

    const resumeA = buildResumeDoc("resume-a", 90);
    const resumeB = buildResumeDoc("resume-b", 80);

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => withFilterPassthrough({
              paginate: async (opts: { cursor: string | null; numItems: number }) => {
                paginateCalled = true;
                expect(opts.numItems).toBe(10);
                return {
                  page: [resumeA, resumeB],
                  continueCursor: "cursor-next",
                  isDone: false,
                };
              },
              take: async () => {
                takeCalled = true;
                return [];
              },
            }),
          }),
        }),
      },
    };

    const result = await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(paginateCalled).toBe(true);
    expect(takeCalled).toBe(false);
    expect(result.page).toHaveLength(2);
    expect((result.page[0] as { _id: string; content: { name: string } })._id).toBe("resume-a");
    expect((result.page[0] as { content: { name: string } }).content.name).toBe("resume-a");
    expect((result.page[1] as { _id: string; content: { name: string } })._id).toBe("resume-b");
    expect((result.page[1] as { content: { name: string } }).content.name).toBe("resume-b");
    expect(result.continueCursor).toBe("cursor-next");
    expect(result.isDone).toBe(false);
  });

  it("uses native paginate() for JD-only requests to avoid large overfetch scans", async () => {
    let paginateCalled = false;
    let takeCalled = false;

    const resumeA = buildResumeDoc("resume-a", 90);
    const resumeB = buildResumeDoc("resume-b", 80);

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => withFilterPassthrough({
              paginate: async () => {
                paginateCalled = true;
                return { page: [], continueCursor: "", isDone: true };
              },
              take: async () => {
                takeCalled = true;
                return [resumeA, resumeB];
              },
            }),
          }),
        }),
      },
    };

    const result = await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      jobDescriptionId: "jd-1",
    });

    expect(paginateCalled).toBe(true);
    expect(takeCalled).toBe(false);
    expect(result.page.length).toBeLessThanOrEqual(10);
  });

  it("matches canonical rule score keys when the request passes a slug jobDescriptionId", async () => {
    const lowerPrimaryHigherJd = buildResumeDoc("resume-a", 70, { "jd-lathe-sales": 88 });
    const higherPrimaryLowerJd = buildResumeDoc("resume-b", 95, { "jd-lathe-sales": 40 });

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => withFilterPassthrough({
              paginate: async () => ({
                page: [higherPrimaryLowerJd, lowerPrimaryHigherJd],
                continueCursor: "",
                isDone: true,
              }),
              take: async () => [],
            }),
          }),
        }),
      },
    };

    const result = await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      jobDescriptionId: "lathe-sales",
    });

    expect((result.page[0] as { _id: string })._id).toBe("resume-a");
    expect((result.page[1] as { _id: string })._id).toBe("resume-b");
  });

  it("falls back to offset/overfetch path when sortBy is set", async () => {
    let paginateCalled = false;
    let takeCalled = false;

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => withFilterPassthrough({
              paginate: async () => {
                paginateCalled = true;
                return { page: [], continueCursor: "", isDone: true };
              },
              take: async () => {
                takeCalled = true;
                return [buildResumeDoc("resume-a", 90)];
              },
            }),
          }),
        }),
      },
    };

    await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      sortBy: "name",
    });

    expect(paginateCalled).toBe(false);
    expect(takeCalled).toBe(true);
  });

  it("uses native paginate() with overfetch when resume filters are set", async () => {
    let paginateCalled = false;
    let paginateNumItems = 0;
    let takeCalled = false;

    const resumeA = { ...buildResumeDoc("resume-a", 90), content: { name: "Alice", location: "东莞" } };
    const resumeB = { ...buildResumeDoc("resume-b", 80), content: { name: "Bob", location: "深圳" } };

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => withFilterPassthrough({
              paginate: async (opts: { numItems: number }) => {
                paginateCalled = true;
                paginateNumItems = opts.numItems;
                return {
                  page: [resumeA, resumeB],
                  continueCursor: "cursor-next",
                  isDone: false,
                };
              },
              take: async () => {
                takeCalled = true;
                return [];
              },
            }),
          }),
        }),
      },
    };

    const result = await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      locations: ["东莞"],
    });

    expect(paginateCalled).toBe(true);
    expect(takeCalled).toBe(false);
    expect(paginateNumItems).toBeGreaterThan(10);
    expect(result.page).toHaveLength(1);
    expect((result.page[0] as { content: { name: string } }).content.name).toBe("Alice");
    expect(result.continueCursor).toBe("cursor-next");
  });

  it("filters by minRoleYears for the requested role type", async () => {
    const resumeA = {
      ...buildResumeDoc("resume-a", 90),
      content: { name: "Alice" },
      ingestData: {
        ruleScores: {},
        industryTags: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 1,
            years: 6.2,
            roleRelevantYears: 6.2,
            verifyIn: "workHistory",
          },
        ],
      },
    };
    const resumeB = {
      ...buildResumeDoc("resume-b", 80),
      content: { name: "Bob" },
      ingestData: {
        ruleScores: {},
        industryTags: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 1,
            years: 3.1,
            roleRelevantYears: 3.1,
            verifyIn: "workHistory",
          },
          {
            type: "engineer",
            matchedSignals: ["工程师"],
            signalCount: 1,
            occurrences: 1,
            years: 8.5,
            roleRelevantYears: 8.5,
            verifyIn: "workHistory",
          },
        ],
      },
    };

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => withFilterPassthrough({
              paginate: async () => ({
                page: [resumeA, resumeB],
                continueCursor: "cursor-next",
                isDone: false,
              }),
              take: async () => [],
            }),
          }),
        }),
      },
    };

    const result = await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      minRoleYears: 5,
      roleFilterType: "sales",
    });

    expect(result.page).toHaveLength(1);
    expect((result.page[0] as { content: { name: string } }).content.name).toBe("Alice");
  });

  it("filters by strict direct-sales years when matched work-entry metadata is present", async () => {
    const resumeDirect = {
      ...buildResumeDoc("resume-direct", 90),
      content: { name: "Direct Sales" },
      ingestData: {
        ruleScores: {},
        industryTags: [],
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
    };
    const resumeSupportOnly = {
      ...buildResumeDoc("resume-support", 80),
      content: { name: "Support Engineer" },
      ingestData: {
        ruleScores: {},
        industryTags: [],
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
    };

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => withFilterPassthrough({
              paginate: async () => ({
                page: [resumeDirect, resumeSupportOnly],
                continueCursor: "cursor-next",
                isDone: false,
              }),
              take: async () => [],
            }),
          }),
        }),
      },
    };

    const result = await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      minRoleYears: 10,
      roleFilterType: "sales",
    });

    expect(result.page).toHaveLength(1);
    expect((result.page[0] as { content: { name: string } }).content.name).toBe("Direct Sales");
  });

  it("filters by minAge/maxAge on stored numeric age and content age", async () => {
    const withinStoredAge = {
      ...buildResumeDoc("resume-stored-age", 90),
      age: 32,
      content: { name: "Stored Age" },
    };
    const withinContentAge = {
      ...buildResumeDoc("resume-content-age", 80),
      content: { name: "Content Age", age: "35岁" },
    };
    const outsideAge = {
      ...buildResumeDoc("resume-outside-age", 70),
      age: 46,
      content: { name: "Outside Age" },
    };
    const missingAge = {
      ...buildResumeDoc("resume-missing-age", 60),
      content: { name: "Missing Age" },
    };

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => withFilterPassthrough({
              paginate: async () => ({
                page: [withinStoredAge, withinContentAge, outsideAge, missingAge],
                continueCursor: "cursor-next",
                isDone: false,
              }),
              take: async () => [],
            }),
          }),
        }),
      },
    };

    const result = await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      minAge: 25,
      maxAge: 40,
    });

    expect(result.page).toHaveLength(2);
    expect((result.page[0] as { content: { name: string } }).content.name).toBe("Stored Age");
    expect((result.page[1] as { content: { name: string } }).content.name).toBe("Content Age");
  });
});

describe("getResumeDetail", () => {
  it("projects only the shared latest three work history entries", async () => {
    const resume = {
      _id: "resume-1",
      externalId: "test:resume-1",
      source: "test",
      tags: [],
      crawledAt: Date.now(),
      content: {
        name: "Alice",
        workHistory: [
          { companyName: "Oldest Co", jobTitle: "Oldest Role", startDate: "2018-01", endDate: "2019-01", raw: "Oldest raw" },
          { companyName: "Recent Co", jobTitle: "Recent Role", startDate: "2023-01", endDate: "2024-01", raw: "Recent raw" },
          { companyName: "Current Co", jobTitle: "Current Role", startDate: "2024-02", endDate: "至今", raw: "Current raw" },
          { companyName: "Middle Co", jobTitle: "Middle Role", startDate: "2021-01", endDate: "2022-01", raw: "Middle raw" },
        ],
      },
    };

    const result = await getResumeDetailHandler({
      db: {
        get: async () => resume,
      },
    }, {
      resumeId: "resume-1",
    });

    expect(result).toEqual(expect.objectContaining({
      content: expect.objectContaining({
        workHistory: [
          expect.objectContaining({ companyName: "Current Co", jobTitle: "Current Role" }),
          expect.objectContaining({ companyName: "Recent Co", jobTitle: "Recent Role" }),
          expect.objectContaining({ companyName: "Middle Co", jobTitle: "Middle Role" }),
        ],
      }),
    }));
    expect((result as { content: { workHistory: Array<{ companyName?: string }> } }).content.workHistory).toHaveLength(3);
    expect((result as { content: { workHistory: Array<{ companyName?: string }> } }).content.workHistory.some((entry) => entry.companyName === "Oldest Co")).toBe(false);
  });
});

describe("searchWithTagExpansionPaginated", () => {
  it("keeps the native search cursor open when the first filtered page is sparse", async () => {
    const matchingResumeA = {
      ...buildResumeDoc("resume-a", 90),
      age: 30,
      searchText: "cnc 销售 china",
      content: { name: "Resume A", location: "China" },
      ingestData: {
        ruleScores: {},
        industryTags: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
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
    };
    const nonMatchingResume = {
      ...buildResumeDoc("resume-b", 80),
      age: 45,
      searchText: "cnc 销售 china",
      content: { name: "Resume B", location: "China" },
      ingestData: {
        ruleScores: {},
        industryTags: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
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
    };
    const matchingResumeC = {
      ...buildResumeDoc("resume-c", 70),
      age: 34,
      searchText: "cnc 销售 china",
      content: { name: "Resume C", location: "China" },
      ingestData: {
        ruleScores: {},
        industryTags: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 1,
            years: 6,
            roleRelevantYears: 6,
            verifyIn: "workHistory",
            matchedWorkEntries: [
              {
                jobTitle: "销售工程师",
                years: 6,
                industryVerified: true,
                matchedSignals: ["销售"],
                directRoleMatch: true,
              },
            ],
          },
        ],
      },
    };
    const matchingResumeD = {
      ...buildResumeDoc("resume-d", 60),
      age: 38,
      searchText: "cnc 销售 china",
      content: { name: "Resume D", location: "China" },
      ingestData: {
        ruleScores: {},
        industryTags: [],
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售"],
            signalCount: 1,
            occurrences: 1,
            years: 7,
            roleRelevantYears: 7,
            verifyIn: "workHistory",
            matchedWorkEntries: [
              {
                jobTitle: "区域销售",
                years: 7,
                industryVerified: true,
                matchedSignals: ["销售"],
                directRoleMatch: true,
              },
            ],
          },
        ],
      },
    };

    const ctx = {
      db: {
        query: () => ({
          withSearchIndex: () => ({
            filter: () => ({
              take: async () => [matchingResumeA, nonMatchingResume],
              paginate: async (opts: { cursor: string | null; numItems: number }) => {
                if (opts.cursor) {
                  return {
                    page: [matchingResumeC, matchingResumeD],
                    continueCursor: "",
                    isDone: true,
                  };
                }
                return {
                  page: [matchingResumeA, nonMatchingResume],
                  continueCursor: "cursor-next",
                  isDone: false,
                };
              },
            }),
          }),
        }),
      },
    };

    const result = await searchPaginatedHandler(ctx, {
      paginationOpts: { cursor: null, numItems: 2 },
      query: "CNC 销售",
      keywordGroups: [
        { original: "cnc", variants: ["cnc"] },
        { original: "销售", variants: ["销售"] },
      ],
      mode: "AND",
      sourceMappings: [
        { term: "cnc", expandedFrom: "cnc" },
        { term: "销售", expandedFrom: "销售" },
      ],
      minRoleYears: 0,
      roleFilterType: "sales",
      minAge: 25,
      maxAge: 40,
      locations: ["China"],
    });

    expect(result.page).toHaveLength(1);
    expect((result.page[0] as { resume: { _id: string } }).resume._id).toBe("resume-a");
    expect(result.continueCursor).toBe("cursor-next");
    expect(result.isDone).toBe(false);
  });
});
