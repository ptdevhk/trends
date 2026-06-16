import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import searchRoutes from './search'
import { workspaceMiddleware } from '../middleware/workspace'
import { DataService } from '../services/data-service'
import { DataNotFoundError } from '../services/errors'
import { parseJsonBody } from '../test-utils'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/', searchRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }

const MOCK_SEARCH_RESULT = {
  results: [
    { title: 'CNC Innovation', platform: 'weibo', rank: 1 },
    { title: 'Smart Factory', platform: 'zhihu', rank: 2 },
  ],
  total: 2,
  total_found: 15,
  statistics: { keyword: 'CNC', avg_rank: 5.2, platform_distribution: { weibo: 10, zhihu: 5 } },
}

describe('search routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/search', () => {
    it('returns search results', async () => {
      vi.spyOn(DataService.prototype, 'searchNewsByKeyword').mockReturnValue(MOCK_SEARCH_RESULT as never)
      const app = createTestApp()
      const response = await app.request('/api/search?q=CNC', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.success).toBe(true)
      expect(body.results).toHaveLength(2)
      expect(body.total).toBe(2)
    })

    it('passes keyword, platform, and limit to service', async () => {
      const searchSpy = vi.spyOn(DataService.prototype, 'searchNewsByKeyword').mockReturnValue(MOCK_SEARCH_RESULT as never)
      const app = createTestApp()
      await app.request('/api/search?q=CNC&platform=weibo&limit=5', { headers: ADMIN_HEADERS })
      expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({
        keyword: 'CNC',
        platforms: ['weibo'],
        limit: 5,
      }))
    })

    it('passes date range when start_date and end_date provided', async () => {
      const searchSpy = vi.spyOn(DataService.prototype, 'searchNewsByKeyword').mockReturnValue(MOCK_SEARCH_RESULT as never)
      const app = createTestApp()
      await app.request('/api/search?q=CNC&start_date=2026-05-01&end_date=2026-05-22', { headers: ADMIN_HEADERS })
      expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({
        dateRange: expect.objectContaining({
          start: expect.any(Date),
          end: expect.any(Date),
        }),
      }))
    })

    it('returns empty results when DataNotFoundError', async () => {
      vi.spyOn(DataService.prototype, 'searchNewsByKeyword').mockImplementation(() => {
        throw new DataNotFoundError('No data')
      })
      const app = createTestApp()
      const response = await app.request('/api/search?q=nonexistent', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.success).toBe(true)
      expect(body.results).toHaveLength(0)
      expect(body.total).toBe(0)
    })
  })
})
