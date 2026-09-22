import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import configRoutes from './config'
import { createAuthMiddleware } from '../middleware/auth'
import { workspaceMiddleware } from '../middleware/workspace'
import { createAuthHeaders } from './test-auth-helpers'
import { resetResumeScreeningDb } from '../services/database'
import * as aiRoutingService from '../services/ai-routing-settings'
import * as aiConfigModule from '../services/ai-config'

vi.mock('../services/ai-routing-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ai-routing-settings')>()
  return {
    ...actual,
    getCachedAiRoutingSettings: vi.fn(),
    loadEffectiveAIConfig: vi.fn(),
    writeAiRoutingSettings: vi.fn(),
  }
})
vi.mock('../services/resume-work-history-limit', () => ({
  getEffectiveResumeWorkHistoryLimit: vi.fn().mockResolvedValue(3),
}))

const mockedService = vi.mocked(aiRoutingService)

function createTestApp(storage?: ReturnType<typeof createAuthHeaders>['storage']) {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  if (storage) {
    const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600 })
    app.use('*', middleware.optionalAuth)
    app.use('/api/*', middleware.requireCsrf)
  }
  app.route('/api/config', configRoutes)
  return app
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createEnvConfig() {
  return {
    enabled: true,
    resumesEnabled: true,
    model: 'openai/env-primary',
    fallbackModel: 'openai/env-fallback',
    apiKey: 'sk-env-key',
    apiBase: 'https://env.api/v1',
    temperature: 0,
    maxTokens: 4000,
    timeout: 120000,
    bonded: ['AI_API_KEY', 'AI_MODEL'],
  }
}

describe('ai-routing routes', () => {
  beforeEach(() => {
    mockedService.writeAiRoutingSettings.mockClear()
    mockedService.getCachedAiRoutingSettings.mockClear()
    mockedService.loadEffectiveAIConfig.mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    resetResumeScreeningDb()
  })

  it('rejects unauthenticated GET /api/config/ai-routing', async () => {
    vi.spyOn(aiConfigModule, 'loadAIConfig').mockReturnValue(createEnvConfig() as never)
    mockedService.getCachedAiRoutingSettings.mockResolvedValue(null)
    mockedService.loadEffectiveAIConfig.mockResolvedValue(createEnvConfig() as never)

    const app = createTestApp()
    const response = await app.request('/api/config/ai-routing')
    expect(response.status).toBe(401)
  })

  it('blocks non-admin PUT /api/config/ai-routing', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'hr', role: 'user' })
    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/ai-routing', {
      method: 'PUT',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/deepseek-v4-flash' }),
    })
    expect(response.status).toBe(403)
    expect(mockedService.writeAiRoutingSettings).not.toHaveBeenCalled()
  })

  it('admin PUT writes settings and never returns raw api key', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'dev', role: 'admin' })
    vi.spyOn(aiConfigModule, 'loadAIConfig').mockReturnValue(createEnvConfig() as never)
    vi.spyOn(aiConfigModule, 'getMaskedApiKey').mockReturnValue('sk-e***e')
    vi.spyOn(aiConfigModule, 'validateAIConfig').mockReturnValue({ valid: true })

    mockedService.writeAiRoutingSettings.mockResolvedValue({
      apiBase: 'https://settings.api/v1',
      model: 'openai/deepseek-v4-flash',
      fallbackModel: 'openai/deepseek-v4-flash-e',
      updatedBy: auth.userId,
      updatedAt: 1_700_000_000,
    })
    mockedService.getCachedAiRoutingSettings.mockResolvedValue({
      apiBase: 'https://settings.api/v1',
      model: 'openai/deepseek-v4-flash',
      fallbackModel: 'openai/deepseek-v4-flash-e',
    })
    mockedService.loadEffectiveAIConfig.mockResolvedValue({
      ...createEnvConfig(),
      model: 'openai/deepseek-v4-flash',
      apiBase: 'https://settings.api/v1',
    } as never)

    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/ai-routing', {
      method: 'PUT',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiBase: 'https://settings.api/v1',
        model: 'openai/deepseek-v4-flash',
        fallbackModel: 'openai/deepseek-v4-flash-e',
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    if (!isRecord(body)) {
      throw new Error('Expected a JSON object body')
    }
    const stored = isRecord(body.stored) ? body.stored : {}
    const effective = isRecord(body.effective) ? body.effective : {}
    const apiKey = isRecord(body.apiKey) ? body.apiKey : {}
    expect(stored.model).toBe('openai/deepseek-v4-flash')
    expect(effective.model).toBe('openai/deepseek-v4-flash')
    expect(apiKey.present).toBe(true)
    expect(JSON.stringify(body)).not.toContain('sk-env-key')

    const writeArg = mockedService.writeAiRoutingSettings.mock.calls[0][0]
    expect(writeArg.updatedBy).toBe(auth.userId)
  })

  it('rejects bare model with 400 on PUT', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'dev', role: 'admin' })
    vi.spyOn(aiConfigModule, 'loadAIConfig').mockReturnValue(createEnvConfig() as never)
    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/ai-routing', {
      method: 'PUT',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-v4-flash' }),
    })
    expect(response.status).toBe(400)
    expect(mockedService.writeAiRoutingSettings).not.toHaveBeenCalled()
  })

  it('GET returns masked key presence but never the raw value', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'dev', role: 'admin' })
    vi.spyOn(aiConfigModule, 'loadAIConfig').mockReturnValue(createEnvConfig() as never)
    vi.spyOn(aiConfigModule, 'getMaskedApiKey').mockReturnValue('sk-e***e')
    vi.spyOn(aiConfigModule, 'validateAIConfig').mockReturnValue({ valid: true })
    mockedService.getCachedAiRoutingSettings.mockResolvedValue(null)
    mockedService.loadEffectiveAIConfig.mockResolvedValue(createEnvConfig() as never)

    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/ai-routing', {
      headers: auth.headers,
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    if (!isRecord(body)) {
      throw new Error('Expected a JSON object body')
    }
    const apiKey = isRecord(body.apiKey) ? body.apiKey : {}
    expect(apiKey.present).toBe(true)
    expect(JSON.stringify(body)).not.toContain('sk-env-key')
  })
})
