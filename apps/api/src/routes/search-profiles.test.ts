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

const runStatusFilePath = path.join(searchProfileService.projectRoot, 'output', 'search-profile-runs.json')

function removeRunStatusFile(): void {
  if (fs.existsSync(runStatusFilePath)) {
    fs.unlinkSync(runStatusFilePath)
  }
}

describe('search-profiles run route', () => {
  beforeEach(() => {
    removeRunStatusFile()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    removeRunStatusFile()
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

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess(null)
      }
      if (call.pathName === 'resume_tasks:dispatch') {
        return convexSuccess('task-concat-default')
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/dongguan-lathe-sales/run', {
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
      profileId: 'dongguan-lathe-sales',
      taskId: 'task-concat-default',
      dispatch: {
        keyword: '车床 销售 CNC 数控',
      },
    })

    const dispatchCall = getDispatchCall(calls)
    expect(dispatchCall.args.keyword).toBe('车床 销售 CNC 数控')
  })

  it('uses explicit request keyword without rewriting it', async () => {
    const calls: ConvexCall[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess(null)
      }
      if (call.pathName === 'resume_tasks:dispatch') {
        return convexSuccess('task-explicit-keyword')
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/dongguan-lathe-sales/run', {
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
      profileId: 'dongguan-lathe-sales',
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

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'search_profiles:getById') {
        return convexSuccess(null)
      }
      if (call.pathName === 'resume_tasks:dispatch') {
        return convexSuccess('task-age-range')
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const response = await app.request('/api/search-profiles/dongguan-lathe-sales/run', {
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
