import { describe, expect, it } from "vitest";

import { cleanupExpired, get, upsert } from "../ai_summary_cache";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type CacheRecord = {
  _id: string
  generatedAt?: number
  summary?: string
  workspaceSlug?: string
  urlHash?: string
  expiresAt: number
}

const getHandler = (get as unknown as ConvexHandler<
  { workspaceSlug: string; urlHash: string },
  CacheRecord | null
>)._handler

const upsertHandler = (upsert as unknown as ConvexHandler<
  {
    urlHash: string
    workspaceSlug: string
    query: string
    facets?: string
    resultCount: number
    resultSetHash: string
    summary: string
    model: string
    generatedAt: number
    expiresAt: number
  },
  string
>)._handler

const cleanupExpiredHandler = (cleanupExpired as unknown as ConvexHandler<
  { now?: number },
  { deleted: number }
>)._handler

function createCacheDb(records: CacheRecord[]) {
  const deletedIds: string[] = []
  const insertedRecords: Array<Record<string, unknown>> = []
  const patchedRecords: Array<{ id: string; patch: Record<string, unknown> }> = []

  return {
    deletedIds,
    insertedRecords,
    patchedRecords,
    db: {
      query(tableName: string) {
        expect(tableName).toBe("ai_summary_cache")

        return {
          withIndex(indexName: string, apply: (q: unknown) => unknown) {
            expect(indexName === "by_workspace_url_hash" || indexName === "by_expires_at").toBe(true)
            if (indexName === "by_workspace_url_hash") {
              const chain = {
                clauses: [] as Array<{ field: string; value: string }>,
                eq(field: string, value: string) {
                  this.clauses.push({ field, value })
                  return this
                },
              }
              const clauseChain = apply(chain as never) as { clauses: Array<{ field: string; value: string }> }

              return {
                async collect() {
                  return records
                    .filter((record) => clauseChain.clauses.every((clause) => record[clause.field as keyof CacheRecord] === clause.value))
                    .map((record) => ({ ...record }))
                },
                async take(n: number) {
                  return records
                    .filter((record) => clauseChain.clauses.every((clause) => record[clause.field as keyof CacheRecord] === clause.value))
                    .map((record) => ({ ...record }))
                    .slice(0, n)
                },
              }
            }

            const chain = {
              field: "" as string,
              value: 0,
              lte(field: string, value: number) {
                this.field = field
                this.value = value
                return this
              },
            }
            const clause = apply(chain as never) as { field: string; value: number }

            return {
              async collect() {
                return records
                  .filter((record) => {
                    const candidate = record[clause.field as keyof CacheRecord]
                    return typeof candidate === "number" && candidate <= clause.value
                  })
                  .map((record) => ({ ...record }))
              },
              async take(n: number) {
                return records
                  .filter((record) => {
                    const candidate = record[clause.field as keyof CacheRecord]
                    return typeof candidate === "number" && candidate <= clause.value
                  })
                  .map((record) => ({ ...record }))
                  .slice(0, n)
              },
            }
          },
        }
      },
      async insert(tableName: string, value: Record<string, unknown>) {
        expect(tableName).toBe("ai_summary_cache")
        insertedRecords.push(value)
        return "inserted-cache-record"
      },
      async patch(id: string, patch: Record<string, unknown>) {
        patchedRecords.push({ id, patch })
      },
      async delete(id: string) {
        deletedIds.push(id)
        const idx = records.findIndex((r) => r._id === id)
        if (idx !== -1) records.splice(idx, 1)
      },
    },
  }
}

describe("ai summary cache cleanup", () => {
  it("scopes cache reads to the workspace-specific url hash", async () => {
    const record = await getHandler(createCacheDb([
      {
        _id: "dev-cache",
        workspaceSlug: "dev",
        urlHash: "same-url",
        generatedAt: 20,
        summary: "Dev summary",
        expiresAt: Date.UTC(2026, 2, 27, 21, 0, 0),
      },
      {
        _id: "hr-cache",
        workspaceSlug: "hr",
        urlHash: "same-url",
        generatedAt: 30,
        summary: "HR summary",
        expiresAt: Date.UTC(2026, 2, 27, 21, 0, 0),
      },
    ]) as never, {
      workspaceSlug: "dev",
      urlHash: "same-url",
    })

    expect(record?._id).toBe("dev-cache")
    expect(record?.summary).toBe("Dev summary")
  })

  it("updates only matching workspace records during upsert", async () => {
    const ctx = createCacheDb([
      {
        _id: "dev-cache",
        workspaceSlug: "dev",
        urlHash: "same-url",
        generatedAt: 10,
        summary: "Dev summary",
        expiresAt: Date.UTC(2026, 2, 27, 20, 0, 0),
      },
      {
        _id: "hr-cache",
        workspaceSlug: "hr",
        urlHash: "same-url",
        generatedAt: 12,
        summary: "HR summary",
        expiresAt: Date.UTC(2026, 2, 27, 20, 0, 0),
      },
    ])

    const result = await upsertHandler(ctx as never, {
      workspaceSlug: "dev",
      urlHash: "same-url",
      query: "machine tools",
      resultCount: 5,
      resultSetHash: "result-set",
      summary: "Updated dev summary",
      model: "anthropic/claude-3-haiku-20240307",
      generatedAt: 99,
      expiresAt: Date.UTC(2026, 2, 27, 22, 0, 0),
    })

    expect(result).toBe("dev-cache")
    expect(ctx.patchedRecords).toEqual([
      {
        id: "dev-cache",
        patch: {
          workspaceSlug: "dev",
          urlHash: "same-url",
          query: "machine tools",
          resultCount: 5,
          resultSetHash: "result-set",
          summary: "Updated dev summary",
          model: "anthropic/claude-3-haiku-20240307",
          generatedAt: 99,
          expiresAt: Date.UTC(2026, 2, 27, 22, 0, 0),
        },
      },
    ])
    expect(ctx.deletedIds).toEqual([])
  })

  it("deletes only expired cache entries", async () => {
    const now = Date.UTC(2026, 2, 27, 20, 0, 0)
    const ctx = createCacheDb([
      { _id: "expired-1", expiresAt: now - 5_000 },
      { _id: "active-1", expiresAt: now + 5_000 },
      { _id: "expired-2", expiresAt: now },
    ])

    const result = await cleanupExpiredHandler(ctx as never, { now })

    expect(result).toEqual({ deleted: 2 })
    expect(ctx.deletedIds).toEqual(["expired-1", "expired-2"])
  })
})
