import { describe, expect, it, vi } from "vitest";

import { processNewResumes, reIngestAllResumes, reIngestStaleResumes } from "../convex/ingest_agent";

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
  { limit?: number; cursor?: string },
  {
    scheduled: number
    batches: number
    currentVersion: number
    currentIngestComputeEpoch: number
    hasMore: boolean
    cursor: string | null
    mode: string
    dryRun: boolean
    scannedRows: number
    skillsStaleCount: number
    computeStaleCount: number
    matchedCount: number
  }
>)._handler

function makeBffResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function successfulIngestComputeResponse() {
  return makeBffResponse(200, {
    success: true,
    results: [{
      resumeId: "r1",
      market: "CN",
      evidenceText: "",
      industryTags: [],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      ruleScores: {},
      experienceLevel: "unknown",
      computedAt: 1,
      skillsVersion: 1,
    }],
  })
}

function processableResumeContext() {
  return {
    async runQuery() {
      return [{ _id: "r1", content: {} }]
    },
    async runMutation(_fn: unknown, args: Record<string, unknown>) {
      if ("decisionType" in args) {
        return "audit-log-1"
      }
    },
  }
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

  it("sends the configured Convex write secret to the BFF compute endpoint", async () => {
    vi.stubEnv("CONVEX_WRITE_SECRET", "worker-test-secret")
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(successfulIngestComputeResponse())

    try {
      await processNewResumesHandler(processableResumeContext() as never, { resumeIds: ["r1"] })

      expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        headers: expect.objectContaining({ "X-Convex-Write-Secret": "worker-test-secret" }),
      }))
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it("omits the BFF worker header when the configured write secret is blank", async () => {
    vi.stubEnv("CONVEX_WRITE_SECRET", "   ")
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(successfulIngestComputeResponse())

    try {
      await processNewResumesHandler(processableResumeContext() as never, { resumeIds: ["r1"] })

      expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }))
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it("processes resumes and stores ingest data via mutation", async () => {
    const ingestMutations: Array<{ updates: Array<Record<string, unknown>> }> = []
    const auditLogMutations: Array<Record<string, unknown>> = []
    const auditOutcomeMutations: Array<Record<string, unknown>> = []
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
            brandHits: [{
              brand: "FANUC",
              role: "both",
              source: "workHistory",
              context: "equipment",
              origin: "international",
              productClass: "complete_machine",
            }],
            brandOrigin: "international",
            machineOrigin: "international",
            productClass: "complete_machine",
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
      async runMutation(_fn: unknown, args: Record<string, unknown>) {
        if ("updates" in args) {
          ingestMutations.push(args as { updates: Array<Record<string, unknown>> })
        } else if ("decisionType" in args) {
          auditLogMutations.push(args)
          return `audit-log-${auditLogMutations.length}`
        } else if ("outcome" in args && "auditLogId" in args) {
          auditOutcomeMutations.push(args)
        }
      },
    }

    const result = await processNewResumesHandler(ctx as never, { resumeIds: ["r1", "r2"] })

    expect(result).toEqual({ processed: 2, error: null })
    expect(ingestMutations).toHaveLength(1)
    expect(ingestMutations[0].updates).toHaveLength(2)
    const update0 = ingestMutations[0].updates[0] as Record<string, Record<string, unknown>>
    expect(update0.resumeId).toBe("r1")
    expect((update0.ingestData as Record<string, unknown>).market).toBe("tech")
    expect((update0.ingestData as Record<string, unknown>).skillsVersion).toBe(2)
    expect((update0.ingestData as Record<string, unknown>).brandOrigin).toBe("international")
    expect((update0.ingestData as Record<string, unknown>).machineOrigin).toBe("international")
    expect((update0.ingestData as Record<string, unknown>).productClass).toBe("complete_machine")
    expect((update0.ingestData as Record<string, unknown>).brandHits).toEqual([{
      brand: "FANUC",
      role: "both",
      source: "workHistory",
      context: "equipment",
      origin: "international",
      productClass: "complete_machine",
    }])
    expect(ingestMutations[0].updates[1].resumeId).toBe("r2")

    // Verify audit log mutations were called for each processed resume (EU AI Act Art. 12)
    expect(auditLogMutations).toHaveLength(2)
    expect(auditLogMutations[0].decisionType).toBe("rank")
    expect(auditLogMutations[0].actionRef).toBe("ingest_agent:processNewResumes")
    expect(auditLogMutations[0].output).toMatchObject({ tags: ["software"], score: 0.9 })

    // Verify setAuditOutcome mutations were called for each audit log
    expect(auditOutcomeMutations).toHaveLength(2)
    expect(auditOutcomeMutations[0].outcome).toBe("accepted")
    expect(auditOutcomeMutations[0].setBy).toBe("system:ingest_agent")

    // Verify the BFF payload includes sourceKey
    const callArgs = fetchSpy.mock.calls[0]
    const body = JSON.parse(callArgs[1]?.body as string)
    expect(body.resumes[0]).toEqual({ resumeId: "r1", content: { name: "Alice" }, sourceKey: "acme", workspaceSlug: "dev" })
    expect(body.resumes[1]).toEqual({ resumeId: "r2", content: { name: "Bob" }, sourceKey: undefined, workspaceSlug: "dev" })

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
      makeBffResponse(200, { version: 2, ingestComputeEpoch: 1 }),
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
              ingestData: { skillsVersion: 2, ingestComputeEpoch: 1 },
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

    expect(result).toMatchObject({
      scheduled: 0,
      batches: 0,
      currentVersion: 2,
      hasMore: false,
      cursor: null,
    })
    fetchSpy.mockRestore()
  })

  it("schedules only stale resumes for re-ingest", async () => {
    const scheduledPayloads: Array<{ resumeIds: string[] }> = []
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeBffResponse(200, { version: 3, ingestComputeEpoch: 1 }),
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
              ingestData: { skillsVersion: 1, ingestComputeEpoch: 1 },
              primaryRuleScore: 0,
              searchText: "",
            },
            {
              _id: "current-1",
              content: {},
              ingestData: { skillsVersion: 3, ingestComputeEpoch: 1 },
              primaryRuleScore: 0,
              searchText: "",
            },
            {
              _id: "stale-2",
              content: {},
              ingestData: { skillsVersion: 2, ingestComputeEpoch: 1 },
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
      makeBffResponse(200, { version: 2, ingestComputeEpoch: 1 }),
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
              ingestData: { skillsVersion: 1, ingestComputeEpoch: 1 },
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
      makeBffResponse(200, { version: 3, ingestComputeEpoch: 1 }),
    )

    let queryCount = 0
    const ctx = {
      async runQuery(_fn: unknown, args: { limit?: number }) {
        queryCount += 1
        return {
          continueCursor: `cursor:${queryCount}`,
          isDone: false,
          page: Array.from({ length: args.limit ?? 50 }, (_, i) => ({
            _id: `stale-${queryCount * 60 + i}`,
            content: {},
            ingestData: { skillsVersion: 1, ingestComputeEpoch: 1 },
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
    // 75 stale = a single 100-row batch (scan page size raised to 100)
    expect(scheduledPayloads).toHaveLength(1)
    expect(scheduledPayloads[0].resumeIds).toHaveLength(75)
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
      makeBffResponse(200, { version: 2, ingestComputeEpoch: 1 }),
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
              { _id: "s1", content: {}, ingestData: { skillsVersion: 1, ingestComputeEpoch: 1 }, primaryRuleScore: 0, searchText: "" },
              { _id: "c1", content: {}, ingestData: { skillsVersion: 2, ingestComputeEpoch: 1 }, primaryRuleScore: 0, searchText: "" },
            ],
          }
        }
        return {
          continueCursor: "",
          isDone: true,
          page: [
            { _id: "s2", content: {}, ingestData: { skillsVersion: 1, ingestComputeEpoch: 1 }, primaryRuleScore: 0, searchText: "" },
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

  it("continues from an opaque cursor so paced calls schedule disjoint resumes", async () => {
    const scheduledPayloads: Array<{ resumeIds: string[] }> = []
    const queryArgs: Array<{ cursor?: string; limit?: number }> = []
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeBffResponse(200, { version: 3, ingestComputeEpoch: 1 }),
    )

    const pages = {
      start: {
        continueCursor: "cursor:next",
        isDone: false,
        page: ["stale-1", "stale-2"],
      },
      "cursor:next": {
        continueCursor: "",
        isDone: true,
        page: ["stale-3", "stale-4"],
      },
    } as const
    const ctx = {
      async runQuery(_fn: unknown, args: { cursor?: string; limit?: number }) {
        queryArgs.push(args)
        const page = pages[args.cursor ?? "start"]
        return {
          ...page,
          page: page.page.map((_id) => ({
            _id,
            content: {},
            ingestData: { skillsVersion: 1, ingestComputeEpoch: 1 },
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

    const first = await reIngestStaleResumesHandler(ctx as never, { limit: 2 })
    const second = await reIngestStaleResumesHandler(ctx as never, {
      limit: 2,
      cursor: first.cursor ?? undefined,
    })

    expect(first).toMatchObject({ scheduled: 2, hasMore: true, cursor: "cursor:next" })
    expect(second).toMatchObject({ scheduled: 2, hasMore: false, cursor: null })
    expect(queryArgs).toEqual([
      { cursor: undefined, limit: 2 },
      { cursor: "cursor:next", limit: 2 },
    ])
    expect(scheduledPayloads).toEqual([
      { resumeIds: ["stale-1", "stale-2"] },
      { resumeIds: ["stale-3", "stale-4"] },
    ])
    fetchSpy.mockRestore()
  })

  it("dry-run reports the rows actually scanned, not the requested limit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, { version: 3, ingestComputeEpoch: 2 }),
    )

    let queryCount = 0
    const ctx = {
      async runQuery() {
        queryCount += 1
        if (queryCount === 1) {
          return {
            continueCursor: "cursor:p2",
            isDone: false,
            page: Array.from({ length: 100 }, (_, i) => ({
              _id: `stale-${i}`,
              content: {},
              ingestData: { skillsVersion: 1, ingestComputeEpoch: 1 },
              primaryRuleScore: 0,
              searchText: "",
            })),
          }
        }
        return {
          continueCursor: "",
          isDone: true,
          page: Array.from({ length: 60 }, (_, i) => ({
            _id: `stale-${100 + i}`,
            content: {},
            ingestData: { skillsVersion: 1, ingestComputeEpoch: 1 },
            primaryRuleScore: 0,
            searchText: "",
          })),
        }
      },
      scheduler: {
        async runAfter() {
          throw new Error("dry-run must not schedule")
        },
      },
    }

    const result = await reIngestStaleResumesHandler(ctx as never, {
      limit: 200,
      mode: "compute",
      dryRun: true,
    })

    // 160 rows actually fetched across two pages (100 + 60), even though the
    // requested limit was 200 — the honest window is 160, not 200.
    expect(result).toMatchObject({
      scheduled: 0,
      batches: 0,
      scannedRows: 160,
      computeStaleCount: 160,
      matchedCount: 160,
      hasMore: false,
      cursor: null,
      dryRun: true,
    })
    fetchSpy.mockRestore()
  })

  it("dry-run exposes an incomplete window via scannedRows + hasMore", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeBffResponse(200, { version: 3, ingestComputeEpoch: 2 }),
    )

    const ctx = {
      async runQuery() {
        return {
          continueCursor: "cursor:more",
          isDone: false,
          page: Array.from({ length: 100 }, (_, i) => ({
            _id: `stale-${i}`,
            content: {},
            ingestData: { skillsVersion: 1, ingestComputeEpoch: 1 },
            primaryRuleScore: 0,
            searchText: "",
          })),
        }
      },
      scheduler: {
        async runAfter() {
          throw new Error("dry-run must not schedule")
        },
      },
    }

    const result = await reIngestStaleResumesHandler(ctx as never, {
      limit: 100,
      mode: "compute",
      dryRun: true,
    })

    expect(result).toMatchObject({
      scheduled: 0,
      scannedRows: 100,
      computeStaleCount: 100,
      hasMore: true,
      cursor: "cursor:more",
    })
    fetchSpy.mockRestore()
  })
})
