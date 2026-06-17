import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import filterPresetsRoutes from './filter-presets'
import { workspaceMiddleware } from '../middleware/workspace'
import { workspaceConfigService } from '../services/workspace-config-service'
import { createAuthContext } from './test-auth-helpers'
import { parseJsonBody } from '../test-utils'

// dev workspace = admin, hr workspace = user
function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.use('*', async (c, next) => {
    c.set('auth', createAuthContext({ workspaceSlug: 'dev', role: 'admin' }))
    await next()
  })
  app.route('/api/filter-presets', filterPresetsRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }
const USER_HEADERS = { 'X-Workspace-Slug': 'hr' }

const MOCK_PRESETS = {
  presets: [
    {
      id: 'senior-engineer',
      name: 'Senior Engineer',
      category: 'engineering',
      filters: { minExperience: 5, education: ['bachelor'] },
    },
    {
      id: 'junior-engineer',
      name: 'Junior Engineer',
      category: 'engineering',
      filters: { minExperience: 0 },
    },
    {
      id: 'senior-designer',
      name: 'Senior Designer',
      category: 'design',
      filters: { minExperience: 3 },
    },
  ],
  categories: [
    { id: 'engineering', name: 'Engineering' },
    { id: 'design', name: 'Design' },
  ],
}

describe('filter-presets routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/filter-presets', () => {
    it('returns all presets', async () => {
      vi.spyOn(workspaceConfigService, 'getFilterPresets').mockResolvedValue(MOCK_PRESETS)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; presets: unknown[] }>(response)
      expect(body.success).toBe(true)
      expect(body.presets).toHaveLength(3)
    })

    it('filters by category', async () => {
      vi.spyOn(workspaceConfigService, 'getFilterPresets').mockResolvedValue(MOCK_PRESETS)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets?category=engineering', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ presets: { category: string }[] }>(response)
      expect(body.presets).toHaveLength(2)
      expect(body.presets.every((p: { category: string }) => p.category === 'engineering')).toBe(true)
    })

    it('returns empty when category has no presets', async () => {
      vi.spyOn(workspaceConfigService, 'getFilterPresets').mockResolvedValue(MOCK_PRESETS)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets?category=marketing', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ presets: unknown[] }>(response)
      expect(body.presets).toHaveLength(0)
    })
  })

  describe('GET /api/filter-presets/categories', () => {
    it('returns categories', async () => {
      vi.spyOn(workspaceConfigService, 'getFilterPresets').mockResolvedValue(MOCK_PRESETS)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/categories', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; categories: unknown[] }>(response)
      expect(body.success).toBe(true)
      expect(body.categories).toHaveLength(2)
    })
  })

  describe('GET /api/filter-presets/stats', () => {
    it('returns stats with byCategory counts', async () => {
      vi.spyOn(workspaceConfigService, 'getFilterPresets').mockResolvedValue(MOCK_PRESETS)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/stats', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; stats: { total: unknown; byCategory: Record<string, unknown> } }>(response)
      expect(body.success).toBe(true)
      expect(body.stats.total).toBe(3)
      expect(body.stats.byCategory.engineering).toBe(2)
      expect(body.stats.byCategory.design).toBe(1)
    })
  })

  describe('GET /api/filter-presets/:id', () => {
    it('returns preset by id', async () => {
      vi.spyOn(workspaceConfigService, 'getFilterPresets').mockResolvedValue(MOCK_PRESETS)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/senior-engineer', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; preset: { id: string } }>(response)
      expect(body.success).toBe(true)
      expect(body.preset.id).toBe('senior-engineer')
    })

    it('returns 404 for unknown id', async () => {
      vi.spyOn(workspaceConfigService, 'getFilterPresets').mockResolvedValue(MOCK_PRESETS)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/nonexistent', { headers: ADMIN_HEADERS })
      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/filter-presets', () => {
    it('creates a preset with admin access', async () => {
      const workspaceConfig = {
        presets: [...MOCK_PRESETS.presets],
        categories: [...MOCK_PRESETS.categories],
      }
      vi.spyOn(workspaceConfigService, 'getWorkspaceFilterPresets').mockResolvedValue(workspaceConfig)
      vi.spyOn(workspaceConfigService, 'setWorkspaceFilterPresets').mockResolvedValue(undefined)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          id: 'lead-engineer',
          name: 'Lead Engineer',
          category: 'engineering',
          filters: { minExperience: 8 },
        }),
      })
      expect(response.status).toBe(201)
      const body = await parseJsonBody<{ success: unknown; preset: { id: string } }>(response)
      expect(body.success).toBe(true)
      expect(body.preset.id).toBe('lead-engineer')
    })

    it('rejects creation without admin access (hr workspace)', async () => {
      const app = createTestApp()
      const response = await app.request('/api/filter-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...USER_HEADERS },
        body: JSON.stringify({
          id: 'lead-engineer',
          name: 'Lead Engineer',
          category: 'engineering',
          filters: { minExperience: 8 },
        }),
      })
      expect(response.status).toBe(403)
    })

    it('rejects duplicate preset id', async () => {
      const workspaceConfig = {
        presets: [...MOCK_PRESETS.presets],
        categories: [...MOCK_PRESETS.categories],
      }
      vi.spyOn(workspaceConfigService, 'getWorkspaceFilterPresets').mockResolvedValue(workspaceConfig)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          id: 'senior-engineer',
          name: 'Duplicate',
          category: 'engineering',
          filters: { minExperience: 5 },
        }),
      })
      expect(response.status).toBe(409)
    })

    it('adds new category if preset has unknown category', async () => {
      const workspaceConfig = {
        presets: [...MOCK_PRESETS.presets],
        categories: [...MOCK_PRESETS.categories],
      }
      const setSpy = vi.spyOn(workspaceConfigService, 'setWorkspaceFilterPresets').mockResolvedValue(undefined)
      vi.spyOn(workspaceConfigService, 'getWorkspaceFilterPresets').mockResolvedValue(workspaceConfig)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          id: 'sales-lead',
          name: 'Sales Lead',
          category: 'sales',
          filters: {},
        }),
      })
      expect(response.status).toBe(201)
      const savedConfig = setSpy.mock.calls[0]?.[1] as { categories: { id: string }[] }
      expect(savedConfig.categories.some((c) => c.id === 'sales')).toBe(true)
    })
  })

  describe('PUT /api/filter-presets/:id', () => {
    it('updates a preset with admin access', async () => {
      const workspaceConfig = {
        presets: [...MOCK_PRESETS.presets],
        categories: [...MOCK_PRESETS.categories],
      }
      vi.spyOn(workspaceConfigService, 'getWorkspaceFilterPresets').mockResolvedValue(workspaceConfig)
      vi.spyOn(workspaceConfigService, 'setWorkspaceFilterPresets').mockResolvedValue(undefined)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/senior-engineer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          name: 'Senior Engineer (Updated)',
          filters: { minExperience: 7 },
        }),
      })
      expect(response.status).toBe(200)
      const body = await parseJsonBody<{ success: unknown; preset: { name: string; id: string } }>(response)
      expect(body.success).toBe(true)
      expect(body.preset.name).toBe('Senior Engineer (Updated)')
      expect(body.preset.id).toBe('senior-engineer')
    })

    it('rejects update without admin access (hr workspace)', async () => {
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/senior-engineer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...USER_HEADERS },
        body: JSON.stringify({ name: 'Hacked' }),
      })
      expect(response.status).toBe(403)
    })

    it('returns 404 for unknown preset', async () => {
      const workspaceConfig = {
        presets: [...MOCK_PRESETS.presets],
        categories: [...MOCK_PRESETS.categories],
      }
      vi.spyOn(workspaceConfigService, 'getWorkspaceFilterPresets').mockResolvedValue(workspaceConfig)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ name: 'Test' }),
      })
      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/filter-presets/:id', () => {
    it('deletes a preset with admin access', async () => {
      const workspaceConfig = {
        presets: [...MOCK_PRESETS.presets],
        categories: [...MOCK_PRESETS.categories],
      }
      vi.spyOn(workspaceConfigService, 'getWorkspaceFilterPresets').mockResolvedValue(workspaceConfig)
      const setSpy = vi.spyOn(workspaceConfigService, 'setWorkspaceFilterPresets').mockResolvedValue(undefined)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/senior-engineer', {
        method: 'DELETE',
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const savedConfig = setSpy.mock.calls[0]?.[1] as { presets: { id: string }[] }
      expect(savedConfig.presets.every((p) => p.id !== 'senior-engineer')).toBe(true)
    })

    it('rejects delete without admin access (hr workspace)', async () => {
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/senior-engineer', {
        method: 'DELETE',
        headers: USER_HEADERS,
      })
      expect(response.status).toBe(403)
    })

    it('returns 404 for unknown preset', async () => {
      const workspaceConfig = {
        presets: [...MOCK_PRESETS.presets],
        categories: [...MOCK_PRESETS.categories],
      }
      vi.spyOn(workspaceConfigService, 'getWorkspaceFilterPresets').mockResolvedValue(workspaceConfig)
      const app = createTestApp()
      const response = await app.request('/api/filter-presets/nonexistent', {
        method: 'DELETE',
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(404)
    })
  })
})
