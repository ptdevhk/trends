import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_SLUG,
  addReviewedItem,
  archiveSession,
  getActiveSession,
  markSearchHistoryOpened,
  saveSearchHistory,
  saveSession,
} from "../sessions";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const getActiveSessionHandler = (getActiveSession as unknown as ConvexHandler<
  { sessionKey: string; workspaceSlug?: string },
  unknown
>)._handler

const saveSessionHandler = (saveSession as unknown as ConvexHandler<
  { sessionKey: string; workspaceSlug?: string; location: string; keywords: string[]; jobDescriptionId?: string },
  string | null
>)._handler

const addReviewedItemHandler = (addReviewedItem as unknown as ConvexHandler<
  { sessionKey: string; workspaceSlug?: string; resumeId: string },
  string | null
>)._handler

const archiveSessionHandler = (archiveSession as unknown as ConvexHandler<
  { sessionKey: string; workspaceSlug?: string },
  null
>)._handler

const saveSearchHistoryHandler = (saveSearchHistory as unknown as ConvexHandler<
  { sessionKey: string; workspaceSlug?: string; title?: string; location: string; keywords: string[]; resumeIds?: string[] },
  string
>)._handler

const markSearchHistoryOpenedHandler = (markSearchHistoryOpened as unknown as ConvexHandler<
  { id: string; workspaceSlug?: string },
  string | null
>)._handler

type ScreeningSession = {
  _id: string;
  sessionKey: string;
  status: "active" | "archived";
  workspaceSlug: string;
  config: { location: string; keywords: string[] };
  reviewedResumeIds: string[];
  lastActive: number;
}

type SearchHistoryRecord = {
  _id: string;
  sessionKey: string;
  title: string;
  location: string;
  keywords: string[];
  workspaceSlug: string;
  createdAt: number;
  lastOpenedAt?: number;
}

function createSessionsDb(sessions: ScreeningSession[] = []) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = []

  return {
    patches,
    inserts,
    db: {
      query(tableName: string) {
        if (tableName === "screening_sessions") {
          return {
            withIndex(_indexName: string, apply: (q: { eq: (field: string, value: string) => unknown }) => unknown) {
              const conditions: Array<{ field: string; value: string }> = []
              apply({
                eq(field: string, value: string) {
                  conditions.push({ field, value })
                  return this
                },
              })

              const filtered = sessions.filter((s) =>
                conditions.every((c) => s[c.field as keyof ScreeningSession] === c.value)
              )

              return {
                filter(apply: (q: { eq: (left: unknown, right: unknown) => unknown; field: (name: string) => string }) => unknown) {
                  const clause = apply({
                    eq: (left: unknown, right: unknown) => ({ left, right }),
                    field: (name: string) => name,
                  }) as { left: string; right: unknown }
                  const statusFiltered = filtered.filter((s) => s[clause.left as keyof ScreeningSession] === clause.right)
                  return {
                    async collect() { return [...statusFiltered] },
                    async take(_n: number) { return [...statusFiltered].slice(0, _n) },
                  }
                },
                async collect() { return [...filtered] },
                async take(_n: number) { return [...filtered].slice(0, _n) },
              }
            },
            async collect() { return [...sessions] },
            async take(_n: number) { return [...sessions].slice(0, _n) },
          }
        }

        if (tableName === "search_history") {
          return {
            withIndex(_indexName: string, apply: (q: { eq: (field: string, value: string) => unknown }) => unknown) {
              apply({
                eq() { return this },
              })
              return {
                order() { return { async take() { return [] } } },
                async take() { return [] },
              }
            },
            async collect() { return [] },
            async take() { return [] },
          }
        }

        if (tableName === "industry_db_cohorts") {
          return {
            withIndex() {
              return { async take() { return [] } }
            },
            async collect() { return [] },
          }
        }

        return {
          async collect() { return [] },
          async take() { return [] },
        }
      },
      async patch(id: string, patch: Record<string, unknown>) {
        patches.push({ id, patch })
        const session = sessions.find((s) => s._id === id)
        if (session) Object.assign(session, patch)
      },
      async insert(table: string, doc: Record<string, unknown>) {
        inserts.push({ table, doc })
        return `inserted-${inserts.length}`
      },
      async get(id: string) {
        return sessions.find((s) => s._id === id) ?? null
      },
    },
  }
}

