import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../app'
import { resetResumeScreeningDb } from '../services/database'
import { createAuthHeaders } from './test-auth-helpers'

type ConvexCall = {
  type: 'query' | 'mutation'
  pathName: string
  args: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseConvexCall(input: Request | string | URL, init?: RequestInit): ConvexCall {
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
    }
  )
}

describe('blocks route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetResumeScreeningDb()
  })

  it('respects workspace isolation via X-Workspace-Slug on list', async () => {
    const calls: ConvexCall[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)
      if (call.pathName === 'candidate_blocks:list') {
        return convexSuccess([])
      }
      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp()
    const hrResponse = await app.request('/api/blocks', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })
    const devResponse = await app.request('/api/blocks')

    expect(hrResponse.status).toBe(200)
    expect(devResponse.status).toBe(200)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.args.workspaceSlug).toBe('hr')
    expect(calls[1]?.args.workspaceSlug).toBe('dev')
  })

  it('rejects block mutations without a session', async () => {
    const calls: ConvexCall[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init))
      return convexSuccess(null)
    })

    const app = createApp()
    const postResponse = await app.request('/api/blocks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'hr',
      },
      body: JSON.stringify({ identityKey: 'resume-1' }),
    })
    const patchResponse = await app.request('/api/blocks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'hr',
      },
      body: JSON.stringify({ identityKey: 'resume-1', reason: 'duplicate' }),
    })
    const deleteResponse = await app.request('/api/blocks?identityKey=resume-1', {
      method: 'DELETE',
      headers: { 'X-Workspace-Slug': 'hr' },
    })

    expect(postResponse.status).toBe(401)
    expect(patchResponse.status).toBe(401)
    expect(deleteResponse.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('passes hr workspace slug and authenticated actor through bulk block requests', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'hr', role: 'user' })
    const calls: ConvexCall[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'candidate_blocks:bulkUpsert') {
        return convexSuccess({ inserted: 2, updated: 0, total: 2 })
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp({ authStorage: auth.storage })
    const response = await app.request('/api/blocks', {
      method: 'POST',
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identityKeys: ['resume-1', 'resume-2', 'resume-1'],
        reason: 'duplicate applicants',
        blockedBy: 'body-user',
      }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({
      success: true,
      inserted: 2,
      updated: 0,
      total: 2,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      type: 'mutation',
      pathName: 'candidate_blocks:bulkUpsert',
      args: {
        workspaceSlug: 'hr',
        identityKeys: ['resume-1', 'resume-2'],
        reason: 'duplicate applicants',
        blockedBy: auth.userId,
      },
    })
  })

  it('rejects authenticated users outside the selected workspace', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'hr', requestWorkspaceSlug: 'dev', role: 'user' })
    const calls: ConvexCall[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init))
      return convexSuccess(null)
    })

    const app = createApp({ authStorage: auth.storage })
    const response = await app.request('/api/blocks', {
      method: 'POST',
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identityKey: 'resume-1' }),
    })

    expect(response.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('uses the default dev workspace when unblocking with dev auth', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'dev', role: 'user' })
    const calls: ConvexCall[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.pathName === 'candidate_blocks:remove') {
        return convexSuccess(true)
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp({ authStorage: auth.storage })
    const response = await app.request('/api/blocks?identityKey=resume-7', {
      method: 'DELETE',
      headers: auth.headers,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      removed: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      type: 'mutation',
      pathName: 'candidate_blocks:remove',
      args: {
        workspaceSlug: 'dev',
        identityKey: 'resume-7',
      },
    })
  })
})
