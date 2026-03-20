import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { QuickStartPanel } from './QuickStartPanel'

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}))
const { useQueryMock, profileEditorMockState } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  profileEditorMockState: {
    current: undefined as Record<string, unknown> | undefined,
  },
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
  SearchProfileEditorDialog: ({
    open,
    onSaved,
  }: {
    open: boolean
    onSaved?: (profile?: Record<string, unknown>) => void
  }) => (
    open
      ? (
        <button
          data-testid="mock-profile-editor-save"
          onClick={() => onSaved?.(profileEditorMockState.current)}
        >
          Save edited profile
        </button>
        )
      : null
  ),
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
    profileEditorMockState.current = undefined
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
          && typeof payload.collectUrl === 'string'
          && payload.collectUrl.includes('hr.job5156.com/search')
          && !payload.collectUrl.includes('location=')
        )
      ).toBe(true)
    })
  })

  it('refreshes the matched profile card after saving edits from the fast editor', async () => {
    const user = userEvent.setup()

    const initialProfile = {
      id: 'profile-1',
      name: 'CNC销售-Demo',
      status: 'active' as const,
      location: '广东',
      keywords: ['CNC', '销售'],
      jobDescription: 'old-jd',
      filters: {
        minExperience: 1,
      },
    }

    const updatedProfile = {
      id: 'profile-1',
      name: 'CNC销售-Demo',
      status: 'active' as const,
      location: '广东',
      keywords: ['CNC', '销售', '车床'],
      jobDescription: undefined,
      filters: {
        minExperience: 1,
        maxAge: 45,
      },
    }

    postMock.mockImplementation(async () => ({
      data: {
        success: true,
        profileId: 'profile-1',
        confidence: profileEditorMockState.current ? 0.67 : 0.91,
        matchedKeywords: profileEditorMockState.current ? ['cnc', '销售', '车床'] : ['cnc', '销售'],
      },
    }))
    getMock.mockImplementation(async (path: string) => {
      if (path.includes('/api/search-profiles/profile-1')) {
        return {
          data: {
            success: true,
            profile: profileEditorMockState.current ? updatedProfile : initialProfile,
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
        defaultLocation="广东"
        defaultKeywords={['CNC', '销售']}
        jobDescriptionId=""
      />
    )

    await waitFor(() => {
      expect(screen.getByText('JD: old-jd')).toBeInTheDocument()
      expect(screen.getByText('Matched: cnc, 销售')).toBeInTheDocument()
    })

    profileEditorMockState.current = updatedProfile

    await user.click(screen.getByRole('button', { name: 'Modify' }))
    await user.click(screen.getByTestId('mock-profile-editor-save'))

    expect(screen.getByDisplayValue('CNC 销售 车床')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('JD: --')).toBeInTheDocument()
      expect(screen.getByText('Filters: 1+ yrs | Age <=45')).toBeInTheDocument()
      expect(screen.getByText('Matched: cnc, 销售, 车床')).toBeInTheDocument()
    })
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

  it('promotes the matched SEEK profile jobUrl into collectUrl before manual apply', async () => {
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
        collectUrl: SEEK_MALAYSIA_JOB_URL,
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
        collectUrl: SEEK_MALAYSIA_COLLECT_URL,
      })
    })
  })
})
