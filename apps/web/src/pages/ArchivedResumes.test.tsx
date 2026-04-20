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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
      if (typeof options === 'string') {
        return options
      }
      if (options?.defaultValue) {
        return options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(options[key] ?? `{{${key}}}`))
      }
      return _key
    },
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
