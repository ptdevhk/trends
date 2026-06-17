import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import searchAnalyticsRoutes from './search-analytics'
import { workspaceMiddleware } from '../middleware/workspace'
import { SearchEventLogger } from '../services/search-event-logger'
import { SkillsKnowledgeService } from '../services/skills-knowledge'
import { parseJsonBody } from '../test-utils'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/api/search-analytics', searchAnalyticsRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }

const MOCK_ZERO_RESULT_ITEMS = [
  { query: '5轴加工中心', count: 12, lastSeen: '2026-05-22T10:00:00Z' },
  { query: 'EDM operator', count: 5, lastSeen: '2026-05-21T15:30:00Z' },
]

const MOCK_SUMMARY = {
  totalSearches: 150,
  zeroResultSearches: 30,
  zeroResultRate: 0.2,
  topQueries: [{ query: 'CNC', count: 45 }],
  actionDistribution: { shortlist: 60, reject: 30 },
  dailyTrend: [{ date: '2026-05-22', searches: 50, zeroResults: 10, shortlist: 20, reject: 15 }],
}

const MOCK_SYNONYM_SUGGESTIONS = [
  { query: '5轴', variant: '五轴', canonical: '五轴加工', confidence: 0.85, reason: 'Chinese numeral variant' },
]

