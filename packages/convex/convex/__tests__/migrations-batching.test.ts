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

    const result = await backfillIngestDataHandler(ctx as never, { limit: 1 })

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

  it("continues scanning later pages until it finds enough unprocessed resumes", async () => {
    const scheduledPayloads: Array<{ resumeIds: string[] }> = []
    let queryCount = 0

    const ctx = {
      async runQuery() {
        queryCount += 1

        if (queryCount === 1) {
          return {
            continueCursor: "next:cursor",
            isDone: false,
            page: [
              {
                _id: "resume-1",
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
        }

        return {
          continueCursor: "done:cursor",
          isDone: true,
          page: [
            {
              _id: "resume-2",
              content: {},
              ingestData: undefined,
              primaryRuleScore: undefined,
              searchText: undefined,
            },
            {
              _id: "resume-3",
              content: {},
              ingestData: undefined,
              primaryRuleScore: undefined,
              searchText: undefined,
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

    const result = await backfillIngestDataHandler(ctx as never, { limit: 2 })

    expect(result).toEqual({
      scheduled: 2,
      batches: 1,
      hasMore: false,
      cursor: null,
      scannedResumes: 3,
      message: "Scheduled ingest backfill for 2 resumes in 1 batch(es)",
    })
    expect(scheduledPayloads).toEqual([{ resumeIds: ["resume-2", "resume-3"] }])
  })
})
