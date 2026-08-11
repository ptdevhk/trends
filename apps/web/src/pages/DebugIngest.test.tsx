import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import DebugIngest from './DebugIngest'

const getMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    GET: (...args: unknown[]) => getMock(...args),
  },
}))

type BatchResetResult = {
  cleared: number
  hasMore: boolean
  cursor: string | null
}

const resetDatabaseMutation = vi.fn(async () => ({ count: 0 }))
const clearAnalysesMutation = vi.fn<() => Promise<BatchResetResult>>(async () => ({
  cleared: 0,
  hasMore: false,
  cursor: null,
}))
const hardResetMutation = vi.fn<() => Promise<BatchResetResult>>(async () => ({
  cleared: 0,
  hasMore: false,
  cursor: null,
}))
const deleteResumesMutation = vi.fn(async () => ({
  requested: 0,
  deleted: 0,
  missingResumeIds: [],
  deletedAiTaggingResults: 0,
  patchedScreeningSessions: 0,
}))
const archiveResumesMutation = vi.fn(async () => ({
  archived: 0,
}))
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
type SourceFacetRow = {
  key: string
  label: string
  count: number
}

const usePaginatedQueryMock = vi.fn<(query: unknown, args: unknown, options: unknown) => PaginatedQueryMockResult>(() => ({
  results: [],
  status: 'Exhausted',
  isLoading: false,
  loadMore,
}))
const useQueryMock = vi.fn<(query: unknown, args: unknown) => SourceFacetRow[] | undefined>(() => [])

let actionHookCallCount = 0
let mutationHookCallCount = 0

vi.mock('convex/react', () => ({
  usePaginatedQuery: (query: unknown, args: unknown, options: unknown) => usePaginatedQueryMock(query, args, options),
  useQuery: (query: unknown, args: unknown) => useQueryMock(query, args),
  useAction: () => {
    const action = [backfillIngestDataAction, reIngestStaleSkillsVersionAction, reIngestAllResumesAction][actionHookCallCount % 3]
    actionHookCallCount += 1
    return action
  },
  useMutation: () => {
    const mutation = [clearAnalysesMutation, hardResetMutation, resetDatabaseMutation, deleteResumesMutation, archiveResumesMutation][mutationHookCallCount % 5]
    mutationHookCallCount += 1
    return mutation
  },
}))

const mockT = (_key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
      if (typeof options === 'string') {
        return options
      }
      if (options?.defaultValue) {
        return options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(options[key] ?? `{{${key}}}`))
      }
      return _key
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

