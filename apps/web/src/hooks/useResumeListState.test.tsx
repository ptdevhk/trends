import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { CandidateStatusRecord } from '@/hooks/useCandidateStatus'
import { useResumeListState } from './useResumeListState'

const mockState = vi.hoisted(() => ({
  convexResumes: [] as ConvexResumeItem[],
  filters: {} as Record<string, unknown>,
  sessionLocation: '广东',
  sessionKeywords: [] as string[],
  sessionJobDescriptionId: undefined as string | undefined,
  blocksByIdentity: {} as Record<string, { identityKey: string }>,
  statusByIdentity: {} as Record<string, CandidateStatusRecord>,
  setFilters: vi.fn(),
  setLocation: vi.fn(),
  setKeywords: vi.fn(),
  setJobDescriptionId: vi.fn(),
  trackReviewedResume: vi.fn(),
  applyExternalState: vi.fn(),
  saveSearchHistory: vi.fn(async () => 'history-1'),
  markSearchHistoryOpened: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  reloadSamples: vi.fn(async () => {}),
  blockCandidates: vi.fn(async () => true),
  unblockCandidate: vi.fn(async () => true),
  updateStatus: vi.fn(async () => {}),
  saveAction: vi.fn(async () => {}),
  syncToUrl: vi.fn(),
  urlParsedState: {
    location: undefined as string | undefined,
    keywords: [] as string[],
    jobDescriptionId: undefined as string | undefined,
    filters: {} as Record<string, unknown>,
    selectedTags: [] as string[],
    selectedCompanies: [] as string[],
    selectedExperienceLevel: undefined as 'senior' | 'mid' | 'junior' | undefined,
  },
  urlHasParams: false,
  urlHasKeywordParam: false,
  urlHasJobDescriptionParam: false,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string }) => {
      if (typeof options === 'string') {
        return options
      }
      return options?.defaultValue ?? _key
    },
  }),
}))

vi.mock('convex/react', () => ({
  useQuery: () => [],
  useMutation: () => vi.fn(async () => ({})),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    location: mockState.sessionLocation,
    setLocation: mockState.setLocation,
    keywords: mockState.sessionKeywords,
    setKeywords: mockState.setKeywords,
    jobDescriptionId: mockState.sessionJobDescriptionId,
    setJobDescriptionId: mockState.setJobDescriptionId,
    filters: mockState.filters,
    setFilters: mockState.setFilters,
    reviewedIdsSet: new Set<string>(),
    trackReviewedResume: mockState.trackReviewedResume,
    applyExternalState: mockState.applyExternalState,
    searchHistory: [],
    searchHistoryLoading: false,
    saveSearchHistory: mockState.saveSearchHistory,
    markSearchHistoryOpened: mockState.markSearchHistoryOpened,
  }),
}))

vi.mock('@/hooks/useUrlSearchState', () => ({
  hasKnownUrlSearchParams: () => false,
  parseUrlSearchState: () => mockState.urlParsedState,
  useUrlSearchState: () => ({
    parsedState: mockState.urlParsedState,
    hasUrlParams: mockState.urlHasParams,
    hasKeywordParam: mockState.urlHasKeywordParam,
    hasJobDescriptionParam: mockState.urlHasJobDescriptionParam,
    syncToUrl: mockState.syncToUrl,
  }),
}))

vi.mock('@/hooks/useResumes', () => ({
  useResumes: () => ({
    resumes: [],
    summary: null,
    loading: false,
    error: null,
    selectedSample: '',
    refresh: mockState.refresh,
    reloadSamples: mockState.reloadSamples,
  }),
}))

vi.mock('@/hooks/useConvexResumes', () => ({
  useConvexResumes: () => ({
    resumes: mockState.convexResumes,
    loading: false,
  }),
}))

vi.mock('@/hooks/useCandidateActions', () => ({
  useCandidateActions: () => ({
    actions: {},
    saveAction: mockState.saveAction,
  }),
}))

vi.mock('@/hooks/useCandidateBlocks', () => ({
  useCandidateBlocks: () => ({
    blocksByIdentity: mockState.blocksByIdentity,
    blockCandidates: mockState.blockCandidates,
    unblockCandidate: mockState.unblockCandidate,
  }),
}))

