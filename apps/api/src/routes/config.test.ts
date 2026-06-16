import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import configRoutes from './config'
import { createAuthMiddleware } from '../middleware/auth'
import { workspaceMiddleware } from '../middleware/workspace'
import type { AuthStorage } from '../services/auth-storage'
import { configSourceInspector, UnknownConfigSourceError } from '../services/config-source-inspector'
import { customKeywordService } from '../services/custom-keyword-service'
import { resetResumeScreeningDb } from '../services/database'
import { workspaceConfigService } from '../services/workspace-config-service'
import { createAuthHeaders } from './test-auth-helpers'
import { parseJsonBody } from '../test-utils'

function createTestApp(storage?: AuthStorage) {
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

describe('config route workspace access', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetResumeScreeningDb()
  })

  it('loads rule weights for the requested workspace', async () => {
    const getRuleWeightsSpy = vi.spyOn(workspaceConfigService, 'getRuleWeights').mockResolvedValue({
      roleMatch: {
        screener: { passThreshold: 52 },
      },
    } as never)

    const app = createTestApp()
    const response = await app.request('/api/config/rule-weights', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    expect(getRuleWeightsSpy).toHaveBeenCalledWith('hr')
    expect(await response.json()).toEqual({
      success: true,
      config: {
        roleMatch: {
          screener: { passThreshold: 52 },
        },
      },
    })
  })

  it('loads the resolved resume field usage policy for the requested workspace', async () => {
    const getPolicySpy = vi.spyOn(workspaceConfigService, 'getResumeFieldUsagePolicy').mockResolvedValue({
      version: 1,
      updatedAt: '2026-03-20',
      description: 'test policy',
      sourceFileRelativePath: 'config/resume/field-usage-policy.json5',
      fields: {
        jobIntention: {
          surfaces: {
            analysis: false,
            presentation: true,
          },
        },
      },
    })

    const app = createTestApp()
    const response = await app.request('/api/config/resume-field-usage-policy', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    expect(getPolicySpy).toHaveBeenCalledWith('hr')
    expect(await response.json()).toEqual({
      success: true,
      config: {
        version: 1,
        updatedAt: '2026-03-20',
        description: 'test policy',
        sourceFileRelativePath: 'config/resume/field-usage-policy.json5',
        fields: {
          jobIntention: {
            surfaces: {
              analysis: false,
              presentation: true,
            },
          },
        },
      },
    })
  })

  it('requires authentication for workspace config updates', async () => {
    const setRuleWeightsSpy = vi.spyOn(workspaceConfigService, 'setWorkspaceRuleWeights').mockResolvedValue()

    const app = createTestApp()
    const response = await app.request('/api/config/rule-weights', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'hr',
      },
      body: JSON.stringify({
        roleMatch: {
          screener: { passThreshold: 60 },
        },
      }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Authentication required',
    })
    expect(setRuleWeightsSpy).not.toHaveBeenCalled()
  })

  it('blocks workspace users from updating workspace config', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'hr', role: 'user' })
    const setRuleWeightsSpy = vi.spyOn(workspaceConfigService, 'setWorkspaceRuleWeights').mockResolvedValue()

    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/rule-weights', {
      method: 'PUT',
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roleMatch: {
          screener: { passThreshold: 60 },
        },
      }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Admin access required',
    })
    expect(setRuleWeightsSpy).not.toHaveBeenCalled()
  })

  it('allows dev admin updates and persists them to the dev workspace', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'dev', role: 'admin' })
    const setRuleWeightsSpy = vi.spyOn(workspaceConfigService, 'setWorkspaceRuleWeights').mockResolvedValue()
    const getRuleWeightsSpy = vi.spyOn(workspaceConfigService, 'getRuleWeights').mockResolvedValue({
      roleMatch: {
        screener: { passThreshold: 64 },
      },
    } as never)

    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/rule-weights', {
      method: 'PUT',
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roleMatch: {
          screener: { passThreshold: 64 },
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(setRuleWeightsSpy).toHaveBeenCalledWith('dev', {
      roleMatch: {
        screener: { passThreshold: 64 },
      },
    })
    expect(getRuleWeightsSpy).toHaveBeenCalledWith('dev')
    expect(await response.json()).toEqual({
      success: true,
      config: {
        roleMatch: {
          screener: { passThreshold: 64 },
        },
      },
    })
  })

  it('allows hr workspace admins to update hr workspace config', async () => {
    const auth = createAuthHeaders({ workspaceSlug: 'hr', role: 'admin' })
    const setRuleWeightsSpy = vi.spyOn(workspaceConfigService, 'setWorkspaceRuleWeights').mockResolvedValue()
    const getRuleWeightsSpy = vi.spyOn(workspaceConfigService, 'getRuleWeights').mockResolvedValue({
      roleMatch: {
        screener: { passThreshold: 68 },
      },
    } as never)

    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/rule-weights', {
      method: 'PUT',
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roleMatch: {
          screener: { passThreshold: 68 },
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(setRuleWeightsSpy).toHaveBeenCalledWith('hr', {
      roleMatch: {
        screener: { passThreshold: 68 },
      },
    })
    expect(getRuleWeightsSpy).toHaveBeenCalledWith('hr')
  })

  it('allows dev admin updates for the resume field usage policy', async () => {
    const setPolicySpy = vi.spyOn(workspaceConfigService, 'setWorkspaceResumeFieldUsagePolicy').mockResolvedValue()
    const getPolicySpy = vi.spyOn(workspaceConfigService, 'getResumeFieldUsagePolicy').mockResolvedValue({
      version: 1,
      updatedAt: '2026-03-20',
      description: 'merged policy',
      sourceFileRelativePath: 'config/resume/field-usage-policy.json5',
      fields: {
        jobIntention: {
          surfaces: {
            analysis: false,
            presentation: true,
          },
        },
      },
    })

    const auth = createAuthHeaders({ workspaceSlug: 'dev', role: 'admin' })
    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/resume-field-usage-policy', {
      method: 'PUT',
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          jobIntention: {
            surfaces: {
              presentation: true,
            },
          },
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(setPolicySpy).toHaveBeenCalledWith('dev', {
      fields: {
        jobIntention: {
          surfaces: {
            presentation: true,
          },
        },
      },
    })
    expect(getPolicySpy).toHaveBeenCalledWith('dev')
    expect(await response.json()).toEqual({
      success: true,
      config: {
        version: 1,
        updatedAt: '2026-03-20',
        description: 'merged policy',
        sourceFileRelativePath: 'config/resume/field-usage-policy.json5',
        fields: {
          jobIntention: {
            surfaces: {
              analysis: false,
              presentation: true,
            },
          },
        },
      },
    })
  })

  it('allows hr users to load export field settings', async () => {
    const getExportFieldsSpy = vi.spyOn(workspaceConfigService, 'getExportFieldsConfig').mockResolvedValue({
      fields: ['resumeId', 'name'],
      includeDebugWhenEnabled: false,
    })

    const app = createTestApp()
    const response = await app.request('/api/config/export-fields', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    expect(getExportFieldsSpy).toHaveBeenCalledWith('hr')
    expect(await response.json()).toEqual({
      success: true,
      config: {
        fields: ['resumeId', 'name'],
        includeDebugWhenEnabled: false,
      },
    })
  })

  it('allows hr users to update export field settings', async () => {
    const setExportFieldsSpy = vi.spyOn(workspaceConfigService, 'setExportFieldsConfig').mockResolvedValue()
    const getExportFieldsSpy = vi.spyOn(workspaceConfigService, 'getExportFieldsConfig').mockResolvedValue({
      fields: ['resumeId', 'name', 'userRating'],
      includeDebugWhenEnabled: true,
    })

    const app = createTestApp()
    const response = await app.request('/api/config/export-fields', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'hr',
      },
      body: JSON.stringify({
        fields: ['resumeId', 'name', 'userRating'],
        includeDebugWhenEnabled: true,
      }),
    })

    expect(response.status).toBe(200)
    expect(setExportFieldsSpy).toHaveBeenCalledWith('hr', {
      fields: ['resumeId', 'name', 'userRating'],
      includeDebugWhenEnabled: true,
    })
    expect(getExportFieldsSpy).toHaveBeenCalledWith('hr')
    expect(await response.json()).toEqual({
      success: true,
      config: {
        fields: ['resumeId', 'name', 'userRating'],
        includeDebugWhenEnabled: true,
      },
    })
  })

  it('lists allowlisted config sources', async () => {
    const listSourcesSpy = vi.spyOn(configSourceInspector, 'listSources').mockReturnValue([
      {
        key: 'resume-ai-prompts-active',
        label: 'Resume AI prompts (active locale)',
        relativePath: 'config/resume/ai-prompts.md',
        type: 'markdown',
        group: 'prompt',
        audience: 'developer',
        readOnly: true,
        metadata: {
          version: 3,
          requestedLocale: 'en',
          resolvedSourceLocale: 'zh-Hans',
          fallbackToZhHans: true,
        },
      },
    ])

    const app = createTestApp()
    const response = await app.request('/api/config/sources?locale=en', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    expect(listSourcesSpy).toHaveBeenCalledWith('en')
    expect(await response.json()).toEqual({
      success: true,
      sources: [
        {
          key: 'resume-ai-prompts-active',
          label: 'Resume AI prompts (active locale)',
          relativePath: 'config/resume/ai-prompts.md',
          type: 'markdown',
          group: 'prompt',
          audience: 'developer',
          readOnly: true,
          metadata: {
            version: 3,
            requestedLocale: 'en',
            resolvedSourceLocale: 'zh-Hans',
            fallbackToZhHans: true,
          },
        },
      ],
    })
  })

  it('loads grouped config source summaries', async () => {
    const listGroupSpy = vi.spyOn(configSourceInspector, 'listSourceGroups').mockReturnValue([
      {
        key: 'prompt',
        label: 'Prompt Sources',
        description: 'Prompt and AI-inspection sources used by debug and screening flows.',
        audience: 'developer',
        sources: [
          {
            key: 'resume-ai-prompts-active',
            label: 'Resume AI prompts (active locale)',
            relativePath: 'config/resume/ai-prompts.md',
            type: 'markdown',
            group: 'prompt',
            audience: 'developer',
            readOnly: true,
          },
        ],
      },
    ])

    const app = createTestApp()
    const response = await app.request('/api/config/source-groups?locale=en', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    expect(listGroupSpy).toHaveBeenCalledWith('en')
    expect(await response.json()).toEqual({
      success: true,
      groups: [
        {
          key: 'prompt',
          label: 'Prompt Sources',
          description: 'Prompt and AI-inspection sources used by debug and screening flows.',
          audience: 'developer',
          sources: [
            {
              key: 'resume-ai-prompts-active',
              label: 'Resume AI prompts (active locale)',
              relativePath: 'config/resume/ai-prompts.md',
              type: 'markdown',
              group: 'prompt',
              audience: 'developer',
              readOnly: true,
            },
          ],
        },
      ],
    })
  })

  it('loads system metadata payload', async () => {
    const app = createTestApp()
    const response = await app.request('/api/config/system-metadata', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    const payload = await parseJsonBody<{
      success: boolean
      metadata: {
        identity: { appName: string }
        navigation: {
          system: unknown[]
          systemSettings: unknown[]
        }
        labels: {
          aiBreakdown: Array<{ key: string }>
        }
        capabilities: Array<{ id: string }>
      }
    }>(response)
    expect(payload.success).toBe(true)
    expect(payload.metadata.identity.appName).toBe('Trends')
    expect(payload.metadata.navigation.system.length).toBeGreaterThan(0)
    expect(payload.metadata.navigation.systemSettings.length).toBeGreaterThan(0)
    expect(payload.metadata.labels.aiBreakdown.some((item) => item.key === 'industry_db')).toBe(true)
    expect(payload.metadata.capabilities.some((item) => item.id === 'cli-system-inspect')).toBe(true)
  })

  it('loads resume display limits payload', async () => {
    const app = createTestApp()
    const response = await app.request('/api/config/resume-display-limits', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      latestWorkHistoryLimit: 3,
      source: 'packages/shared/src/work-history-evidence.ts',
    })
  })

  it('loads config source detail by key', async () => {
    const getSourceSpy = vi.spyOn(configSourceInspector, 'getSource').mockReturnValue({
      key: 'resume-skills',
      label: 'Resume skills taxonomy',
      relativePath: 'config/resume/skills.md',
      type: 'markdown',
      group: 'config',
      audience: 'developer',
      readOnly: true,
      rawSource: '## Skills\n- CNC',
      parsedPreview: {
        sections: [{ heading: 'Skills', lineCount: 1, subsectionHeadings: [] }],
      },
    })

    const app = createTestApp()
    const response = await app.request('/api/config/sources/resume-skills?locale=zh-Hans', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(200)
    expect(getSourceSpy).toHaveBeenCalledWith('resume-skills', 'zh-Hans')
    expect(await response.json()).toEqual({
      success: true,
      source: {
        key: 'resume-skills',
        label: 'Resume skills taxonomy',
        relativePath: 'config/resume/skills.md',
        type: 'markdown',
        group: 'config',
        audience: 'developer',
        readOnly: true,
        rawSource: '## Skills\n- CNC',
        parsedPreview: {
          sections: [{ heading: 'Skills', lineCount: 1, subsectionHeadings: [] }],
        },
      },
    })
  })

  it('returns 404 for unknown config source keys', async () => {
    vi.spyOn(configSourceInspector, 'getSource').mockImplementation(() => {
      throw new UnknownConfigSourceError('missing-source')
    })

    const app = createTestApp()
    const response = await app.request('/api/config/sources/missing-source', {
      headers: {
        'X-Workspace-Slug': 'hr',
      },
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Unknown config source: missing-source',
    })
  })

  it('returns custom keywords with workflow seeds and market metadata', async () => {
    vi.spyOn(workspaceConfigService, 'getCustomKeywords').mockResolvedValue({
      tags: [
        {
          id: 'seed-equipment-cnc',
          keyword: 'CNC',
          english: 'CNC',
          category: 'equipment',
          markets: ['CN', 'MY'],
          source: 'system',
        },
      ],
      categories: [
        {
          id: 'equipment',
          name: 'Equipment',
        },
      ],
      systemLocations: [
        {
          id: 'gd',
          keyword: '广东',
          level: 'province',
          visible: true,
          markets: ['CN'],
        },
      ],
      workflowSeeds: [
        {
          id: 'job5156-cn-cnc-sales',
          label: 'China · Job5156 · CNC 销售',
          market: 'CN',
          location: 'China',
          keywords: ['CNC', '销售'],
          collectionSource: {
            type: 'job5156',
          },
          visible: true,
          source: 'system',
        },
      ],
    } as never)

    const app = createTestApp()
    const response = await app.request('/api/config/custom-keywords', {
      headers: {
        'X-Workspace-Slug': 'dev',
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      tags: [
        {
          id: 'seed-equipment-cnc',
          keyword: 'CNC',
          english: 'CNC',
          category: 'equipment',
          markets: ['CN', 'MY'],
          source: 'system',
        },
      ],
      categories: [
        {
          id: 'equipment',
          name: 'Equipment',
        },
      ],
      systemLocations: [
        {
          id: 'gd',
          keyword: '广东',
          level: 'province',
          visible: true,
          markets: ['CN'],
        },
      ],
      workflowSeeds: [
        {
          id: 'job5156-cn-cnc-sales',
          label: 'China · Job5156 · CNC 销售',
          market: 'CN',
          location: 'China',
          keywords: ['CNC', '销售'],
          collectionSource: {
            type: 'job5156',
          },
          visible: true,
          source: 'system',
        },
      ],
    })
  })

  it('updates a seeded custom keyword through a workspace override', async () => {
    const baseConfig = {
      tags: [
        {
          id: 'seed-role-sales',
          keyword: '销售',
          english: 'Sales',
          category: 'role',
          markets: ['CN'],
          visible: true,
          source: 'system',
        },
      ],
      categories: [
        {
          id: 'role',
          name: 'Role',
        },
      ],
      systemLocations: [],
      workflowSeeds: [],
    }

    const updatedConfig = {
      ...baseConfig,
      tags: [
        {
          id: 'seed-role-sales',
          keyword: '销售',
          english: 'Sales',
          category: 'role',
          markets: ['CN', 'MY'],
          visible: false,
          source: 'workspace',
        },
      ],
    }

    const getCustomKeywordsSpy = vi.spyOn(workspaceConfigService, 'getCustomKeywords')
      .mockResolvedValueOnce(baseConfig as never)
      .mockResolvedValueOnce(updatedConfig as never)
    const getWorkspaceCustomKeywordsSpy = vi.spyOn(workspaceConfigService, 'getWorkspaceCustomKeywords').mockResolvedValue({
      tags: [],
      categories: [],
      systemLocations: [],
      workflowSeeds: [],
    } as never)
    const setWorkspaceCustomKeywordsSpy = vi.spyOn(workspaceConfigService, 'setWorkspaceCustomKeywords').mockResolvedValue()

    const auth = createAuthHeaders({ workspaceSlug: 'dev', role: 'admin' })
    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/custom-keywords/seed-role-sales', {
      method: 'PUT',
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'seed-role-sales',
        keyword: '销售',
        english: 'Sales',
        category: 'role',
        markets: ['CN', 'MY'],
        visible: false,
      }),
    })

    expect(response.status).toBe(200)
    expect(getCustomKeywordsSpy).toHaveBeenCalledTimes(2)
    expect(getWorkspaceCustomKeywordsSpy).toHaveBeenCalledWith('dev')
    expect(setWorkspaceCustomKeywordsSpy).toHaveBeenCalledWith('dev', expect.objectContaining({
      tags: [
        expect.objectContaining({
          id: 'seed-role-sales',
          keyword: '销售',
          english: 'Sales',
          category: 'role',
          markets: ['CN', 'MY'],
          visible: false,
        }),
      ],
    }))
    expect(await response.json()).toEqual({
      success: true,
      tag: {
        id: 'seed-role-sales',
        keyword: '销售',
        english: 'Sales',
        category: 'role',
        markets: ['CN', 'MY'],
        visible: false,
        source: 'workspace',
      },
    })
  })

  it('hides a seeded workflow seed through a workspace override on delete', async () => {
    vi.spyOn(customKeywordService, 'listWorkflowSeeds').mockReturnValue([
      {
        id: 'seek-my-cnc-sales',
        label: 'Malaysia · SEEK · CNC Sales',
        market: 'MY',
        location: 'Malaysia',
        keywords: ['CNC', 'Sales'],
        collectionSource: {
          type: 'seek',
        },
        visible: true,
        source: 'system',
      },
    ])

    const mergedConfig = {
      tags: [],
      categories: [],
      systemLocations: [],
      workflowSeeds: [
        {
          id: 'seek-my-cnc-sales',
          label: 'Malaysia · SEEK · CNC Sales',
          market: 'MY',
          location: 'Malaysia',
          keywords: ['CNC', 'Sales'],
          collectionSource: {
            type: 'seek',
          },
          visible: true,
          source: 'system',
        },
      ],
    }

    const getCustomKeywordsSpy = vi.spyOn(workspaceConfigService, 'getCustomKeywords').mockResolvedValue(mergedConfig as never)
    const getWorkspaceCustomKeywordsSpy = vi.spyOn(workspaceConfigService, 'getWorkspaceCustomKeywords').mockResolvedValue({
      tags: [],
      categories: [],
      systemLocations: [],
      workflowSeeds: [],
    } as never)
    const setWorkspaceCustomKeywordsSpy = vi.spyOn(workspaceConfigService, 'setWorkspaceCustomKeywords').mockResolvedValue()

    const auth = createAuthHeaders({ workspaceSlug: 'dev', role: 'admin' })
    const app = createTestApp(auth.storage)
    const response = await app.request('/api/config/custom-keywords/workflow-seeds/seek-my-cnc-sales', {
      method: 'DELETE',
      headers: auth.headers,
    })

    expect(response.status).toBe(200)
    expect(getCustomKeywordsSpy).toHaveBeenCalledWith('dev')
    expect(getWorkspaceCustomKeywordsSpy).toHaveBeenCalledWith('dev')
    expect(setWorkspaceCustomKeywordsSpy).toHaveBeenCalledWith('dev', expect.objectContaining({
      workflowSeeds: [
        expect.objectContaining({
          id: 'seek-my-cnc-sales',
          visible: false,
          source: 'workspace',
        }),
      ],
    }))
    expect(await response.json()).toEqual({
      success: true,
    })
  })
})
