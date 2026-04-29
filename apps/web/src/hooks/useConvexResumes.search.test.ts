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

describe('useConvexResumes AND-mode search', () => {
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
})
