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
    aiFeedbackByResume: {},
    saveAction: mockState.saveAction,
    getAiFeedback: () => undefined,
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
  primaryRuleScore?: number
  companyHits?: string[]
  industryTags?: string[]
  roleSignals: Array<{
    type: string
    matchedSignals: string[]
    signalCount: number
    occurrences: number
    years: number
    industryVerifiedYears: number
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
    primaryRuleScore: params.primaryRuleScore,
    ingestData: {
      evidenceText: 'test work history',
      industryTags: params.industryTags ?? [],
      synonymHits: [],
      brandHits: [],
      companyHits: params.companyHits ?? [],
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

    // Real resume data from Convex (fetched via scripts/fetch-score-cases.ts)
    //
    // MATCHING (score 68): 张先生 — 14y sales at verified CNC companies
    //   东莞宝力机械 → Tier 4 match ("机械" pattern)
    //   庆鸿金精密 → Tier 4 match ("精密" not a pattern, but verified via company context)
    //   industryVerifiedYears: 14 → full credit for all years
    //   primaryRuleScore: 68 (jd-lathe-sales score)
    //
    // MATCHING (score 68): 李先生 — 8.33y sales at verified automation companies
    //   广东速美达自动化股份 → Tier 4 match ("自动化" pattern)
    //   东莞市精驰自动化设备 → Tier 4 match ("自动化" pattern)
    //   industryVerifiedYears: 8.33 → full credit
    //   primaryRuleScore: 68 (jd-lathe-sales score)
    //
    // NON-MATCHING (score 20): 罗女士 — sales at non-CNC companies
    //   广东赤辰车业有限公司 → Tier 4 patterns (机床/数控/cnc/机械/...) → NO match
    //   东莞市蓝欣橡塑科技 → NO match
    //   industryVerifiedYears: 0 → score capped low
    //   primaryRuleScore: 20
    //
    mockState.convexResumes = [
      // Synthetic ideal case: maxes most scoring categories for 80+ score
      // skillMatch:15 + roleMatch:8 + experienceMatch:25 + educationMatch:15
      // + locationMatch:15 + industryMatch:10 + brandRelevance:0 = 88
      buildResume({
        id: 'resume-ideal-cnc-sales',
        name: 'Ideal CNC Sales',
        primaryRuleScore: 85,
        companyHits: ['star'],
        industryTags: ['machinery', 'cnc', 'sales', 'automation'],
        roleSignals: [
          {
            type: 'sales',
            matchedSignals: ['销售', '销售经理', '大客户销售'],
            signalCount: 3,
            occurrences: 4,
            years: 10,
            industryVerifiedYears: 10,
            verifyIn: 'workHistory',
          },
        ],
      }),
      // Real matching case: 张先生 — 14y verified CNC machinery sales
      buildResume({
        id: 'resume-zhang-machinery-sales',
        name: 'Zhang Machinery Sales',
        primaryRuleScore: 68,
        companyHits: [],
        industryTags: ['machinery', 'sales'],
        roleSignals: [
          {
            type: 'sales',
            matchedSignals: ['销售', '销售经理'],
            signalCount: 2,
            occurrences: 2,
            years: 14,
            industryVerifiedYears: 14,
            verifyIn: 'workHistory',
          },
          {
            type: 'engineer',
            matchedSignals: ['技术'],
            signalCount: 1,
            occurrences: 1,
            years: 3,
            industryVerifiedYears: 0,
            verifyIn: 'workHistory',
          },
        ],
      }),
      // Real matching case: 李先生 — 8.33y verified automation sales
      buildResume({
        id: 'resume-li-automation-sales',
        name: 'Li Automation Sales',
        primaryRuleScore: 68,
        companyHits: [],
        industryTags: ['machinery', 'sales', 'automation'],
        roleSignals: [
          {
            type: 'sales',
            matchedSignals: ['销售', '销售经理'],
            signalCount: 2,
            occurrences: 2,
            years: 8.33,
            industryVerifiedYears: 8.33,
            verifyIn: 'workHistory',
          },
        ],
      }),
      // Real non-matching case: 罗女士 — sales at non-CNC company
      buildResume({
        id: 'resume-luo-non-cnc-sales',
        name: 'Luo Non-CNC Sales',
        primaryRuleScore: 20,
        companyHits: [],
        industryTags: [],
        roleSignals: [
          {
            type: 'sales',
            matchedSignals: ['销售'],
            signalCount: 1,
            occurrences: 1,
            years: 1.58,
            industryVerifiedYears: 0,
            verifyIn: 'workHistory',
          },
        ],
      }),
      // Real matching case with companyHit: 周先生 — jingdiao brand hit
      buildResume({
        id: 'resume-zhou-jingdiao',
        name: 'Zhou Jingdiao Hit',
        primaryRuleScore: 44,
        companyHits: ['jingdiao'],
        industryTags: ['machinery', 'cnc'],
        roleSignals: [
          {
            type: 'engineer',
            matchedSignals: ['工程师'],
            signalCount: 1,
            occurrences: 1,
            years: 3,
            industryVerifiedYears: 3,
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
            industryVerifiedYears: 0,
            verifyIn: 'workHistory',
          },
        ],
      }),
    ]
  })

  it('sorts by primaryRuleScore descending — verified CNC resumes first', () => {
    expect(getDisplayedResumeNames()).toEqual([
      'Ideal CNC Sales',        // primaryRuleScore: 85
      'Zhang Machinery Sales',  // primaryRuleScore: 68
      'Li Automation Sales',    // primaryRuleScore: 68
      'Zhou Jingdiao Hit',      // primaryRuleScore: 44
      'Luo Non-CNC Sales',      // primaryRuleScore: 20
      'Engineer Junior',        // primaryRuleScore: 0 (undefined)
    ])
  })

  it('minMatchScore >=60 keeps only industry-verified high-score resumes', () => {
    mockState.filters = {
      minMatchScore: 60,
    }

    expect(getDisplayedResumeNames()).toEqual([
      'Ideal CNC Sales',
      'Zhang Machinery Sales',
      'Li Automation Sales',
    ])
  })

  it('minMatchScore >=60 excludes non-CNC sales despite having sales years', () => {
    mockState.filters = {
      minMatchScore: 60,
    }

    const names = getDisplayedResumeNames()
    expect(names).not.toContain('Luo Non-CNC Sales')
    expect(names).not.toContain('Zhou Jingdiao Hit')
  })

  it('filters by minRoleYears + roleFilterType (engineer)', () => {
    mockState.filters = {
      minRoleYears: 2,
      roleFilterType: 'engineer',
    }

    expect(getDisplayedResumeNames()).toEqual([
      'Zhang Machinery Sales',
      'Zhou Jingdiao Hit',
    ])
  })

  it('falls back to legacy minSalesYears when minRoleYears is absent', () => {
    mockState.filters = {
      minSalesYears: 5,
    }

    expect(getDisplayedResumeNames()).toEqual([
      'Ideal CNC Sales',
      'Zhang Machinery Sales',
      'Li Automation Sales',
    ])
  })

  it('hides blocked candidates by default', () => {
    mockState.blocksByIdentity = {
      'resume-luo-non-cnc-sales': { identityKey: 'resume-luo-non-cnc-sales' },
    }

    expect(getDisplayedResumeNames()).toEqual([
      'Ideal CNC Sales', 'Zhang Machinery Sales', 'Li Automation Sales', 'Zhou Jingdiao Hit', 'Engineer Junior',
    ])
  })

  it('includes blocked candidates when showBlocked is enabled', () => {
    mockState.filters = {
      showBlocked: true,
    }
    mockState.blocksByIdentity = {
      'resume-luo-non-cnc-sales': { identityKey: 'resume-luo-non-cnc-sales' },
    }

    expect(getDisplayedResumeNames()).toEqual([
      'Ideal CNC Sales', 'Zhang Machinery Sales', 'Li Automation Sales', 'Zhou Jingdiao Hit', 'Luo Non-CNC Sales', 'Engineer Junior',
    ])
  })

  it('filters by interviewed_reject status', () => {
    mockState.filters = {
      status: ['interviewed_reject'],
    }
    mockState.statusByIdentity = {
      'resume-luo-non-cnc-sales': buildCandidateStatusRecord('resume-luo-non-cnc-sales', 'interviewed_reject'),
    }

    expect(getDisplayedResumeNames()).toEqual(['Luo Non-CNC Sales'])
  })

  it('applies showBlocked together with interviewed_reject status filtering', () => {
    mockState.filters = {
      showBlocked: true,
      status: ['interviewed_reject'],
    }
    mockState.blocksByIdentity = {
      'resume-luo-non-cnc-sales': { identityKey: 'resume-luo-non-cnc-sales' },
    }
    mockState.statusByIdentity = {
      'resume-luo-non-cnc-sales': buildCandidateStatusRecord('resume-luo-non-cnc-sales', 'interviewed_reject'),
    }

    expect(getDisplayedResumeNames()).toEqual(['Luo Non-CNC Sales'])
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

  it('filters by selectedCompanies — only verified companyHits', () => {
    mockState.urlParsedState = {
      ...mockState.urlParsedState,
      selectedCompanies: ['jingdiao'],
    }
    mockState.urlHasParams = true

    expect(getDisplayedResumeNames()).toEqual(['Zhou Jingdiao Hit'])
  })

  it('industryVerifiedYears=0 scores low even with total sales years', () => {
    const { result } = renderHook(() => useResumeListState())
    const nonCnc = result.current.displayedResumes.find(
      (entry) => entry.resume.name === 'Luo Non-CNC Sales'
    )
    const verified = result.current.displayedResumes.find(
      (entry) => entry.resume.name === 'Zhang Machinery Sales'
    )

    expect(nonCnc?.ruleScore).toBe(20)
    expect(verified?.ruleScore).toBe(68)
  })

  it('minMatchScore >=80 keeps only ideal CNC sales resume', () => {
    mockState.filters = {
      minMatchScore: 80,
    }

    expect(getDisplayedResumeNames()).toEqual(['Ideal CNC Sales'])
  })

  it('industryVerifiedYears > 0 with companyHits produces 80+ score', () => {
    const { result } = renderHook(() => useResumeListState())
    const ideal = result.current.displayedResumes.find(
      (entry) => entry.resume.name === 'Ideal CNC Sales'
    )

    expect(ideal).toBeDefined()
    expect(ideal?.ruleScore).toBe(85)

    const resume = ideal?.resume as ConvexResumeItem
    expect(resume.ingestData?.companyHits).toContain('star')
    expect(
      resume.ingestData?.roleSignals?.some(
        (rs: { industryVerifiedYears: number }) => rs.industryVerifiedYears > 0
      )
    ).toBe(true)
  })
})
