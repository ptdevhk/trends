import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import healthRoutes from './health'
import { workspaceMiddleware } from '../middleware/workspace'
import { parseJsonBody } from '../test-utils'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/', healthRoutes)
  return app
}

describe('health routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns healthy status', async () => {
    const app = createTestApp()
    const response = await app.request('/health', {
      headers: { 'X-Workspace-Slug': 'dev' },
    })
    expect(response.status).toBe(200)
    const body = await parseJsonBody<{ status: string; timestamp: string; version: string }>(response)
    expect(body.status).toBe('healthy')
    expect(body.timestamp).toBeTruthy()
    expect(body.version).toBeTruthy()
  })

  it('includes version from config', async () => {
    const app = createTestApp()
    const response = await app.request('/health', {
      headers: { 'X-Workspace-Slug': 'dev' },
    })
    const body = await parseJsonBody<{ status: string; timestamp: string; version: string }>(response)
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
  })

  it('includes ISO-formatted timestamp', async () => {
    const app = createTestApp()
    const response = await app.request('/health', {
      headers: { 'X-Workspace-Slug': 'dev' },
    })
    const body = await parseJsonBody<{ status: string; timestamp: string }>(response)
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
