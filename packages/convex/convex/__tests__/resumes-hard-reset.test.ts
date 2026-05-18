import { describe, expect, it, vi } from "vitest";

import { hardResetIngestData } from "../resumes";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const hardResetIngestDataHandler = (hardResetIngestData as unknown as ConvexHandler<
  Record<string, never>,
  { cleared: number; hasMore: boolean; cursor: string | null }
>)._handler

describe("hardResetIngestData", () => {
  it("clears computed ingest and analysis fields while preserving raw resume data", async () => {
    const patch = vi.fn(async () => undefined)

    const resumes = [
      {
        _id: "resume-1",
        externalId: "ext-1",
        content: { name: "Alice" },
        hash: "hash-1",
        source: "source-a",
        crawledAt: 1,
        tags: ["profile-1"],
        ingestData: {
          evidenceText: "computed",
          industryTags: [],
          synonymHits: [],
          ruleScores: {},
          experienceLevel: "unknown",
          computedAt: 1,
          skillsVersion: 1,
        },
        analysis: {
          score: 88,
          summary: "summary",
          highlights: [],
          recommendation: "yes",
        },
        analyses: {
          default: {
            score: 88,
          },
        },
        primaryRuleScore: 88,
        searchText: "alice sales",
      },
      {
        _id: "resume-2",
        externalId: "ext-2",
        content: { name: "Bob" },
        hash: "hash-2",
        source: "source-b",
        crawledAt: 2,
        tags: ["profile-2"],
        ingestData: undefined,
        analysis: undefined,
        analyses: undefined,
        primaryRuleScore: undefined,
        searchText: undefined,
      },
    ]

    const ctx = {
      db: {
        query() {
          return {
            order(orderDirection: string) {
              expect(orderDirection).toBe("desc")
              return {
                async paginate(args: { cursor: string | null; numItems: number; maximumBytesRead?: number; maximumRowsRead?: number }) {
                  expect(args).toEqual({ cursor: null, numItems: 25, maximumBytesRead: 8388608, maximumRowsRead: 16000 })
                  return {
                    page: resumes,
                    isDone: true,
                    continueCursor: "cursor-unused",
                  }
                },
              }
            },
          }
        },
        patch,
      },
    }

    const result = await hardResetIngestDataHandler(ctx as never, {})

    expect(result).toEqual({ cleared: 1, hasMore: false, cursor: null })
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith("resume-1", {
      ingestData: undefined,
      analysis: undefined,
      analyses: undefined,
      primaryRuleScore: undefined,
      searchText: undefined,
    })
    expect(resumes[0]).toMatchObject({
      externalId: "ext-1",
      hash: "hash-1",
      source: "source-a",
      crawledAt: 1,
      tags: ["profile-1"],
      content: { name: "Alice" },
    })
  })
});
