import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArchivedResumes from './ArchivedResumes'

const loadMore = vi.fn()
type SourceFacetRow = {
  key: string
  label: string
  count: number
}
type PaginatedQueryMockResult = {
  results: Array<Record<string, unknown>>
  status: string
  isLoading: boolean
  loadMore: typeof loadMore
}
const unarchiveResumesMutation = vi.fn(async () => ({
  requested: 0,
  unarchived: 0,
  notArchived: 0,
  missingResumeIds: [],
}))

const usePaginatedQueryMock = vi.fn<
  (query: unknown, args: unknown, options: unknown) => PaginatedQueryMockResult
>(() => ({
  results: [],
  status: 'Exhausted',
  isLoading: false,
  loadMore,
}))
const useQueryMock = vi.fn<(query: unknown, args: unknown) => SourceFacetRow[] | undefined>(() => [])

vi.mock('convex/react', () => ({
  usePaginatedQuery: (query: unknown, args: unknown, options: unknown) => usePaginatedQueryMock(query, args, options),
  useQuery: (query: unknown, args: unknown) => useQueryMock(query, args),
  useMutation: () => unarchiveResumesMutation,
}))

let sourceFacetsMockReturn: { facets: SourceFacetRow[] | undefined; isLoading: boolean; error: unknown } = {
  facets: [],
  isLoading: false,
  error: undefined,
}
vi.mock('@/hooks/useSourceFacets', () => ({
  useSourceFacets: () => sourceFacetsMockReturn,
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

describe('ArchivedResumes source filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: 'Exhausted',
      isLoading: false,
      loadMore,
    })
    useQueryMock.mockReturnValue([])
    sourceFacetsMockReturn = {
      facets: [
        { key: 'seek', label: 'SEEK', count: 2 },
        { key: '51job-manual', label: '51job manual', count: 1 },
      ],
      isLoading: false,
      error: undefined,
    }
  })

  it('forwards selected source keys to the archived diagnostics query', async () => {
    const user = userEvent.setup()
    render(<ArchivedResumes />)

    const sourceFilter = screen.getByLabelText('Source Filter')
    await user.selectOptions(sourceFilter, ['seek', '51job-manual'])

    await waitFor(() => {
      expect(usePaginatedQueryMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sourceKeys: ['seek', '51job-manual'],
        }),
        expect.anything(),
      )
    })
  })
})

describe('ArchivedResumes search auto-load', () => {
  const row = {
    resumeId: 'r1',
    externalId: 'ext-1',
    source: 'seek',
    sourceKey: 'seek',
    name: 'Test User',
    jobIntention: 'Engineer',
    location: 'KL',
    isArchived: true,
    archivedAt: 1700000000000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    usePaginatedQueryMock.mockReturnValue({
      results: [row],
      status: 'CanLoadMore',
      isLoading: false,
      loadMore,
    })
    useQueryMock.mockReturnValue([])
    sourceFacetsMockReturn = {
      facets: [],
      isLoading: false,
      error: undefined,
    }
  })

  it('auto-loads more pages while a search is active', async () => {
    const user = userEvent.setup()
    render(<ArchivedResumes />)

    await user.type(screen.getByPlaceholderText('Search by name / intention / location...'), 'test')

    await waitFor(() => {
      expect(loadMore).toHaveBeenCalledWith(100)
    })
  })

  it('does not auto-load when no search is active', async () => {
    render(<ArchivedResumes />)

    expect(loadMore).not.toHaveBeenCalled()
  })
})

describe('ArchivedResumes restore confirm', () => {
  const row = {
    resumeId: 'r1',
    externalId: 'ext-1',
    source: 'seek',
    sourceKey: 'seek',
    name: 'Test User',
    jobIntention: 'Engineer',
    location: 'KL',
    isArchived: true,
    archivedAt: 1700000000000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    usePaginatedQueryMock.mockReturnValue({
      results: [row],
      status: 'Exhausted',
      isLoading: false,
      loadMore,
    })
    useQueryMock.mockReturnValue([])
    sourceFacetsMockReturn = {
      facets: [],
      isLoading: false,
      error: undefined,
    }
  })

  it('does not restore a row until the inline confirm is accepted', async () => {
    const user = userEvent.setup()
    render(<ArchivedResumes />)

    await user.click(screen.getByRole('button', { name: 'Restore' }))
    expect(unarchiveResumesMutation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Yes, restore' }))
    expect(unarchiveResumesMutation).toHaveBeenCalledWith({ resumeIds: ['r1'] })
  })

  it('cancels the inline confirm without restoring', async () => {
    const user = userEvent.setup()
    render(<ArchivedResumes />)

    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(unarchiveResumesMutation).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })

  it('requires dialog confirmation before restoring the selection', async () => {
    const user = userEvent.setup()
    render(<ArchivedResumes />)

    await user.click(screen.getByLabelText('r1'))
    await user.click(screen.getByRole('button', { name: 'Restore Selected (1)' }))

    expect(unarchiveResumesMutation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Yes, restore' }))
    expect(unarchiveResumesMutation).toHaveBeenCalledWith({ resumeIds: ['r1'] })
  })
})

describe('ArchivedResumes empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: 'Exhausted',
      isLoading: false,
      loadMore,
    })
    useQueryMock.mockReturnValue([])
    sourceFacetsMockReturn = {
      facets: [],
      isLoading: false,
      error: undefined,
    }
  })

  it('shows a search-specific empty state with a clear action', async () => {
    const user = userEvent.setup()
    render(<ArchivedResumes />)

    await user.type(screen.getByPlaceholderText('Search by name / intention / location...'), 'nobody')

    expect(screen.getByText('No archived resumes match your search')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(screen.getByText('No archived resumes found')).toBeInTheDocument()
  })
})