describe('search-analytics routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/search-analytics/zero-results', () => {
    it('returns zero-result queries', async () => {
      vi.spyOn(SearchEventLogger.prototype, 'getZeroResultSummary').mockReturnValue(MOCK_ZERO_RESULT_ITEMS as never)
      const app = createTestApp()
      const response = await app.request('/api/search-analytics/zero-results', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; items: { query: string }[] }>(response)
      expect(body.success).toBe(true)
      expect(body.items).toHaveLength(2)
      expect(body.items[0].query).toBe('5轴加工中心')
    })

    it('passes limit query param', async () => {
      const summarySpy = vi.spyOn(SearchEventLogger.prototype, 'getZeroResultSummary').mockReturnValue([] as never)
      const app = createTestApp()
      await app.request('/api/search-analytics/zero-results?limit=10', { headers: ADMIN_HEADERS })
      expect(summarySpy).toHaveBeenCalledWith(10)
    })

    it('uses default limit when not provided', async () => {
      const summarySpy = vi.spyOn(SearchEventLogger.prototype, 'getZeroResultSummary').mockReturnValue([] as never)
      const app = createTestApp()
      await app.request('/api/search-analytics/zero-results', { headers: ADMIN_HEADERS })
      expect(summarySpy).toHaveBeenCalledWith(undefined)
    })
  })

  describe('GET /api/search-analytics/summary', () => {
    it('returns aggregated summary', async () => {
      vi.spyOn(SearchEventLogger.prototype, 'getSummary').mockReturnValue(MOCK_SUMMARY as never)
      const app = createTestApp()
      const response = await app.request('/api/search-analytics/summary', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; summary: Record<string, unknown> }>(response)
      expect(body.success).toBe(true)
      expect(body.summary.totalSearches).toBe(150)
      expect(body.summary.zeroResultRate).toBe(0.2)
      expect(body.summary.topQueries).toHaveLength(1)
      expect(body.summary.dailyTrend).toHaveLength(1)
    })

    it('passes topQueries and daily params', async () => {
      const summarySpy = vi.spyOn(SearchEventLogger.prototype, 'getSummary').mockReturnValue(MOCK_SUMMARY as never)
      const app = createTestApp()
      await app.request('/api/search-analytics/summary?topQueries=20&daily=30', { headers: ADMIN_HEADERS })
      expect(summarySpy).toHaveBeenCalledWith({ topQueryLimit: 20, dailyLimit: 30 })
    })

    it('uses defaults when no params provided', async () => {
      const summarySpy = vi.spyOn(SearchEventLogger.prototype, 'getSummary').mockReturnValue(MOCK_SUMMARY as never)
      const app = createTestApp()
      await app.request('/api/search-analytics/summary', { headers: ADMIN_HEADERS })
      expect(summarySpy).toHaveBeenCalledWith({})
    })
  })

  describe('GET /api/search-analytics/synonym-suggestions', () => {
    it('returns synonym suggestions', async () => {
      vi.spyOn(SearchEventLogger.prototype, 'getZeroResultQueries').mockReturnValue(['5轴'] as never)
      vi.spyOn(SkillsKnowledgeService.prototype, 'generateSynonymSuggestions').mockReturnValue(MOCK_SYNONYM_SUGGESTIONS as never)
      const app = createTestApp()
      const response = await app.request('/api/search-analytics/synonym-suggestions', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; suggestions: { canonical: string }[] }>(response)
      expect(body.success).toBe(true)
      expect(body.suggestions).toHaveLength(1)
      expect(body.suggestions[0].canonical).toBe('五轴加工')
    })

    it('passes limit to getZeroResultQueries', async () => {
      vi.spyOn(SearchEventLogger.prototype, 'getZeroResultQueries').mockReturnValue([] as never)
      vi.spyOn(SkillsKnowledgeService.prototype, 'generateSynonymSuggestions').mockReturnValue([] as never)
      const app = createTestApp()
      await app.request('/api/search-analytics/synonym-suggestions?limit=50', { headers: ADMIN_HEADERS })
      expect(SearchEventLogger.prototype.getZeroResultQueries).toHaveBeenCalledWith(50)
    })

    it('defaults limit to 200 when not provided', async () => {
      vi.spyOn(SearchEventLogger.prototype, 'getZeroResultQueries').mockReturnValue([] as never)
      vi.spyOn(SkillsKnowledgeService.prototype, 'generateSynonymSuggestions').mockReturnValue([] as never)
      const app = createTestApp()
      await app.request('/api/search-analytics/synonym-suggestions', { headers: ADMIN_HEADERS })
      expect(SearchEventLogger.prototype.getZeroResultQueries).toHaveBeenCalledWith(200)
    })

    it('returns empty suggestions when no zero-result queries', async () => {
      vi.spyOn(SearchEventLogger.prototype, 'getZeroResultQueries').mockReturnValue([] as never)
      vi.spyOn(SkillsKnowledgeService.prototype, 'generateSynonymSuggestions').mockReturnValue([] as never)
      const app = createTestApp()
      const response = await app.request('/api/search-analytics/synonym-suggestions', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ suggestions: unknown[] }>(response)
      expect(body.suggestions).toHaveLength(0)
    })
  })

  describe('POST /api/search-analytics/log', () => {
    it('logs a search query event', async () => {
      const logSpy = vi.spyOn(SearchEventLogger.prototype, 'logSearchQuery').mockImplementation(() => {})
      const app = createTestApp()
      const response = await app.request('/api/search-analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ query: 'CNC operator', resultCount: 25, topScore: 92.5 }),
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.success).toBe(true)
      expect(logSpy).toHaveBeenCalledWith({
        query: 'CNC operator',
        resultCount: 25,
        topScore: 92.5,
      })
    })

    it('works without optional topScore', async () => {
      const logSpy = vi.spyOn(SearchEventLogger.prototype, 'logSearchQuery').mockImplementation(() => {})
      const app = createTestApp()
      const response = await app.request('/api/search-analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ query: 'test', resultCount: 0 }),
      })
      expect(response.status).toBe(200)
      expect(logSpy).toHaveBeenCalledWith({
        query: 'test',
        resultCount: 0,
        topScore: undefined,
      })
    })

    it('rejects missing required fields', async () => {
      const app = createTestApp()
      const response = await app.request('/api/search-analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
    })

    it('rejects negative resultCount', async () => {
      const app = createTestApp()
      const response = await app.request('/api/search-analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ query: 'test', resultCount: -1 }),
      })
      expect(response.status).toBe(400)
    })
  })
})
