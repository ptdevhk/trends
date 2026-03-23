import { describe, expect, it } from "vitest";

import { listForBackup } from "../resumes";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type BackupRow = {
  _id: string
  externalId: string
  source: string
  tags: string[]
  crawledAt: number
  content: Record<string, unknown>
  searchText?: string
  primaryRuleScore?: number
  ingestData?: Record<string, unknown>
  analysis?: Record<string, unknown>
  analyses?: Record<string, unknown>
}

const listForBackupHandler = (listForBackup as unknown as ConvexHandler<
  {
    paginationOpts: { cursor: string | null; numItems: number }
    resumeIds?: string[]
    sourceHosts?: string[]
    limit?: number
  },
  { page: BackupRow[]; continueCursor: string; isDone: boolean }
>)._handler

describe("listForBackup", () => {
  it("filters and limits a paginated backup page", async () => {
    const paginate = async (options: { cursor: string | null; numItems: number }) => {
      expect(options).toEqual({ cursor: null, numItems: 2 })
      return {
        page: [
          {
            _id: "resume-2",
            externalId: "hk.employer.seek.com:profile:2002",
            source: "hk.employer.seek.com",
            tags: ["seek"],
            crawledAt: 100,
            content: {
              profileId: "2002",
              profileType: "seek",
              name: "Bob",
              extractedAt: "2026-03-17T00:00:00.000Z",
            },
          },
          {
            _id: "resume-1",
            externalId: "hr.job5156.com:resume:1001",
            source: "hr.job5156.com",
            tags: ["sales", "job5156"],
            crawledAt: 200,
            searchText: "alice sales dongguan",
            primaryRuleScore: 93,
            ingestData: {
              industryTags: ["machine tools"],
            },
            analysis: {
              score: 86,
            },
            analyses: {
              "source:job5156|analysis:lathe-sales": {
                score: 86,
              },
            },
            content: {
              resumeId: "1001",
              name: "Alice",
              extractedAt: "2026-03-17T00:00:00.000Z",
            },
          },
          {
            _id: "resume-3",
            externalId: "hr.job5156.com:resume:1003",
            source: "hr.job5156.com",
            tags: ["ops"],
            crawledAt: 50,
            content: {
              resumeId: "1003",
              name: "Carol",
              extractedAt: "2026-03-17T00:00:00.000Z",
            },
          },
        ],
        continueCursor: "cursor:next",
        isDone: false,
      }
    }

    const ctx = {
      db: {
        query(tableName: string) {
          expect(tableName).toBe("resumes")
          return {
            withIndex(indexName: string) {
              expect(indexName).toBe("by_crawledAt")
              return {
                order(direction: "asc" | "desc") {
                  expect(direction).toBe("desc")
                  return { paginate }
                },
              }
            },
          }
        },
      },
    }

    const result = await listForBackupHandler(ctx as never, {
      paginationOpts: { cursor: null, numItems: 50 },
      sourceHosts: ["hr.job5156.com"],
      limit: 2,
    })

    expect(result).toEqual({
      page: [
        {
          _id: "resume-1",
          externalId: "hr.job5156.com:resume:1001",
          source: "hr.job5156.com",
          tags: ["sales", "job5156"],
          crawledAt: 200,
          searchText: "alice sales dongguan",
          primaryRuleScore: 93,
          ingestData: {
            industryTags: ["machine tools"],
          },
          analysis: {
            score: 86,
          },
          analyses: {
            "source:job5156|analysis:lathe-sales": {
              score: 86,
            },
          },
          content: {
            resumeId: "1001",
            name: "Alice",
            extractedAt: "2026-03-17T00:00:00.000Z",
          },
        },
        {
          _id: "resume-3",
          externalId: "hr.job5156.com:resume:1003",
          source: "hr.job5156.com",
          tags: ["ops"],
          crawledAt: 50,
          content: {
            resumeId: "1003",
            name: "Carol",
            extractedAt: "2026-03-17T00:00:00.000Z",
          },
        },
      ],
      continueCursor: "cursor:next",
      isDone: false,
    })
  })

  it("matches requested resume ids using the shared resume id resolver", async () => {
    const paginate = async (options: { cursor: string | null; numItems: number }) => {
      expect(options).toEqual({ cursor: null, numItems: 25 })
      return {
        page: [
          {
            _id: "resume-1",
            externalId: "seek:profile:2002",
            source: "hk.employer.seek.com",
            tags: ["seek"],
            crawledAt: 100,
            searchText: "bob seek sales",
            primaryRuleScore: 81,
            content: {
              profileId: "2002",
              profileType: "seek",
              profileUrl: "https://hk.employer.seek.com/candidates/2002",
              name: "Bob",
              extractedAt: "2026-03-17T00:00:00.000Z",
            },
          },
          {
            _id: "resume-2",
            externalId: "seek:profile:9999",
            source: "hk.employer.seek.com",
            tags: ["seek"],
            crawledAt: 90,
            content: {
              profileId: "9999",
              profileType: "seek",
              profileUrl: "https://hk.employer.seek.com/candidates/9999",
              name: "Carol",
              extractedAt: "2026-03-17T00:00:00.000Z",
            },
          },
        ],
        continueCursor: "cursor:done",
        isDone: true,
      }
    }

    const ctx = {
      db: {
        query(tableName: string) {
          expect(tableName).toBe("resumes")
          return {
            withIndex(indexName: string) {
              expect(indexName).toBe("by_crawledAt")
              return {
                order(direction: "asc" | "desc") {
                  expect(direction).toBe("desc")
                  return { paginate }
                },
              }
            },
          }
        },
      },
    }

    const result = await listForBackupHandler(ctx as never, {
      paginationOpts: { cursor: null, numItems: 50 },
      resumeIds: ["2002"],
    })

    expect(result.page).toEqual([
      {
        _id: "resume-1",
        externalId: "seek:profile:2002",
        source: "hk.employer.seek.com",
        tags: ["seek"],
        crawledAt: 100,
        searchText: "bob seek sales",
        primaryRuleScore: 81,
        content: {
          profileId: "2002",
          profileType: "seek",
          profileUrl: "https://hk.employer.seek.com/candidates/2002",
          name: "Bob",
          extractedAt: "2026-03-17T00:00:00.000Z",
        },
      },
    ])
    expect(result.isDone).toBe(true)
  })
})
