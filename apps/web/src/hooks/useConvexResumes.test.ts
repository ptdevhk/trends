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
  // BFF AND-mode search path returns different shape from keyword-expansion
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

describe('useConvexResumes', () => {
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
    // AND-mode is now active for plain keyword queries (no JD).
    // Mock the BFF /api/resumes endpoint to return the resume with
    // doc-level fields mixed into the flat BFF item shape.
    rawApiGetMock.mockImplementation(async (path?: unknown) => {
      if (path === '/api/resumes') {
        return {
          data: {
            success: true,
            data: [{
              // BFF returns a flat item: doc fields + content merged
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
      minExperience: 3,
      maxExperience: 8,
      education: ['bachelor'],
      skills: ['fanuc'],
      requiredKeywords: ['machine tools', 'cnc'],
      locations: ['Dongguan'],
      minSalary: 10,
      maxSalary: 20,
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

  it('falls back to local keyword expansion when the expansion request fails', async () => {
    rawApiGetMock.mockResolvedValueOnce({
      error: new Error('network failed'),
    })
    usePaginatedQueryMock.mockImplementation((_query, args) => ({
      results: args === 'skip' ? [] : [buildSearchEntry('resume-1', 'Alice')],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }))

    const { result } = renderHook(() => useConvexResumes(200, 'CNC Sales'))

    await waitFor(() => {
      const searchCall = usePaginatedQueryMock.mock.calls.find(([, args]) => args !== 'skip' && 'query' in (args as Record<string, unknown>))
      expect(searchCall?.[1]).toMatchObject({
        query: 'CNC Sales',
        keywordGroups: [
          { original: 'cnc', variants: ['cnc'] },
          { original: 'sales', variants: ['sales'] },
        ],
        mode: 'AND',
        sourceMappings: [],
      })
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

  it('forwards required keywords to the paginated search query', async () => {
    usePaginatedQueryMock.mockImplementation((_query, args) => ({
      results: args === 'skip' ? [] : [buildSearchEntry('resume-1', 'Alice')],
      status: 'Exhausted',
      isLoading: false,
      loadMore: loadMoreMock,
    }))

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
    usePaginatedQueryMock.mockImplementation((_query, args) => {
      if (args === 'skip') {
        return {
          results: [],
          status: 'Exhausted',
          isLoading: false,
          loadMore: loadMoreMock,
        }
      }

      if ('query' in (args as Record<string, unknown>)) {
        return {
          results: [],
          status: 'Exhausted',
          isLoading: false,
          loadMore: loadMoreMock,
        }
      }

      return {
        results: [buildResumeDoc('resume-fallback', 'Fallback Candidate')],
        status: 'Exhausted',
        isLoading: false,
        loadMore: loadMoreMock,
      }
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

    usePaginatedQueryMock.mockImplementation((_query, args) => {
      if (args === 'skip') {
        return {
          results: [],
          status: 'Exhausted',
          isLoading: false,
          loadMore: loadMoreMock,
        }
      }

      if ('query' in (args as Record<string, unknown>)) {
        return {
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
          ],
          status: 'Exhausted',
          isLoading: false,
          loadMore: loadMoreMock,
        }
      }

      return {
        results: [],
        status: 'Exhausted',
        isLoading: false,
        loadMore: loadMoreMock,
      }
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

    usePaginatedQueryMock.mockImplementation((_query, args) => {
      if (args === 'skip') {
        return {
          results: [],
          status: 'Exhausted',
          isLoading: false,
          loadMore: loadMoreMock,
        }
      }

      if ('query' in (args as Record<string, unknown>)) {
        return {
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
          ],
          status: 'Exhausted',
          isLoading: false,
          loadMore: loadMoreMock,
        }
      }

      return {
        results: [],
        status: 'Exhausted',
        isLoading: false,
        loadMore: loadMoreMock,
      }
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
