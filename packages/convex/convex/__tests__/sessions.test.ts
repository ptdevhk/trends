import { describe, expect, it } from 'vitest'

import { backfillWorkspaceSlugs } from '../migrations'
import { DEFAULT_WORKSPACE_SLUG, listSearchHistory, recentSearches } from '../sessions'

type BackfillWorkspaceSlugsResult = {
  defaultWorkspace: string
  patchedJobDescriptions: number
  patchedSearchProfiles: number
  patchedScreeningSessions: number
  patchedSearchHistory: number
}

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const listSearchHistoryHandler = (listSearchHistory as unknown as ConvexHandler<
  { workspaceSlug?: string },
  SearchHistoryRecord[]
>)._handler

const recentSearchesHandler = (recentSearches as unknown as ConvexHandler<
  { sessionKey: string; workspaceSlug?: string; limit?: number },
  SearchHistoryRecord[]
>)._handler

const backfillWorkspaceSlugsHandler = (backfillWorkspaceSlugs as unknown as ConvexHandler<
  Record<string, never>,
  BackfillWorkspaceSlugsResult
>)._handler

type SearchHistoryRecord = {
  _id: string
  sessionKey: string
  title: string
  location: string
  keywords: string[]
  workspaceSlug?: string
  createdAt: number
  lastOpenedAt?: number
}

type QueryBuilder = {
  withIndex?: (
    indexName: string,
    apply: (q: { eq: (field: string, value: string) => { field: string; value: string } }) => unknown
  ) => {
    collect: () => Promise<SearchHistoryRecord[]>
  }
  filter?: (
    apply: (q: {
      eq: (left: unknown, right: unknown) => { left: unknown; right: unknown }
      field: (name: string) => string
    }) => unknown
  ) => {
    collect: () => Promise<Array<Record<string, unknown>>>
  }
  collect: () => Promise<Array<Record<string, unknown>>>
}

function createSearchHistoryDb(records: SearchHistoryRecord[]) {
  const patches: Array<{ id: string; patch: Partial<SearchHistoryRecord> }> = []

  return {
    patches,
    db: {
      query(tableName: string): QueryBuilder {
        if (tableName === 'search_history') {
          const buildRecords = (fieldName?: string, value?: string) => {
            const next = value === undefined
              ? records
              : records.filter((record) => record[fieldName as keyof SearchHistoryRecord] === value)
            return next.map((record) => ({ ...record }))
          }

          return {
            withIndex(indexName, apply) {
              expect(indexName === 'by_workspace' || indexName === 'by_sessionKey').toBe(true)
              const clause = apply({
                eq(field, value) {
                  return { field, value }
                },
              }) as { field: string; value: string }
              expect(clause.field === 'workspaceSlug' || clause.field === 'sessionKey').toBe(true)

              return {
                async collect() {
                  return buildRecords(clause.field, clause.value)
                },
                async take(n: number) {
                  return buildRecords(clause.field, clause.value).slice(0, n)
                },
                order() {
                  return {
                    async take(n: number) {
                      return buildRecords(clause.field, clause.value).slice(0, n)
                    },
                  }
                },
              }
            },
            async collect() {
              return buildRecords()
            },
          }
        }

        if (tableName === 'job_descriptions') {
          return {
            filter(apply) {
              const clause = apply({
                eq(left, right) {
                  return { left, right }
                },
                field(name) {
                  return name
                },
              }) as { left: unknown; right: unknown }
              expect(clause).toEqual({ left: 'type', right: 'custom' })

              return {
                async collect() {
                  return []
                },
                async take(n: number) {
                  return []
                },
              }
            },
            async collect() {
              return []
            },
          }
        }

        if (tableName === 'industry_db_cohorts') {
          return {
            withIndex(indexName, apply) {
              expect(indexName).toBe('by_workspace')
              const clause = apply({
                eq(field, value) {
                  return { field, value }
                },
              }) as { field: string; value: string }
              expect(clause.field).toBe('workspaceSlug')

              return {
                async collect() {
                  return []
                },
                async take(n: number) {
                  return []
                },
              }
            },
            async collect() {
              return []
            },
          }
        }

        return {
          async collect() {
            return []
          },
        }
      },
      async patch(id: string, patch: Partial<SearchHistoryRecord>) {
        patches.push({ id, patch })
        const record = records.find((entry) => entry._id === id)
        if (record) {
          Object.assign(record, patch)
        }
      },
    },
  }
}