let sourceFacetsMockReturn: { facets: SourceFacetRow[] | undefined; isLoading: boolean; error: unknown } = {
  facets: [],
  isLoading: false,
  error: undefined,
}
vi.mock('@/hooks/useSourceFacets', () => ({
  useSourceFacets: () => sourceFacetsMockReturn,
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
    useQueryMock.mockReturnValue([])
    sourceFacetsMockReturn = {
      facets: [
        { key: 'job5156', label: 'Job5156', count: 3 },
        { key: '51job-manual', label: '51job manual', count: 1 },
      ],
      isLoading: false,
      error: undefined,
    }
    getMock.mockResolvedValue({
      data: { success: true, version: 3, ingestComputeEpoch: 1 },
      response: { ok: true, status: 200 },
    })
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
    expect(screen.queryByText('销售工程师')).not.toBeInTheDocument()
    expect(screen.getAllByText('--').length).toBeGreaterThan(0)

    const loadMoreButton = screen.getByRole('button', { name: 'Load More' })
    expect(loadMoreButton).toBeEnabled()

    await user.click(loadMoreButton)

    expect(loadMore).toHaveBeenCalledWith(100)
  })

  it('uses combined ingest freshness and shows a detailed re-ingest label when epoch is missing', async () => {
    usePaginatedQueryMock.mockReturnValue({
      results: [
        {
          resumeId: 'resume-1',
          externalId: 'ext-1',
          source: 'seek',
          sourceKey: 'seek',
          name: 'Freshness Candidate',
          jobIntention: 'Sales Engineer',
          location: 'Kuala Lumpur',
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
      status: 'Exhausted',
      isLoading: false,
      loadMore,
    })

    render(<DebugIngest />)

    await waitFor(() => {
      expect(screen.getByText('Re-ingest')).toBeInTheDocument()
    })
    const staleCountCard = screen.getByText('Loaded Stale / Missing').closest('.rounded-lg')
    expect(staleCountCard).not.toBeNull()
    expect(within(staleCountCard as HTMLElement).getByText('1')).toBeInTheDocument()
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
    hardResetMutation.mockResolvedValueOnce({ cleared: 12, hasMore: false, cursor: null })
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
      expect(hardResetMutation).toHaveBeenCalledWith({ cursor: undefined })
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

  it('requires confirmation before clearing AI analyses and preserves HR-status messaging', async () => {
    const user = userEvent.setup()
    clearAnalysesMutation
      .mockResolvedValueOnce({ cleared: 25, hasMore: true, cursor: 'cursor-1' })
      .mockResolvedValueOnce({ cleared: 15, hasMore: false, cursor: null })

    render(<DebugIngest />)

    await user.click(screen.getByRole('button', { name: 'Reset AI Analyses' }))

    expect(clearAnalysesMutation).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Clear AI analysis and confirm scores only so scoring can be re-run. HR candidate status, notes, and shortlist/reject decisions are preserved. This cannot be undone for AI scores.'
      )
    ).toBeInTheDocument()

    const confirmButtons = screen.getAllByRole('button', { name: 'Reset AI Analyses' })
    await user.click(confirmButtons[confirmButtons.length - 1]!)

    await waitFor(() => {
      expect(clearAnalysesMutation).toHaveBeenNthCalledWith(1, { cursor: undefined })
    })
    await waitFor(() => {
      expect(clearAnalysesMutation).toHaveBeenNthCalledWith(2, { cursor: 'cursor-1' })
    })
    expect(toast.success).toHaveBeenCalledWith(
      'Cleared analyses for 40 resumes. You can now re-run AI analysis.'
    )
  })

  it('selects visible rows and bulk archives selected resumes', async () => {
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
        {
          resumeId: 'resume-2',
          externalId: 'ext-2',
          name: '李小姐',
          jobIntention: '技術支援',
          location: '深圳',
          ingestData: {
            industryTags: ['service'],
            companyHits: ['mitsubishi'],
            brandHits: [],
            experienceLevel: 'senior',
            ruleScoreCount: 1,
            computedAt: 1_700_000_000_100,
            skillsVersion: 3,
            taggingEntries: [],
          },
        },
      ],
      status: 'Exhausted',
      isLoading: false,
      loadMore,
    })
    archiveResumesMutation.mockResolvedValueOnce({
      archived: 2,
    })

    render(<DebugIngest />)

    const checkboxes = screen.getAllByRole('checkbox')
    const selectAllCheckbox = checkboxes[0]
    if (!selectAllCheckbox) {
      throw new Error('Expected select all checkbox')
    }
    await user.click(selectAllCheckbox)

    const bulkArchiveButton = screen.getByRole('button', { name: 'Archive Selected (2)' })
    expect(bulkArchiveButton).toBeEnabled()
    await user.click(bulkArchiveButton)

    await waitFor(() => {
      expect(archiveResumesMutation).toHaveBeenCalledWith({ resumeIds: ['resume-1', 'resume-2'] })
    })
    expect(toast.success).toHaveBeenCalledWith('Archived 2 resume(s)')
  })

  it('archives a single resume from the row action', async () => {
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
      status: 'Exhausted',
      isLoading: false,
      loadMore,
    })
    archiveResumesMutation.mockResolvedValueOnce({
      archived: 1,
    })

    render(<DebugIngest />)

    await user.click(screen.getAllByRole('button', { name: 'Archive' })[0])

    await waitFor(() => {
      expect(archiveResumesMutation).toHaveBeenCalledWith({ resumeIds: ['resume-1'] })
    })
    expect(toast.success).toHaveBeenCalledWith('Archived 1 resume(s)')
  })

  it('forwards selected source keys to the diagnostics query', async () => {
    const user = userEvent.setup()
    render(<DebugIngest />)

    const sourceFilter = screen.getByLabelText('Source Filter')
    await user.selectOptions(sourceFilter, ['job5156', '51job-manual'])

    await waitFor(() => {
      expect(usePaginatedQueryMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sourceKeys: ['job5156', '51job-manual'],
        }),
        expect.anything(),
      )
    })
  })
})
