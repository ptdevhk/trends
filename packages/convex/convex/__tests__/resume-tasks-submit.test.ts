import { describe, expect, it, vi } from "vitest";

import { submitResumes } from "../resume_tasks";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const submitResumesHandler = (submitResumes as unknown as ConvexHandler<
  {
    resumes: Array<{
      externalId: string
      content: Record<string, unknown>
      hash: string
      source: string
      tags: string[]
      restoreState?: {
        crawledAt?: number
        searchText?: string
        primaryRuleScore?: number
        ingestData?: unknown
        analysis?: unknown
        analyses?: unknown
      }
    }>
  },
  {
    input: number
    submitted: number
    deduped: number
    identityDeduped: number
    identityMatched: number
    inserted: number
    updated: number
    unchanged: number
  }
>)._handler;

describe("submitResumes", () => {
  it("preserves restore state and skips ingest scheduling for restored resumes", async () => {
    const inserts: Array<{ tableName: string; value: Record<string, unknown> }> = [];
    const scheduler = {
      runAfter: vi.fn(async () => undefined),
    };

    const ctx = {
      db: {
        query(tableName: string) {
          if (tableName === "resumes") {
            return {
              withIndex() {
                return {
                  async unique() {
                    return null;
                  },
                };
              },
            };
          }

          if (tableName === "sync_events") {
            return {
              withIndex() {
                return {
                  async take() {
                    return [];
                  },
                };
              },
            };
          }

          throw new Error(`Unexpected table query: ${tableName}`);
        },
        async insert(tableName: string, value: Record<string, unknown>) {
          inserts.push({ tableName, value });
          return tableName === "resumes" ? "resume-1" : "sync-1";
        },
        async patch() {
          throw new Error("patch should not be called in insert test");
        },
        async delete() {
          throw new Error("delete should not be called in insert test");
        },
      },
      scheduler,
    };

    const result = await submitResumesHandler(ctx as never, {
      resumes: [{
        externalId: "hr.job5156.com:resume:1001",
        content: {
          resumeId: "1001",
          name: "Alice",
          location: "东莞",
        },
        hash: "hash-1",
        source: "hr.job5156.com",
        tags: ["sales"],
        restoreState: {
          crawledAt: 1763942400000,
          searchText: "alice sales dongguan",
          primaryRuleScore: 91,
          ingestData: {
            industryTags: ["machine tools"],
          },
          analysis: {
            score: 88,
          },
          analyses: {
            "source:job5156|analysis:lathe-sales": { score: 88 },
          },
        },
      }],
    });

    const resumeInsert = inserts.find((item) => item.tableName === "resumes");
    expect(resumeInsert?.value).toMatchObject({
      externalId: "hr.job5156.com:resume:1001",
      identityKey: expect.any(String),
      content: {
        resumeId: "1001",
        name: "Alice",
        location: "东莞",
      },
      hash: "hash-1",
      searchText: "alice sales dongguan",
      tags: ["sales"],
      source: "hr.job5156.com",
      crawledAt: 1763942400000,
      primaryRuleScore: 91,
      ingestData: {
        industryTags: ["machine tools"],
      },
      analysis: {
        score: 88,
      },
      analyses: {
        "source:job5156|analysis:lathe-sales": { score: 88 },
      },
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(result).toEqual({
      input: 1,
      submitted: 1,
      deduped: 0,
      identityDeduped: 0,
      identityMatched: 0,
      inserted: 1,
      updated: 0,
      unchanged: 0,
    });
  });

  it("schedules ingest for fresh imports without restore state", async () => {
    const scheduler = {
      runAfter: vi.fn(async () => undefined),
    };

    const ctx = {
      db: {
        query(tableName: string) {
          if (tableName === "resumes") {
            return {
              withIndex() {
                return {
                  async unique() {
                    return null;
                  },
                };
              },
            };
          }

          if (tableName === "sync_events") {
            return {
              withIndex() {
                return {
                  async take() {
                    return [];
                  },
                };
              },
            };
          }

          throw new Error(`Unexpected table query: ${tableName}`);
        },
        async insert(tableName: string) {
          return tableName === "resumes" ? "resume-2" : "sync-2";
        },
        async patch() {
          throw new Error("patch should not be called in insert test");
        },
        async delete() {
          throw new Error("delete should not be called in insert test");
        },
      },
      scheduler,
    };

    await submitResumesHandler(ctx as never, {
      resumes: [{
        externalId: "seek:profile:2002",
        content: {
          profileId: "2002",
          name: "Bob",
          location: "Kuala Lumpur",
        },
        hash: "hash-2",
        source: "hk.employer.seek.com",
        tags: ["seek"],
      }],
    });

    expect(scheduler.runAfter).toHaveBeenCalledOnce();
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      { resumeIds: ["resume-2"] },
    );
  });
});
