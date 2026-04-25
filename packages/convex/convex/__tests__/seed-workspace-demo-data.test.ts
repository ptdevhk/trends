import { describe, expect, it } from 'vitest'

import { clearWorkspaceDemoResumes, seedWorkspaceDemoData } from '../seed'

type WorkspaceSeedResult = {
  customJobDescriptions: {
    inserted: number
    updated: number
  }
  searchProfiles: {
    inserted: number
    updated: number
  }
  screeningSessions: {
    inserted: number
    updated: number
  }
  searchHistory: {
    inserted: number
    updated: number
  }
  workspaceConfig: {
    inserted: number
    updated: number
  }
  resumes: {
    inserted: number
    updated: number
  }
}

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type ClearWorkspaceDemoResumesResult = {
  deleted: number
  tag: string
}

type RecordWithId = {
  _id: string
}

type JobDescriptionRecord = RecordWithId & {
  title: string
  slug?: string
  content: string
  type: string
  workspaceSlug?: string
  location?: string
  industryTags?: string[]
  customKeywords?: string[]
  minExperience?: number
  maxAge?: number
  enabled: boolean
  lastModified: number
}

type SearchProfileRecord = RecordWithId & {
  name: string
  criteria: Record<string, unknown>
  profile?: Record<string, unknown>
  workspaceSlug?: string
  lastRunAt?: number
}

type ScreeningSessionRecord = RecordWithId & {
  sessionKey: string
  status: string
  config: Record<string, unknown>
  reviewedResumeIds: string[]
  workspaceSlug?: string
  lastActive: number
}

type SearchHistoryRecord = RecordWithId & {
  sessionKey: string
  title: string
  location: string
  keywords: string[]
  jobDescriptionId?: string
  collectionSource?: {
    type: 'job5156' | '51job' | 'seek'
    exactUrl?: string
  }
  filters?: Record<string, unknown>
  selectedTags?: string[]
  selectedCompanies?: string[]
  selectedExperienceLevel?: string
  workspaceSlug?: string
  createdAt: number
  lastOpenedAt: number
}

type WorkspaceConfigRecord = RecordWithId & {
  workspaceSlug: string
  configKey: string
  configValue: Record<string, unknown>
  updatedAt: number
}

type ResumeRecord = RecordWithId & {
  externalId: string
  identityKey?: string
  content: Record<string, unknown>
  hash: string
  source: string
  tags: string[]
  crawledAt: number
  ingestData?: Record<string, unknown>
  primaryRuleScore?: number
  searchText?: string
}

type SeedTables = {
  job_descriptions: JobDescriptionRecord[]
  search_profiles: SearchProfileRecord[]
  screening_sessions: ScreeningSessionRecord[]
  search_history: SearchHistoryRecord[]
  workspace_config: WorkspaceConfigRecord[]
  resumes: ResumeRecord[]
}

type SupportedTable = keyof SeedTables

const seedWorkspaceDemoDataHandler = (seedWorkspaceDemoData as unknown as ConvexHandler<
  {
    includeDemoResumes?: boolean
  },
  WorkspaceSeedResult
>)._handler

const clearWorkspaceDemoResumesHandler = (clearWorkspaceDemoResumes as unknown as ConvexHandler<
  Record<string, never>,
  ClearWorkspaceDemoResumesResult
>)._handler

function createEqChain(clauses: Array<{ field: string; value: string }>) {
  return {
    eq(field: string, value: string) {
      clauses.push({ field, value })
      return this
    },
  }
}

