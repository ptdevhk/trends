import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../app'
import { searchProfileService } from '../services/search-profile-service'

type ConvexCall = {
  type: 'query' | 'mutation'
  pathName: string
  args: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseConvexCall(input: RequestInfo | URL, init?: RequestInit): ConvexCall {
  const requestUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url

  const type: ConvexCall['type'] = requestUrl.includes('/api/query') ? 'query' : 'mutation'
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  if (!isRecord(body)) {
    throw new Error('Missing convex request body')
  }

  const pathName = typeof body.path === 'string' ? body.path : ''
  const args = isRecord(body.args) ? body.args : {}

  if (!pathName) {
    throw new Error('Missing convex path in request body')
  }

  return {
    type,
    pathName,
    args,
  }
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({
      status: 'success',
      value,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )
}

function getDispatchCall(calls: ConvexCall[]): ConvexCall {
  const dispatchCall = calls.find((call) => call.pathName === 'resume_tasks:dispatch')
  if (!dispatchCall) {
    throw new Error('Expected resume_tasks:dispatch call')
  }
  return dispatchCall
}

function getUpdateCall(calls: ConvexCall[]): ConvexCall {
  const updateCall = calls.find((call) => call.pathName === 'search_profiles:update')
  if (!updateCall) {
    throw new Error('Expected search_profiles:update call')
  }
  return updateCall
}

function getCreateCalls(calls: ConvexCall[]): ConvexCall[] {
  return calls.filter((call) => call.pathName === 'search_profiles:create')
}

const runStatusFilePath = path.join(searchProfileService.projectRoot, 'output', 'search-profile-runs.json')
const seededJob51Profile = {
  id: '51job-cn-cnc-sales',
  name: 'China 51job CNC Sales',
  description: 'China-wide 51job CNC sales search profile used for the landing quick start',
  createdAt: '2026-04-02',
  updatedAt: '2026-04-02',
  status: 'active' as const,
  location: 'China',
  keywords: ['CNC', '销售'],
  jobDescription: 'lathe-sales',
  filters: {
    minExperience: 2,
    maxExperience: null,
    locations: ['China'],
  },
  schedule: {
    enabled: true,
    cron: '0 9 * * 1-5',
    timezone: 'Asia/Shanghai',
    maxCandidates: 200,
  },
  sources: [
    {
      type: '51job',
      enabled: true,
      priority: 1,
    },
    {
      type: 'job5156',
      enabled: false,
      priority: 2,
    },
  ],
  quickStart: {
    enabled: true,
    rank: 2,
    label: 'China · 51job · CNC 销售',
    description: 'CNC, 销售 · China',
  },
}

function removeRunStatusFile(): void {
  if (fs.existsSync(runStatusFilePath)) {
    fs.unlinkSync(runStatusFilePath)
  }
}

describe('search-profiles list route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('materializes seeded template profiles into editable workspace records', async () => {
    const records: Array<Record<string, unknown>> = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)

      if (call.pathName === 'search_profiles:list') {
        return convexSuccess(records)
      }

      if (call.pathName === 'search_profiles:create') {
        if (!isRecord(call.args.profile)) {
          throw new Error('Expected profile payload for seed materialization')
        }

        const logicalId = typeof call.args.profile.id === 'string' ? call.args.profile.id : `profile-${records.length + 1}`
        const filters = isRecord(call.args.profile.filters) ? call.args.profile.filters : {}
        const filterLocations = Array.isArray(filters.locations) ? filters.locations : []
        const now = Date.now()
        const record = {
          _id: `search_profiles-${records.length + 1}`,
          name: call.args.profile.name,
          profileId: logicalId,
          criteria: {
            keywords: call.args.profile.keywords,
            locations: filterLocations.length > 0
              ? filterLocations
              : [call.args.profile.location].filter(Boolean),
          },
          profile: call.args.profile,
          workspaceSlug: call.args.workspaceSlug,
          createdAt: now,
          updatedAt: now,
        }
        records.push(record)
        return convexSuccess(record)
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles', {
      headers: {
        'X-Workspace-Slug': 'dev',
      },
    })

    expect(response.status).toBe(200)
    const payload = await response.json()

    expect(payload.success).toBe(true)
    expect(payload.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'job5156-cn-cnc-sales',
          filters: expect.objectContaining({
            minAge: 25,
            maxAge: 40,
            minExperience: 2,
          }),
          sources: expect.arrayContaining([
            expect.objectContaining({
              type: 'job5156',
              enabled: true,
            }),
          ]),
          quickStart: expect.objectContaining({
            enabled: true,
            rank: 1,
            label: 'China · Job5156 · CNC 销售',
          }),
        }),
        expect.objectContaining({
          id: '51job-cn-cnc-sales',
          filters: expect.objectContaining({
            minAge: 25,
            maxAge: 40,
            minExperience: 2,
          }),
          sources: expect.arrayContaining([
            expect.objectContaining({
              type: '51job',
              enabled: true,
            }),
          ]),
          quickStart: expect.objectContaining({
            enabled: true,
            rank: 2,
            label: 'China · 51job · CNC 销售',
          }),
        }),
        expect.objectContaining({
          id: 'seek-malaysia-sales',
          filters: expect.objectContaining({
            maxAge: 45,
            minExperience: 2,
          }),
          sources: expect.arrayContaining([
            expect.objectContaining({
              type: 'seek',
              enabled: true,
            }),
          ]),
          quickStart: expect.objectContaining({
            enabled: true,
            rank: 3,
            label: 'Malaysia · SEEK · CNC Sales',
          }),
        }),
      ]),
    )
    expect(records).toHaveLength(3)
  })

  it('exposes scheduled runtime profiles from workspace-managed storage across known workspaces', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)

      if (call.pathName === 'search_profiles:list') {
        const workspaceSlug = typeof call.args.workspaceSlug === 'string' ? call.args.workspaceSlug : 'dev'

        if (workspaceSlug === 'dev') {
          return convexSuccess([
            {
              _id: 'search_profiles-dev-1',
              name: 'China Job5156 CNC Sales',
              profileId: 'job5156-cn-cnc-sales',
              criteria: {
                keywords: ['CNC', '销售'],
                locations: ['China'],
              },
              profile: {
                id: 'job5156-cn-cnc-sales',
                name: 'China Job5156 CNC Sales',
                status: 'active',
                location: 'China',
                keywords: ['CNC', '销售'],
                schedule: {
                  enabled: true,
                  cron: '0 9 * * 1-5',
                  maxCandidates: 200,
                },
              },
              workspaceSlug: 'dev',
            },
            {
              _id: 'search_profiles-dev-2',
              name: 'SEEK Malaysia CNC Sales',
              profileId: 'seek-malaysia-sales',
              criteria: {
                keywords: ['CNC', 'Sales'],
                locations: ['Kuala Lumpur MY'],
              },
              profile: {
                id: 'seek-malaysia-sales',
                name: 'SEEK Malaysia CNC Sales',
                status: 'active',
                location: 'Kuala Lumpur MY',
                keywords: ['CNC', 'Sales'],
                schedule: {
                  enabled: false,
                },
              },
              workspaceSlug: 'dev',
            },
            {
              _id: 'search_profiles-dev-3',
              name: 'China 51job CNC Sales',
              profileId: '51job-cn-cnc-sales',
              criteria: {
                keywords: ['CNC', '销售'],
                locations: ['China'],
              },
              profile: {
                id: '51job-cn-cnc-sales',
                name: 'China 51job CNC Sales',
                status: 'active',
                location: 'China',
                keywords: ['CNC', '销售'],
                schedule: {
                  enabled: true,
                  cron: '0 9 * * 1-5',
                  maxCandidates: 200,
                },
              },
              workspaceSlug: 'dev',
            },
          ])
        }

        if (workspaceSlug === 'hr') {
          return convexSuccess([
            {
              _id: 'search_profiles-hr-1',
              name: 'HR resume ops',
              profileId: 'hr-profile-1',
              criteria: {
                keywords: ['招聘', '简历'],
                locations: ['东莞'],
              },
              profile: {
                id: 'hr-profile-1',
                name: 'HR resume ops',
                status: 'active',
                location: '东莞',
                keywords: ['招聘', '简历'],
                schedule: {
                  enabled: true,
                  cron: '*/30 * * * *',
                  maxCandidates: 50,
                },
              },
              workspaceSlug: 'hr',
            },
          ])
        }

        return convexSuccess([])
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/runtime', {
      headers: {
        'X-Workspace-Slug': 'dev',
      },
    })

    expect(response.status).toBe(200)
    const payload = await response.json()

    expect(payload).toEqual({
      success: true,
      items: expect.arrayContaining([
        expect.objectContaining({
          workspaceSlug: 'dev',
          profileId: 'job5156-cn-cnc-sales',
          cron: '0 9 * * 1-5',
        }),
        expect.objectContaining({
          workspaceSlug: 'dev',
          profileId: '51job-cn-cnc-sales',
          cron: '0 9 * * 1-5',
        }),
        expect.objectContaining({
          workspaceSlug: 'hr',
          profileId: 'hr-profile-1',
          cron: '*/30 * * * *',
        }),
      ]),
    })
    expect(payload.items).toHaveLength(3)
  })
})

