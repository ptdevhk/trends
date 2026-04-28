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
  useQuery: () => undefined,
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    analysis_tasks: { list: 'analysis_tasks:list' },
    resumes: {
      searchWithTagExpansionPaginated: 'resumes:searchWithTagExpansionPaginated',
      searchWithTagExpansionScanPage: 'resumes:searchWithTagExpansionScanPage',
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

describe('useConvexResumes exact keyword scan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rawApiPostMock.mockImplementation(async (...args: unknown[]) => {
      void args
      return {
        data: {
          success: true,
          results: [] as Array<{ resumeId: string; score: number; recommendation: string }>,
        },
      }
    })
  })

  it('forwards required keywords to the paginated search query', async () => {
    const requiredKwResult: PaginatedResult = {
      results: [buildSearchEntry('resume-1', 'Alice')],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }
    usePaginatedQueryMock.mockImplementation((_query, args) =>
      args === 'skip' ? skipPaginatedResult : requiredKwResult,
    )

    renderHook(() => useConvexResumes(200, 'CNC', 'jd-1', {
      filters: {
        requiredKeywords: ['machine tools', 'cnc'],
      },
    }))

    await waitFor(() => {
      expect(rawApiGetMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      const searchCall = usePaginatedQueryMock.mock.calls.find(([, args]) =>
        args !== 'skip'
        && 'query' in (args as Record<string, unknown>)
        && !('jobDescriptionId' in (args as Record<string, unknown>))
      )
      expect(searchCall?.[1]).toMatchObject({
        requiredKeywords: ['machine tools', 'cnc'],
      })
    })

    expect(rawApiPostMock).toHaveBeenCalledWith('/api/resumes/match', {
      body: {
        source: 'convex',
        persist: false,
        mode: 'rules_only',
        jobDescriptionId: 'jd-1',
        resumeIds: ['resume-1'],
      },
    })
  })

  it('falls back to the JD list query when a JD-backed keyword search returns no matches', async () => {
    const emptyPaginatedResult: PaginatedResult = {
      results: [],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }
    const fallbackListResult: PaginatedResult = {
      results: [buildResumeDoc('resume-fallback', 'Fallback Candidate')],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }
    usePaginatedQueryMock.mockImplementation((_query, args) => {
      if (args === 'skip') return skipPaginatedResult
      if ('query' in (args as Record<string, unknown>)) return emptyPaginatedResult
      return fallbackListResult
    })

    const { result } = renderHook(() => useConvexResumes(200, 'CNC', 'lathe-sales'))

    await waitFor(() => {
      expect(rawApiGetMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(result.current.resumes.map((resume) => resume.name)).toEqual(['Fallback Candidate'])
    })
  })

  it('prefers the best JD match when exact keyword scan returns duplicate identities', async () => {
    rawApiPostMock.mockResolvedValue({
      data: {
        success: true,
        results: [
          { resumeId: 'resume-low-match', score: 35, recommendation: 'potential' },
          { resumeId: 'resume-best-match', score: 91, recommendation: 'match' },
          { resumeId: 'resume-third', score: 72, recommendation: 'match' },
        ],
      },
    })

    const duplicateScanResult: PaginatedResult = {
      results: [
        {
          resume: buildResumeDoc('resume-low-match', 'Lower Match Duplicate', {
            identityKey: 'identity-1',
            primaryRuleScore: 90,
            crawledAt: 1_700_000_000_000,
          }),
          provenance: [{ term: 'cnc', source: 'searchText' }],
        },
        {
          resume: buildResumeDoc('resume-best-match', 'Best Match Duplicate', {
            identityKey: 'identity-1',
            primaryRuleScore: 60,
            crawledAt: 1_700_000_000_100,
          }),
          provenance: [{ term: 'sales', source: 'searchText' }],
        },
        {
          resume: buildResumeDoc('resume-third', 'Third Candidate', {
            identityKey: 'identity-2',
            primaryRuleScore: 70,
            crawledAt: 1_700_000_000_200,
          }),
          provenance: [{ term: 'cnc', source: 'searchText' }],
        },
      ] as unknown as PaginatedResult['results'],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }
    usePaginatedQueryMock.mockImplementation((_query, args) => {
      if (args === 'skip') return skipPaginatedResult
      if ('query' in (args as Record<string, unknown>)) return duplicateScanResult
      return skipPaginatedResult
    })

    const { result } = renderHook(() => useConvexResumes(200, 'CNC sales', 'jd-1'))

    await waitFor(() => {
      expect(rawApiPostMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(result.current.resumes.map((resume) => resume.name)).toEqual([
        'Best Match Duplicate',
        'Third Candidate',
      ])
    })
  })

  it('merges duplicate provenance while preserving explicit newest sort on exact keyword scans', async () => {
    rawApiPostMock.mockResolvedValue({
      data: {
        success: true,
        results: [
          { resumeId: 'resume-best-match', score: 91, recommendation: 'match' },
          { resumeId: 'resume-lower-match', score: 30, recommendation: 'potential' },
          { resumeId: 'resume-newest', score: 72, recommendation: 'match' },
        ],
      },
    })

    const provenanceScanResult: PaginatedResult = {
      results: [
        {
          resume: buildResumeDoc('resume-best-match', 'Best Match Duplicate', {
            identityKey: 'identity-1',
            primaryRuleScore: 60,
            extractedAt: '2026-03-02T00:00:00.000Z',
            crawledAt: 1_700_000_000_000,
          }),
          provenance: [{ term: 'cnc', source: 'searchText' }],
        },
        {
          resume: buildResumeDoc('resume-lower-match', 'Lower Match Duplicate', {
            identityKey: 'identity-1',
            primaryRuleScore: 90,
            extractedAt: '2026-03-10T00:00:00.000Z',
            crawledAt: 1_700_000_000_100,
          }),
          provenance: [{ term: 'servo', source: 'searchText' }],
        },
        {
          resume: buildResumeDoc('resume-newest', 'Newest Candidate', {
            identityKey: 'identity-2',
            primaryRuleScore: 70,
            extractedAt: '2026-03-15T00:00:00.000Z',
            crawledAt: 1_700_000_000_200,
          }),
          provenance: [{ term: 'automation', source: 'searchText' }],
        },
      ] as unknown as PaginatedResult['results'],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }
    usePaginatedQueryMock.mockImplementation((_query, args) => {
      if (args === 'skip') return skipPaginatedResult
      if ('query' in (args as Record<string, unknown>)) return provenanceScanResult
      return skipPaginatedResult
    })

    const { result } = renderHook(() => useConvexResumes(200, 'CNC servo', 'jd-1', {
      sortBy: 'extractedAt',
      sortOrder: 'desc',
    }))

    await waitFor(() => {
      expect(rawApiPostMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(result.current.resumes.map((resume) => resume.name)).toEqual([
        'Newest Candidate',
        'Best Match Duplicate',
      ])
    })

    expect(result.current.resumes[1]?._provenance).toEqual([
      { term: 'cnc', source: 'searchText' },
      { term: 'servo', source: 'searchText' },
    ])
  })
})
