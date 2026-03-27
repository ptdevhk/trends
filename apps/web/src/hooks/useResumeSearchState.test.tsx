import { act, renderHook } from '@testing-library/react'
import { formatKeywordQuery } from '@trends/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResumeSearchState } from '@/hooks/useResumeSearchState'
import type { CandidateStatusRecord } from '@/hooks/useCandidateStatus'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { UrlSearchState } from '@/hooks/useUrlSearchState'

const {
  exportDownloadMock,
  toastErrorMock,
  toastInfoMock,
} = vi.hoisted(() => ({
  exportDownloadMock: vi.fn(async (apiBaseUrl: string, payload: unknown) => {
    void apiBaseUrl
    void payload
  }),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    sessions: {
      recentSearches: 'recent-searches-query',
      saveSearchHistory: 'save-search-history-mutation',
      markSearchHistoryOpened: 'mark-search-history-opened-mutation',
    },
    taxonomy_clusters: {
      list: 'taxonomy-clusters-list-query',
    },
  },
}))

vi.mock('@/lib/resume-export', () => ({
  submitResumeExportDownload: (apiBaseUrl: string, payload: unknown) => {
    void apiBaseUrl
    void payload
    return exportDownloadMock(apiBaseUrl, payload)
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: (message: unknown) => toastErrorMock(message),
    info: (message: unknown) => toastInfoMock(message),
  },
}))

const {
  blocksByIdentityMock,
  convexQueryStateMock,
  markSearchHistoryOpenedMutationMock,
  parsedStateMock,
  resumesMock,
  saveSearchHistoryMutationMock,
  recentSearchHistoryRecordsMock,
  statusByIdentityMock,
  syncToUrlMock,
  taxonomyClusterRecordsMock,
  useFacetCountsMock,
  useConvexResumesMock,
  useMutationMock,
  useQueryMock,
  workspaceMock,
} = vi.hoisted(() => ({
  blocksByIdentityMock: {} as Record<string, boolean>,
  convexQueryStateMock: {
    hasMore: false,
    loading: false,
    loadingMore: false,
  },
  markSearchHistoryOpenedMutationMock: vi.fn(async () => {}),
  parsedStateMock: {} as UrlSearchState,
  resumesMock: [] as ConvexResumeItem[],
  saveSearchHistoryMutationMock: vi.fn(async () => 'history-1'),
  recentSearchHistoryRecordsMock: [] as Array<Record<string, unknown>>,
  statusByIdentityMock: {} as Record<string, CandidateStatusRecord>,
  syncToUrlMock: vi.fn(),
  taxonomyClusterRecordsMock: [] as Array<Record<string, unknown>>,
  useFacetCountsMock: vi.fn(),
  useConvexResumesMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn(),
  workspaceMock: {
    slug: 'dev',
  },
}))

vi.mock('convex/react', () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => workspaceMock,
}))

vi.mock('@/hooks/useUrlSearchState', () => ({
  useUrlSearchState: () => ({
    parsedState: parsedStateMock,
    syncToUrl: syncToUrlMock,
  }),
}))

vi.mock('@/hooks/useCandidateStatus', () => ({
  useCandidateStatus: () => ({
    statusByIdentity: statusByIdentityMock,
  }),
}))

vi.mock('@/hooks/useCandidateBlocks', () => ({
  useCandidateBlocks: () => ({
    blocksByIdentity: blocksByIdentityMock,
  }),
}))

vi.mock('@/hooks/useConvexResumes', () => ({
  useConvexResumes: (...args: unknown[]) => useConvexResumesMock(...args),
}))

vi.mock('@/hooks/useFacetCounts', () => ({
  useFacetCounts: (...args: unknown[]) => useFacetCountsMock(...args),
}))

function createParsedState(overrides: Partial<UrlSearchState> = {}): UrlSearchState {
  return {
    shareSessionId: undefined,
    query: undefined,
    location: undefined,
    keywords: [],
    requiredKeywords: [],
    jobDescriptionId: undefined,
    selectedTags: [],
    selectedCompanies: [],
    selectedExperienceLevel: undefined,
    filters: {},
    ...overrides,
  }
}