vi.mock('@/hooks/useCandidateStatus', () => ({
  useCandidateStatus: () => ({
    statusByIdentity: mockState.statusByIdentity,
    updateStatus: mockState.updateStatus,
  }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: vi.fn(async () => ({ data: { success: true } })),
    GET: vi.fn(async () => ({ data: { success: true } })),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

function buildResume(params: {
  id: string
  name: string
  roleSignals: Array<{
    type: string
    matchedSignals: string[]
    signalCount: number
    occurrences: number
    years: number
    verifyIn: string
  }>
}): ConvexResumeItem {
  return {
    resumeId: params.id as ConvexResumeItem['resumeId'],
    externalId: `ext-${params.id}`,
    crawledAt: 1_700_000_000_000,
    source: 'test',
    tags: [],
    identityKey: params.id,
    name: params.name,
    profileUrl: `https://example.com/${params.id}`,
    activityStatus: 'Active',
    age: '30',
    ageNumber: 30,
    experience: '5 years',
    education: 'Bachelor',
    location: 'Dongguan',
    selfIntro: 'Test intro',
    jobIntention: 'Test role',
    expectedSalary: '10k-20k',
    workHistory: [{ raw: 'Test work history' }],
    extractedAt: '2026-03-01T00:00:00.000Z',
    ingestData: {
      evidenceText: 'test work history',
      industryTags: [],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      roleSignals: params.roleSignals,
      ruleScores: {},
      experienceLevel: 'mid',
      computedAt: 1_700_000_000_000,
      skillsVersion: 1,
    },
  }
}

function buildCandidateStatusRecord(
  identityKey: string,
  status: CandidateStatusRecord['status']
): CandidateStatusRecord {
  return {
    _id: `status-${identityKey}`,
    identityKey,
    workspaceSlug: 'default',
    status,
    updatedAt: 1,
  }
}

function getDisplayedResumeNames(): string[] {
  const { result } = renderHook(() => useResumeListState())
  return result.current.displayedResumes.map((entry) => entry.resume.name)
}

describe('useResumeListState role filter regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    mockState.filters = {}
    mockState.sessionLocation = '广东'
    mockState.sessionKeywords = []
    mockState.sessionJobDescriptionId = undefined
    mockState.blocksByIdentity = {}
    mockState.statusByIdentity = {}
    mockState.urlParsedState = {
      location: undefined,
      keywords: [],
      jobDescriptionId: undefined,
      filters: {},
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
    }
    mockState.urlHasParams = false
    mockState.urlHasKeywordParam = false
    mockState.urlHasJobDescriptionParam = false

    mockState.convexResumes = [
      buildResume({
        id: 'resume-engineer-strong',
        name: 'Engineer Strong',
        roleSignals: [
          {
            type: 'engineer',
            matchedSignals: ['工程师'],
            signalCount: 3,
            occurrences: 3,
            years: 4,
            verifyIn: 'workHistory',
          },
        ],
      }),
      buildResume({
        id: 'resume-sales-only',
        name: 'Sales Only',
        roleSignals: [
          {
            type: 'sales',
            matchedSignals: ['销售'],
            signalCount: 4,
            occurrences: 4,
            years: 6,
            verifyIn: 'workHistory',
          },
        ],
      }),
      buildResume({
        id: 'resume-engineer-junior',
        name: 'Engineer Junior',
        roleSignals: [
          {
            type: 'engineer',
            matchedSignals: ['研发'],
            signalCount: 1,
            occurrences: 1,
            years: 1,
            verifyIn: 'workHistory',
          },
        ],
      }),
    ]
  })

  it('filters by minRoleYears + roleFilterType (engineer)', () => {
    mockState.filters = {
      minRoleYears: 2,
      roleFilterType: 'engineer',
    }

    expect(getDisplayedResumeNames()).toEqual(['Engineer Strong'])
  })

  it('falls back to legacy minSalesYears when minRoleYears is absent', () => {
    mockState.filters = {
      minSalesYears: 5,
    }

    expect(getDisplayedResumeNames()).toEqual(['Sales Only'])
  })

  it('hides blocked candidates by default', () => {
    mockState.blocksByIdentity = {
      'resume-sales-only': { identityKey: 'resume-sales-only' },
    }

    expect(getDisplayedResumeNames()).toEqual(['Engineer Strong', 'Engineer Junior'])
  })

  it('includes blocked candidates when showBlocked is enabled', () => {
    mockState.filters = {
      showBlocked: true,
    }
    mockState.blocksByIdentity = {
      'resume-sales-only': { identityKey: 'resume-sales-only' },
    }

    expect(getDisplayedResumeNames()).toEqual(['Engineer Strong', 'Sales Only', 'Engineer Junior'])
  })

  it('filters by interviewed_reject status', () => {
    mockState.filters = {
      status: ['interviewed_reject'],
    }
    mockState.statusByIdentity = {
      'resume-sales-only': buildCandidateStatusRecord('resume-sales-only', 'interviewed_reject'),
    }

    expect(getDisplayedResumeNames()).toEqual(['Sales Only'])
  })

  it('applies showBlocked together with interviewed_reject status filtering', () => {
    mockState.filters = {
      showBlocked: true,
      status: ['interviewed_reject'],
    }
    mockState.blocksByIdentity = {
      'resume-sales-only': { identityKey: 'resume-sales-only' },
    }
    mockState.statusByIdentity = {
      'resume-sales-only': buildCandidateStatusRecord('resume-sales-only', 'interviewed_reject'),
    }

    expect(getDisplayedResumeNames()).toEqual(['Sales Only'])
  })

  it('reset clears location instead of restoring the Guangdong default', () => {
    mockState.filters = {
      minRoleYears: 2,
      roleFilterType: 'engineer',
    }

    const { result } = renderHook(() => useResumeListState())

    act(() => {
      result.current.handleResetAll()
    })

    expect(mockState.setLocation).toHaveBeenCalledWith('')
    expect(mockState.setKeywords).toHaveBeenCalledWith([])
    expect(mockState.setFilters).toHaveBeenCalledWith({})
  })

  it('saves current search into explicit history', async () => {
    mockState.filters = {
      minRoleYears: 2,
      roleFilterType: 'engineer',
    }

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleSaveCurrentSearch()
    })

    expect(mockState.saveSearchHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '广东',
        location: '广东',
        keywords: [],
        filters: mockState.filters,
      })
    )
  })

  it('applies saved search history and updates opened timestamp', async () => {
    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleApplySearchHistory({
        id: 'history-1' as never,
        sessionKey: 'session-1',
        title: 'Saved search',
        location: '苏州',
        keywords: ['CNC', '销售'],
        jobDescriptionId: 'lathe-sales',
        filters: { minAge: 28 },
        selectedTags: ['STAR'],
        selectedCompanies: ['Acme'],
        selectedExperienceLevel: 'mid',
        createdAt: 1,
        lastOpenedAt: 2,
      })
    })

    expect(mockState.applyExternalState).toHaveBeenCalledWith({
      location: '苏州',
      keywords: ['CNC', '销售'],
      jobDescriptionId: 'lathe-sales',
      filters: { minAge: 28 },
    })
    expect(mockState.markSearchHistoryOpened).toHaveBeenCalledWith('history-1')
  })

  it('allows manual profile apply to bypass the URL hydration guard', () => {
    mockState.sessionLocation = ''
    mockState.urlParsedState = {
      location: '广东',
      keywords: ['CNC'],
      jobDescriptionId: undefined,
      filters: {},
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
    }
    mockState.urlHasParams = true
    mockState.urlHasKeywordParam = true

    const { result } = renderHook(() => useResumeListState())

    act(() => {
      result.current.handleQuickStartApply({
        location: '江苏',
        keywords: ['CNC', '销售'],
        filters: {
          minExperience: 1,
        },
      }, true)
    })

    expect(mockState.setLocation).toHaveBeenCalledTimes(1)
    const setLocationArg = mockState.setLocation.mock.calls[0]?.[0]
    expect(typeof setLocationArg).toBe('function')
    expect(setLocationArg('')).toBe('江苏')
    expect(mockState.setKeywords).toHaveBeenCalledWith(expect.any(Function))
    expect(mockState.setFilters).toHaveBeenCalledWith(expect.any(Function))
  })
})
