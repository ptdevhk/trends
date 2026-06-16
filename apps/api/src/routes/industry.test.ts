import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import industryRoutes from './industry'
import { workspaceMiddleware } from '../middleware/workspace'
import { IndustryDataService } from '../services/industry-data-service'
import { BrandDisplayResolver } from '../services/brand-display-resolver'
import { parseJsonBody } from '../test-utils'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/', industryRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }

const MOCK_COMPANIES = [
  { id: 1, nameCn: '沈阳机床', nameEn: 'SMTCL', type: 'state_owned', category: 'key_company' as const },
  { id: 2, nameCn: '大连机床', nameEn: 'Dalian Machine', type: 'state_owned', category: 'key_company' as const },
  { id: 3, nameCn: '友嘉实业', nameEn: 'FFG', type: 'private', category: 'ites_exhibitor' as const },
  { id: 4, nameCn: '中贸代理', nameEn: 'Zhongmao Agent', type: 'agent', category: 'agent' as const },
]

const MOCK_KEYWORDS = [
  { id: 1, keyword: '车削', english: 'turning', category: 'lathe' as const },
  { id: 2, keyword: '铣削', english: 'milling', category: 'machining' as const },
  { id: 3, keyword: '电火花', english: 'EDM', category: 'edm' as const },
  { id: 4, keyword: '三坐标', english: 'CMM', category: 'measurement' as const },
]

const MOCK_BRANDS = [
  { id: 1, nameCn: '马扎克', nameEn: 'Mazak', type: 'cnc', origin: 'international' as const },
  { id: 2, nameCn: '大连机床', nameEn: 'Dalian', type: 'cnc', origin: 'domestic' as const },
  { id: 3, nameCn: '天田代理', nameEn: 'Amada Agent', type: 'sheet_metal', origin: 'agent' as const },
]

const MOCK_STATS = {
  loadedAt: '2026-05-22T10:00:00.000Z',
  companiesCount: 4,
  keywordsCount: 4,
  brandsCount: 3,
}

const MOCK_DISPLAY_MAP = {
  mazak: { displayName: 'Mazak', zhHans: '马扎克' },
  dalian: { displayName: 'Dalian', zhHans: '大连机床' },
}

const MOCK_VALIDATION = {
  valid: true,
  issues: [],
  stats: { totalTables: 3, totalRows: 11, tablesWithIssues: 0 },
}

