import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../app'

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

describe('search-profiles run route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches concatenated profile keywords when request keyword is omitted', async () => {
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
        keyword: '车床销售CNC数控',
      },
    })

    const dispatchCall = getDispatchCall(calls)
    expect(dispatchCall.args.keyword).toBe('车床销售CNC数控')
  })

  it('uses explicit request keyword without concatenating profile defaults', async () => {
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
