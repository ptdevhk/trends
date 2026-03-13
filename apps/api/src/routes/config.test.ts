import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import configRoutes from './config'
import { workspaceMiddleware } from '../middleware/workspace'
import { configSourceInspector, UnknownConfigSourceError } from '../services/config-source-inspector'
import { workspaceConfigService } from '../services/workspace-config-service'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/api/config', configRoutes)
  return app
}

describe('config route workspace access', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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

  it('blocks hr users from updating workspace config', async () => {
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

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Admin access required',
    })
    expect(setRuleWeightsSpy).not.toHaveBeenCalled()
  })

  it('allows dev admin updates and persists them to the dev workspace', async () => {
    const setRuleWeightsSpy = vi.spyOn(workspaceConfigService, 'setWorkspaceRuleWeights').mockResolvedValue()
    const getRuleWeightsSpy = vi.spyOn(workspaceConfigService, 'getRuleWeights').mockResolvedValue({
      roleMatch: {
        screener: { passThreshold: 64 },
      },
    } as never)

    const app = createTestApp()
    const response = await app.request('/api/config/rule-weights', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Slug': 'dev',
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
    const payload = await response.json()
    expect(payload.success).toBe(true)
    expect(payload.metadata.identity.appName).toBe('Trends')
    expect(payload.metadata.navigation.system.length).toBeGreaterThan(0)
    expect(payload.metadata.labels.aiBreakdown.some((item: { key: string }) => item.key === 'industry_db')).toBe(true)
    expect(payload.metadata.capabilities.some((item: { id: string }) => item.id === 'cli-system-inspect')).toBe(true)
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
})
