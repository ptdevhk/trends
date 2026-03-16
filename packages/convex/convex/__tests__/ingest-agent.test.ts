import { describe, expect, it } from "vitest";

import { reIngestAllResumes } from "../ingest_agent";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const reIngestAllResumesHandler = (reIngestAllResumes as unknown as ConvexHandler<
  Record<string, never>,
  { scheduled: number; batches: number }
>)._handler

describe("reIngestAllResumes", () => {
  it("schedules every resume, including ones without existing ingest data", async () => {
    const scheduledPayloads: Array<{ resumeIds: string[] }> = []
    let queryCount = 0

    const ctx = {
      async runQuery() {
        queryCount += 1

        if (queryCount === 1) {
          return {
            continueCursor: "cursor:2",
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
        }

        return {
          continueCursor: "cursor:done",
          isDone: true,
          page: [
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

    const result = await reIngestAllResumesHandler(ctx as never, {})

    expect(result).toEqual({
      scheduled: 3,
      batches: 2,
    })
    expect(scheduledPayloads).toEqual([
      { resumeIds: ["resume-1", "resume-2"] },
      { resumeIds: ["resume-3"] },
    ])
  })
})
