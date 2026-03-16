import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DebugIngest from './DebugIngest'

const resetDatabaseMutation = vi.fn(async () => ({ count: 0 }))
const clearAnalysesMutation = vi.fn(async () => ({ cleared: 0 }))
const hardResetMutation = vi.fn(async () => ({ cleared: 0 }))
const backfillIngestDataAction = vi.fn(async () => ({ scheduled: 0 }))
const reIngestStaleSkillsVersionAction = vi.fn(async () => ({ scheduled: 0 }))
const reIngestAllResumesAction = vi.fn(async () => ({ scheduled: 0 }))
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

let actionHookCallCount = 0
let mutationHookCallCount = 0

vi.mock('convex/react', () => ({
  usePaginatedQuery: () => usePaginatedQueryMock(),
  useAction: () => {
    const action = [backfillIngestDataAction, reIngestStaleSkillsVersionAction, reIngestAllResumesAction][actionHookCallCount % 3]
    actionHookCallCount += 1
    return action
  },
  useMutation: () => {
    const mutation = [clearAnalysesMutation, hardResetMutation, resetDatabaseMutation][mutationHookCallCount % 3]
    mutationHookCallCount += 1
    return mutation
  },
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
    actionHookCallCount = 0
    mutationHookCallCount = 0
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: 'Exhausted',
      isLoading: false,
      loadMore,
    })
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, version: 1 }),
    })) as unknown as typeof fetch
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
      expect(resetDatabaseMutation).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(
        screen.queryByText('Delete all resume data and task records? This cannot be undone.')
      ).not.toBeInTheDocument()
    })
  })

  it('opens a hard reset confirmation dialog and avoids native confirm', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<DebugIngest />)

    await user.click(screen.getByRole('button', { name: 'Hard Reset & Re-ingest' }))

    expect(
      screen.getByText(
        'Clear all computed ingest and AI analysis data, then schedule a full background re-ingest for all resumes. This cannot be undone.'
      )
    ).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('hard resets computed data and schedules re-ingest after confirmation', async () => {
    const user = userEvent.setup()
    hardResetMutation.mockResolvedValueOnce({ cleared: 12 })
    reIngestAllResumesAction.mockResolvedValueOnce({ scheduled: 12 })

    render(<DebugIngest />)

    await user.click(screen.getByRole('button', { name: 'Hard Reset & Re-ingest' }))
    const confirmButtons = screen.getAllByRole('button', { name: 'Hard Reset & Re-ingest' })
    const dialogConfirmButton = confirmButtons[confirmButtons.length - 1]
    if (!dialogConfirmButton) {
      throw new Error('Expected hard reset confirmation button in dialog')
    }

    await user.click(dialogConfirmButton)

    await waitFor(() => {
      expect(hardResetMutation).toHaveBeenCalledWith({})
    })
    await waitFor(() => {
      expect(reIngestAllResumesAction).toHaveBeenCalledWith({})
    })
    await waitFor(() => {
      expect(
        screen.queryByText(
          'Clear all computed ingest and AI analysis data, then schedule a full background re-ingest for all resumes. This cannot be undone.'
        )
      ).not.toBeInTheDocument()
    })
  })
})
