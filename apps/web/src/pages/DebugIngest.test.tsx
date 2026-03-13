import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DebugIngest from './DebugIngest'

const resetMutation = vi.fn(async () => ({ count: 0, cleared: 0 }))
const loadMore = vi.fn()
type PaginatedQueryMockResult = {
  results: Array<Record<string, unknown>>
  status: string
  isLoading: boolean
  loadMore: typeof loadMore
}

const usePaginatedQueryMock = vi.fn<() => PaginatedQueryMockResult>(() => ({
  results: [],
  status: 'Exhausted',
  isLoading: false,
  loadMore,
}))

vi.mock('convex/react', () => ({
  usePaginatedQuery: () => usePaginatedQueryMock(),
  useAction: () => vi.fn(async () => ({ scheduled: 0 })),
  useMutation: () => resetMutation,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
      if (typeof options === 'string') {
        return options
      }
      return options?.defaultValue ?? _key
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('DebugIngest reset database dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: 'Exhausted',
      isLoading: false,
      loadMore,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, version: 1 }),
      }))
    )
  })

  it('renders loaded counts and loads more results when available', async () => {
    const user = userEvent.setup()
    usePaginatedQueryMock.mockReturnValue({
      results: [
        {
          resumeId: 'resume-1',
          externalId: 'ext-1',
          name: '赵先生',
          jobIntention: '销售工程师',
          location: '东莞',
          ingestData: {
            industryTags: ['sales'],
            companyHits: ['fanuc'],
            brandHits: [],
            experienceLevel: 'mid',
            ruleScoreCount: 2,
            computedAt: 1_700_000_000_000,
            skillsVersion: 3,
            taggingEntries: [],
          },
        },
      ],
      status: 'CanLoadMore',
      isLoading: false,
      loadMore,
    })

    render(<DebugIngest />)

    await waitFor(() => {
      expect(screen.getByText((content) => content.includes('more available'))).toBeInTheDocument()
    })

    expect(screen.getByText('Loaded Resumes')).toBeInTheDocument()

    const loadMoreButton = screen.getByRole('button', { name: 'Load More' })
    expect(loadMoreButton).toBeEnabled()

    await user.click(loadMoreButton)

    expect(loadMore).toHaveBeenCalledWith(100)
  })

  it('disables load more when pagination is exhausted', () => {
    render(<DebugIngest />)

    expect(screen.getByRole('button', { name: 'Load More' })).toBeDisabled()
  })

  it('opens in-app confirmation dialog instead of native confirm', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<DebugIngest />)

    await user.click(screen.getByRole('button', { name: 'Clear Resume Database' }))

    expect(
      screen.getByText('Delete all resume data and task records? This cannot be undone.')
    ).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('closes dialog on cancel and successful reset', async () => {
    const user = userEvent.setup()
    render(<DebugIngest />)

    await user.click(screen.getByRole('button', { name: 'Clear Resume Database' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByText('Delete all resume data and task records? This cannot be undone.')
      ).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Clear Resume Database' }))
    const confirmButtons = screen.getAllByRole('button', { name: 'Clear Resume Database' })
    const dialogConfirmButton = confirmButtons[confirmButtons.length - 1]
    if (!dialogConfirmButton) {
      throw new Error('Expected confirmation button in dialog')
    }
    await user.click(dialogConfirmButton)

    await waitFor(() => {
      expect(resetMutation).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(
        screen.queryByText('Delete all resume data and task records? This cannot be undone.')
      ).not.toBeInTheDocument()
    })
  })
})
