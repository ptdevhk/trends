import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConvexResumes } from './useConvexResumes'

type KeywordExpansionResponse = {
  data?: {
    success: boolean
    summary?: {
      groups?: Array<{ original: string; variants: string[] }>
      mode?: 'AND' | 'OR'
      expandedTo?: string[]
      sourceMapping?: Record<string, string>
    }
  }
  error?: Error
}

const loadMoreMock = vi.fn()
const useQueryMock = vi.hoisted(() => vi.fn())
const useAnalysisTasksMock = vi.hoisted(() => vi.fn())
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const rawApiGetMock = vi.fn(async (path?: unknown, _options?: unknown): Promise<KeywordExpansionResponse> => {
  if (typeof path === 'string' && path === '/api/resumes') {
    return {
      data: {
        success: true,
        data: [],
        summary: { total: 0 },
      },
    } as unknown as KeywordExpansionResponse
  }
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
const rawApiPostMock = vi.fn(async (...args: unknown[]) => {
  void args
  return {
    data: {
      success: true,
      results: [] as Array<{ resumeId: string; score: number; recommendation: string }>,
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
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('@/contexts/AnalysisTasksContext', () => ({
  useAnalysisTasks: () => useAnalysisTasksMock(),
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    analysis_tasks: { list: 'analysis_tasks:list' },
    resumes_search: {
      search: 'resumes_search:search',
      searchWithTagExpansionPaginated: 'resumes_search:searchWithTagExpansionPaginated',
      searchWithTagExpansionScanPage: 'resumes_search:searchWithTagExpansionScanPage',
    },
    resumes: {
      listWithIngestDataPaginated: 'resumes:listWithIngestDataPaginated',
      getResumeDetail: 'resumes:getResumeDetail',
    },
  },
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (path: unknown, options?: unknown) => rawApiGetMock(path, options),
    POST: (path: unknown, options?: unknown) => rawApiPostMock(path, options),
  },
}))

function buildResumeDoc(
  id: string,
  name: string,
  overrides?: {
    identityKey?: string
    primaryRuleScore?: number
    experience?: string
    extractedAt?: string
    crawledAt?: number
  },
): Record<string, unknown> {
  return {
    _id: id,
    externalId: `ext-${id}`,
    source: 'hr.job5156.com',
    tags: [],
    identityKey: overrides?.identityKey,
    crawledAt: overrides?.crawledAt ?? 1_700_000_000_000,
    primaryRuleScore: overrides?.primaryRuleScore,
    content: {
      name,
      experience: overrides?.experience ?? '5 years',
      education: 'Bachelor',
      location: 'Dongguan',
      selfIntro: 'Intro',
      jobIntention: 'Sales Engineer',
      expectedSalary: '10k-20k',
      extractedAt: overrides?.extractedAt ?? '2026-03-01T00:00:00.000Z',
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

const exhaustedPaginatedResult: PaginatedResult = {
  results: [buildResumeDoc('resume-1', 'Alice')],
  status: 'Exhausted',
  isLoading: false,
  loadMore: loadMoreMock,
}
const skipPaginatedResult: PaginatedResult = {
  results: [],
  status: 'Exhausted',
  isLoading: false,
  loadMore: loadMoreMock,
}

describe('useConvexResumes list path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAnalysisTasksMock.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      dispatch: vi.fn(),
      cancel: vi.fn(),
      canManage: true,
    })
    rawApiPostMock.mockImplementation(async (...args: unknown[]) => {
      void args
      return {
        data: {
          success: true,
          results: [] as Array<{ resumeId: string; score: number; recommendation: string }>,
        },
      }
    })
    usePaginatedQueryMock.mockImplementation((_query, args) =>
      args === 'skip' ? skipPaginatedResult : exhaustedPaginatedResult,
    )
  })

  it('gets analysis-task refetch state from the BFF-backed context', () => {
    renderHook(() => useConvexResumes(200))

    expect(useAnalysisTasksMock).toHaveBeenCalled()
    expect(useQueryMock).not.toHaveBeenCalledWith('analysis_tasks:list', expect.anything())
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
        maxExperience: 8,
        education: ['bachelor'],
        skills: ['fanuc'],
        requiredKeywords: ['machine tools', 'cnc'],
        locations: ['Dongguan'],
        minSalary: 10,
        maxSalary: 20,
      },
    }))

    const listCall = usePaginatedQueryMock.mock.calls.find(([, args]) => args !== 'skip' && !('query' in (args as Record<string, unknown>)))

    expect(listCall?.[1]).toMatchObject({
      jobDescriptionId: 'jd-1',
      maxExperience: 8,
      education: ['bachelor'],
      skills: ['fanuc'],
      requiredKeywords: ['machine tools', 'cnc'],
      locations: ['Dongguan'],
      minSalary: 10,
      maxSalary: 20,
    })
  })

  it('forwards age filters to the paginated list query', () => {
    renderHook(() => useConvexResumes(200, undefined, 'jd-1', {
      filters: {
        minAge: 25,
        maxAge: 40,
      },
    }))

    const listCall = usePaginatedQueryMock.mock.calls.find(([, args]) => args !== 'skip' && !('query' in (args as Record<string, unknown>)))

    expect(listCall?.[1]).toMatchObject({
      minAge: 25,
      maxAge: 40,
    })
  })

  it('forwards role filters to the paginated list query', () => {
    renderHook(() => useConvexResumes(200, undefined, 'jd-1', {
      filters: {
        minRoleYears: 3,
        roleFilterType: 'verified',
      },
    }))

    const listCall = usePaginatedQueryMock.mock.calls.find(([, args]) => args !== 'skip' && !('query' in (args as Record<string, unknown>)))

    expect(listCall?.[1]).toMatchObject({
      minRoleYears: 3,
      roleFilterType: 'verified',
    })
  })

  it('returns loading=true while the first page is loading', () => {
    usePaginatedQueryMock.mockImplementation((_query, args) => ({
      results: args === 'skip' ? [] : [],
      status: args === 'skip' ? 'Exhausted' : 'LoadingFirstPage',
      isLoading: true,
      loadMore: loadMoreMock,
    }))

    const { result } = renderHook(() => useConvexResumes(200))

    expect(result.current.loading).toBe(true)
  })

  it('returns loading=false when disabled', () => {
    const { result } = renderHook(() => useConvexResumes(200, undefined, undefined, { enabled: false }))

    expect(result.current.loading).toBe(false)
    expect(result.current.resumes).toEqual([])
  })
})
