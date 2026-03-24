import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConvexResumes } from './useConvexResumes'

const loadMoreMock = vi.fn()
const rawApiGetMock = vi.fn(async (path?: unknown, options?: unknown) => {
  void path
  void options
  return {
  data: {
    success: true,
    summary: {
      groups: [{ original: 'cnc', variants: ['cnc'] }],
      mode: 'AND' as const,
      expandedTo: ['cnc'],
      sourceMapping: {},
    },
  },
  }
})

type PaginatedResult = {
  results: Array<Record<string, unknown>>
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'
  isLoading: boolean
  loadMore: typeof loadMoreMock
}

const usePaginatedQueryMock = vi.fn<(
  query: unknown,
  args: unknown,
  options: { initialNumItems: number }
) => PaginatedResult>()

vi.mock('convex/react', () => ({
  usePaginatedQuery: (query: unknown, args: unknown, options: { initialNumItems: number }) =>
    usePaginatedQueryMock(query, args, options),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (path: unknown, options?: unknown) => rawApiGetMock(path, options),
  },
}))

function buildResumeDoc(id: string, name: string): Record<string, unknown> {
  return {
    _id: id,
    externalId: `ext-${id}`,
    source: 'hr.job5156.com',
    tags: [],
    crawledAt: 1_700_000_000_000,
    content: {
      name,
      experience: '5 years',
      education: 'Bachelor',
      location: 'Dongguan',
      selfIntro: 'Intro',
      jobIntention: 'Sales Engineer',
      expectedSalary: '10k-20k',
      extractedAt: '2026-03-01T00:00:00.000Z',
    },
    ingestData: {
      industryTags: [],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      ruleScores: {},
      experienceLevel: 'mid',
      computedAt: 1_700_000_000_000,
      skillsVersion: 1,
    },
  }
}

function buildSearchEntry(id: string, name: string): Record<string, unknown> {
  return {
    resume: buildResumeDoc(id, name),
    provenance: [{ term: 'cnc', source: 'searchText' }],
  }
}

describe('useConvexResumes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePaginatedQueryMock.mockImplementation((_query, args) => ({
      results: args === 'skip' ? [] : [buildResumeDoc('resume-1', 'Alice')],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }))
  })

  it('loads additional list pages when the requested limit exceeds the loaded page', async () => {
    usePaginatedQueryMock.mockImplementation((_query, args) => ({
      results: args === 'skip'
        ? []
        : [buildResumeDoc('resume-1', 'Alice'), buildResumeDoc('resume-2', 'Bob')],
      status: args === 'skip' ? 'Exhausted' : 'CanLoadMore',
      isLoading: false,
      loadMore: loadMoreMock,
    }))

    renderHook(() => useConvexResumes(400))

    await waitFor(() => {
      expect(loadMoreMock).toHaveBeenCalledWith(200)
    })
  })

  it('returns only the visible slice when more paginated results are already loaded', () => {
    usePaginatedQueryMock.mockImplementation((_query, args) => ({
      results: args === 'skip'
        ? []
        : [
            buildResumeDoc('resume-1', 'Alice'),
            buildResumeDoc('resume-2', 'Bob'),
            buildResumeDoc('resume-3', 'Carla'),
          ],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }))

    const { result } = renderHook(() => useConvexResumes(2))

    expect(result.current.resumes.map((resume) => resume.name)).toEqual(['Alice', 'Bob'])
    expect(result.current.hasMore).toBe(true)
  })

  it('forwards safe sort options to the paginated list query', () => {
    renderHook(() => useConvexResumes(200, undefined, 'jd-1', { sortBy: 'experience', sortOrder: 'asc' }))

    const listCall = usePaginatedQueryMock.mock.calls.find(([, args]) => args !== 'skip' && !('query' in (args as Record<string, unknown>)))

    expect(listCall?.[1]).toMatchObject({
      jobDescriptionId: 'jd-1',
      sortBy: 'experience',
      sortOrder: 'asc',
    })
  })

  it('forwards safe base filters to the paginated list query', () => {
    renderHook(() => useConvexResumes(200, undefined, 'jd-1', {
      filters: {
        minExperience: 3,
        maxExperience: 8,
        education: ['bachelor'],
        locations: ['Dongguan'],
      },
    }))

    const listCall = usePaginatedQueryMock.mock.calls.find(([, args]) => args !== 'skip' && !('query' in (args as Record<string, unknown>)))

    expect(listCall?.[1]).toMatchObject({
      jobDescriptionId: 'jd-1',
      minExperience: 3,
      maxExperience: 8,
      education: ['bachelor'],
      locations: ['Dongguan'],
    })
  })

  it('uses the paginated search query after keyword expansion resolves', async () => {
    usePaginatedQueryMock.mockImplementation((_query, args) => ({
      results: args === 'skip' ? [] : [buildSearchEntry('resume-1', 'Alice')],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }))

    renderHook(() => useConvexResumes(200, 'CNC'))

    await waitFor(() => {
      expect(rawApiGetMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      const searchCall = usePaginatedQueryMock.mock.calls.find(([, args]) => args !== 'skip' && 'query' in (args as Record<string, unknown>))
      expect(searchCall?.[1]).toMatchObject({
        query: 'CNC',
        keywordGroups: [{ original: 'cnc', variants: ['cnc'] }],
      })
    })
  })
})
