import { act, renderHook } from '@testing-library/react'
import { formatKeywordQuery } from '@trends/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResumeSearchState } from '@/hooks/useResumeSearchState'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { UrlSearchState } from '@/hooks/useUrlSearchState'

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    sessions: {
      listSearchHistory: 'list-search-history-query',
      saveSearchHistory: 'save-search-history-mutation',
      markSearchHistoryOpened: 'mark-search-history-opened-mutation',
    },
    taxonomy_clusters: {
      list: 'taxonomy-clusters-list-query',
    },
  },
}))

const {
  blocksByIdentityMock,
  markSearchHistoryOpenedMutationMock,
  parsedStateMock,
  resumesMock,
  saveSearchHistoryMutationMock,
  searchHistoryRecordsMock,
  statusByIdentityMock,
  syncToUrlMock,
  taxonomyClusterRecordsMock,
  useFacetCountsMock,
  useMutationMock,
  useQueryMock,
  workspaceMock,
} = vi.hoisted(() => ({
  blocksByIdentityMock: {} as Record<string, boolean>,
  markSearchHistoryOpenedMutationMock: vi.fn(async () => {}),
  parsedStateMock: {} as UrlSearchState,
  resumesMock: [] as ConvexResumeItem[],
  saveSearchHistoryMutationMock: vi.fn(async () => 'history-1'),
  searchHistoryRecordsMock: [] as Array<Record<string, unknown>>,
  statusByIdentityMock: {} as Record<string, { status: ResumeSearchResultItem['status'] }>,
  syncToUrlMock: vi.fn(),
  taxonomyClusterRecordsMock: [] as Array<Record<string, unknown>>,
  useFacetCountsMock: vi.fn(),
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
  useConvexResumes: () => ({
    resumes: resumesMock,
    hasMore: false,
    loading: false,
    loadingMore: false,
  }),
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
    searchHistoryRecordsMock.splice?.(0, searchHistoryRecordsMock.length)
    taxonomyClusterRecordsMock.splice?.(0, taxonomyClusterRecordsMock.length)
    Object.keys(statusByIdentityMock).forEach((key) => delete statusByIdentityMock[key])
    Object.keys(blocksByIdentityMock).forEach((key) => delete blocksByIdentityMock[key])

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
      if (query === 'list-search-history-query') {
        return searchHistoryRecordsMock
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
  })

  afterEach(() => {
    vi.useRealTimers()
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
    statusByIdentityMock['identity-1'] = { status: 'contacted' }
    statusByIdentityMock['identity-2'] = { status: 'contacted' }
    statusByIdentityMock['identity-3'] = { status: 'contacted' }

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

    searchHistoryRecordsMock.push(
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
})