describe('search-profiles run route', () => {
  beforeEach(() => {
    removeRunStatusFile()
    process.env.ENABLE_HEADLESS_COLLECTOR = 'true'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    removeRunStatusFile()
    delete process.env.ENABLE_HEADLESS_COLLECTOR
  })

  it('uses workspace-scoped custom profiles for hr runs', async () => {
    const calls: ConvexCall[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess({
          _id: 'hr-profile-1',
          name: 'HR resume ops',
          profile: {
            id: 'hr-profile-1',
            name: 'HR resume ops',
            status: 'active',
            location: '东莞',
            keywords: ['招聘', '简历'],
          },
          criteria: {
            keywords: ['招聘', '简历'],
            locations: ['东莞'],
          },
          workspaceSlug: 'hr',
        })
      }
      if (call.pathName === 'resume_tasks:dispatch') {
        return convexSuccess('task-hr-profile')
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/hr-profile-1/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'hr',
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      profileId: 'hr-profile-1',
      taskId: 'task-hr-profile',
      dispatch: {
        keyword: '招聘 简历',
        location: '东莞',
      },
    })

    expect(calls[0]).toMatchObject({
      pathName: 'search_profiles:getById',
      args: {
        id: 'hr-profile-1',
        workspaceSlug: 'hr',
      },
    })

    const dispatchCall = getDispatchCall(calls)
    expect(dispatchCall.args.keyword).toBe('招聘 简历')
    expect(dispatchCall.args.location).toBe('东莞')
  })

  it('dispatches normalized spaced profile keywords when request keyword is omitted', async () => {
    const calls: ConvexCall[] = []
    let materialized = false

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        if (!materialized) {
          return convexSuccess(null)
        }

        return convexSuccess({
          _id: 'search_profiles-seeded-1',
          profileId: '51job-cn-cnc-sales',
          name: 'China 51job CNC Sales',
          profile: seededJob51Profile,
          criteria: {
            keywords: ['CNC', '销售'],
            locations: ['China'],
          },
          workspaceSlug: 'dev',
        })
      }
      if (call.pathName === 'search_profiles:create') {
        materialized = true
        return convexSuccess({
          _id: 'search_profiles-seeded-1',
          profileId: '51job-cn-cnc-sales',
          name: 'China 51job CNC Sales',
          profile: call.args.profile,
          criteria: {
            keywords: ['CNC', '销售'],
            locations: ['China'],
          },
          workspaceSlug: 'dev',
        })
      }
      if (call.pathName === 'resume_tasks:dispatch') {
        return convexSuccess('task-concat-default')
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/51job-cn-cnc-sales/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'dev',
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      profileId: '51job-cn-cnc-sales',
      taskId: 'task-concat-default',
      dispatch: {
        keyword: 'CNC 销售',
      },
    })

    const dispatchCall = getDispatchCall(calls)
    expect(dispatchCall.args.keyword).toBe('CNC 销售')
  })

  it('uses explicit request keyword without rewriting it', async () => {
    const calls: ConvexCall[] = []
    let materialized = false

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        if (!materialized) {
          return convexSuccess(null)
        }

        return convexSuccess({
          _id: 'search_profiles-seeded-1',
          profileId: '51job-cn-cnc-sales',
          name: 'China 51job CNC Sales',
          profile: seededJob51Profile,
          criteria: {
            keywords: ['CNC', '销售'],
            locations: ['China'],
          },
          workspaceSlug: 'dev',
        })
      }
      if (call.pathName === 'search_profiles:create') {
        materialized = true
        return convexSuccess({
          _id: 'search_profiles-seeded-1',
          profileId: '51job-cn-cnc-sales',
          name: 'China 51job CNC Sales',
          profile: call.args.profile,
          criteria: {
            keywords: ['CNC', '销售'],
            locations: ['China'],
          },
          workspaceSlug: 'dev',
        })
      }
      if (call.pathName === 'resume_tasks:dispatch') {
        return convexSuccess('task-explicit-keyword')
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/51job-cn-cnc-sales/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'dev',
      },
      body: JSON.stringify({
        keyword: 'CNC 车床 销售 STAR',
      }),
    })

    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      profileId: '51job-cn-cnc-sales',
      taskId: 'task-explicit-keyword',
      dispatch: {
        keyword: 'CNC 车床 销售 STAR',
      },
    })

    const dispatchCall = getDispatchCall(calls)
    expect(dispatchCall.args.keyword).toBe('CNC 车床 销售 STAR')
  })

  it('passes age range overrides to Convex dispatch when provided', async () => {
    const calls: ConvexCall[] = []
    let materialized = false

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        if (!materialized) {
          return convexSuccess(null)
        }

        return convexSuccess({
          _id: 'search_profiles-seeded-1',
          profileId: '51job-cn-cnc-sales',
          name: 'China 51job CNC Sales',
          profile: seededJob51Profile,
          criteria: {
            keywords: ['CNC', '销售'],
            locations: ['China'],
          },
          workspaceSlug: 'dev',
        })
      }
      if (call.pathName === 'search_profiles:create') {
        materialized = true
        return convexSuccess({
          _id: 'search_profiles-seeded-1',
          profileId: '51job-cn-cnc-sales',
          name: 'China 51job CNC Sales',
          profile: call.args.profile,
          criteria: {
            keywords: ['CNC', '销售'],
            locations: ['China'],
          },
          workspaceSlug: 'dev',
        })
      }
      if (call.pathName === 'resume_tasks:dispatch') {
        return convexSuccess('task-age-range')
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/51job-cn-cnc-sales/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'dev',
      },
      body: JSON.stringify({
        minAge: 25,
        maxAge: 40,
      }),
    })

    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      taskId: 'task-age-range',
      dispatch: {
        minAge: 25,
        maxAge: 40,
      },
    })

    const dispatchCall = getDispatchCall(calls)
    expect(dispatchCall.args.minAge).toBe(25)
    expect(dispatchCall.args.maxAge).toBe(40)
  })
})