describe('industry routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/industry/stats', () => {
    it('returns industry data statistics', async () => {
      vi.spyOn(IndustryDataService.prototype, 'getStats').mockReturnValue(MOCK_STATS)
      const app = createTestApp()
      const response = await app.request('/api/industry/stats', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; stats: Record<string, unknown> }>(response)
      expect(body.success).toBe(true)
      expect(body.stats.companiesCount).toBe(4)
      expect(body.stats.keywordsCount).toBe(4)
      expect(body.stats.brandsCount).toBe(3)
    })
  })

  describe('GET /api/industry/companies', () => {
    it('returns all companies', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadCompanies').mockReturnValue(MOCK_COMPANIES)
      const app = createTestApp()
      const response = await app.request('/api/industry/companies', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.success).toBe(true)
      expect(body.count).toBe(4)
      expect(body.data).toHaveLength(4)
    })

    it('filters companies by category', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadCompanies').mockReturnValue(MOCK_COMPANIES)
      const app = createTestApp()
      const response = await app.request('/api/industry/companies?category=key_company', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ count: number; data: { category: string }[] }>(response)
      expect(body.count).toBe(2)
      expect(body.data.every((c: { category: string }) => c.category === 'key_company')).toBe(true)
    })

    it('searches companies by Chinese name', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadCompanies').mockReturnValue(MOCK_COMPANIES)
      const app = createTestApp()
      const response = await app.request('/api/industry/companies?q=沈阳', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ count: number; data: { nameCn: string }[] }>(response)
      expect(body.count).toBe(1)
      expect(body.data[0].nameCn).toBe('沈阳机床')
    })

    it('searches companies by English name (case-insensitive)', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadCompanies').mockReturnValue(MOCK_COMPANIES)
      const app = createTestApp()
      const response = await app.request('/api/industry/companies?q=smtcl', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ count: number; data: { nameEn: string }[] }>(response)
      expect(body.count).toBe(1)
      expect(body.data[0].nameEn).toBe('SMTCL')
    })

    it('combines category and search filters', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadCompanies').mockReturnValue(MOCK_COMPANIES)
      const app = createTestApp()
      const response = await app.request('/api/industry/companies?category=key_company&q=大连', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ count: number; data: { nameCn: string }[] }>(response)
      expect(body.count).toBe(1)
      expect(body.data[0].nameCn).toBe('大连机床')
    })

    it('returns empty when search matches nothing', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadCompanies').mockReturnValue(MOCK_COMPANIES)
      const app = createTestApp()
      const response = await app.request('/api/industry/companies?q=nonexistent', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ count: number; data: unknown[] }>(response)
      expect(body.count).toBe(0)
      expect(body.data).toHaveLength(0)
    })
  })

  describe('GET /api/industry/keywords', () => {
    it('returns all keywords', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadKeywords').mockReturnValue(MOCK_KEYWORDS)
      const app = createTestApp()
      const response = await app.request('/api/industry/keywords', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.success).toBe(true)
      expect(body.count).toBe(4)
    })

    it('filters keywords by category', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadKeywords').mockReturnValue(MOCK_KEYWORDS)
      const app = createTestApp()
      const response = await app.request('/api/industry/keywords?category=lathe', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ count: number; data: { keyword: string }[] }>(response)
      expect(body.count).toBe(1)
      expect(body.data[0].keyword).toBe('车削')
    })

    it('returns empty when category has no keywords', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadKeywords').mockReturnValue(MOCK_KEYWORDS)
      const app = createTestApp()
      const response = await app.request('/api/industry/keywords?category=smt', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.count).toBe(0)
    })
  })

  describe('GET /api/industry/brand-display-map', () => {
    it('returns brand display map', async () => {
      vi.spyOn(BrandDisplayResolver.prototype, 'toJSON').mockReturnValue(MOCK_DISPLAY_MAP)
      const app = createTestApp()
      const response = await app.request('/api/industry/brand-display-map', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ mazak: Record<string, unknown> }>(response)
      expect(body.mazak).toBeDefined()
      expect(body.mazak.displayName).toBe('Mazak')
      expect(body.mazak.zhHans).toBe('马扎克')
    })
  })

  describe('GET /api/industry/brands', () => {
    it('returns all brands', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadBrands').mockReturnValue(MOCK_BRANDS)
      const app = createTestApp()
      const response = await app.request('/api/industry/brands', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.success).toBe(true)
      expect(body.count).toBe(3)
    })

    it('filters brands by origin', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadBrands').mockReturnValue(MOCK_BRANDS)
      const app = createTestApp()
      const response = await app.request('/api/industry/brands?origin=international', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ count: number; data: { nameEn: string }[] }>(response)
      expect(body.count).toBe(1)
      expect(body.data[0].nameEn).toBe('Mazak')
    })

    it('searches brands by Chinese name', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadBrands').mockReturnValue(MOCK_BRANDS)
      const app = createTestApp()
      const response = await app.request('/api/industry/brands?q=马扎克', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody(response)
      expect(body.count).toBe(1)
    })

    it('searches brands by English name (case-insensitive)', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadBrands').mockReturnValue(MOCK_BRANDS)
      const app = createTestApp()
      const response = await app.request('/api/industry/brands?q=mazak', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ count: number; data: { nameEn: string }[] }>(response)
      expect(body.count).toBe(1)
      expect(body.data[0].nameEn).toBe('Mazak')
    })

    it('combines origin and search filters', async () => {
      vi.spyOn(IndustryDataService.prototype, 'loadBrands').mockReturnValue(MOCK_BRANDS)
      const app = createTestApp()
      const response = await app.request('/api/industry/brands?origin=domestic&q=大连', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ count: number; data: { origin: string }[] }>(response)
      expect(body.count).toBe(1)
      expect(body.data[0].origin).toBe('domestic')
    })
  })

  describe('POST /api/industry/verify', () => {
    it('verifies a company', async () => {
      vi.spyOn(IndustryDataService.prototype, 'verifyCompany').mockReturnValue({
        verified: true,
        confidence: 1.0,
        match: MOCK_COMPANIES[0],
      })
      const app = createTestApp()
      const response = await app.request('/api/industry/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ type: 'company', value: '沈阳机床' }),
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; result: Record<string, unknown> }>(response)
      expect(body.success).toBe(true)
      expect(body.result.verified).toBe(true)
      expect(body.result.confidence).toBe(1.0)
    })

    it('verifies a keyword with category', async () => {
      vi.spyOn(IndustryDataService.prototype, 'matchKeywords').mockReturnValue([MOCK_KEYWORDS[0]])
      const app = createTestApp()
      const response = await app.request('/api/industry/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ type: 'keyword', value: '车削', category: 'lathe' }),
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ result: Record<string, unknown> }>(response)
      expect(body.result.verified).toBe(true)
      expect(body.result.confidence).toBe(1.0)
    })

    it('returns low confidence when keyword has no matches', async () => {
      vi.spyOn(IndustryDataService.prototype, 'matchKeywords').mockReturnValue([])
      const app = createTestApp()
      const response = await app.request('/api/industry/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ type: 'keyword', value: 'unknown' }),
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ result: Record<string, unknown> }>(response)
      expect(body.result.verified).toBe(false)
      expect(body.result.confidence).toBe(0.2)
    })

    it('verifies a brand', async () => {
      vi.spyOn(IndustryDataService.prototype, 'matchBrands').mockReturnValue([MOCK_BRANDS[0]])
      const app = createTestApp()
      const response = await app.request('/api/industry/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ type: 'brand', value: 'Mazak' }),
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ result: Record<string, unknown> }>(response)
      expect(body.result.verified).toBe(true)
      expect(body.result.confidence).toBe(1.0)
    })

    it('rejects invalid verify type', async () => {
      const app = createTestApp()
      const response = await app.request('/api/industry/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ type: 'invalid', value: 'test' }),
      })
      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/industry/validate', () => {
    it('returns validation result', async () => {
      vi.spyOn(IndustryDataService.prototype, 'validateFormat').mockReturnValue(MOCK_VALIDATION)
      const app = createTestApp()
      const response = await app.request('/api/industry/validate', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; valid: unknown; issues: unknown[]; stats: Record<string, unknown> }>(response)
      expect(body.success).toBe(true)
      expect(body.valid).toBe(true)
      expect(body.issues).toHaveLength(0)
      expect(body.stats.totalTables).toBe(3)
    })

    it('returns issues when validation finds problems', async () => {
      vi.spyOn(IndustryDataService.prototype, 'validateFormat').mockReturnValue({
        valid: false,
        issues: [{ section: 'companies', row: 5, issue: 'Missing nameCn', severity: 'error' }],
        stats: { totalTables: 3, totalRows: 11, tablesWithIssues: 1 },
      })
      const app = createTestApp()
      const response = await app.request('/api/industry/validate', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ valid: unknown; issues: unknown[]; stats: Record<string, unknown> }>(response)
      expect(body.valid).toBe(false)
      expect(body.issues).toHaveLength(1)
      expect(body.stats.tablesWithIssues).toBe(1)
    })
  })

  describe('POST /api/industry/reload', () => {
    it('reloads industry data and returns stats', async () => {
      vi.spyOn(IndustryDataService.prototype, 'reload').mockReturnValue({
        companies: [],
        keywords: [],
        brands: [],
        companyUrls: [],
        metadata: MOCK_STATS,
      })
      const app = createTestApp()
      const response = await app.request('/api/industry/reload', {
        method: 'POST',
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; stats: Record<string, unknown> }>(response)
      expect(body.success).toBe(true)
      expect(body.stats.companiesCount).toBe(4)
    })
  })
})
