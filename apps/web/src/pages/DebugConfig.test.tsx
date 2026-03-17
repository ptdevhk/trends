import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DebugConfig from './DebugConfig'

const resetMutation = vi.fn(async () => ({ count: 0, cleared: 0 }))
const dispatchMutation = vi.fn(async () => ({ scheduled: 0 }))
const useMutationMock = vi.fn()
const tMock = (key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
  if (typeof options === 'string') {
    return options
  }
  return options?.defaultValue ?? key
}

vi.mock('convex/react', () => ({
  useQuery: () => ({
    activeWorkers: 1,
    total: 5,
    processing: 1,
    pending: 2,
    completed: 2,
    failed: 0,
    cancelled: 0,
  }),
  useMutation: () => useMutationMock(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}))

vi.mock('@/components/TaskMonitor', () => ({
  TaskMonitor: () => <div data-testid="task-monitor" />,
}))

vi.mock('@/components/SchedulerStatus', () => ({
  SchedulerStatus: () => <div data-testid="scheduler-status" />,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('DebugConfig config sources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMutationMock.mockReset()
    useMutationMock.mockReturnValueOnce(dispatchMutation).mockReturnValueOnce(resetMutation)

    vi.stubGlobal = vi.stubGlobal ?? ((name: string, value: unknown) => {
      ;(globalThis as Record<string, unknown>)[name] = value
      return value
    })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/api/config/ai-status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            enabled: true,
            model: 'claude-opus-4-6',
            temperature: 0,
            maxTokens: 4096,
            timeout: 30000,
            apiKeyMasked: 'sk-***',
            valid: true,
          }),
        }
      }

      if (url.endsWith('/api/config/agents')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            config: {
              agents: {
                list: [
                  {
                    id: 'screen',
                    name: 'Screen',
                    model: 'claude-opus-4-6',
                    config: {},
                  },
                ],
                defaults: {
                  screen: {},
                },
              },
            },
          }),
        }
      }

      if (url.endsWith('/api/config/custom-keywords')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            tags: [],
            categories: [],
            systemLocations: [],
          }),
        }
      }

      if (url.endsWith('/api/industry/brands')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [],
          }),
        }
      }

      if (url.endsWith('/api/config/source-groups')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            groups: [
              {
                key: 'prompt',
                label: 'Prompt Sources',
                description: 'Shared prompt definitions and locale-aware prompt assets.',
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
                    metadata: {
                      version: 4,
                      requestedLocale: 'en',
                      resolvedSourceLocale: 'zh-Hans',
                      fallbackToZhHans: true,
                    },
                  },
                ],
              },
              {
                key: 'config',
                label: 'Config Sources',
                description: 'Runtime configuration and rules exposed to debug surfaces.',
                audience: 'admin',
                sources: [
                  {
                    key: 'resume-rule-weights',
                    label: 'Resume rule weights',
                    relativePath: 'config/resume/rule-weights.json5',
                    type: 'json5',
                    group: 'config',
                    audience: 'admin',
                    readOnly: true,
                  },
                ],
              },
            ],
          }),
        }
      }

      if (url.endsWith('/api/config/sources/resume-ai-prompts-active')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            source: {
              key: 'resume-ai-prompts-active',
              label: 'Resume AI prompts (active locale)',
              relativePath: 'config/resume/ai-prompts.md',
              type: 'markdown',
              group: 'prompt',
              audience: 'developer',
              readOnly: true,
              metadata: {
                version: 4,
                updatedAt: '2026-03-10',
                description: 'Canonical resume AI prompt source',
                locale: 'en',
                requestedLocale: 'en',
                resolvedSourceLocale: 'zh-Hans',
                fallbackToZhHans: true,
              },
              rawSource: '## System Prompt\n- Focus on evidence',
              parsedPreview: {
                sections: [
                  {
                    heading: 'System Prompt',
                    lineCount: 1,
                    subsectionHeadings: [],
                  },
                ],
              },
            },
          }),
        }
      }

      if (url.endsWith('/api/config/sources/resume-rule-weights')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            source: {
              key: 'resume-rule-weights',
              label: 'Resume rule weights',
              relativePath: 'config/resume/rule-weights.json5',
              type: 'json5',
              group: 'config',
              audience: 'admin',
              readOnly: true,
              rawSource: '{ roleMatch: 50 }',
              parsedPreview: {
                roleMatch: 50,
              },
            },
          }),
        }
      }

      throw new Error(`Unhandled fetch: ${url}`)
    }))
  })

  it('shows config sources and loads selected detail', async () => {
    const user = userEvent.setup()

    render(<DebugConfig />)

    await waitFor(() => {
      expect(screen.getByText('debugConfig.configSources')).toBeInTheDocument()
    })

    expect(screen.getByText('Jump to section')).toBeInTheDocument()
    expect(screen.getAllByText('Operations').length).toBeGreaterThan(0)
    expect(screen.getAllByText('AI and agents').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rules and data').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Danger zone').length).toBeGreaterThan(0)
    expect(screen.getByText('System settings overview')).toBeInTheDocument()

    expect(screen.getByText('Prompt Sources')).toBeInTheDocument()
    expect(screen.getByText('Config Sources')).toBeInTheDocument()
    expect(screen.getAllByText('Resume AI prompts (active locale)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('config/resume/ai-prompts.md').length).toBeGreaterThan(0)
    expect(screen.getAllByText('debugConfig.readOnly').length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(screen.getByText('debugConfig.configSourceRaw')).toBeInTheDocument()
      expect(screen.getByText('debugConfig.configSourceParsedPreview')).toBeInTheDocument()
      expect(screen.getByText('debugConfig.configSourceFallbackEnabled')).toBeInTheDocument()
      expect(screen.getByText(/Focus on evidence/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Resume rule weights/i }))

    await waitFor(() => {
      expect(screen.getAllByText('Resume rule weights').length).toBeGreaterThan(0)
      expect(screen.getByText('{ roleMatch: 50 }')).toBeInTheDocument()
    })
  })
})