describe('search-profiles status route', () => {
  beforeEach(() => {
    removeRunStatusFile()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    removeRunStatusFile()
  })

  it('reads workspace-scoped run status for hr without leaking the dev sidecar entry', async () => {
    fs.mkdirSync(path.dirname(runStatusFilePath), { recursive: true })
    fs.writeFileSync(runStatusFilePath, JSON.stringify({
      'dev:shared-profile': {
        profileId: 'shared-profile',
        taskId: 'task-dev',
        taskStatus: 'completed',
        startedAt: '2026-03-09T09:00:00.000Z',
        updatedAt: '2026-03-09T09:05:00.000Z',
        completedAt: '2026-03-09T09:05:00.000Z',
        submitted: 8,
      },
      'hr:shared-profile': {
        profileId: 'shared-profile',
        taskId: 'task-hr',
        taskStatus: 'pending',
        startedAt: '2026-03-09T10:00:00.000Z',
        updatedAt: '2026-03-09T10:00:00.000Z',
      },
    }, null, 2), 'utf8')

    const calls: ConvexCall[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess({
          _id: 'shared-profile',
          name: 'HR shared profile',
          profile: {
            id: 'shared-profile',
            name: 'HR shared profile',
            status: 'active',
            location: '东莞',
            keywords: ['招聘', '简历'],
          },
          criteria: {
            keywords: ['招聘', '简历'],
            locations: ['东莞'],
          },
          workspaceSlug: 'hr',
        })
      }

      if (call.pathName === 'resume_tasks:getById') {
        return convexSuccess({
          _id: 'task-hr',
          status: 'processing',
          progress: {
            current: 3,
            total: 10,
            page: 1,
          },
        })
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/shared-profile/status', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    expect(calls[0]).toMatchObject({
      pathName: 'search_profiles:getById',
      args: {
        id: 'shared-profile',
        workspaceSlug: 'hr',
      },
    })
    expect(calls[1]).toMatchObject({
      pathName: 'search_profiles:getById',
      args: {
        id: 'shared-profile',
        workspaceSlug: 'hr',
      },
    })
    expect(calls[2]).toMatchObject({
      pathName: 'resume_tasks:getById',
      args: {
        taskId: 'task-hr',
      },
    })

    expect(await response.json()).toEqual({
      success: true,
      status: {
        profileId: 'shared-profile',
        taskId: 'task-hr',
        taskStatus: 'processing',
        startedAt: '2026-03-09T10:00:00.000Z',
        updatedAt: expect.any(String),
        resultCount: 3,
      },
    })
  })

  it('returns null status when the requested workspace has no stored run status entry', async () => {
    fs.mkdirSync(path.dirname(runStatusFilePath), { recursive: true })
    fs.writeFileSync(runStatusFilePath, JSON.stringify({
      'dev:shared-profile': {
        profileId: 'shared-profile',
        taskId: 'task-dev',
        taskStatus: 'completed',
        startedAt: '2026-03-09T09:00:00.000Z',
        updatedAt: '2026-03-09T09:05:00.000Z',
        completedAt: '2026-03-09T09:05:00.000Z',
      },
    }, null, 2), 'utf8')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess({
          _id: 'shared-profile',
          name: 'HR shared profile',
          profile: {
            id: 'shared-profile',
            name: 'HR shared profile',
            status: 'active',
            location: '东莞',
            keywords: ['招聘', '简历'],
          },
          criteria: {
            keywords: ['招聘', '简历'],
            locations: ['东莞'],
          },
          workspaceSlug: 'hr',
        })
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/shared-profile/status', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      status: null,
    })
  })
})

