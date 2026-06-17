import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import webVitalsRoutes from './web-vitals'
import { workspaceMiddleware } from '../middleware/workspace'
import { WebVitalsLogger } from '../services/web-vitals-logger'
import { parseJsonBody } from '../test-utils'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/api/web-vitals', webVitalsRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }

const MOCK_SUMMARY = {
  totalReports: 42,
  metrics: {
    LCP: { p50: 1.2, p75: 2.1, p95: 3.5, good: 30, needsImprovement: 8, poor: 4 },
    FID: { p50: 10, p75: 50, p95: 100, good: 35, needsImprovement: 5, poor: 2 },
  },
}

describe('web-vitals routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST /api/web-vitals/report', () => {
    it('logs a web vital metric', async () => {
      const logSpy = vi.spyOn(WebVitalsLogger.prototype, 'logMetric').mockImplementation(() => {})
      const app = createTestApp()
      const response = await app.request('/api/web-vitals/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          name: 'LCP',
          value: 2.5,
          rating: 'needs-improvement',
          id: 'v3-abc123',
          navigationType: 'navigate',
        }),
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: boolean }>(response)
      expect(body.success).toBe(true)
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'LCP',
          value: 2.5,
          rating: 'needs-improvement',
          workspace: 'dev',
        }),
      )
    })

    it('rejects invalid rating', async () => {
      const app = createTestApp()
      const response = await app.request('/api/web-vitals/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          name: 'LCP',
          value: 2.5,
          rating: 'invalid',
          id: 'v3-abc',
          navigationType: 'navigate',
        }),
      })
      expect(response.status).toBe(400)
    })

    it('rejects missing required fields', async () => {
      const app = createTestApp()
      const response = await app.request('/api/web-vitals/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/web-vitals/summary', () => {
    it('returns web vitals summary', async () => {
      vi.spyOn(WebVitalsLogger.prototype, 'getSummary').mockReturnValue(MOCK_SUMMARY as never)
      const app = createTestApp()
      const response = await app.request('/api/web-vitals/summary', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{
        success: boolean
        summary: {
          totalReports: number
          metrics: {
            LCP: { p50: number; p75: number; p95: number; good: number; needsImprovement: number; poor: number }
          }
        }
      }>(response)
      expect(body.success).toBe(true)
      expect(body.summary.totalReports).toBe(42)
      expect(body.summary.metrics.LCP.p50).toBe(1.2)
    })

    it('passes hours query param', async () => {
      const summarySpy = vi.spyOn(WebVitalsLogger.prototype, 'getSummary').mockReturnValue(MOCK_SUMMARY as never)
      const app = createTestApp()
      await app.request('/api/web-vitals/summary?hours=48', { headers: ADMIN_HEADERS })
      expect(summarySpy).toHaveBeenCalledWith(48)
    })

    it('defaults to 24 hours when not provided', async () => {
      const summarySpy = vi.spyOn(WebVitalsLogger.prototype, 'getSummary').mockReturnValue(MOCK_SUMMARY as never)
      const app = createTestApp()
      await app.request('/api/web-vitals/summary', { headers: ADMIN_HEADERS })
      expect(summarySpy).toHaveBeenCalledWith(24)
    })
  })
})
