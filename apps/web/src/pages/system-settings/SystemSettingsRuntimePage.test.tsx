import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'

const { requestJsonMock, setEffectiveWorkHistoryLimitMock, translateMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
  setEffectiveWorkHistoryLimitMock: vi.fn(),
  translateMock: vi.fn((_key: string, fallback?: string | Record<string, unknown>) => {
    if (typeof fallback === 'string') return fallback
    if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
      return fallback.defaultValue as string
    }
    return _key
  }),
}))

vi.mock('@/pages/system-settings/lib', () => ({
  parseAIStatusPayload: (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return null
    return payload
  },
  parseAgentsConfigPayload: (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return null
    return payload
  },
  parseOptionalNumberInput: (raw: string) => {
    if (raw === '') return { valid: true, value: undefined }
    const n = Number(raw)
    return Number.isFinite(n) ? { valid: true, value: n } : { valid: false }
  },
  useSettingsRequestJson: () => ({ apiBaseUrl: '/api', requestJson: requestJsonMock }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translateMock,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/contexts/ResumeWorkHistoryLimitContext', () => ({
  useResumeWorkHistoryLimit: () => ({
    limit: 3,
    setLimit: setEffectiveWorkHistoryLimitMock,
  }),
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

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} data-testid="input" />,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}))

import { SystemSettingsRuntimePage } from './SystemSettingsRuntimePage'

const mockAiStatus = {
  enabled: true,
  model: 'gpt-4o',
  apiBase: 'https://api.openai.com/v1',
  temperature: 0.3,
  maxTokens: 4096,
  timeout: 60,
  apiKeyMasked: 'sk-...abc',
  valid: true,
}

const mockAgentsConfig = {
  agents: {
    list: [
      { id: 'screener', name: 'Resume Screener', model: 'gpt-4o', config: { batchSize: 10, parallelism: 3, timeout: 120 }, isBonded: false },
      { id: 'tagger', name: 'Keyword Tagger', model: 'gpt-4o-mini', config: { batchSize: 20 }, isBonded: true },
    ],
    defaults: { screener: { passThreshold: 60 } },
  },
}

const mockResumeWorkHistoryLimit = {
  success: true,
  limit: 3,
  defaultLimit: 3,
  min: 1,
  max: 10,
}