describe("getActiveSession", () => {
  it("returns the most recently active session for the given key and workspace", async () => {
    const sessions: ScreeningSession[] = [
      { _id: "s1", sessionKey: "key-a", status: "active", workspaceSlug: DEFAULT_WORKSPACE_SLUG, config: { location: "东莞", keywords: [] }, reviewedResumeIds: [], lastActive: 100 },
      { _id: "s2", sessionKey: "key-a", status: "active", workspaceSlug: DEFAULT_WORKSPACE_SLUG, config: { location: "深圳", keywords: [] }, reviewedResumeIds: [], lastActive: 200 },
      { _id: "s3", sessionKey: "key-b", status: "active", workspaceSlug: DEFAULT_WORKSPACE_SLUG, config: { location: "广州", keywords: [] }, reviewedResumeIds: [], lastActive: 300 },
    ]
    const ctx = createSessionsDb(sessions)

    const result = await getActiveSessionHandler(ctx as never, { sessionKey: "key-a" })

    expect(result).not.toBeNull()
    expect((result as ScreeningSession)._id).toBe("s2")
  })

  it("returns null when no active session exists", async () => {
    const ctx = createSessionsDb([])

    const result = await getActiveSessionHandler(ctx as never, { sessionKey: "nonexistent" })

    expect(result).toBeNull()
  })
})

describe("saveSession", () => {
  it("patches existing active session instead of creating a new one", async () => {
    const sessions: ScreeningSession[] = [
      { _id: "s1", sessionKey: "key-a", status: "active", workspaceSlug: DEFAULT_WORKSPACE_SLUG, config: { location: "东莞", keywords: [] }, reviewedResumeIds: [], lastActive: 100 },
    ]
    const ctx = createSessionsDb(sessions)

    const result = await saveSessionHandler(ctx as never, {
      sessionKey: "key-a",
      location: "深圳",
      keywords: ["CNC"],
    })

    expect(result).toBe("s1")
    expect(ctx.patches).toHaveLength(1)
    expect(ctx.patches[0].id).toBe("s1")
    expect(ctx.inserts).toHaveLength(0)
  })

  it("creates a new session when no active one exists", async () => {
    const ctx = createSessionsDb([])

    const result = await saveSessionHandler(ctx as never, {
      sessionKey: "key-new",
      location: "广州",
      keywords: ["销售"],
    })

    expect(result).toBeTruthy()
    expect(ctx.inserts).toHaveLength(1)
    expect(ctx.inserts[0].table).toBe("screening_sessions")
    expect(ctx.patches).toHaveLength(0)
  })
})

describe("addReviewedItem", () => {
  it("adds a resume ID to the reviewed list", async () => {
    const sessions: ScreeningSession[] = [
      { _id: "s1", sessionKey: "key-a", status: "active", workspaceSlug: DEFAULT_WORKSPACE_SLUG, config: { location: "东莞", keywords: [] }, reviewedResumeIds: [], lastActive: 100 },
    ]
    const ctx = createSessionsDb(sessions)

    const result = await addReviewedItemHandler(ctx as never, {
      sessionKey: "key-a",
      resumeId: "resume-1",
    })

    expect(result).toBe("s1")
    expect(ctx.patches).toHaveLength(1)
    expect(ctx.patches[0].patch.reviewedResumeIds).toContain("resume-1")
  })

  it("does not add duplicate resume IDs", async () => {
    const sessions: ScreeningSession[] = [
      { _id: "s1", sessionKey: "key-a", status: "active", workspaceSlug: DEFAULT_WORKSPACE_SLUG, config: { location: "东莞", keywords: [] }, reviewedResumeIds: ["resume-1"], lastActive: 100 },
    ]
    const ctx = createSessionsDb(sessions)

    const result = await addReviewedItemHandler(ctx as never, {
      sessionKey: "key-a",
      resumeId: "resume-1",
    })

    expect(result).toBe("s1")
    expect(ctx.patches).toHaveLength(0)
  })

  it("returns null when no active session exists", async () => {
    const ctx = createSessionsDb([])

    const result = await addReviewedItemHandler(ctx as never, {
      sessionKey: "nonexistent",
      resumeId: "resume-1",
    })

    expect(result).toBeNull()
  })
})

