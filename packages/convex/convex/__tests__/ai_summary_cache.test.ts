import { describe, expect, it } from "vitest";

import { cleanupExpired } from "../ai_summary_cache";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type CacheRecord = {
  _id: string
  expiresAt: number
}

const cleanupExpiredHandler = (cleanupExpired as unknown as ConvexHandler<
  { now?: number },
  { deleted: number }
>)._handler

function createCacheDb(records: CacheRecord[]) {
  const deletedIds: string[] = []

  return {
    deletedIds,
    db: {
      query(tableName: string) {
        expect(tableName).toBe("ai_summary_cache")

        return {
          async collect() {
            return records.map((record) => ({ ...record }))
          },
        }
      },
      async delete(id: string) {
        deletedIds.push(id)
      },
    },
  }
}

describe("ai summary cache cleanup", () => {
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