describe('search history workspace rollout safety', () => {
  it('backfills legacy search history into the default workspace query path', async () => {
    const now = Date.UTC(2026, 2, 10, 9, 0, 0)
    const records: SearchHistoryRecord[] = [
      {
        _id: 'legacy-history',
        sessionKey: 'session-1',
        title: 'Legacy search',
        location: '东莞',
        keywords: ['CNC'],
        createdAt: now - 1_000,
      },
      {
        _id: 'hr-history',
        sessionKey: 'session-2',
        title: 'HR search',
        location: '深圳',
        keywords: ['招聘'],
        workspaceSlug: 'hr',
        createdAt: now,
      },
    ]
    const ctx = createSearchHistoryDb(records)

    const beforeBackfill = await listSearchHistoryHandler(ctx as never, { workspaceSlug: DEFAULT_WORKSPACE_SLUG })
    expect(beforeBackfill).toEqual([])

    const result = await backfillWorkspaceSlugsHandler(ctx as never, {})
    expect(result).toEqual(expect.objectContaining({
      defaultWorkspace: DEFAULT_WORKSPACE_SLUG,
      patchedSearchHistory: 1,
    }))
    expect(ctx.patches).toContainEqual({
      id: 'legacy-history',
      patch: { workspaceSlug: DEFAULT_WORKSPACE_SLUG },
    })

    const afterBackfill = await listSearchHistoryHandler(ctx as never, { workspaceSlug: DEFAULT_WORKSPACE_SLUG })
    expect(afterBackfill.map((record) => record._id)).toEqual(['legacy-history'])

    const hrResults = await listSearchHistoryHandler(ctx as never, { workspaceSlug: 'hr' })
    expect(hrResults.map((record) => record._id)).toEqual(['hr-history'])
  })

  it('returns the most recent searches for the active session only', async () => {
    const now = Date.UTC(2026, 2, 27, 11, 0, 0)
    const records: SearchHistoryRecord[] = [
      {
        _id: 'session-older',
        sessionKey: 'session-a',
        title: 'Older search',
        location: 'Malaysia',
        keywords: ['CNC'],
        workspaceSlug: DEFAULT_WORKSPACE_SLUG,
        createdAt: now - 5_000,
      },
      {
        _id: 'session-newer',
        sessionKey: 'session-a',
        title: 'Newer search',
        location: 'Malaysia',
        keywords: ['Machine Tools'],
        workspaceSlug: DEFAULT_WORKSPACE_SLUG,
        createdAt: now - 4_000,
        lastOpenedAt: now,
      },
      {
        _id: 'other-session',
        sessionKey: 'session-b',
        title: 'Other session',
        location: 'Malaysia',
        keywords: ['Robotics'],
        workspaceSlug: DEFAULT_WORKSPACE_SLUG,
        createdAt: now - 1_000,
      },
      {
        _id: 'other-workspace',
        sessionKey: 'session-a',
        title: 'Other workspace',
        location: 'Shenzhen',
        keywords: ['Sales'],
        workspaceSlug: 'hr',
        createdAt: now - 500,
      },
    ]
    const ctx = createSearchHistoryDb(records)

    const result = await recentSearchesHandler(ctx as never, {
      sessionKey: 'session-a',
      workspaceSlug: DEFAULT_WORKSPACE_SLUG,
      limit: 1,
    })

    expect(result.map((record) => record._id)).toEqual(['session-newer'])
  })
})
