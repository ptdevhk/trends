import { describe, expect, it } from "vitest";

import { listWithIngestDataPaginated } from "../resumes";

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

function buildResumeDoc(id: string, primaryRuleScore: number) {
  return {
    _id: id,
    externalId: `test:${id}`,
    source: "test",
    tags: [],
    crawledAt: Date.now(),
    content: { name: id },
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
    expect(result.page).toEqual([resumeA, resumeB]);
    expect(result.continueCursor).toBe("cursor-next");
    expect(result.isDone).toBe(false);
  });

  it("falls back to offset/overfetch path when jobDescriptionId is set", async () => {
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

    expect(paginateCalled).toBe(false);
    expect(takeCalled).toBe(true);
    expect(result.page.length).toBeLessThanOrEqual(10);
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

  it("uses native paginate() with post-filtering when resume filters are set", async () => {
    let paginateCalled = false;
    let takeCalled = false;

    const resumeA = { ...buildResumeDoc("resume-a", 90), content: { name: "Alice", location: "东莞" } };
    const resumeB = { ...buildResumeDoc("resume-b", 80), content: { name: "Bob", location: "深圳" } };

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => ({
              paginate: async () => {
                paginateCalled = true;
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
    expect(result.page).toHaveLength(1);
    expect((result.page[0] as { content: { name: string } }).content.name).toBe("Alice");
    expect(result.continueCursor).toBe("cursor-next");
  });
});