function createSeedCtx() {
  const tables: SeedTables = {
    job_descriptions: [],
    search_profiles: [],
    screening_sessions: [],
    search_history: [],
    workspace_config: [],
    resumes: [],
  }
  let nextId = 1

  function allocateId(tableName: SupportedTable): string {
    const next = `${tableName}-${nextId}`
    nextId += 1
    return next
  }

  function patchRecord<T extends RecordWithId>(records: T[], id: string, patch: Partial<T>): void {
    const record = records.find((entry) => entry._id === id)
    if (record) {
      Object.assign(record, patch)
    }
  }

  const ctx = {
    db: {
      query(tableName: SupportedTable) {
        if (tableName === 'job_descriptions') {
          return {
            filter(
              apply: (q: {
                eq: (left: unknown, right: unknown) => { left: unknown; right: unknown }
                field: (name: string) => string
              }) => { left: unknown; right: unknown }
            ) {
              const clause = apply({
                eq(left, right) {
                  return { left, right }
                },
                field(name) {
                  return name
                },
              })

              return {
                async collect() {
                  if (clause.left === 'type' && clause.right === 'custom') {
                    return tables.job_descriptions.filter((item) => item.type === 'custom')
                  }
                  return []
                },
              }
            },
            async collect() {
              return tables.job_descriptions
            },
          }
        }

        if (tableName === 'search_profiles') {
          return {
            async collect() {
              return tables.search_profiles
            },
          }
        }

        if (tableName === 'screening_sessions') {
          return {
            async collect() {
              return tables.screening_sessions
            },
          }
        }

        if (tableName === 'search_history') {
          return {
            async collect() {
              return tables.search_history
            },
          }
        }

        if (tableName === 'workspace_config') {
          return {
            withIndex(
              indexName: string,
              apply: (q: { eq: (field: string, value: string) => { eq: (field: string, value: string) => unknown } }) => unknown
            ) {
              expect(indexName).toBe('by_workspace_key')
              const clauses: Array<{ field: string; value: string }> = []
              apply(createEqChain(clauses))

              return {
                async unique() {
                  return tables.workspace_config.find((item) =>
                    clauses.every((clause) => {
                      if (clause.field === 'workspaceSlug') {
                        return item.workspaceSlug === clause.value
                      }
                      if (clause.field === 'configKey') {
                        return item.configKey === clause.value
                      }
                      return false
                    })
                  ) ?? null
                },
              }
            },
          }
        }

        return {
          withIndex(
            indexName: string,
            apply: (q: { eq: (field: string, value: string) => { eq: (field: string, value: string) => unknown } }) => unknown
          ) {
            const clauses: Array<{ field: string; value: string }> = []
            apply(createEqChain(clauses))

            return {
              async unique() {
                if (tableName !== 'resumes') {
                  return null
                }

                if (indexName === 'by_identityKey') {
                  const identity = clauses.find((clause) => clause.field === 'identityKey')?.value
                  return tables.resumes.find((item) => item.identityKey === identity) ?? null
                }

                if (indexName === 'by_externalId') {
                  const externalId = clauses.find((clause) => clause.field === 'externalId')?.value
                  return tables.resumes.find((item) => item.externalId === externalId) ?? null
                }

                return null
              },
            }
          },
          async collect() {
            return tables.resumes
          },
        }
      },
      async insert<T extends SupportedTable>(
        tableName: T,
        value: Omit<SeedTables[T][number], '_id'>
      ) {
        const record = {
          ...value,
          _id: allocateId(tableName),
        } as SeedTables[T][number]
        switch (tableName) {
          case 'job_descriptions':
            tables.job_descriptions.push(record as JobDescriptionRecord)
            break
          case 'search_profiles':
            tables.search_profiles.push(record as SearchProfileRecord)
            break
          case 'screening_sessions':
            tables.screening_sessions.push(record as ScreeningSessionRecord)
            break
          case 'search_history':
            tables.search_history.push(record as SearchHistoryRecord)
            break
          case 'workspace_config':
            tables.workspace_config.push(record as WorkspaceConfigRecord)
            break
          case 'resumes':
            tables.resumes.push(record as ResumeRecord)
            break
        }
        return record._id
      },
      async patch(id: string, patch: Partial<JobDescriptionRecord | SearchProfileRecord | ScreeningSessionRecord | SearchHistoryRecord | WorkspaceConfigRecord | ResumeRecord>) {
        patchRecord(tables.job_descriptions, id, patch as Partial<JobDescriptionRecord>)
        patchRecord(tables.search_profiles, id, patch as Partial<SearchProfileRecord>)
        patchRecord(tables.screening_sessions, id, patch as Partial<ScreeningSessionRecord>)
        patchRecord(tables.search_history, id, patch as Partial<SearchHistoryRecord>)
        patchRecord(tables.workspace_config, id, patch as Partial<WorkspaceConfigRecord>)
        patchRecord(tables.resumes, id, patch as Partial<ResumeRecord>)
      },
      async delete(id: string) {
        tables.job_descriptions = tables.job_descriptions.filter((entry) => entry._id !== id)
        tables.search_profiles = tables.search_profiles.filter((entry) => entry._id !== id)
        tables.screening_sessions = tables.screening_sessions.filter((entry) => entry._id !== id)
        tables.search_history = tables.search_history.filter((entry) => entry._id !== id)
        tables.workspace_config = tables.workspace_config.filter((entry) => entry._id !== id)
        tables.resumes = tables.resumes.filter((entry) => entry._id !== id)
      },
    },
  }

  return { ctx, tables }
}

