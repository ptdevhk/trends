import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import rssRoutes from './rss'
import { workspaceMiddleware } from '../middleware/workspace'
import { DataService } from '../services/data-service'
import { DataNotFoundError } from '../services/errors'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/', rssRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }

const MOCK_RSS_ITEMS = [
  { title: 'Industry Update', feed: '36kr', publishedAt: '2026-05-22T10:00:00Z', url: 'https://example.com/1' },
  { title: 'Tech News', feed: 'ithome', publishedAt: '2026-05-22T09:00:00Z', url: 'https://example.com/2' },
]

describe('rss routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/rss', () => {
    it('returns RSS items', async () => {
      vi.spyOn(DataService.prototype, 'getLatestRss').mockReturnValue(MOCK_RSS_ITEMS as never)
      const app = createTestApp()
      const response = await app.request('/api/rss', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.summary.total).toBe(2)
    })

    it('passes feed, days, and limit params', async () => {
      const rssSpy = vi.spyOn(DataService.prototype, 'getLatestRss').mockReturnValue(MOCK_RSS_ITEMS as never)
      const app = createTestApp()
      await app.request('/api/rss?feed=36kr,ithome&days=7&limit=20', { headers: ADMIN_HEADERS })
      expect(rssSpy).toHaveBeenCalledWith(expect.objectContaining({
        feeds: ['36kr', 'ithome'],
        days: 7,
        limit: 20,
      }))
    })

    it('returns empty data when DataNotFoundError', async () => {
      vi.spyOn(DataService.prototype, 'getLatestRss').mockImplementation(() => {
        throw new DataNotFoundError('No RSS data', { suggestion: 'Run RSS crawler' })
      })
      const app = createTestApp()
      const response = await app.request('/api/rss', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
      expect(body.summary.description).toContain('Run RSS crawler')
    })

    it('indicates multi-day range in description', async () => {
      vi.spyOn(DataService.prototype, 'getLatestRss').mockReturnValue(MOCK_RSS_ITEMS as never)
      const app = createTestApp()
      const response = await app.request('/api/rss?days=7', { headers: ADMIN_HEADERS })
      const body = await response.json()
      expect(body.summary.description).toContain('last 7 days')
    })
  })
})
