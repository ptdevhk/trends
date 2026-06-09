import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import actionsRoutes from './actions'
import { createAuthMiddleware } from '../middleware/auth'
import { workspaceMiddleware } from '../middleware/workspace'
import { ActionStorage } from '../services/action-storage'
import type { AuthStorage } from '../services/auth-storage'
import { resetResumeScreeningDb } from '../services/database'
import { createAuthHeaders } from './test-auth-helpers'

function createTestApp(storage?: AuthStorage) {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  if (storage) {
    const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600 })
    app.use('*', middleware.optionalAuth)
    app.use('/api/*', middleware.requireCsrf)
  }
  app.route('/', actionsRoutes)
  return app
}

const MOCK_ACTION = {
  id: 1,
  resumeId: 'resume-123',
  actionType: 'star' as const,
  createdAt: new Date().toISOString(),
}

const MOCK_ACTIONS = [
  MOCK_ACTION,
  { id: 2, resumeId: 'resume-456', actionType: 'reject' as const, createdAt: new Date().toISOString() },
]

describe('actions routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetResumeScreeningDb()
  })

  describe('POST /api/actions', () => {
    it('rejects writes without a session', async () => {
      const saveSpy = vi.spyOn(ActionStorage.prototype, 'saveAction').mockReturnValue(MOCK_ACTION as never)
      const app = createTestApp()
      const response = await app.request('/api/actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Slug': 'dev',
        },
        body: JSON.stringify({
          resumeId: 'resume-123',
          actionType: 'star',
        }),
      })
      expect(response.status).toBe(401)
      expect(saveSpy).not.toHaveBeenCalled()
    })

    it('creates a star action with the authenticated actor', async () => {
      const auth = createAuthHeaders({ workspaceSlug: 'hr', role: 'user' })
      const saveSpy = vi.spyOn(ActionStorage.prototype, 'saveAction').mockReturnValue({
        ...MOCK_ACTION,
        userId: auth.userId,
      } as never)
      const app = createTestApp(auth.storage)
      const response = await app.request('/api/actions', {
        method: 'POST',
        headers: {
          ...auth.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: 'body-user',
          resumeId: 'resume-123',
          actionType: 'star',
        }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.action.actionType).toBe('star')
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: auth.userId,
          resumeId: 'resume-123',
          actionType: 'star',
        }),
      )
    })

    it('creates an action with optional data', async () => {
      const auth = createAuthHeaders({ workspaceSlug: 'hr', role: 'user' })
      const saveSpy = vi.spyOn(ActionStorage.prototype, 'saveAction').mockReturnValue(MOCK_ACTION as never)
      const app = createTestApp(auth.storage)
      await app.request('/api/actions', {
        method: 'POST',
        headers: {
          ...auth.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resumeId: 'resume-123',
          actionType: 'note',
          actionData: { text: 'Great candidate' },
        }),
      })
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'note',
          actionData: { text: 'Great candidate' },
        }),
      )
    })

    it('rejects authenticated users outside the selected workspace', async () => {
      const auth = createAuthHeaders({ workspaceSlug: 'hr', requestWorkspaceSlug: 'dev', role: 'user' })
      const saveSpy = vi.spyOn(ActionStorage.prototype, 'saveAction').mockReturnValue(MOCK_ACTION as never)
      const app = createTestApp(auth.storage)
      const response = await app.request('/api/actions', {
        method: 'POST',
        headers: {
          ...auth.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resumeId: 'resume-123',
          actionType: 'star',
        }),
      })
      expect(response.status).toBe(403)
      expect(saveSpy).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/actions', () => {
    it('returns latest actions for session', async () => {
      vi.spyOn(ActionStorage.prototype, 'getLatestActionsForSession').mockReturnValue(MOCK_ACTIONS as never)
      const app = createTestApp()
      const response = await app.request('/api/actions?sessionId=session-123', {
        headers: { 'X-Workspace-Slug': 'dev' },
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.actions).toHaveLength(2)
    })

    it('returns all actions when latestOnly=false', async () => {
      vi.spyOn(ActionStorage.prototype, 'getActionsForSession').mockReturnValue(MOCK_ACTIONS as never)
      const app = createTestApp()
      const response = await app.request('/api/actions?sessionId=session-123&latestOnly=false', {
        headers: { 'X-Workspace-Slug': 'dev' },
      })
      expect(response.status).toBe(200)
    })

    it('passes jobDescriptionId when provided', async () => {
      const getSpy = vi.spyOn(ActionStorage.prototype, 'getLatestActionsForSession').mockReturnValue([] as never)
      const app = createTestApp()
      await app.request('/api/actions?sessionId=session-123&jobDescriptionId=lathe-sales', {
        headers: { 'X-Workspace-Slug': 'dev' },
      })
      expect(getSpy).toHaveBeenCalledWith('session-123', 'lathe-sales')
    })

    it('trims whitespace from jobDescriptionId', async () => {
      const getSpy = vi.spyOn(ActionStorage.prototype, 'getLatestActionsForSession').mockReturnValue([] as never)
      const app = createTestApp()
      await app.request('/api/actions?sessionId=session-123&jobDescriptionId=%20%20lathe%20', {
        headers: { 'X-Workspace-Slug': 'dev' },
      })
      expect(getSpy).toHaveBeenCalledWith('session-123', 'lathe')
    })

    it('normalizes empty jobDescriptionId to undefined', async () => {
      const getSpy = vi.spyOn(ActionStorage.prototype, 'getLatestActionsForSession').mockReturnValue([] as never)
      const app = createTestApp()
      await app.request('/api/actions?sessionId=session-123&jobDescriptionId=%20%20', {
        headers: { 'X-Workspace-Slug': 'dev' },
      })
      expect(getSpy).toHaveBeenCalledWith('session-123', undefined)
    })
  })
})