function createStatusRecord(
  identityKey: string,
  status: CandidateStatusRecord['status'],
  overrides: Partial<CandidateStatusRecord> = {},
): CandidateStatusRecord {
  return {
    _id: `${identityKey}-status`,
    identityKey,
    workspaceSlug: 'dev',
    status,
    updatedAt: Date.now(),
    ...overrides,
  }
}

function createResume(index: number, overrides: Partial<ConvexResumeItem> = {}): ConvexResumeItem {
  const extractedDay = ((index - 1) % 28) + 1

  return {
    resumeId: `resume-${index}` as ConvexResumeItem['resumeId'],
    externalId: `external-${index}`,
    identityKey: `identity-${index}`,
    name: `Candidate ${index}`,
    profileUrl: '',
    activityStatus: '',
    age: '',
    ageNumber: 30,
    experience: '5 years',
    education: 'Bachelor',
    location: 'Malaysia',
    extractedAt: new Date(`2026-03-${String(extractedDay).padStart(2, '0')}T10:00:00.000Z`).toISOString(),
    expectedSalary: '',
    jobIntention: '',
    selfIntro: '',
    skills: [],
    workHistory: [],
    source: 'seek',
    crawledAt: Date.now(),
    tags: [],
    primaryRuleScore: 85,
    ingestData: {
      industryTags: ['Machine Tools', 'Automation'],
      synonymHits: [],
      brandHits: [],
      companyHits: ['FANUC'],
      ruleScores: {},
      experienceLevel: 'senior',
      computedAt: Date.now(),
      skillsVersion: 1,
    },
    ...overrides,
  }
}

function lastResumeLimitCall(): number | undefined {
  const lastCall = useConvexResumesMock.mock.calls[useConvexResumesMock.mock.calls.length - 1]
  return lastCall?.[0] as number | undefined
}

