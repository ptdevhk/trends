import { describe, expect, it, vi } from "vitest";

import { processNewResumes, reIngestAllResumes, reIngestStaleResumes } from "../ingest_agent";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const processNewResumesHandler = (processNewResumes as unknown as ConvexHandler<
  { resumeIds: string[] },
  { processed: number; error: string | null }
>)._handler

const reIngestAllResumesHandler = (reIngestAllResumes as unknown as ConvexHandler<
  Record<string, never>,
  { scheduled: number; batches: number }
>)._handler

const reIngestStaleResumesHandler = (reIngestStaleResumes as unknown as ConvexHandler<
  { limit?: number },
  { scheduled: number; batches: number; currentVersion: number; hasMore: boolean }
>)._handler

function makeBffResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("processNewResumes", () => {
  it("returns processed: 0 with no error for empty resumeIds", async () => {
    const result = await processNewResumesHandler({} as never, { resumeIds: [] })
    expect(result).toEqual({ processed: 0, error: null })
  })

  it("returns processed: 0 when no resumes found by query", async () => {
    const ctx = {
      async runQuery() {
        return []
      },
    }
    const result = await processNewResumesHandler(ctx as never, { resumeIds: ["r1", "r2"] })
    expect(result).toEqual({ processed: 0, error: null })
  })

  it("returns error when BFF API returns non-OK status", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(500, { error: "internal" }),
    )
    const ctx = {
      async runQuery() {
        return [{ _id: "r1", content: { name: "Test" } }]
      },
    }

    const result = await processNewResumesHandler(ctx as never, { resumeIds: ["r1"] })

    expect(result.processed).toBe(0)
    expect(result.error).toContain("BFF API error: 500")
    fetchSpy.mockRestore()
  })

  it("returns error when BFF response is missing success/results", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, { wrong: true }),
    )
    const ctx = {
      async runQuery() {
        return [{ _id: "r1", content: { name: "Test" } }]
      },
    }

    const result = await processNewResumesHandler(ctx as never, { resumeIds: ["r1"] })

    expect(result.processed).toBe(0)
    expect(result.error).toContain("Invalid BFF response")
    fetchSpy.mockRestore()
  })

  it("processes resumes and stores ingest data via mutation", async () => {
    const mutations: Array<{ updates: Array<Record<string, unknown>> }> = []
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, {
        success: true,
        results: [
          {
            resumeId: "r1",
            market: "tech",
            evidenceText: "evidence",
            industryTags: ["software"],
            synonymHits: ["dev"],
            brandHits: [],
            companyHits: [],
            ruleScores: { tech: 0.9 },
            experienceLevel: "senior",
            computedAt: 1000,
            skillsVersion: 2,
            primaryRuleScore: 0.9,
            companyPatternAliasTokens: "acme",
          },
          {
            resumeId: "r2",
            market: "finance",
            evidenceText: "",
            industryTags: [],
            synonymHits: [],
            brandHits: [],
            companyHits: [],
            ruleScores: {},
            experienceLevel: "junior",
            computedAt: 1001,
            skillsVersion: 2,
          },
        ],
      }),
    )

    const ctx = {
      async runQuery() {
        return [
          { _id: "r1", content: { name: "Alice" }, sourceKey: "acme" },
          { _id: "r2", content: { name: "Bob" } },
        ]
      },
      async runMutation(_fn: unknown, args: { updates: Array<Record<string, unknown>> }) {
        mutations.push(args)
      },
    }

    const result = await processNewResumesHandler(ctx as never, { resumeIds: ["r1", "r2"] })

    expect(result).toEqual({ processed: 2, error: null })
    expect(mutations).toHaveLength(1)
    expect(mutations[0].updates).toHaveLength(2)
    const update0 = mutations[0].updates[0] as Record<string, Record<string, unknown>>
    expect(update0.resumeId).toBe("r1")
    expect((update0.ingestData as Record<string, unknown>).market).toBe("tech")
    expect((update0.ingestData as Record<string, unknown>).skillsVersion).toBe(2)
    expect(mutations[0].updates[1].resumeId).toBe("r2")

    // Verify the BFF payload includes sourceKey
    const callArgs = fetchSpy.mock.calls[0]
    const body = JSON.parse(callArgs[1]?.body as string)
    expect(body.resumes[0]).toEqual({ resumeId: "r1", content: { name: "Alice" }, sourceKey: "acme" })
    expect(body.resumes[1]).toEqual({ resumeId: "r2", content: { name: "Bob" }, sourceKey: undefined })

    fetchSpy.mockRestore()
  })

  it("handles network/fetch errors gracefully", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    const ctx = {
      async runQuery() {
        return [{ _id: "r1", content: {} }]
      },
    }

    const result = await processNewResumesHandler(ctx as never, { resumeIds: ["r1"] })

    expect(result.processed).toBe(0)
    expect(result.error).toBe("network down")
    fetchSpy.mockRestore()
  })
})

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

