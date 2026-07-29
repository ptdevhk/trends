import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'

const requestJsonMock = vi.hoisted(() => vi.fn())

vi.mock('@/pages/system-settings/lib', () => ({
  parseConfigSourceGroupsPayload: (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return null
    const p = payload as Record<string, unknown>
    return p.groups ?? null
  },
  parseConfigSourceDetailPayload: (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return null
    return payload
  },
  useSettingsRequestJson: () => ({ apiBaseUrl: '/api', requestJson: requestJsonMock }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
        return fallback.defaultValue as string
      }
      return _key
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}))

import { SystemSettingsConfigSourcesPage } from './SystemSettingsConfigSourcesPage'

const mockGroups = {
  groups: [
    {
      key: 'prompts',
      label: 'AI Prompts',
      description: 'System and user prompt templates',
      audience: 'internal',
      sources: [
        { key: 'screener-prompt', label: 'Screener Prompt', type: 'yaml', relativePath: 'config/prompts/screener.yaml', metadata: { locale: 'zh-Hans', version: 2 } },
        { key: 'tagger-prompt', label: 'Tagger Prompt', type: 'yaml', relativePath: 'config/prompts/tagger.yaml' },
      ],
    },
  ],
}

const mockSourceDetail = {
  key: 'screener-prompt',
  label: 'Screener Prompt',
  type: 'yaml',
  relativePath: 'config/prompts/screener.yaml',
  group: 'prompts',
  audience: 'internal',
  rawSource: 'system: You are a resume screener',
  parsedPreview: { system: 'You are a resume screener', user: 'Evaluate this resume' },
  metadata: { locale: 'zh-Hans', version: 2, description: 'Main screening prompt' },
}

const mockResumeDisplayLimits = {
  success: true,
  latestWorkHistoryLimit: 5,
  source: 'system_settings.resumeWorkHistoryLimit',
}

describe('SystemSettingsConfigSourcesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/source-groups') return Promise.resolve(mockGroups)
      if (url === '/api/config/resume-display-limits') return Promise.resolve(mockResumeDisplayLimits)
      if (url.startsWith('/api/config/sources/')) return Promise.resolve(mockSourceDetail)
      return Promise.resolve({})
    })
  })

  it('loads and displays config source groups', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsConfigSourcesPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('AI Prompts')).toBeInTheDocument()
    })
    expect(screen.getByText('Screener Prompt')).toBeInTheDocument()
    expect(screen.getByText('Tagger Prompt')).toBeInTheDocument()
  })

  it('loads and displays resume display limits', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsConfigSourcesPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('system_settings.resumeWorkHistoryLimit')).toBeInTheDocument()
    })
  })

  it('shows config source detail when source is selected', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsConfigSourcesPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Screener Prompt')).toBeInTheDocument()
    })

    // The first source is auto-selected, so detail should load
    await waitFor(() => {
      expect(screen.getByText('Screener Prompt')).toBeInTheDocument()
    })
    // Detail card should show the source type and group
    expect(screen.getAllByText(/yaml/).length).toBeGreaterThan(0)
  })

  it('shows loading state initially', () => {
    requestJsonMock.mockReturnValue(new Promise(() => {}))

    render(
      <BrowserRouter>
        <SystemSettingsConfigSourcesPage />
      </BrowserRouter>,
    )

    expect(screen.getByText('Config sources')).toBeInTheDocument()
  })

  it('shows error state on load failure', async () => {
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/source-groups') return Promise.reject(new Error('Network error'))
      if (url === '/api/config/resume-display-limits') return Promise.resolve(null)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsConfigSourcesPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('resumes.error')).toBeInTheDocument()
    })
  })

  it('refreshes data on button click', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsConfigSourcesPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('AI Prompts')).toBeInTheDocument()
    })

    const refreshBtn = screen.getByText('Refresh')
    await userEvent.click(refreshBtn)

    await waitFor(() => {
      expect(requestJsonMock.mock.calls.length).toBeGreaterThan(3)
    })
  })

  it('handles missing resume display limits gracefully', async () => {
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/source-groups') return Promise.resolve(mockGroups)
      if (url === '/api/config/resume-display-limits') return Promise.resolve(null)
      if (url.startsWith('/api/config/sources/')) return Promise.resolve(mockSourceDetail)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsConfigSourcesPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('AI Prompts')).toBeInTheDocument()
    })

    // Resume display limits card should not appear
    expect(screen.queryByText('Resume display limits')).not.toBeInTheDocument()
  })

  it('switches selected source on click', async () => {
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/source-groups') return Promise.resolve(mockGroups)
      if (url === '/api/config/resume-display-limits') return Promise.resolve(mockResumeDisplayLimits)
      if (url.startsWith('/api/config/sources/')) return Promise.resolve({ ...mockSourceDetail, key: url.split('/').pop() })
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsConfigSourcesPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Screener Prompt')).toBeInTheDocument()
    })

    // Click on second source
    const taggerButtons = screen.getAllByText('Tagger Prompt')
    await userEvent.click(taggerButtons[0])

    // Detail for tagger should be requested
    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(expect.stringContaining('/api/config/sources/tagger-prompt'))
    })
  })

  it('shows config source parse error', async () => {
    const groupsWithError = {
      groups: [
        {
          key: 'prompts',
          label: 'AI Prompts',
          description: 'System and user prompt templates',
          audience: 'internal',
          sources: [
            { key: 'bad-prompt', label: 'Bad Prompt', type: 'yaml', relativePath: 'config/bad.yaml', parseError: 'YAML parse error on line 5' },
          ],
        },
      ],
    }

    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/source-groups') return Promise.resolve(groupsWithError)
      if (url === '/api/config/resume-display-limits') return Promise.resolve(mockResumeDisplayLimits)
      if (url.startsWith('/api/config/sources/')) return Promise.resolve({ ...mockSourceDetail, parseError: 'YAML parse error on line 5' })
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsConfigSourcesPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('YAML parse error on line 5')).toBeInTheDocument()
    })
  })
})