describe('useResumeSearchState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    localStorage.clear()

    workspaceMock.slug = 'dev'
    parsedStateMock.shareSessionId = undefined
    parsedStateMock.query = undefined
    parsedStateMock.location = undefined
    parsedStateMock.keywords = []
    parsedStateMock.requiredKeywords = []
    parsedStateMock.jobDescriptionId = undefined
    parsedStateMock.selectedTags = []
    parsedStateMock.selectedCompanies = []
    parsedStateMock.selectedExperienceLevel = undefined
    parsedStateMock.filters = {}

    resumesMock.splice(0, resumesMock.length)
    recentSearchHistoryRecordsMock.splice?.(0, recentSearchHistoryRecordsMock.length)
    taxonomyClusterRecordsMock.splice?.(0, taxonomyClusterRecordsMock.length)
    Object.keys(statusByIdentityMock).forEach((key) => delete statusByIdentityMock[key])
    Object.keys(blocksByIdentityMock).forEach((key) => delete blocksByIdentityMock[key])
    convexQueryStateMock.hasMore = false
    convexQueryStateMock.loading = false
    convexQueryStateMock.loadingMore = false

    useFacetCountsMock.mockReturnValue({
      clusters: [],
      tags: [],
      companies: [],
      experienceLevels: [],
      education: [],
      statuses: [],
      minScoreOptions: [],
    })

    useQueryMock.mockImplementation((query) => {
      if (query === 'recent-searches-query') {
        return recentSearchHistoryRecordsMock
      }
      if (query === 'taxonomy-clusters-list-query') {
        return taxonomyClusterRecordsMock
      }
      return undefined
    })

    useMutationMock.mockImplementation((mutation) => {
      if (mutation === 'save-search-history-mutation') {
        return saveSearchHistoryMutationMock
      }
      if (mutation === 'mark-search-history-opened-mutation') {
        return markSearchHistoryOpenedMutationMock
      }
      return vi.fn()
    })

    useConvexResumesMock.mockImplementation(() => ({
      resumes: resumesMock,
      hasMore: convexQueryStateMock.hasMore,
      loading: convexQueryStateMock.loading,
      loadingMore: convexQueryStateMock.loadingMore,
    }))
    exportDownloadMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to score-first ordering for loaded search results', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
    }))

    resumesMock.push(
      createResume(1, { primaryRuleScore: 72 }),
      createResume(2, { primaryRuleScore: 91 }),
      createResume(3, { primaryRuleScore: 84 }),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.activeSort).toBe('score')
    expect(result.current.filteredResults.map((item) => item.key)).toEqual([
      'resume-2',
      'resume-3',
      'resume-1',
    ])
  })

  it('derives raw and cluster tags, applies local filters, and sorts matching results', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
        sortBy: 'experience',
        sortOrder: 'desc',
      },
    }))

    taxonomyClusterRecordsMock.push(
      {
        name: 'Manufacturing Systems',
        slug: 'manufacturing-systems',
        tags: ['Machine Tools', 'Automation'],
      },
    )
    resumesMock.push(
      createResume(1, {
        experience: '10 years',
        primaryRuleScore: 92,
      }),
      createResume(2, {
        experience: '3 years',
        primaryRuleScore: 86,
      }),
      createResume(3, {
        experience: '12 years',
        primaryRuleScore: 95,
        education: 'Master',
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['DMG MORI'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
        },
      }),
    )
    statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'contacted')
    statusByIdentityMock['identity-2'] = createStatusRecord('identity-2', 'contacted')
    statusByIdentityMock['identity-3'] = createStatusRecord('identity-3', 'contacted')

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.isLanding).toBe(false)
    expect(result.current.activeSort).toBe('experience')
    expect(result.current.selectedClusterTags).toEqual(['manufacturing-systems'])
    expect(result.current.selectedRawTags).toEqual(['Machine Tools'])
    expect(result.current.filterCount).toBe(7)
    expect(result.current.taxonomyClusters).toEqual([
      {
        name: 'Manufacturing Systems',
        slug: 'manufacturing-systems',
        parentSlug: undefined,
        tags: ['Machine Tools', 'Automation'],
      },
    ])
    expect(result.current.filteredResults.map((item) => item.key)).toEqual(['resume-1', 'resume-2'])
    expect(result.current.filteredResults[0]?.resume.experience).toBe('10 years')
    expect(result.current.filteredResults[1]?.resume.experience).toBe('3 years')
  })

  it('normalizes a recent search and syncs it back to canonical url state when applied', async () => {
    const historyKeywords = ['Machine Tools', 'Sales']
    const expectedQuery = formatKeywordQuery(historyKeywords)

    recentSearchHistoryRecordsMock.push(
      {
        _id: 'history-1',
        sessionKey: 'session-1',
        title: 'Saved search',
        location: 'Malaysia',
        keywords: historyKeywords,
        jobDescriptionId: 'lathe-sales',
        selectedTags: ['cluster:manufacturing-systems', 'Machine Tools', 'machine tools'],
        selectedCompanies: ['FANUC', ' fanuc '],
        selectedExperienceLevel: ' senior ',
        filters: {
          education: ['Bachelor'],
          status: ['new'],
        },
        createdAt: 1,
        lastOpenedAt: 2,
      },
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.recentSearches).toEqual([
      expect.objectContaining({
        id: 'history-1',
        location: 'Malaysia',
        keywords: historyKeywords,
        selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
        selectedCompanies: ['FANUC'],
        selectedExperienceLevel: 'senior',
      }),
    ])

    await act(async () => {
      await result.current.applyRecentSearch(result.current.recentSearches[0]!)
    })

    expect(markSearchHistoryOpenedMutationMock).toHaveBeenCalledWith({
      id: 'history-1',
      workspaceSlug: 'dev',
    })
    expect(syncToUrlMock).toHaveBeenCalledWith({
      query: expectedQuery,
      shareSessionId: undefined,
      location: 'Malaysia',
      keywords: historyKeywords,
      requiredKeywords: [],
      jobDescriptionId: 'lathe-sales',
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        education: ['Bachelor'],
        status: ['new'],
      },
    })
    expect(result.current.queryInput).toBe(expectedQuery)
  })

  it('loads recent searches from the active session only', () => {
    localStorage.setItem('trends.resume.search.sessionKey.dev', 'session-dev')

    renderHook(() => useResumeSearchState())

    expect(useQueryMock).toHaveBeenCalledWith('recent-searches-query', {
      sessionKey: 'session-dev',
      workspaceSlug: 'dev',
      limit: 10,
    })
  })

  it('debounces search-history persistence and caps saved resume ids to the first 50', async () => {
    const query = formatKeywordQuery(['Machine Tools', 'Sales'])
    Object.assign(parsedStateMock, createParsedState({
      query,
      keywords: ['Machine Tools', 'Sales'],
      location: 'Malaysia',
      selectedTags: ['cluster:manufacturing-systems'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        status: ['contacted'],
      },
    }))
    localStorage.setItem('trends.resume.search.sessionKey.dev', 'session-dev')

    resumesMock.push(
      ...Array.from({ length: 55 }, (_, index) => createResume(index + 1, {
        resumeId: `resume-${index + 1}` as ConvexResumeItem['resumeId'],
        identityKey: `identity-${index + 1}`,
      })),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.isLanding).toBe(false)
    expect(saveSearchHistoryMutationMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(799)
    })

    expect(saveSearchHistoryMutationMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(saveSearchHistoryMutationMock).toHaveBeenCalledTimes(1)
    expect(saveSearchHistoryMutationMock).toHaveBeenCalledWith({
      sessionKey: 'session-dev',
      workspaceSlug: 'dev',
      title: `Malaysia · ${query}`,
      location: 'Malaysia',
      keywords: ['Machine Tools', 'Sales'],
      jobDescriptionId: undefined,
      filters: {
        status: ['contacted'],
      },
      selectedTags: ['cluster:manufacturing-systems'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      resumeIds: Array.from({ length: 50 }, (_, index) => `resume-${index + 1}`),
    })
  })

  it('syncs submit, clear, and sort actions back into canonical url state', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
      location: 'Malaysia',
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
        sortBy: 'experience',
        sortOrder: 'desc',
      },
    }))

    const { result } = renderHook(() => useResumeSearchState())

    act(() => {
      result.current.submitSearch('  servo automation  ')
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(1, {
      shareSessionId: undefined,
      query: 'servo automation',
      location: 'Malaysia',
      keywords: ['servo', 'automation'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
        sortBy: 'experience',
        sortOrder: 'desc',
      },
    })

    act(() => {
      result.current.setSort('newest')
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(2, {
      shareSessionId: undefined,
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
        sortBy: 'extractedAt',
        sortOrder: 'desc',
      },
    })

    act(() => {
      result.current.setSort('score')
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(3, {
      shareSessionId: undefined,
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
      },
    })

    act(() => {
      result.current.clearSearch()
    })

    expect(result.current.queryInput).toBe('')
    expect(syncToUrlMock).toHaveBeenNthCalledWith(4, {
      shareSessionId: undefined,
      query: undefined,
      location: 'Malaysia',
      keywords: [],
      requiredKeywords: [],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
      filters: {},
    })
  })

  it('exports the current filtered results with score-first metadata', async () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
    }))

    resumesMock.push(
      createResume(1, {
        primaryRuleScore: 88,
        analysis: {
          score: 91,
          summary: 'Strong fit',
          highlights: [],
          recommendation: 'strong_match',
          breakdown: {
            industry_db: 55,
          },
        },
      }),
      createResume(2, {
        primaryRuleScore: 79,
      }),
    )
    statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'contacted', {
      notes: 'Call first',
    })

    const { result } = renderHook(() => useResumeSearchState())

    await act(async () => {
      await result.current.exportResults()
    })

    expect(exportDownloadMock).toHaveBeenCalledWith(
      '',
      {
        format: 'csv',
        source: 'convex',
        entries: [
          {
            resumeId: 'resume-1',
            status: 'contacted',
            match: {
              score: 88,
              recommendation: 'strong_match',
              scoreSource: 'rule',
            },
            ruleScore: 88,
            userComment: 'Call first',
          },
          {
            resumeId: 'resume-2',
            status: 'new',
            match: {
              score: 79,
              recommendation: 'match',
              scoreSource: 'rule',
            },
            ruleScore: 79,
          },
        ],
      },
    )
    expect(toastInfoMock).toHaveBeenCalledWith('Started export for 2 resumes')
  })

  it('clears only facet filters while preserving the active search context', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        minExperience: 5,
        maxExperience: 12,
        locations: ['Malaysia'],
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
      },
    }))

    const { result } = renderHook(() => useResumeSearchState())

    act(() => {
      result.current.clearFacetFilters()
    })

    expect(result.current.queryInput).toBe('machine tools')
    expect(syncToUrlMock).toHaveBeenCalledWith({
      shareSessionId: undefined,
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
      filters: {
        minExperience: 5,
        maxExperience: 12,
        locations: ['Malaysia'],
        education: undefined,
        status: undefined,
        minMatchScore: undefined,
      },
    })
  })

  it('removes tag-like facet selections case-insensitively while preserving the active search context', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['Machine Tools', 'cluster:manufacturing-systems'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        minExperience: 5,
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
      },
    }))

    const { result } = renderHook(() => useResumeSearchState())
    const baseSyncedState = {
      shareSessionId: undefined,
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedExperienceLevel: 'senior',
      filters: {
        minExperience: 5,
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
      },
    }

    act(() => {
      result.current.toggleTag(' machine tools ')
      result.current.toggleCluster(' Manufacturing-Systems ')
      result.current.toggleCompany(' fanuc ')
      result.current.toggleEducation(' bachelor ')
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(1, {
      ...baseSyncedState,
      selectedTags: ['cluster:manufacturing-systems'],
      selectedCompanies: ['FANUC'],
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(2, {
      ...baseSyncedState,
      selectedTags: ['Machine Tools'],
      selectedCompanies: ['FANUC'],
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(3, {
      ...baseSyncedState,
      selectedTags: ['Machine Tools', 'cluster:manufacturing-systems'],
      selectedCompanies: [],
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(4, {
      ...baseSyncedState,
      selectedTags: ['Machine Tools', 'cluster:manufacturing-systems'],
      selectedCompanies: ['FANUC'],
      filters: {
        ...baseSyncedState.filters,
        education: [],
      },
    })
  })

  it('clears optional experience-level and min-score facets while preserving the active search context', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        minExperience: 5,
        maxExperience: 12,
        locations: ['Malaysia'],
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
      },
    }))

    const { result } = renderHook(() => useResumeSearchState())
    const baseSyncedState = {
      shareSessionId: undefined,
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems'],
      selectedCompanies: ['FANUC'],
      filters: {
        minExperience: 5,
        maxExperience: 12,
        locations: ['Malaysia'],
        education: ['Bachelor'],
        status: ['contacted'],
      },
    }

    act(() => {
      result.current.setSelectedExperienceLevel(undefined)
      result.current.setMinScoreFilter(undefined)
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(1, {
      ...baseSyncedState,
      selectedExperienceLevel: undefined,
      filters: {
        ...baseSyncedState.filters,
        minMatchScore: 80,
      },
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(2, {
      ...baseSyncedState,
      selectedExperienceLevel: 'senior',
      filters: {
        ...baseSyncedState.filters,
        minMatchScore: undefined,
      },
    })
  })

  it('toggles status filters while preserving the active search context', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        minExperience: 5,
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
      },
    }))

    const { result } = renderHook(() => useResumeSearchState())
    const baseSyncedState = {
      shareSessionId: undefined,
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: ['CNC'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems'],
      selectedCompanies: ['FANUC'],
      selectedExperienceLevel: 'senior',
      filters: {
        minExperience: 5,
        education: ['Bachelor'],
        minMatchScore: 80,
      },
    }

    act(() => {
      result.current.toggleStatus('contacted')
      result.current.toggleStatus('offer')
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(1, {
      ...baseSyncedState,
      filters: {
        ...baseSyncedState.filters,
        status: [],
      },
    })

    expect(syncToUrlMock).toHaveBeenNthCalledWith(2, {
      ...baseSyncedState,
      filters: {
        ...baseSyncedState.filters,
        status: ['contacted', 'offer'],
      },
    })
  })

  it('only grows the resume window when more results are available and not already loading more', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
    }))
    convexQueryStateMock.hasMore = true

    const { result, rerender } = renderHook(() => useResumeSearchState())

    expect(lastResumeLimitCall()).toBe(200)

    act(() => {
      result.current.loadMore()
    })

    expect(lastResumeLimitCall()).toBe(400)

    convexQueryStateMock.loadingMore = true
    rerender()

    act(() => {
      result.current.loadMore()
    })

    expect(lastResumeLimitCall()).toBe(400)

    convexQueryStateMock.loadingMore = false
    convexQueryStateMock.hasMore = false
    rerender()

    act(() => {
      result.current.loadMore()
    })

    expect(lastResumeLimitCall()).toBe(400)
  })
})
