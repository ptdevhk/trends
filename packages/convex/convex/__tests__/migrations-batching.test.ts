import { describe, expect, it } from "vitest";

import { backfillIngestData } from "../migrations";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type BackfillIngestDataResult = {
  scheduled: number
  batches: number
  hasMore: boolean
  cursor: string | null
  scannedResumes: number
  message: string
}

const backfillIngestDataHandler = (backfillIngestData as unknown as ConvexHandler<
  { limit?: number; cursor?: string; batchSize?: number },
  BackfillIngestDataResult
>)._handler

describe("backfillIngestData", () => {
  it("schedules only unprocessed resumes from the current scan batch and returns the next cursor", async () => {
    const scheduledPayloads: Array<{ resumeIds: string[] }> = []

    const ctx = {
      async runQuery() {
        return {
          continueCursor: "next:cursor",
          isDone: false,
          page: [
            {
              _id: "resume-1",
              content: {},
              ingestData: undefined,
              primaryRuleScore: undefined,
              searchText: undefined,
            },
            {
              _id: "resume-2",
              content: {},
              ingestData: {
                evidenceText: "already processed",
                industryTags: [],
                synonymHits: [],
                ruleScores: {},
                experienceLevel: "unknown",
                computedAt: 1,
                skillsVersion: 1,
              },
              primaryRuleScore: 0,
              searchText: "",
            },
          ],
        }
      },
      scheduler: {
        async runAfter(_delay: number, _fn: unknown, payload: { resumeIds: string[] }) {
          scheduledPayloads.push(payload)
        },
      },
    }

    const result = await backfillIngestDataHandler(ctx as never, { limit: 100 })

    expect(result).toEqual({
      scheduled: 1,
      batches: 1,
      hasMore: true,
      cursor: "next:cursor",
      scannedResumes: 2,
      message: "Scheduled ingest backfill for 1 resumes in 1 batch(es)",
    })
    expect(scheduledPayloads).toEqual([{ resumeIds: ["resume-1"] }])
  })
})
