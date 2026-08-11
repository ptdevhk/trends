import { afterEach, describe, expect, it, vi } from 'vitest'

// Maintenance middleware is unit-tested separately; route tests bypass it.
vi.mock('../middleware/maintenance.js', () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

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

  it('rejects block list reads without a session even when a workspace header is supplied', async () => {
    const calls: ConvexCall[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init))
      return convexSuccess([])
    })

    const app = createApp()
    const response = await app.request('/api/blocks', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('lists only the authenticated workspace and rejects a workspace override', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'hr', role: 'user' })
    const calls: ConvexCall[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)
      if (call.pathName === 'candidate_blocks:list') {
        return convexSuccess({
          page: [],
          isDone: true,
          continueCursor: '',
        })
      }
      throw new Error(`Unexpected convex path: ${call.pathName}`)
    })

    const app = createApp({ authStorage: auth.storage })
    const allowed = await app.request('/api/blocks', { headers: auth.headers })
    const denied = await app.request('/api/blocks', {
      headers: {
        ...auth.headers,
        'X-Workspace-Slug': 'dev',
      },
    })

    expect(allowed.status).toBe(200)
    expect(denied.status).toBe(403)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args.workspaceSlug).toBe('hr')
  })

  it.each(['user', 'reviewer', 'admin'] as const)(
    'allows a %s role member on the member surface /api/blocks',
    async (role) => {
      const auth = createAuthHeaders({ workspaceSlug: 'hr', role })
      const calls: ConvexCall[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init)
        calls.push(call)
        if (call.pathName === 'candidate_blocks:list') {
          return convexSuccess({
            page: [],
            isDone: true,
            continueCursor: '',
          })
        }
        throw new Error(`Unexpected convex path: ${call.pathName}`)
      })

      const app = createApp({ authStorage: auth.storage })
      const response = await app.request('/api/blocks', { headers: auth.headers })

      expect(response.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.args.workspaceSlug).toBe('hr')
    },
  )

  it('aggregates paginated block rows and deduplicates identities', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'hr', role: 'user' })
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      _id: `block-${index}`,
      identityKey: `identity-${index}`,
      workspaceSlug: 'hr',
      blockedAt: index,
    }))
    const secondPage = [
      {
        _id: 'block-duplicate-newer',
        identityKey: 'identity-10',
        workspaceSlug: 'hr',
        reason: 'newer reason',
        blockedAt: 1000,
      },
      {
        _id: 'block-500',
        identityKey: 'identity-500',
        workspaceSlug: 'hr',
        blockedAt: 500,
      },
    ]
    const calls: ConvexCall[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)
      if (call.pathName !== 'candidate_blocks:list') {
        throw new Error(`Unexpected convex path: ${call.pathName}`)
      }
      const paginationOpts = call.args.paginationOpts as { cursor?: string | null }
      return paginationOpts?.cursor
        ? convexSuccess({ page: secondPage, isDone: true, continueCursor: '' })
        : convexSuccess({ page: firstPage, isDone: false, continueCursor: 'page-2' })
    })

    const app = createApp({ authStorage: auth.storage })
    const response = await app.request('/api/blocks', { headers: auth.headers })
    const payload = await response.json() as { items: Array<{ identityKey: string; reason?: string }> }

    expect(response.status).toBe(200)
    expect(calls).toHaveLength(2)
    expect(payload.items).toHaveLength(501)
    expect(payload.items.find((item) => item.identityKey === 'identity-10')?.reason).toBe('newer reason')
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
