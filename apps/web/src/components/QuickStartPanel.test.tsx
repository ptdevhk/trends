import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { QuickStartPanel } from './QuickStartPanel'

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}))
const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
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

describe('QuickStartPanel role-aware quick filter label', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('switches quick filter label between sales, engineer, and fallback', async () => {
    const { rerender } = render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId="lathe-sales"
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: /销售经验\s+至少\s+年/ })).toBeInTheDocument()
    })

    rerender(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId="senior-mechanical-engineer"
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: /工程经验\s+至少\s+年/ })).toBeInTheDocument()
    })

    rerender(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId=""
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: /相关经验\s+至少\s+年/ })).toBeInTheDocument()
    })
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
})
