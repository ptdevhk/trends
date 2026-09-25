import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ResearchSettingsPage } from './ResearchSettingsPage'

const mockT = (_key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
  let text = options?.defaultValue ?? _key
  if (options) {
    for (const [k, v] of Object.entries(options)) {
      if (k === 'defaultValue') continue
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
  }
  return text
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }))
vi.mock('@/contexts/WorkspaceContext', () => ({ useWorkspace: () => ({ slug: 'hr' }) }))

const getMock = vi.fn()
const putMock = vi.fn()
vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { GET: (...a: unknown[]) => getMock(...a), PUT: (...a: unknown[]) => putMock(...a) },
}))

const keywords = {
  success: true,
  seed: { version: 'v1', groups: [], defaultKeywords: ['压铸'] },
  workspace: { version: 1, enabled: [], excluded: [], custom: [] },
  effective: ['压铸'],
}
const platforms = {
  success: true,
  seed: { version: 'v1', groups: [], defaults: [], catalogIds: ['weibo'] },
  workspace: { version: 1, enabled: [], excluded: [] },
  effective: ['weibo'],
}
const newsSources = {
  success: true,
  seed: { version: 'v1', groups: [], catalogIds: [], defaultGroupIds: [] },
  workspace: { version: 1, excludedGroups: [], excludedFeeds: [], enabledFeeds: [] },
  effective: [],
}

describe('ResearchSettingsPage', () => {
  beforeEach(() => {
    getMock.mockReset()
    putMock.mockReset()
    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/research/pulse/keywords') return { data: keywords }
      if (path === '/api/research/platforms') return { data: platforms }
      if (path === '/api/research/news-sources') return { data: newsSources }
      return { data: { success: true, items: [] } }
    })
    putMock.mockResolvedValue({ data: { ...keywords, success: true } })
  })

  it('mounts at /hr/research/settings with back link and settings panel', () => {
    render(
      <MemoryRouter initialEntries={['/hr/research/settings']}>
        <ResearchSettingsPage />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('research-settings-page')).toBeInTheDocument()
    expect(screen.getByTestId('research-settings-back')).toHaveAttribute('href', '/hr/research')
    expect(screen.getByTestId('research-settings-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('research-settings-tab-config')).toHaveTextContent('监控设置')
    // settings panel loads state
    expect(getMock).toHaveBeenCalledWith('/api/research/pulse/keywords')
    expect(getMock).toHaveBeenCalledWith('/api/research/platforms')
    expect(getMock).toHaveBeenCalledWith('/api/research/news-sources')
    expect(screen.getByTestId('research-settings-panel')).toBeInTheDocument()
  })
})
