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

  it('refreshes the matched profile card after saving edits from the fast editor', async () => {
    const user = userEvent.setup()

    postMock.mockResolvedValue({
      data: {
        success: true,
        profileId: 'profile-1',
        confidence: 0.91,
        matchedKeywords: ['销售'],
      },
    })
    getMock.mockResolvedValue({
      data: {
        success: true,
        profile: {
          id: 'profile-1',
          name: 'CNC销售-Demo',
          status: 'active',
          location: '广东',
          keywords: ['销售'],
          jobDescription: 'old-jd',
          filters: {
            minExperience: 1,
          },
        },
      },
    })

    render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={['销售']}
        jobDescriptionId=""
      />
    )

    await waitFor(() => {
      expect(screen.getByText('JD: old-jd')).toBeInTheDocument()
    })

    profileEditorMockState.current = {
      id: 'profile-1',
      name: 'CNC销售-Demo',
      status: 'active',
      location: '广东',
      keywords: ['销售'],
      jobDescription: undefined,
      filters: {
        minExperience: 1,
        maxAge: 45,
      },
    }

    await user.click(screen.getByRole('button', { name: 'Modify' }))
    await user.click(screen.getByTestId('mock-profile-editor-save'))

    expect(screen.getByText('JD: --')).toBeInTheDocument()
    expect(screen.getByText('Filters: 1+ yrs | Age <=45')).toBeInTheDocument()
  })
})