describe('seedWorkspaceDemoData', () => {
  it('does not seed demo resumes unless explicitly requested', async () => {
    const { ctx, tables } = createSeedCtx()

    const firstRun = await seedWorkspaceDemoDataHandler(ctx as never, {})

    expect(firstRun.resumes).toEqual({ inserted: 0, updated: 0 })
    expect(tables.resumes).toHaveLength(0)
  })

  it('seeds search profiles without JD linkage for the three seed profiles', async () => {
    const { ctx, tables } = createSeedCtx()

    const firstRun = await seedWorkspaceDemoDataHandler(ctx as never, {})

    expect(firstRun.searchProfiles).toEqual({ inserted: 3, updated: 0 })
    expect(tables.search_profiles).toHaveLength(3)

    const seededProfiles = new Map(
      tables.search_profiles.map((record) => [String(record.profile?.id), record.profile ?? {}])
    )

    const job5156Profile = seededProfiles.get('job5156-cn-cnc-sales') as { filters?: Record<string, unknown>; jobDescription?: string } | undefined
    expect(job5156Profile?.filters).toMatchObject({
      minAge: 25,
      maxAge: 40,
    })
    expect(job5156Profile?.jobDescription).toBe("lathe-sales")
    const job51Profile = seededProfiles.get('51job-cn-cnc-sales') as { filters?: Record<string, unknown>; jobDescription?: string } | undefined
    expect(job51Profile?.filters).toMatchObject({
      minAge: 25,
      maxAge: 40,
    })
    expect(job51Profile?.jobDescription).toBeUndefined()
    const seekProfile = seededProfiles.get('seek-malaysia-sales') as { jobDescription?: string } | undefined
    expect(seekProfile?.jobDescription).toBe("seek-malaysia-sales")
  })

  it('seeds one deterministic SEEK Malaysia resume only for explicit demo-resume runs and stays idempotent on rerun', async () => {
    const { ctx, tables } = createSeedCtx()

    const firstRun = await seedWorkspaceDemoDataHandler(ctx as never, {
      includeDemoResumes: true,
    })

    expect(firstRun.resumes).toEqual({ inserted: 1, updated: 0 })
    expect(tables.resumes).toHaveLength(1)
    expect(tables.resumes[0]).toEqual(expect.objectContaining({
      externalId: 'my.employer.seek.com:profile:503033454',
      identityKey: 'profileUrl:my.employer.seek.com/candidates/503033454',
      source: 'my.employer.seek.com',
      primaryRuleScore: 86,
    }))
    expect(tables.resumes[0]?.content).toEqual(expect.objectContaining({
      name: 'Yap Kae Wen',
      location: 'Kuala Lumpur, Malaysia',
      jobIntention: 'Sales Engineer / Sales Manager',
    }))
    expect(tables.resumes[0]?.searchText).toContain('sales engineer')
    expect(tables.resumes[0]?.searchText).toContain('kuala lumpur')
    expect(tables.resumes[0]?.ingestData).toEqual(expect.objectContaining({
      industryTags: ['machinery', 'sales'],
      companyHits: ['Precision Machines Malaysia Sdn Bhd', 'STAR Micronics Asia'],
      experienceLevel: 'senior',
      ruleScores: expect.objectContaining({
        'seek-malaysia-sales': 86,
      }),
    }))

    const secondRun = await seedWorkspaceDemoDataHandler(ctx as never, {
      includeDemoResumes: true,
    })

    expect(secondRun.resumes).toEqual({ inserted: 0, updated: 0 })
    expect(tables.resumes).toHaveLength(1)
  })

  it('clears only workspace-demo resumes', async () => {
    const { ctx, tables } = createSeedCtx()

    await seedWorkspaceDemoDataHandler(ctx as never, {
      includeDemoResumes: true,
    })
    await ctx.db.insert('resumes', {
      externalId: 'real-seek-profile',
      identityKey: 'profileUrl:my.employer.seek.com/candidates/real',
      content: {
        name: 'Real Candidate',
      },
      hash: 'hash-real',
      source: 'my.employer.seek.com',
      tags: ['seek'],
      crawledAt: 1,
    })

    const result = await clearWorkspaceDemoResumesHandler(ctx as never, {})

    expect(result).toEqual({
      deleted: 1,
      tag: 'workspace-demo',
    })
    expect(tables.resumes).toHaveLength(1)
    expect(tables.resumes[0]?.externalId).toBe('real-seek-profile')
  })
})
