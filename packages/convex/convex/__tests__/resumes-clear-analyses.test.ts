import { describe, expect, it, vi } from "vitest";

import { clearAnalyses } from "../resumes";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type ClearAnalysesResult = {
  cleared: number
  hasMore: boolean
  cursor: string | null
}

const clearAnalysesHandler = (clearAnalyses as unknown as ConvexHandler<
  {
    resumeIds?: string[]
    jobDescriptionId?: string
    cursor?: string
    batchSize?: number
  },
  ClearAnalysesResult
>)._handler

describe("clearAnalyses", () => {
  it("paginates full-table clears for large datasets", async () => {
    const patch = vi.fn(async () => undefined)
    const resumes = [
      {
        _id: "resume-1",
        analysis: { score: 90, jobDescriptionId: "jd-1" },
        analyses: { "source:seek|analysis:jd-1": { score: 90 } },
      },
      {
        _id: "resume-2",
        analysis: undefined,
        analyses: { default: { score: 72 } },
      },
      {
        _id: "resume-3",
        analysis: undefined,
        analyses: undefined,
      },
    ]

    const ctx = {
      db: {
        query(tableName: string) {
          expect(tableName).toBe("resumes")
          return {
            order(orderDirection: string) {
              expect(orderDirection).toBe("desc")
              return {
                async paginate(args: { cursor: string | null; numItems: number }) {
                  expect(args).toEqual({ cursor: "next-batch", numItems: 10 })
                  return {
                    page: resumes,
                    isDone: false,
                    continueCursor: "cursor-2",
                  }
                },
              }
            },
          }
        },
        patch,
      },
    }

    const result = await clearAnalysesHandler(ctx as never, {
      cursor: "next-batch",
      batchSize: 10,
    })

    expect(result).toEqual({ cleared: 2, hasMore: true, cursor: "cursor-2" })
    expect(patch).toHaveBeenCalledTimes(2)
    expect(patch).toHaveBeenNthCalledWith(1, "resume-1", {
      analysis: undefined,
      analyses: undefined,
    })
    expect(patch).toHaveBeenNthCalledWith(2, "resume-2", {
      analysis: undefined,
      analyses: undefined,
    })
  })

  it("clears only requested resume ids without querying for pagination", async () => {
    const get = vi.fn(async (id: string) => {
      if (id === "resume-1") {
        return {
          _id: "resume-1",
          analysis: { jobDescriptionId: "jd-1", score: 88 },
          analyses: {
            "source:job5156|analysis:jd-1": { score: 88 },
            "source:seek|analysis:jd-2": { score: 51 },
          },
        }
      }
      return null
    })
    const patch = vi.fn(async () => undefined)

    const ctx = {
      db: {
        query() {
          throw new Error("query should not be used when resumeIds are provided")
        },
        get,
        patch,
      },
    }

    const result = await clearAnalysesHandler(ctx as never, {
      resumeIds: ["resume-1", "resume-missing"],
      jobDescriptionId: "jd-1",
    })

    expect(result).toEqual({ cleared: 1, hasMore: false, cursor: null })
    expect(get).toHaveBeenCalledTimes(2)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith("resume-1", {
      analysis: undefined,
      analyses: {
        "source:seek|analysis:jd-2": { score: 51 },
      },
    })
  })
});
