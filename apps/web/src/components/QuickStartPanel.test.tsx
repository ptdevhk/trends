import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { QuickStartPanel } from './QuickStartPanel'
import type { SearchHistoryItem } from '@/hooks/useSession'

const { getMock, postMock, navigateMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  navigateMock: vi.fn(),
}))
const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}))

const SEEK_MALAYSIA_JOB_URL = 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1'
const SEEK_MALAYSIA_COLLECT_URL = 'https://my.employer.seek.com/candidates/recommended?keyword=CNC+Sales&location=Kuala+Lumpur+MY&tr_auto_sync=true'

const SEEK_MALAYSIA_WORKFLOW_SEED = {
  id: 'seek-my-cnc-sales',
  label: 'Malaysia · SEEK · CNC Sales',
  market: 'MY',
  location: 'Kuala Lumpur MY',
  keywords: ['CNC', 'Sales'],
  collectionSource: {
    type: 'seek',
  },
  visible: true,
}

const JOB51_WORKFLOW_SEED = {
  id: 'job51-cn-cnc-sales',
  label: 'China · 51job · CNC 销售',
  market: 'CN',
  location: '东莞',
  keywords: ['CNC', '销售'],
  collectionSource: {
    type: '51job',
  },
  visible: true,
}

const SEEK_MALAYSIA_PROFILE = {
  id: 'seek-malaysia-sales',
  name: 'SEEK Malaysia CNC Sales',
  status: 'active' as const,
  location: 'Kuala Lumpur MY',
  keywords: ['CNC', 'Sales'],
  jobDescription: 'seek-malaysia-sales',
  filters: {
    minExperience: 2,
    maxAge: 45,
  },
  sources: [
    {
      type: 'seek',
      enabled: true,
      priority: 1,
      jobUrl: SEEK_MALAYSIA_JOB_URL,
    },
  ],
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('./JobDescriptionSelect', () => ({
  JobDescriptionSelect: ({
    value,
    onChange,
  }: {
    value: string
    onChange?: (value: string) => void
  }) => (
    <select
      data-testid="job-description-select"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <option value="">Select job description</option>
      <option value="lathe-sales">车床销售工程师</option>
      <option value="senior-mechanical-engineer">高级机械工程师</option>
    </select>
  ),
}))

vi.mock('./KeywordChips', () => ({
  KeywordChips: () => <div data-testid="keyword-chips" />,
}))

vi.mock('./JobDescriptionEditor', () => ({
  JobDescriptionEditor: () => null,
}))

vi.mock('./SearchProfileEditorDialog', () => ({
  SearchProfileEditorDialog: () => null,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

describe('QuickStartPanel quick-filter display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigateMock.mockReset()
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === 'skip') {
        return undefined
      }
      if (typeof args === 'object' && args !== null && 'workspaceSlug' in args) {
        return []
      }
      if (typeof args === 'object' && args !== null && 'id' in args) {
        return null
      }
      return undefined
    })
    postMock.mockResolvedValue({ data: { success: false } })
    getMock.mockImplementation(async (path: string) => {
      if (path.includes('/api/config/custom-keywords')) {
        return {
          data: {
            success: true,
            tags: [],
            categories: [],
            systemLocations: [],
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
              },
              SEEK_MALAYSIA_WORKFLOW_SEED,
              JOB51_WORKFLOW_SEED,
            ],
          },
        }
      }

      if (path.includes('/api/job-descriptions/lathe-sales')) {
        return {
          data: {
            success: true,
            item: {
              requiredRoles: [{ type: 'sales' }],
            },
          },
        }
      }

      if (path.includes('/api/job-descriptions/senior-mechanical-engineer')) {
        return {
          data: {
            success: true,
            item: {
              requiredRoles: [{ type: 'engineer' }],
            },
          },
        }
      }

      return {
        data: {
          success: true,
          item: {
            requiredRoles: [],
          },
        },
      }
    })
  })

  it('does not render the quick-filter summary row', async () => {
    const { rerender } = render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId="lathe-sales"
      />
    )

    await waitFor(() => {
      expect(getMock).toHaveBeenCalled()
    })
    expect(screen.queryByText('筛选条件')).not.toBeInTheDocument()
    expect(screen.queryByText(/销售经验\s*1\+年/)).not.toBeInTheDocument()
    expect(screen.queryByText(/≤\s*45岁/)).not.toBeInTheDocument()

    rerender(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId="senior-mechanical-engineer"
      />
    )

    await waitFor(() => {
      expect(getMock).toHaveBeenCalled()
    })
    expect(screen.queryByText('筛选条件')).not.toBeInTheDocument()
    expect(screen.queryByText(/工程经验\s*1\+年/)).not.toBeInTheDocument()
  })

  it('restores editable location input near keywords', () => {
    render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId=""
      />
    )

    const locationInput = screen.getByRole('textbox', { name: '位置' }) as HTMLInputElement
    expect(locationInput.value).toBe('广东')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('keeps the shell compact until large tablet and desktop breakpoints', () => {
    render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId=""
      />
    )

    const searchGrid = screen.getByTestId('quickstart-search-grid')
    const jobDescriptionCard = screen.getByTestId('quickstart-jd-card')

    expect(searchGrid.className).toContain('lg:grid-cols-[minmax(0,1.3fr)_minmax(220px,0.85fr)]')
    expect(searchGrid.className).toContain('xl:grid-cols-[minmax(0,1.45fr)_minmax(180px,0.7fr)_minmax(220px,0.85fr)]')
    expect(jobDescriptionCard.className).toContain('lg:col-span-2')
    expect(jobDescriptionCard.className).toContain('xl:col-span-1')
  })

  it('opens the assistant drawer and surfaces recent saved searches', async () => {
    const user = userEvent.setup()
    const onAssistantOpen = vi.fn()

    render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={['CNC']}
        jobDescriptionId=""
        onAssistantOpen={onAssistantOpen}
        assistantHistory={[
          {
            id: 'history-1' as SearchHistoryItem['id'],
            sessionKey: 'session-1',
            title: '广东 · CNC',
            location: '广东',
            keywords: ['CNC'],
            filters: {},
            selectedTags: ['STAR'],
            selectedCompanies: [],
            createdAt: Date.UTC(2026, 2, 26, 10, 0, 0),
            lastOpenedAt: Date.UTC(2026, 2, 26, 11, 0, 0),
          },
        ]}
        onApplyAssistantHistory={vi.fn(async () => {})}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Assistant' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Assistant' }))

    expect(onAssistantOpen).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('search-assistant-drawer')).toBeInTheDocument()
    expect(screen.getAllByText('广东 · CNC').length).toBeGreaterThan(0)
    expect(screen.getByText('Workflow starts')).toBeInTheDocument()
  })

  it('requests history on mount so recent searches can become one-tap shortcuts', () => {
    const onRequestHistory = vi.fn()

    render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={['CNC']}
        jobDescriptionId=""
        onRequestHistory={onRequestHistory}
      />
    )

    expect(onRequestHistory).toHaveBeenCalledTimes(1)
  })

  it('exposes recent searches as one-tap continue cards', async () => {
    const user = userEvent.setup()
    const onApplyAssistantHistory = vi.fn(async () => {})

    render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={['CNC']}
        jobDescriptionId=""
        assistantHistory={[
          {
            id: 'history-2' as SearchHistoryItem['id'],
            sessionKey: 'session-2',
            title: 'Kuala Lumpur MY · CNC Sales',
            location: 'Kuala Lumpur MY',
            keywords: ['CNC', 'Sales'],
            jobDescriptionId: 'seek-malaysia-sales',
            filters: {},
            selectedTags: [],
            selectedCompanies: [],
            notes: 'Resume shortlist for Malaysia flow',
            createdAt: Date.UTC(2026, 2, 26, 12, 0, 0),
            lastOpenedAt: Date.UTC(2026, 2, 26, 13, 0, 0),
          },
        ]}
        onApplyAssistantHistory={onApplyAssistantHistory}
      />
    )

    expect(screen.getByTestId('quickstart-recent-history')).toBeInTheDocument()
    expect(screen.getByText('Kuala Lumpur MY · CNC Sales')).toBeInTheDocument()
    expect(screen.getByText('Resume shortlist for Malaysia flow')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Kuala Lumpur MY · CNC Sales/i }))

    expect(onApplyAssistantHistory).toHaveBeenCalledTimes(1)
    expect(onApplyAssistantHistory).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Kuala Lumpur MY · CNC Sales',
      jobDescriptionId: 'seek-malaysia-sales',
    }))
  })

  it('preserves externally restored location and keywords when a saved search includes a JD', async () => {
    const onApplyConfig = vi.fn()

    getMock.mockImplementation(async (path: string) => {
      if (path.includes('/api/config/custom-keywords')) {
        return {
          data: {
            success: true,
            tags: [],
            categories: [],
            systemLocations: [],
            workflowSeeds: [],
          },
        }
      }

      if (path.includes('/api/job-descriptions/lathe-sales')) {
        return {
          data: {
            success: true,
            item: {
              location: '东莞',
              autoMatch: {
                keywords: ['车床', 'STAR'],
              },
              requiredRoles: [{ type: 'sales', min_years: 1 }],
            },
          },
        }
      }

      return {
        data: {
          success: true,
          item: {
            requiredRoles: [],
          },
        },
      }
    })

    const { rerender } = render(
      <QuickStartPanel
        defaultLocation=""
        defaultKeywords={[]}
        jobDescriptionId=""
        onApplyConfig={onApplyConfig}
      />
    )

    rerender(
      <QuickStartPanel
        defaultLocation="China"
        defaultKeywords={['CNC', '销售']}
        jobDescriptionId="lathe-sales"
        onApplyConfig={onApplyConfig}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '位置' })).toHaveValue('China')
      expect(screen.getByDisplayValue('CNC 销售')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(onApplyConfig).toHaveBeenLastCalledWith({
        location: 'China',
        keywords: ['CNC', '销售'],
        jobDescriptionId: 'lathe-sales',
        collectionSource: {
          type: 'job5156',
        },
      })
    })
  })

  it('shows the current session summary when a shared or reopened search is active', () => {
    render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={['CNC']}
        jobDescriptionId=""
        activeSessionTitle="Kuala Lumpur · Sales Engineer"
        activeSessionLabel="Shared link"
        activeSessionDescription="Opened from a durable sid link and ready to refine or reshare."
        activeSessionNote="Priority shortlist for HR sync"
        activeSessionId="shared-session-1"
      />
    )

    expect(screen.getByTestId('quickstart-active-session')).toBeInTheDocument()
    expect(screen.getByText('Kuala Lumpur · Sales Engineer')).toBeInTheDocument()
    expect(screen.getByText('Shared link')).toBeInTheDocument()
    expect(screen.getByText('shared-ses…')).toBeInTheDocument()
    expect(screen.getByText('Context note')).toBeInTheDocument()
    expect(screen.getByText('Priority shortlist for HR sync')).toBeInTheDocument()
  })

  it('does not auto-apply min years when no JD is selected', async () => {
    const onApplyQuickFilters = vi.fn()

    render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId=""
        onApplyQuickFilters={onApplyQuickFilters}
        quickFilters={{ minRoleYears: undefined, maxAge: undefined }}
      />
    )

    // Wait for the debounced auto-apply cycle to complete
    await new Promise((resolve) => setTimeout(resolve, 500))

    // When values are already in sync, the callback may be skipped.
    // The key invariant: minRoleYears=1 must never be applied without a JD.
    expect(
      onApplyQuickFilters.mock.calls.some(([value]) => value?.minRoleYears === 1)
    ).toBe(false)
  })

  it('still auto-fills JD defaults for a manual JD selection', async () => {
    const user = userEvent.setup()

    getMock.mockImplementation(async (path: string) => {
      if (path.includes('/api/config/custom-keywords')) {
        return {
          data: {
            success: true,
            tags: [],
            categories: [],
            systemLocations: [],
            workflowSeeds: [],
          },
        }
      }

      if (path.includes('/api/job-descriptions/lathe-sales')) {
        return {
          data: {
            success: true,
            item: {
              location: '东莞',
              autoMatch: {
                keywords: ['车床'],
              },
              requiredRoles: [{ type: 'sales', min_years: 1 }],
            },
          },
        }
      }

      return {
        data: {
          success: true,
          item: {
            requiredRoles: [],
          },
        },
      }
    })

    function StatefulQuickStartPanel() {
      const [jobDescriptionId, setJobDescriptionId] = useState('')

      return (
        <QuickStartPanel
          defaultLocation="广东"
          defaultKeywords={[]}
          jobDescriptionId={jobDescriptionId}
          onJobChange={setJobDescriptionId}
        />
      )
    }

    render(<StatefulQuickStartPanel />)

    await user.selectOptions(screen.getByTestId('job-description-select'), 'lathe-sales')

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '位置' })).toHaveValue('东莞')
      expect(screen.getByDisplayValue('车床')).toBeInTheDocument()
    })
  })

  it('applies workflow seeds from the config payload', async () => {
    const user = userEvent.setup()
    const onApplyConfig = vi.fn()

    render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId=""
        onApplyConfig={onApplyConfig}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'China · Job5156 · CNC 销售' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'China · Job5156 · CNC 销售' }))

    await waitFor(() => {
      expect(
        onApplyConfig.mock.calls.some(([payload]) =>
          payload?.location === 'China'
          && Array.isArray(payload?.keywords)
          && payload.keywords.join(' ') === 'CNC 销售'
          && payload.collectionSource?.type === 'job5156'
        )
      ).toBe(true)
    })
  })

  it('navigates to the routable search profile editor from the matched profile card', async () => {
    const user = userEvent.setup()

    postMock.mockResolvedValue({
      data: {
        success: true,
        profileId: 'seek-malaysia-sales',
        confidence: 0.95,
        matchedKeywords: SEEK_MALAYSIA_PROFILE.keywords.map((keyword) => keyword.toLowerCase()),
      },
    })
    getMock.mockImplementation(async (path: string) => {
      if (path.includes('/api/search-profiles/seek-malaysia-sales')) {
        return {
          data: {
            success: true,
            profile: SEEK_MALAYSIA_PROFILE,
          },
        }
      }

      return {
        data: {
          success: true,
          item: {
            requiredRoles: [],
          },
        },
      }
    })

    render(
      <QuickStartPanel
        defaultLocation="Kuala Lumpur MY"
        defaultKeywords={['CNC', 'Sales']}
        jobDescriptionId=""
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Modify' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Modify' }))

    expect(navigateMock).toHaveBeenCalledWith('/dev/system/profiles?edit=seek-malaysia-sales')
  })

  it('shows auto-match with keywords only when location is blank', async () => {
    postMock.mockResolvedValue({
      data: {
        success: true,
        profileId: 'profile-1',
        confidence: 1,
        matchedKeywords: ['销售', 'cnc'],
      },
    })
    getMock.mockImplementation(async (path: string) => {
      if (path.includes('/api/search-profiles/profile-1')) {
        return {
          data: {
            success: true,
            profile: {
              id: 'profile-1',
              name: 'CNC销售-Demo',
              status: 'active' as const,
              location: '广东,江苏',
              keywords: ['CNC', '销售'],
              filters: {
                minExperience: 1,
                minAge: 25,
                maxAge: 35,
              },
            },
          },
        }
      }

      return {
        data: {
          success: true,
          item: {
            requiredRoles: [],
          },
        },
      }
    })

    render(
      <QuickStartPanel
        defaultLocation=""
        defaultKeywords={['销售', 'CNC']}
        jobDescriptionId=""
      />
    )

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/api/search-profiles/auto-match', {
        body: {
          keywords: ['销售', 'CNC'],
        },
      })
      expect(screen.getByText('CNC销售-Demo')).toBeInTheDocument()
      expect(screen.getByText('100%')).toBeInTheDocument()
    })
  })

  it('promotes the matched SEEK profile jobUrl into collectionSource before manual apply', async () => {
    const onApplyConfig = vi.fn()

    postMock.mockResolvedValue({
      data: {
        success: true,
        profileId: 'seek-malaysia-sales',
        confidence: 0.95,
        matchedKeywords: SEEK_MALAYSIA_PROFILE.keywords.map((keyword) => keyword.toLowerCase()),
      },
    })
    getMock.mockImplementation(async (path: string) => {
      if (path.includes('/api/search-profiles/seek-malaysia-sales')) {
        return {
          data: {
            success: true,
            profile: SEEK_MALAYSIA_PROFILE,
          },
        }
      }

      return {
        data: {
          success: true,
          item: {
            requiredRoles: [],
          },
        },
      }
    })

    render(
      <QuickStartPanel
        defaultLocation="Kuala Lumpur MY"
        defaultKeywords={SEEK_MALAYSIA_WORKFLOW_SEED.keywords}
        jobDescriptionId=""
        onApplyConfig={onApplyConfig}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(SEEK_MALAYSIA_PROFILE.name)).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(onApplyConfig).toHaveBeenLastCalledWith({
        location: 'Kuala Lumpur MY',
        keywords: SEEK_MALAYSIA_PROFILE.keywords,
        jobDescriptionId: undefined,
        collectionSource: {
          type: 'seek',
          exactUrl: SEEK_MALAYSIA_JOB_URL,
        },
      })
    })
  })

  it('applies the SEEK Malaysia workflow preset without splitting the location', async () => {
    const user = userEvent.setup()
    const onApplyConfig = vi.fn()

    render(
      <QuickStartPanel
        defaultLocation=""
        defaultKeywords={[]}
        jobDescriptionId=""
        onApplyConfig={onApplyConfig}
        onJobChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: SEEK_MALAYSIA_WORKFLOW_SEED.label })
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: SEEK_MALAYSIA_WORKFLOW_SEED.label }))

    expect(screen.getByRole('textbox', { name: '位置' })).toHaveValue('Kuala Lumpur MY')
    expect(screen.getByDisplayValue(SEEK_MALAYSIA_WORKFLOW_SEED.keywords.join(' '))).toBeInTheDocument()

    await waitFor(() => {
      expect(onApplyConfig).toHaveBeenLastCalledWith({
        location: 'Kuala Lumpur MY',
        keywords: SEEK_MALAYSIA_WORKFLOW_SEED.keywords,
        jobDescriptionId: undefined,
        collectionSource: {
          type: 'seek',
          exactUrl: SEEK_MALAYSIA_COLLECT_URL,
        },
      })
    })
  })

  it('applies the 51job workflow preset with collectionSource type 51job', async () => {
    const user = userEvent.setup()
    const onApplyConfig = vi.fn()

    render(
      <QuickStartPanel
        defaultLocation=""
        defaultKeywords={[]}
        jobDescriptionId=""
        onApplyConfig={onApplyConfig}
        onJobChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: JOB51_WORKFLOW_SEED.label })
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: JOB51_WORKFLOW_SEED.label }))

    expect(screen.getByRole('textbox', { name: '位置' })).toHaveValue('东莞')
    expect(screen.getByDisplayValue(JOB51_WORKFLOW_SEED.keywords.join(' '))).toBeInTheDocument()

    await waitFor(() => {
      expect(onApplyConfig).toHaveBeenLastCalledWith({
        location: '东莞',
        keywords: JOB51_WORKFLOW_SEED.keywords,
        jobDescriptionId: undefined,
        collectionSource: {
          type: '51job',
        },
      })
    })
  })
})
