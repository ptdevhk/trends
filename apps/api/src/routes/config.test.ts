import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../app'
import { workspaceConfigService } from '../services/workspace-config-service'

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

    const app = createApp()
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

    const app = createApp()
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

    const app = createApp()
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
})
