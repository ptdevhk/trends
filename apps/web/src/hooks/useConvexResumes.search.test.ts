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
const analysisTasksState = vi.hoisted(() => ({
  tasks: [] as Array<Record<string, unknown>>,
}))
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

function buildSearchEntry(id: string, name: string): Record<string, unknown> {
  return {
    resume: buildResumeDoc(id, name),
    provenance: [{ term: 'cnc', source: 'searchText' }],
  }
}

const skipPaginatedResult: PaginatedResult = {
  results: [],
  status: 'Exhausted',
  isLoading: false,
  loadMore: loadMoreMock,
}

describe('useConvexResumes AND-mode search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    analysisTasksState.tasks = []
    useAnalysisTasksMock.mockImplementation(() => ({
      tasks: analysisTasksState.tasks,
      loading: false,
      error: null,
      refresh: vi.fn(),
      dispatch: vi.fn(),
      cancel: vi.fn(),
      canManage: true,
    }))
    rawApiPostMock.mockImplementation(async (...args: unknown[]) => {
      void args
      return {
        data: {
          success: true,
          results: [] as Array<{ resumeId: string; score: number; recommendation: string }>,
        },
      }
    })
    // Default: non-AND-mode path is skipped, AND-mode BFF returns empty
    usePaginatedQueryMock.mockImplementation((_query, args) =>
      args === 'skip' ? skipPaginatedResult : { results: [], status: 'Exhausted', isLoading: false, loadMore: loadMoreMock },
    )
  })

  it('preserves matchedWorkEntries.directRoleMatch from ingest role signals', async () => {
    const resumeWithRoleSignals = {
      ...buildResumeDoc('resume-1', 'Alice'),
      ingestData: {
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        ruleScores: {},
        experienceLevel: 'mid',
        computedAt: 1_700_000_000_000,
        skillsVersion: 1,
        roleSignals: [
          {
            type: 'sales',
            matchedSignals: ['销售工程师'],
            signalCount: 1,
            occurrences: 1,
            years: 4,
            industryVerifiedYears: 0,
            roleRelevantYears: 4,
            industryVerifiedRelevantYears: 0,
            matchedWorkEntries: [
              {
                companyName: 'Example Co',
                jobTitle: '销售工程师',
                years: 4,
                industryVerified: false,
                matchedSignals: ['销售工程师'],
                directRoleMatch: true,
              },
            ],
            verifyIn: 'workHistory',
          },
        ],
      },
    }
    rawApiGetMock.mockImplementation(async (path?: unknown) => {
      if (path === '/api/resumes') {
        return {
          data: {
            success: true,
            data: [{
              resumeId: 'resume-1',
              _provenance: [{ term: 'cnc', source: 'searchText' }],
              ...resumeWithRoleSignals,
              ...typeof (resumeWithRoleSignals as Record<string, unknown>).content === 'object' && (resumeWithRoleSignals as Record<string, unknown>).content !== null ? (resumeWithRoleSignals as Record<string, unknown>).content as Record<string, unknown> : {},
            }],
            summary: { total: 1 },
          },
        }
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

    const { result } = renderHook(() => useConvexResumes(200, 'CNC'))

    await waitFor(() => {
      expect(result.current.resumes).toHaveLength(1)
    })

    const directRoleMatch = result.current.resumes[0]?.ingestData?.roleSignals?.[0]?.matchedWorkEntries?.[0]?.directRoleMatch

    expect(directRoleMatch).toBe(true)
  })

  it('uses the BFF AND-mode search path when keyword expansion resolves with AND mode', async () => {
    const searchPaginatedResult: PaginatedResult = {
      results: [buildSearchEntry('resume-1', 'Alice')],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }
    usePaginatedQueryMock.mockImplementation((_query, args) =>
      args === 'skip' ? skipPaginatedResult : searchPaginatedResult,
    )

    renderHook(() => useConvexResumes(200, 'CNC'))

    await waitFor(() => {
      expect(rawApiGetMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      const bffCall = rawApiGetMock.mock.calls.find(([path]) => path === '/api/resumes')
      expect(bffCall).toBeDefined()
    })
  })

  it('surfaces searchFailed on a dropped BFF search and clears it on retry', async () => {
    rawApiGetMock.mockImplementation(async (path?: unknown) => {
      if (typeof path === 'string' && path === '/api/resumes') {
        return { error: new Error('BFF AND-mode search failed') }
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

    const { result } = renderHook(() => useConvexResumes(200, 'CNC'))

    // The failure must surface as an explicit search-failed flag with NO
    // results (never a silent false "0 results" empty state).
    await waitFor(() => {
      expect(result.current.searchFailed).toBe(true)
    })
    expect(result.current.resumes).toHaveLength(0)

    // A healthy retry recovers the results and clears the flag.
    rawApiGetMock.mockImplementation(async (path?: unknown) => {
      if (typeof path === 'string' && path === '/api/resumes') {
        return {
          data: {
            success: true,
            data: [buildResumeDoc('resume-1', 'Alice')],
            summary: { total: 1 },
          },
        }
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
    result.current.retrySearch()

    await waitFor(() => {
      expect(result.current.searchFailed).toBe(false)
    })
    await waitFor(() => {
      expect(result.current.resumes.length).toBeGreaterThan(0)
    })
  })

  it('clears searchFailed when a subsequent search succeeds', async () => {
    const { result, rerender } = renderHook((query: string) => useConvexResumes(200, query), {
      initialProps: 'CNC',
    })

    await waitFor(() => {
      expect(result.current.searchFailed).toBe(false)
    })

    rawApiGetMock.mockImplementation(async (path?: unknown) => {
      if (typeof path === 'string' && path === '/api/resumes') {
        return { error: new Error('BFF AND-mode search failed') }
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
    rerender('CNC Sales')

    await waitFor(() => {
      expect(result.current.searchFailed).toBe(true)
    })

    rawApiGetMock.mockImplementation(async (path?: unknown) => {
      if (typeof path === 'string' && path === '/api/resumes') {
        return { data: { success: true, data: [], summary: { total: 0 } } }
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
    rerender('CNC Sales Again')

    await waitFor(() => {
      expect(result.current.searchFailed).toBe(false)
    })
  })

  it('refetches BFF AND-mode results when the task context reports a newly completed task', async () => {
    const { rerender } = renderHook(() => useConvexResumes(200, 'CNC'))

    await waitFor(() => {
      expect(rawApiGetMock.mock.calls.filter(([path]) => path === '/api/resumes')).toHaveLength(1)
    })

    analysisTasksState.tasks = [{
      id: 'completed-task',
      createdAt: 1,
      status: 'completed',
      config: {},
      progress: { current: 1, total: 1, skipped: 0 },
    }]
    rerender()

    await waitFor(() => {
      expect(rawApiGetMock.mock.calls.filter(([path]) => path === '/api/resumes')).toHaveLength(2)
    })
    expect(useAnalysisTasksMock).toHaveBeenCalled()
    expect(useQueryMock).not.toHaveBeenCalledWith('analysis_tasks:list', expect.anything())
  })

  it('forwards sort and source filters to the BFF AND-mode search path', async () => {
    renderHook(() => useConvexResumes(200, 'CNC', undefined, {
      filters: {
        sources: ['51job'],
      },
      sortBy: 'extractedAt',
      sortOrder: 'desc',
    }))

    await waitFor(() => {
      const bffCall = rawApiGetMock.mock.calls.find(([path]) => path === '/api/resumes')
      expect(bffCall?.[1]).toEqual({
        params: {
          query: expect.objectContaining({
            q: 'CNC',
            source: 'convex',
            paged: 'true',
            sources: '51job',
            sortBy: 'extractedAt',
            sortOrder: 'desc',
          }),
        },
      })
    })
  })

  it('reveals the next BFF AND-mode page when the display limit increases', async () => {
    const bffResumes = Array.from({ length: 450 }, (_, index) =>
      buildResumeDoc(`resume-${index}`, `Candidate ${index}`))

    rawApiGetMock.mockImplementation(async (path?: unknown, options?: unknown): Promise<KeywordExpansionResponse> => {
      if (path === '/api/resumes') {
        const params = (options as { params?: { query?: Record<string, unknown> } })?.params?.query
        const offset = typeof params?.offset === 'number' ? params.offset : 0
        const pageLimit = typeof params?.limit === 'number' ? params.limit : 200
        const page = bffResumes.slice(offset, offset + pageLimit)
        return {
          data: {
            success: true,
            data: page,
            summary: { total: bffResumes.length },
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

    const { result, rerender } = renderHook(
      ({ limit }) => useConvexResumes(limit, 'CNC'),
      { initialProps: { limit: 200 } },
    )

    await waitFor(() => {
      expect(result.current.resumes).toHaveLength(200)
    })
    expect(result.current.hasMore).toBe(true)

    rerender({ limit: 400 })

    await waitFor(() => {
      expect(result.current.resumes).toHaveLength(400)
    })
    expect(result.current.hasMore).toBe(true)
  })

  it('falls back to local keyword expansion when the expansion request fails', async () => {
    rawApiGetMock.mockResolvedValueOnce({
      error: new Error('network failed'),
    })
    const fallbackSearchResult: PaginatedResult = {
      results: [buildSearchEntry('resume-1', 'Alice')],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }
    usePaginatedQueryMock.mockImplementation((_query, args) =>
      args === 'skip' ? skipPaginatedResult : fallbackSearchResult,
    )

    const { result } = renderHook(() => useConvexResumes(200, 'CNC Sales'))

    await waitFor(() => {
      expect(result.current.expansion).not.toBeNull()
    })

    expect(result.current.expansion).toEqual({
      groups: [
        { original: 'cnc', variants: ['cnc'] },
        { original: 'sales', variants: ['sales'] },
      ],
      mode: 'AND',
      expandedTo: ['cnc', 'sales'],
      sourceMapping: {},
    })
  })

  it('forwards age and role filters to the search query alongside keywords', async () => {
    rawApiGetMock.mockResolvedValueOnce({
      data: {
        success: true,
        summary: {
          groups: [{ original: 'cnc', variants: ['cnc'] }],
          mode: 'OR' as const,
          expandedTo: ['cnc'],
          sourceMapping: {},
        },
      },
    })
    const searchPaginatedResult: PaginatedResult = {
      results: [buildSearchEntry('resume-1', 'Alice')],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }
    usePaginatedQueryMock.mockImplementation((_query, args) =>
      args === 'skip' ? skipPaginatedResult : searchPaginatedResult,
    )

    renderHook(() => useConvexResumes(200, 'CNC', undefined, {
      filters: {
        minAge: 25,
        maxAge: 40,
        minRoleYears: 3,
        roleFilterType: 'verified',
      },
    }))

    let searchCall: unknown[] | undefined
    await waitFor(() => {
      searchCall = usePaginatedQueryMock.mock.calls.find(
        ([, args]) => args !== 'skip' && typeof args === 'object' && 'query' in (args as Record<string, unknown>),
      )
      expect(searchCall).toBeDefined()
    })

    expect(searchCall?.[1]).toMatchObject({
      minAge: 25,
      maxAge: 40,
      minRoleYears: 3,
      roleFilterType: 'verified',
    })
  })

  it('shows loading=true while keyword expansion is in flight', async () => {
    let resolveExpansion: (value: unknown) => void
    const expansionPromise = new Promise((resolve) => { resolveExpansion = resolve })
    rawApiGetMock.mockImplementation(async (path?: unknown) => {
      if (path === '/api/resumes') {
        return {
          data: {
            success: true,
            data: [],
            summary: { total: 0 },
          },
        }
      }
      await expansionPromise
      return {
        data: {
          success: true,
          summary: {
            groups: [{ original: 'cnc', variants: ['cnc'] }],
            mode: 'OR' as const,
            expandedTo: ['cnc'],
            sourceMapping: {},
          },
        },
      }
    })
    usePaginatedQueryMock.mockImplementation((_query, args) =>
      args === 'skip'
        ? skipPaginatedResult
        : { results: [], status: 'LoadingFirstPage' as const, isLoading: true, loadMore: loadMoreMock },
    )

    const { result } = renderHook(() => useConvexResumes(200, 'CNC'))

    // While expansion is pending, loading should be true
    expect(result.current.loading).toBe(true)

    // Resolve the expansion and wait for the query to fire
    resolveExpansion!(null)
    usePaginatedQueryMock.mockImplementation((_query, args) =>
      args === 'skip'
        ? skipPaginatedResult
        : { results: [], status: 'Exhausted' as const, isLoading: false, loadMore: loadMoreMock },
    )
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })
})
