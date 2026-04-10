import { describe, expect, it } from "vitest";

import { getResumeDetail, listWithIngestDataPaginated } from "../resumes";

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

const handler = (
  listWithIngestDataPaginated as unknown as ConvexHandler<PaginatedArgs, PaginatedResult>
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
            order: () => ({
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
            order: () => ({
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
            order: () => ({
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
            order: () => ({
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
            order: () => ({
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