describe('search-profiles update route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('materializes a seeded template profile into workspace storage before updating it', async () => {
    const calls: ConvexCall[] = []
    const existingCreatedAt = Date.now() - 1000
    let seededRecord: Record<string, unknown> | null = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess(seededRecord)
      }

      if (call.pathName === 'search_profiles:create') {
        if (!isRecord(call.args.profile)) {
          throw new Error('Expected seeded profile payload')
        }

        seededRecord = {
          _id: 'search_profiles-seeded-1',
          name: call.args.profile.name,
          profileId: call.args.profile.id,
          criteria: {
            keywords: call.args.profile.keywords,
            locations: [call.args.profile.location].filter(Boolean),
          },
          profile: call.args.profile,
          workspaceSlug: 'dev',
          createdAt: existingCreatedAt,
          updatedAt: existingCreatedAt,
        }
        return convexSuccess(seededRecord)
      }

      if (call.pathName === 'search_profiles:update') {
        if (!isRecord(call.args.profile) || !seededRecord) {
          throw new Error('Expected updated seeded profile payload')
        }

        seededRecord = {
          ...seededRecord,
          name: call.args.profile.name,
          criteria: {
            keywords: call.args.profile.keywords,
            locations: [call.args.profile.location].filter(Boolean),
          },
          profile: call.args.profile,
          updatedAt: Date.now(),
        }
        return convexSuccess(seededRecord)
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/job5156-cn-cnc-sales', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'dev',
      },
      body: JSON.stringify({
        name: 'China Job5156 CNC Sales',
        location: 'China',
        keywords: ['CNC', '销售', '机床'],
        status: 'active',
        quickStart: {
          enabled: true,
          rank: 1,
          label: 'China · Job5156 · CNC 销售',
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(getCreateCalls(calls)).toHaveLength(1)

    const updateCall = getUpdateCall(calls)
    expect(updateCall.args.id).toBe('search_profiles-seeded-1')
    expect(isRecord(updateCall.args.profile)).toBe(true)
    if (!isRecord(updateCall.args.profile)) {
      throw new Error('Expected updated profile payload')
    }
    expect(updateCall.args.profile.id).toBe('job5156-cn-cnc-sales')
    expect(updateCall.args.profile.seedSource).toBe('config/search-profiles')
    expect(updateCall.args.profile.keywords).toEqual(['CNC', '销售', '机床'])

    const payload = await response.json()
    expect(payload.success).toBe(true)
    expect(payload.profile.id).toBe('job5156-cn-cnc-sales')
    expect(payload.profile.keywords).toEqual(['CNC', '销售', '机床'])
  })

  it('syncs linked custom JD auto_match keywords without moving other filters under auto_match', async () => {
    const calls: ConvexCall[] = []
    const existingCreatedAt = Date.now() - 1000

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess({
          _id: 'custom-profile-1',
          name: 'CNC销售-Demo',
          criteria: {
            keywords: ['销售', 'CNC'],
            locations: ['广东'],
          },
          profile: {
            id: 'custom-profile-1',
            name: 'CNC销售-Demo',
            status: 'active',
            location: '广东',
            keywords: ['销售', 'CNC'],
            jobDescription: 'custom-jd-1',
            filters: {
              minExperience: 1,
              maxAge: 45,
            },
          },
          workspaceSlug: 'dev',
          createdAt: existingCreatedAt,
          updatedAt: existingCreatedAt,
        })
      }

      if (call.pathName === 'job_descriptions:get') {
        return convexSuccess({
          _id: 'custom-jd-1',
          type: 'custom',
          title: '车床销售',
          workspaceSlug: 'dev',
          location: '广东',
          industryTags: ['machinery', 'cnc', 'sales'],
          minExperience: 1,
          maxAge: 45,
        })
      }

      if (call.pathName === 'search_profiles:update') {
        return convexSuccess({
          _id: 'custom-profile-1',
          name: 'CNC销售-Demo',
          criteria: {
            keywords: ['销售', 'CNC', '车床'],
            locations: ['广东'],
          },
          profile: {
            id: 'custom-profile-1',
            name: 'CNC销售-Demo',
            status: 'active',
            location: '广东',
            keywords: ['销售', 'CNC', '车床'],
            jobDescription: 'custom-jd-1',
            filters: {
              minExperience: 1,
              maxAge: 45,
            },
          },
          workspaceSlug: 'dev',
          createdAt: existingCreatedAt,
          updatedAt: Date.now(),
        })
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/custom-profile-1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'dev',
      },
      body: JSON.stringify({
        name: 'CNC销售-Demo',
        location: '广东',
        keywords: ['销售', 'CNC', '车床'],
        status: 'active',
        jobDescription: 'custom-jd-1',
        filters: {
          minExperience: 1,
          maxAge: 45,
        },
      }),
    })

    expect(response.status).toBe(200)

    const updateCall = getUpdateCall(calls)
    expect(updateCall.args.jobDescriptionSync).toMatchObject({
      id: 'custom-jd-1',
      customKeywords: ['销售', 'CNC', '车床'],
    })
    if (!isRecord(updateCall.args.jobDescriptionSync)) {
      throw new Error('Expected jobDescriptionSync payload')
    }
    expect(typeof updateCall.args.jobDescriptionSync.content).toBe('string')
    expect(updateCall.args.jobDescriptionSync.content).toContain('auto_match:')
    expect(updateCall.args.jobDescriptionSync.content).toContain('  keywords:')
    expect(updateCall.args.jobDescriptionSync.content).toContain('min_experience: 1')
    expect(updateCall.args.jobDescriptionSync.content).toContain('max_age: 45')
    expect(updateCall.args.jobDescriptionSync.content).not.toContain('  locations:')
    expect(updateCall.args.jobDescriptionSync.content).not.toContain('suggested_filters:')
  })

  it('clears optional job description linkage and filters when the editor sends explicit nulls', async () => {
    const calls: ConvexCall[] = []
    const existingCreatedAt = Date.now() - 1000

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess({
          _id: 'custom-profile-1',
          name: 'CNC销售-Demo',
          criteria: {
            keywords: ['销售', 'CNC'],
            locations: ['广东'],
          },
          profile: {
            id: 'custom-profile-1',
            name: 'CNC销售-Demo',
            status: 'active',
            location: '广东',
            keywords: ['销售', 'CNC'],
            jobDescription: 'js7bbr2wheavb7krrycbz2gvn182d88y',
            filters: {
              minExperience: 1,
              maxAge: 40,
            },
            schedule: {
              enabled: true,
              cron: '0 9 * * 1-5',
            },
          },
          workspaceSlug: 'dev',
          createdAt: existingCreatedAt,
          updatedAt: existingCreatedAt,
        })
      }

      if (call.pathName === 'search_profiles:update') {
        if (!isRecord(call.args.profile)) {
          throw new Error('Expected updated profile payload')
        }

        return convexSuccess({
          _id: 'custom-profile-1',
          name: call.args.profile.name,
          criteria: {
            keywords: call.args.profile.keywords,
            locations: [call.args.profile.location],
          },
          profile: call.args.profile,
          workspaceSlug: 'dev',
          createdAt: existingCreatedAt,
          updatedAt: Date.now(),
        })
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/custom-profile-1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'dev',
      },
      body: JSON.stringify({
        name: 'CNC销售-Demo',
        location: '广东',
        keywords: ['销售', 'CNC'],
        status: 'active',
        jobDescription: null,
        filters: null,
        schedule: {
          enabled: true,
          cron: '0 9 * * 1-5',
        },
      }),
    })

    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.success).toBe(true)
    expect(payload.profile.jobDescription).toBeUndefined()
    expect(payload.profile.filters).toBeUndefined()

    const updateCall = getUpdateCall(calls)
    expect(isRecord(updateCall.args.profile)).toBe(true)
    if (!isRecord(updateCall.args.profile)) {
      throw new Error('Expected record payload')
    }
    expect('jobDescription' in updateCall.args.profile).toBe(false)
    expect('filters' in updateCall.args.profile).toBe(false)
  })

  it('persists Seek source job URLs on profile updates', async () => {
    const calls: ConvexCall[] = []
    const existingCreatedAt = Date.now() - 1000

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess({
          _id: 'custom-profile-1',
          name: 'Seek profile',
          criteria: {
            keywords: ['Sales', 'Engineer'],
            locations: ['Kuala Lumpur MY'],
          },
          profile: {
            id: 'custom-profile-1',
            name: 'Seek profile',
            status: 'active',
            location: 'Kuala Lumpur MY',
            keywords: ['Sales', 'Engineer'],
            sources: [
              {
                type: 'job5156',
                enabled: true,
                priority: 1,
              },
            ],
          },
          workspaceSlug: 'dev',
          createdAt: existingCreatedAt,
          updatedAt: existingCreatedAt,
        })
      }

      if (call.pathName === 'search_profiles:update') {
        if (!isRecord(call.args.profile)) {
          throw new Error('Expected updated profile payload')
        }

        return convexSuccess({
          _id: 'custom-profile-1',
          name: call.args.profile.name,
          criteria: {
            keywords: call.args.profile.keywords,
            locations: [call.args.profile.location],
          },
          profile: call.args.profile,
          workspaceSlug: 'dev',
          createdAt: existingCreatedAt,
          updatedAt: Date.now(),
        })
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/custom-profile-1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'dev',
      },
      body: JSON.stringify({
        name: 'Seek profile',
        location: 'Kuala Lumpur MY',
        keywords: ['Sales', 'Engineer'],
        status: 'active',
        sources: [
          {
            type: 'job5156',
            enabled: true,
            priority: 1,
          },
          {
            type: 'seek',
            enabled: true,
            priority: 2,
            jobUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
          },
        ],
      }),
    })

    expect(response.status).toBe(200)

    const updateCall = getUpdateCall(calls)
    expect(isRecord(updateCall.args.profile)).toBe(true)
    if (!isRecord(updateCall.args.profile) || !Array.isArray(updateCall.args.profile.sources)) {
      throw new Error('Expected sources array in updated profile payload')
    }
    expect(updateCall.args.profile.sources).toContainEqual({
      type: 'seek',
      enabled: true,
      priority: 2,
      jobUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
    })
  })

  it('allows saving an explicitly empty location without restoring the previous one', async () => {
    const calls: ConvexCall[] = []
    const existingCreatedAt = Date.now() - 1000

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess({
          _id: 'custom-profile-1',
          name: 'CNC销售-Demo',
          criteria: {
            keywords: ['销售', 'CNC'],
            locations: ['广东,江苏'],
          },
          profile: {
            id: 'custom-profile-1',
            name: 'CNC销售-Demo',
            status: 'active',
            location: '广东,江苏',
            keywords: ['销售', 'CNC'],
          },
          workspaceSlug: 'dev',
          createdAt: existingCreatedAt,
          updatedAt: existingCreatedAt,
        })
      }

      if (call.pathName === 'search_profiles:update') {
        if (!isRecord(call.args.profile)) {
          throw new Error('Expected updated profile payload')
        }

        return convexSuccess({
          _id: 'custom-profile-1',
          name: call.args.profile.name,
          criteria: {
            keywords: call.args.profile.keywords,
            locations: [],
          },
          profile: call.args.profile,
          workspaceSlug: 'dev',
          createdAt: existingCreatedAt,
          updatedAt: Date.now(),
        })
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/custom-profile-1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'dev',
      },
      body: JSON.stringify({
        name: 'CNC销售-Demo',
        location: '',
        keywords: ['销售', 'CNC'],
        status: 'active',
      }),
    })

    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.success).toBe(true)
    expect(payload.profile.location).toBe('')

    const updateCall = getUpdateCall(calls)
    expect(isRecord(updateCall.args.profile)).toBe(true)
    if (!isRecord(updateCall.args.profile)) {
      throw new Error('Expected record payload')
    }
    expect(updateCall.args.profile.location).toBe('')
  })
})

