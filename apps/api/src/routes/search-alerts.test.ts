import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import searchAlertsRoutes from './search-alerts'
import { workspaceMiddleware } from '../middleware/workspace'
import type { AuthContext } from '../services/auth-types'
import { createAuthContext } from './test-auth-helpers'
import { parseJsonBody } from '../test-utils'

// search-alerts uses a local convexQuery/convexMutation that calls resolveConvexUrl + fetch.
// We mock the global fetch to intercept Convex HTTP API calls.
function createTestApp(authContext: AuthContext | null = createAuthContext({ workspaceSlug: 'dev', role: 'user' })) {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  if (authContext) {
    app.use('*', async (c, next) => {
      c.set('auth', authContext)
      await next()
    })
  }
  app.route('/', searchAlertsRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }

function mockConvexResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ status: 'success', value }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockConvexError(message: string, status = 200): Response {
  return new Response(JSON.stringify({ status: 'error', errorMessage: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const MOCK_ALERTS = [
  {
    _id: 'alert-1',
    _creationTime: Date.now(),
    workspaceSlug: 'dev',
    searchProfileId: 'sp-1',
    name: 'High CNC Matches',
    keywords: ['CNC', '车削'],
    minScore: 80,
    enabled: true,
    lastNotifiedAt: Date.now() - 86400000,
    createdBy: 'admin',
  },
  {
    _id: 'alert-2',
    _creationTime: Date.now(),
    workspaceSlug: 'dev',
    searchProfileId: 'sp-2',
    name: 'New Engineers',
    keywords: [],
    minScore: 50,
    enabled: false,
  },
]

describe('search-alerts routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('workspace membership', () => {
    it('rejects anonymous alert reads', async () => {
      const app = createTestApp(null)
      const response = await app.request('/', { headers: ADMIN_HEADERS })

      expect(response.status).toBe(401)
    })

    it('rejects alert reads from users outside the selected workspace', async () => {
      const app = createTestApp(createAuthContext({ workspaceSlug: 'hr', role: 'user' }))
      const response = await app.request('/', { headers: ADMIN_HEADERS })

      expect(response.status).toBe(403)
    })

    it('allows workspace members to read alerts', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse(MOCK_ALERTS) as never)
      const app = createTestApp()
      const response = await app.request('/', { headers: ADMIN_HEADERS })

      expect(response.status).toBe(200)
    })
  })

  describe('GET /api/search-alerts/', () => {
    it('returns alerts for workspace', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse(MOCK_ALERTS) as never)
      const app = createTestApp()
      const response = await app.request('/', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; alerts: { _id: string }[] }>(response)
      expect(body.success).toBe(true)
      expect(body.alerts).toHaveLength(2)
      expect(body.alerts[0]._id).toBe('alert-1')
    })

    it('passes workspaceSlug to Convex query', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse([]) as never)
      const app = createTestApp()
      await app.request('/', { headers: ADMIN_HEADERS })
      const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string ?? '{}')
      expect(callBody.path).toBe('search_alerts:list')
      expect(callBody.args.workspaceSlug).toBe('dev')
    })

    it('returns empty array when no alerts', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse([]) as never)
      const app = createTestApp()
      const response = await app.request('/', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ alerts: unknown[] }>(response)
      expect(body.alerts).toHaveLength(0)
    })
  })

  describe('POST /api/search-alerts/', () => {
    it('creates an alert', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse('alert-new-1') as never)
      const app = createTestApp()
      const response = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          searchProfileId: 'sp-1',
          name: 'My Alert',
          keywords: ['test'],
          minScore: 75,
        }),
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.success).toBe(true)
      expect(body.alertId).toBe('alert-new-1')
    })

    it('passes workspaceSlug and body to Convex mutation', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse('alert-new') as never)
      const app = createTestApp()
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          searchProfileId: 'sp-1',
          name: 'My Alert',
          keywords: ['test'],
          minScore: 75,
        }),
      })
      const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string ?? '{}')
      expect(callBody.path).toBe('search_alerts:create')
      expect(callBody.args.workspaceSlug).toBe('dev')
      expect(callBody.args.searchProfileId).toBe('sp-1')
      expect(callBody.args.minScore).toBe(75)
    })

    it('rejects missing required fields', async () => {
      const app = createTestApp()
      const response = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
    })

    it('rejects invalid minScore range', async () => {
      const app = createTestApp()
      const response = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          searchProfileId: 'sp-1',
          name: 'Test',
          minScore: 150,
        }),
      })
      expect(response.status).toBe(400)
    })
  })

  describe('PATCH /api/search-alerts/:id/toggle', () => {
    it('toggles alert enabled state', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse(null) as never)
      const app = createTestApp()
      const response = await app.request('/alert-1/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ enabled: false }),
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.success).toBe(true)
    })

    it('passes alertId and enabled to Convex mutation', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse(null) as never)
      const app = createTestApp()
      await app.request('/alert-1/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ enabled: true }),
      })
      const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string ?? '{}')
      expect(callBody.path).toBe('search_alerts:toggle')
      expect(callBody.args.alertId).toBe('alert-1')
      expect(callBody.args.workspaceSlug).toBe('dev')
      expect(callBody.args.enabled).toBe(true)
    })

    it('rejects missing enabled field', async () => {
      const app = createTestApp()
      const response = await app.request('/alert-1/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
    })
  })

  describe('DELETE /api/search-alerts/:id', () => {
    it('deletes an alert', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse(null) as never)
      const app = createTestApp()
      const response = await app.request('/alert-1', {
        method: 'DELETE',
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.success).toBe(true)
    })

    it('passes alertId to Convex mutation', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockConvexResponse(null) as never)
      const app = createTestApp()
      await app.request('/alert-1', {
        method: 'DELETE',
        headers: ADMIN_HEADERS,
      })
      const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string ?? '{}')
      expect(callBody.path).toBe('search_alerts:remove')
      expect(callBody.args.workspaceSlug).toBe('dev')
      expect(callBody.args.alertId).toBe('alert-1')
    })
  })
})