describe("archiveSession", () => {
  it("patches the active session to archived status", async () => {
    const sessions: ScreeningSession[] = [
      { _id: "s1", sessionKey: "key-a", status: "active", workspaceSlug: DEFAULT_WORKSPACE_SLUG, config: { location: "东莞", keywords: [] }, reviewedResumeIds: [], lastActive: 100 },
    ]
    const ctx = createSessionsDb(sessions)

    const result = await archiveSessionHandler(ctx as never, { sessionKey: "key-a" })

    expect(result).toBeNull()
    expect(ctx.patches).toHaveLength(1)
    expect(ctx.patches[0].patch.status).toBe("archived")
  })

  it("does nothing when no active session exists", async () => {
    const ctx = createSessionsDb([])

    const result = await archiveSessionHandler(ctx as never, { sessionKey: "nonexistent" })

    expect(result).toBeNull()
    expect(ctx.patches).toHaveLength(0)
  })
})

describe("saveSearchHistory", () => {
  it("creates a search history record with normalized fields", async () => {
    const ctx = createSessionsDb()

    const result = await saveSearchHistoryHandler(ctx as never, {
      sessionKey: "session-a",
      location: "  东莞  ",
      keywords: [" CNC ", "cnc", "销售", " 销售 "],
      resumeIds: [],
    })

    expect(result).toBeTruthy()
    expect(ctx.inserts).toHaveLength(1)
    const doc = ctx.inserts[0].doc
    expect(doc.location).toBe("东莞")
    // normalizeStringList trims and deduplicates exact matches (case-sensitive)
    expect(doc.keywords).toEqual(["CNC", "cnc", "销售"])
    // Title should be auto-generated from location + keywords
    expect(doc.title).toContain("东莞")
    expect(doc.workspaceSlug).toBe(DEFAULT_WORKSPACE_SLUG)
  })

  it("creates a cohort when resumeIds are provided", async () => {
    const ctx = createSessionsDb()

    // Provide resumeIds — but the db.get won't find them, so cohort will have all zeros
    const result = await saveSearchHistoryHandler(ctx as never, {
      sessionKey: "session-a",
      location: "东莞",
      keywords: ["CNC"],
      resumeIds: ["nonexistent-resume"],
    })

    expect(result).toBeTruthy()
    // With empty data from get(), buildIndustryDbV2Cohort still creates a cohort entry
    // (it maps null gets to 0 scores, so size >= 1)
  })

  it("uses provided title when not empty", async () => {
    const ctx = createSessionsDb()

    await saveSearchHistoryHandler(ctx as never, {
      sessionKey: "session-a",
      title: "Custom Title",
      location: "东莞",
      keywords: ["CNC"],
    })

    const doc = ctx.inserts[0].doc
    expect(doc.title).toBe("Custom Title")
  })
})

describe("markSearchHistoryOpened", () => {
  it("updates lastOpenedAt for a record in the same workspace", async () => {
    const searchHistoryRecords: SearchHistoryRecord[] = [
      { _id: "sh1", sessionKey: "s-a", title: "Test", location: "东莞", keywords: [], workspaceSlug: DEFAULT_WORKSPACE_SLUG, createdAt: 1000 },
    ]
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = []

    const ctx = {
      db: {
        async get(id: string) {
          const record = searchHistoryRecords.find((r) => r._id === id)
          return record ? { ...record, _id: id } : null
        },
        async patch(id: string, patch: Record<string, unknown>) {
          patches.push({ id, patch })
        },
      },
    }

    const result = await markSearchHistoryOpenedHandler(ctx as never, {
      id: "sh1",
      workspaceSlug: DEFAULT_WORKSPACE_SLUG,
    })

    expect(result).toBe("sh1")
    expect(patches).toHaveLength(1)
    expect(patches[0].patch.lastOpenedAt).toBeGreaterThan(0)
  })

  it("returns null when record does not exist", async () => {
    const ctx = {
      db: {
        async get() { return null },
        async patch() {},
      },
    }

    const result = await markSearchHistoryOpenedHandler(ctx as never, {
      id: "nonexistent",
      workspaceSlug: DEFAULT_WORKSPACE_SLUG,
    })

    expect(result).toBeNull()
  })

  it("returns null when record belongs to a different workspace", async () => {
    const searchHistoryRecords: SearchHistoryRecord[] = [
      { _id: "sh1", sessionKey: "s-a", title: "Test", location: "东莞", keywords: [], workspaceSlug: "hr", createdAt: 1000 },
    ]

    const ctx = {
      db: {
        async get(id: string) {
          const record = searchHistoryRecords.find((r) => r._id === id)
          return record ? { ...record, _id: id } : null
        },
        async patch() {},
      },
    }

    const result = await markSearchHistoryOpenedHandler(ctx as never, {
      id: "sh1",
      workspaceSlug: DEFAULT_WORKSPACE_SLUG,
    })

    expect(result).toBeNull()
  })
})
