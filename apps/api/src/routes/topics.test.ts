import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import topicsRoutes from './topics'
import { workspaceMiddleware } from '../middleware/workspace'
import { DataService } from '../services/data-service'
import { DataNotFoundError } from '../services/errors'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/', topicsRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }

const MOCK_TOPICS_RESULT = {
  topics: [
    { keyword: 'CNC', count: 42 },
    { keyword: '智能制造', count: 28 },
  ],
  generated_at: '2026-05-22T12:00:00+08:00',
  mode: 'daily',
  extract_mode: 'frequency',
  total_keywords: 150,
}

describe('topics routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/topics', () => {
    it('returns trending topics', async () => {
      vi.spyOn(DataService.prototype, 'getTrendingTopics').mockReturnValue(MOCK_TOPICS_RESULT as never)
      const app = createTestApp()
      const response = await app.request('/api/topics', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.topics).toHaveLength(2)
      expect(body.total_keywords).toBe(150)
    })

    it('passes top_n, mode, and extract_mode params', async () => {
      const topicsSpy = vi.spyOn(DataService.prototype, 'getTrendingTopics').mockReturnValue(MOCK_TOPICS_RESULT as never)
      const app = createTestApp()
      await app.request('/api/topics?top_n=20&mode=daily&extract_mode=auto_extract', { headers: ADMIN_HEADERS })
      expect(topicsSpy).toHaveBeenCalledWith(expect.objectContaining({
        top_n: 20,
        mode: 'daily',
        extract_mode: 'auto_extract',
      }))
    })

    it('returns empty topics when DataNotFoundError', async () => {
      vi.spyOn(DataService.prototype, 'getTrendingTopics').mockImplementation(() => {
        throw new DataNotFoundError('No data')
      })
      const app = createTestApp()
      const response = await app.request('/api/topics', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.topics).toHaveLength(0)
      expect(body.total_keywords).toBe(0)
    })
  })
})