describe('search-profiles delete route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tombstones a materialized seeded profile so it does not reappear on the next list', async () => {
    const calls: ConvexCall[] = []
    const records: Array<Record<string, unknown>> = []

    function buildCriteria(profile: Record<string, unknown>) {
      const filters = isRecord(profile.filters) ? profile.filters : {}
      const filterLocations = Array.isArray(filters.locations) ? filters.locations : []
      return {
        keywords: Array.isArray(profile.keywords) ? profile.keywords : [],
        locations: filterLocations.length > 0
          ? filterLocations
          : [profile.location].filter(Boolean),
      }
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:list') {
        return convexSuccess(records)
      }

      if (call.pathName === 'search_profiles:getById') {
        const found = records.find((record) => (
          String(record._id) === call.args.id
          || record.profileId === call.args.id
        )) ?? null
        return convexSuccess(found)
      }

      if (call.pathName === 'search_profiles:create') {
        if (!isRecord(call.args.profile)) {
          throw new Error('Expected profile payload for seeded create')
        }

        const profile = call.args.profile
        const record = {
          _id: `search_profiles-${records.length + 1}`,
          name: profile.name,
          profileId: profile.id,
          criteria: buildCriteria(profile),
          profile,
          workspaceSlug: call.args.workspaceSlug,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        records.push(record)
        return convexSuccess(record)
      }

      if (call.pathName === 'search_profiles:update') {
        const existingIndex = records.findIndex((record) => String(record._id) === call.args.id)
        if (existingIndex < 0 || !isRecord(call.args.profile)) {
          throw new Error('Expected existing seeded record for update')
        }

        const nextRecord = {
          ...records[existingIndex],
          name: call.args.profile.name,
          criteria: buildCriteria(call.args.profile),
          profile: call.args.profile,
          updatedAt: Date.now(),
        }
        records.splice(existingIndex, 1, nextRecord)
        return convexSuccess(nextRecord)
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const deleteResponse = await app.request('/api/search-profiles/seek-malaysia-sales', {
      method: 'DELETE',
      headers: {
        'X-Workspace-Slug': 'dev',
      },
    })

    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toEqual({ success: true })

    const deleteUpdateCall = getUpdateCall(calls)
    expect(isRecord(deleteUpdateCall.args.profile)).toBe(true)
    if (!isRecord(deleteUpdateCall.args.profile)) {
      throw new Error('Expected tombstone profile payload')
    }
    expect(deleteUpdateCall.args.profile.id).toBe('seek-malaysia-sales')
    expect(deleteUpdateCall.args.profile.seedSource).toBe('config/search-profiles')
    expect(typeof deleteUpdateCall.args.profile.deletedAt).toBe('number')

    const listResponse = await app.request('/api/search-profiles', {
      headers: {
        'X-Workspace-Slug': 'dev',
      },
    })

    expect(listResponse.status).toBe(200)
    const listPayload = await listResponse.json()
    expect(listPayload.success).toBe(true)
    expect(listPayload.profiles).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'seek-malaysia-sales',
        }),
      ]),
    )
    expect(getCreateCalls(calls)).toHaveLength(3)
  })
})