describe('SystemSettingsRuntimePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/ai-status') return Promise.resolve(mockAiStatus)
      if (url === '/api/config/agents') return Promise.resolve(mockAgentsConfig)
      if (url === '/api/system/resume-work-history-limit') return Promise.resolve(mockResumeWorkHistoryLimit)
      return Promise.resolve({})
    })
  })

  it('loads and applies the configured resume work-history limit', async () => {
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/ai-status') return Promise.resolve(mockAiStatus)
      if (url === '/api/config/agents') return Promise.resolve(mockAgentsConfig)
      if (url === '/api/system/resume-work-history-limit') {
        return Promise.resolve({ ...mockResumeWorkHistoryLimit, limit: 5 })
      }
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Latest work-history entries')).toHaveValue(5)
      expect(setEffectiveWorkHistoryLimitMock).toHaveBeenCalledWith(5)
    })
  })

  it('saves a valid resume work-history limit and updates the app context', async () => {
    const { toast } = await import('sonner')
    requestJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/system/resume-work-history-limit' && init?.method === 'PUT') {
        return Promise.resolve({ ...mockResumeWorkHistoryLimit, limit: 4 })
      }
      if (url === '/api/config/ai-status') return Promise.resolve(mockAiStatus)
      if (url === '/api/config/agents') return Promise.resolve(mockAgentsConfig)
      if (url === '/api/system/resume-work-history-limit') return Promise.resolve(mockResumeWorkHistoryLimit)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    const input = await screen.findByLabelText('Latest work-history entries')
    await userEvent.clear(input)
    await userEvent.type(input, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Save limit' }))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith('/api/system/resume-work-history-limit', {
        method: 'PUT',
        body: JSON.stringify({ limit: 4 }),
      })
      expect(setEffectiveWorkHistoryLimitMock).toHaveBeenCalledWith(4)
      expect(toast.success).toHaveBeenCalledWith('Resume work-history limit saved.')
    })
  })

  it('rejects a resume work-history limit outside the allowed range', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    const input = await screen.findByLabelText('Latest work-history entries')
    await userEvent.clear(input)
    await userEvent.type(input, '11')

    expect(screen.getByText('Enter a whole number from 1 to 10.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save limit' })).toBeDisabled()
  })

  it('shows an error when saving the resume work-history limit fails', async () => {
    const { toast } = await import('sonner')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/system/resume-work-history-limit' && init?.method === 'PUT') {
        return Promise.reject(new Error('Save failed'))
      }
      if (url === '/api/config/ai-status') return Promise.resolve(mockAiStatus)
      if (url === '/api/config/agents') return Promise.resolve(mockAgentsConfig)
      if (url === '/api/system/resume-work-history-limit') return Promise.resolve(mockResumeWorkHistoryLimit)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    const input = await screen.findByLabelText('Latest work-history entries')
    await userEvent.clear(input)
    await userEvent.type(input, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Save limit' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('debugConfig.saveError')
    })
    consoleErrorSpy.mockRestore()
  })

  it('loads and displays AI status', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    })
    expect(screen.getByText('sk-...abc')).toBeInTheDocument()
  })

  it('shows AI enabled and valid badges', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('debugConfig.aiEnabled')).toBeInTheDocument()
    })
    expect(screen.getByText('debugConfig.aiValid')).toBeInTheDocument()
  })

  it('shows AI disabled badge when not enabled', async () => {
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/ai-status') return Promise.resolve({ ...mockAiStatus, enabled: false, valid: false, validationError: 'Invalid key' })
      if (url === '/api/config/agents') return Promise.resolve(mockAgentsConfig)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('debugConfig.aiDisabled')).toBeInTheDocument()
    })
    expect(screen.getByText('debugConfig.aiInvalid')).toBeInTheDocument()
    expect(screen.getByText('Invalid key')).toBeInTheDocument()
  })

  it('loads and displays agents', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('screener')).toBeInTheDocument()
    })
    expect(screen.getByText('tagger')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    requestJsonMock.mockReturnValue(new Promise(() => {}))

    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    expect(screen.getByText('AI review runtime')).toBeInTheDocument()
  })

  it('shows error state on load failure', async () => {
    requestJsonMock.mockRejectedValue(new Error('Network error'))

    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('resumes.error')).toBeInTheDocument()
    })
  })

  it('refreshes data on button click', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    })

    const refreshBtn = screen.getByText('Refresh')
    await userEvent.click(refreshBtn)

    await waitFor(() => {
      expect(requestJsonMock.mock.calls.length).toBeGreaterThan(2)
    })
  })

  it('saves agent config', async () => {
    const { toast } = await import('sonner')
    requestJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/config/agents' && init?.method === 'PUT') return Promise.resolve(mockAgentsConfig)
      if (url === '/api/config/ai-status') return Promise.resolve(mockAiStatus)
      if (url === '/api/config/agents') return Promise.resolve(mockAgentsConfig)
      if (url === '/api/system/resume-work-history-limit') return Promise.resolve(mockResumeWorkHistoryLimit)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('screener')).toBeInTheDocument()
    })

    // Click the save button for the first agent
    const saveButtons = screen.getAllByText('debugConfig.save')
    await userEvent.click(saveButtons[0])

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled()
    })
  })

  it('handles save error gracefully', async () => {
    const { toast } = await import('sonner')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/config/agents' && init?.method === 'PUT') return Promise.reject(new Error('Save failed'))
      if (url === '/api/config/ai-status') return Promise.resolve(mockAiStatus)
      if (url === '/api/config/agents') return Promise.resolve(mockAgentsConfig)
      if (url === '/api/system/resume-work-history-limit') return Promise.resolve(mockResumeWorkHistoryLimit)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('screener')).toBeInTheDocument()
    })

    const saveButtons = screen.getAllByText('debugConfig.save')
    await userEvent.click(saveButtons[0])

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })

    consoleErrorSpy.mockRestore()
  })

  it('shows review stage count in description', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsRuntimePage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      // The t() mock returns defaultValue as-is: '{{count}} review stages'
      // since it doesn't interpolate, just check the template is rendered
      expect(screen.getByText(/review stages/)).toBeInTheDocument()
    })
  })
})