describe("reIngestStaleResumes", () => {
  it("returns zero scheduled when all resumes have current version", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, { version: 2 }),
    )

    const ctx = {
      async runQuery() {
        return {
          continueCursor: "",
          isDone: true,
          page: [
            {
              _id: "r1",
              content: {},
              ingestData: { skillsVersion: 2 },
              primaryRuleScore: 0,
              searchText: "",
            },
          ],
        }
      },
      scheduler: {
        async runAfter() {},
      },
    }

    const result = await reIngestStaleResumesHandler(ctx as never, {})

    expect(result).toEqual({
      scheduled: 0,
      batches: 0,
      currentVersion: 2,
      hasMore: false,
    })
    fetchSpy.mockRestore()
  })

  it("schedules only stale resumes for re-ingest", async () => {
    const scheduledPayloads: Array<{ resumeIds: string[] }> = []
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, { version: 3 }),
    )

    const ctx = {
      async runQuery() {
        return {
          continueCursor: "",
          isDone: true,
          page: [
            {
              _id: "stale-1",
              content: {},
              ingestData: { skillsVersion: 1 },
              primaryRuleScore: 0,
              searchText: "",
            },
            {
              _id: "current-1",
              content: {},
              ingestData: { skillsVersion: 3 },
              primaryRuleScore: 0,
              searchText: "",
            },
            {
              _id: "stale-2",
              content: {},
              ingestData: { skillsVersion: 2 },
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

    const result = await reIngestStaleResumesHandler(ctx as never, {})

    expect(result.scheduled).toBe(2)
    expect(result.currentVersion).toBe(3)
    expect(result.hasMore).toBe(false)
    expect(scheduledPayloads).toEqual([
      { resumeIds: ["stale-1", "stale-2"] },
    ])
    fetchSpy.mockRestore()
  })

  it("skips resumes with undefined ingestData (never ingested)", async () => {
    const scheduledPayloads: Array<{ resumeIds: string[] }> = []
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, { version: 2 }),
    )

    const ctx = {
      async runQuery() {
        return {
          continueCursor: "",
          isDone: true,
          page: [
            {
              _id: "never-ingested",
              content: {},
              ingestData: undefined,
              primaryRuleScore: undefined,
              searchText: undefined,
            },
            {
              _id: "stale-1",
              content: {},
              ingestData: { skillsVersion: 1 },
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

    const result = await reIngestStaleResumesHandler(ctx as never, {})

    expect(result.scheduled).toBe(1)
    expect(scheduledPayloads).toEqual([{ resumeIds: ["stale-1"] }])
    fetchSpy.mockRestore()
  })

  it("respects the limit parameter", async () => {
    const scheduledPayloads: Array<{ resumeIds: string[] }> = []
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, { version: 3 }),
    )

    let queryCount = 0
    const ctx = {
      async runQuery() {
        queryCount += 1
        return {
          continueCursor: queryCount < 2 ? "more" : "",
          isDone: queryCount >= 2,
          page: Array.from({ length: 60 }, (_, i) => ({
            _id: `stale-${queryCount * 60 + i}`,
            content: {},
            ingestData: { skillsVersion: 1 },
            primaryRuleScore: 0,
            searchText: "",
          })),
        }
      },
      scheduler: {
        async runAfter(_delay: number, _fn: unknown, payload: { resumeIds: string[] }) {
          scheduledPayloads.push(payload)
        },
      },
    }

    const result = await reIngestStaleResumesHandler(ctx as never, { limit: 75 })

    expect(result.scheduled).toBe(75)
    expect(result.currentVersion).toBe(3)
    expect(result.hasMore).toBe(true)
    // 75 stale = batch of 50 + batch of 25
    expect(scheduledPayloads).toHaveLength(2)
    expect(scheduledPayloads[0].resumeIds).toHaveLength(50)
    expect(scheduledPayloads[1].resumeIds).toHaveLength(25)
    fetchSpy.mockRestore()
  })

  it("throws when skills version endpoint fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(503, "unavailable"),
    )

    const ctx = {
      async runQuery() { return { continueCursor: "", isDone: true, page: [] } },
      scheduler: { async runAfter() {} },
    }

    await expect(
      reIngestStaleResumesHandler(ctx as never, {}),
    ).rejects.toThrow("Failed to get skills version: 503")

    fetchSpy.mockRestore()
  })

  it("throws when skills version response has invalid version field", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, { version: "not-a-number" }),
    )

    const ctx = {
      async runQuery() { return { continueCursor: "", isDone: true, page: [] } },
      scheduler: { async runAfter() {} },
    }

    await expect(
      reIngestStaleResumesHandler(ctx as never, {}),
    ).rejects.toThrow("Invalid skills version response: version must be a number")

    fetchSpy.mockRestore()
  })

  it("handles multi-page scanning with cursor", async () => {
    const scheduledPayloads: Array<{ resumeIds: string[] }> = []
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, { version: 2 }),
    )

    let queryCount = 0
    const ctx = {
      async runQuery() {
        queryCount += 1
        if (queryCount === 1) {
          return {
            continueCursor: "page2",
            isDone: false,
            page: [
              { _id: "s1", content: {}, ingestData: { skillsVersion: 1 }, primaryRuleScore: 0, searchText: "" },
              { _id: "c1", content: {}, ingestData: { skillsVersion: 2 }, primaryRuleScore: 0, searchText: "" },
            ],
          }
        }
        return {
          continueCursor: "",
          isDone: true,
          page: [
            { _id: "s2", content: {}, ingestData: { skillsVersion: 1 }, primaryRuleScore: 0, searchText: "" },
          ],
        }
      },
      scheduler: {
        async runAfter(_delay: number, _fn: unknown, payload: { resumeIds: string[] }) {
          scheduledPayloads.push(payload)
        },
      },
    }

    const result = await reIngestStaleResumesHandler(ctx as never, {})

    expect(result.scheduled).toBe(2)
    expect(result.currentVersion).toBe(2)
    expect(result.hasMore).toBe(false)
    expect(scheduledPayloads).toEqual([
      { resumeIds: ["s1", "s2"] },
    ])
    fetchSpy.mockRestore()
  })
})
