import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import trendsRoutes from './trends'
import { workspaceMiddleware } from '../middleware/workspace'
import { DataService } from '../services/data-service'
import { DataNotFoundError } from '../services/errors'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/', trendsRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }

const MOCK_TRENDS = [
  { title: 'AI in Manufacturing', platform: 'weibo', rank: 1, url: 'https://example.com/1' },
  { title: 'CNC Automation', platform: 'zhihu', rank: 2, url: 'https://example.com/2' },
]

describe('trends routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/trends', () => {
    it('returns latest trends', async () => {
      vi.spyOn(DataService.prototype, 'getLatestNews').mockReturnValue(MOCK_TRENDS as never)
      const app = createTestApp()
      const response = await app.request('/api/trends', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.summary.total).toBe(2)
      expect(body.data).toHaveLength(2)
    })

    it('returns trends by date', async () => {
      vi.spyOn(DataService.prototype, 'getNewsByDate').mockReturnValue(MOCK_TRENDS as never)
      const app = createTestApp()
      const response = await app.request('/api/trends?date=2026-05-22', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.summary.description).toContain('2026-05-22')
    })

    it('returns empty data when DataNotFoundError', async () => {
      vi.spyOn(DataService.prototype, 'getLatestNews').mockImplementation(() => {
        throw new DataNotFoundError('No data', { suggestion: 'Run crawler first' })
      })
      const app = createTestApp()
      const response = await app.request('/api/trends', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
      expect(body.summary.total).toBe(0)
    })

    it('passes platform and limit params', async () => {
      const newsSpy = vi.spyOn(DataService.prototype, 'getLatestNews').mockReturnValue(MOCK_TRENDS as never)
      const app = createTestApp()
      await app.request('/api/trends?platform=weibo,zhihu&limit=10', { headers: ADMIN_HEADERS })
      expect(newsSpy).toHaveBeenCalledWith(expect.objectContaining({
        platforms: ['weibo', 'zhihu'],
        limit: 10,
      }))
    })
  })

  describe('GET /api/trends/:id', () => {
    it('returns trend by title', async () => {
      vi.spyOn(DataService.prototype, 'getTrendByTitle').mockReturnValue(MOCK_TRENDS[0] as never)
      const app = createTestApp()
      const response = await app.request('/api/trends/AI%20in%20Manufacturing', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data.title).toBe('AI in Manufacturing')
    })

    it('decodes URL-encoded title', async () => {
      const trendSpy = vi.spyOn(DataService.prototype, 'getTrendByTitle').mockReturnValue(MOCK_TRENDS[0] as never)
      const app = createTestApp()
      await app.request('/api/trends/CNC%20Automation', { headers: ADMIN_HEADERS })
      expect(trendSpy).toHaveBeenCalledWith('CNC Automation', expect.any(Object))
    })
  })
})
