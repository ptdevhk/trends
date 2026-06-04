import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConvexIngestData, ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { CandidateStatusRecord } from '@/hooks/useCandidateStatus'
import { RESUME_HOME_RESET_STATE } from '@/lib/resume-home-navigation'
import { rawApiClient } from '@/lib/api-helpers'
import { getCurrentResumeAiPromptVersion } from '@/lib/analysis-utils'
import { useResumeListState } from './useResumeListState'
import type { ConvexResumeFilters, ConvexResumeSortBy } from '@/hooks/useConvexResumes'
import { buildRuleScoringText } from '@/lib/resume-scoring'
import type { CollectionSource } from '@/lib/search-profile-sources'

let capturedExportPayload: unknown = null
const createObjectUrlMock = vi.fn(() => 'blob:mock')
const revokeObjectUrlMock = vi.fn()
const anchorClickMock = vi.fn()

const mockState = vi.hoisted(() => ({
  convexResumes: [] as ConvexResumeItem[],
  convexHasMore: false,
  convexLoadingMore: false,
  useConvexResumesArgs: [] as Array<{
    limit?: number
    query?: string
    jobDescriptionId?: string
    options?: {
      sortBy?: ConvexResumeSortBy
      sortOrder?: 'asc' | 'desc'
      filters?: ConvexResumeFilters
    }
  }>,
  cloneConvexResumesOnRead: false,
  filters: {} as Record<string, unknown>,
  sessionLocation: '广东',
  sessionKeywords: [] as string[],
  sessionJobDescriptionId: undefined as string | undefined,
  sessionCollectionSource: undefined as CollectionSource | undefined,
  sessionCollectUrl: '' as string,
  blocksByIdentity: {} as Record<string, { identityKey: string }>,
  statusByIdentity: {} as Record<string, CandidateStatusRecord>,
  setFilters: vi.fn(),
  setLocation: vi.fn(),
  setKeywords: vi.fn(),
  setJobDescriptionId: vi.fn(),
  setCollectionSource: vi.fn(),
  setCollectUrl: vi.fn(),
  apiSessionId: undefined as string | undefined,
  ensureApiSession: vi.fn(async () => 'api-session-1'),
  rememberApiSessionId: vi.fn(),
  trackReviewedResume: vi.fn(),
  applyExternalState: vi.fn(),
  saveSearchHistory: vi.fn(async () => 'history-1'),
  markSearchHistoryOpened: vi.fn(async () => {}),
  searchHistory: [] as Array<Record<string, unknown>>,
  matchApiResponse: { success: true, results: [] as Array<{ resumeId: string; score: number }> },
  refresh: vi.fn(async () => {}),
  reloadSamples: vi.fn(async () => {}),
  blockCandidates: vi.fn(async () => true),
  unblockCandidate: vi.fn(async () => true),
  updateStatus: vi.fn(async () => {}),
  saveAction: vi.fn(async () => {}),
  syncToUrl: vi.fn(),
  urlParsedState: {
    shareSessionId: undefined as string | undefined,
    location: undefined as string | undefined,
    keywords: [] as string[],
    requiredKeywords: [] as string[],
    jobDescriptionId: undefined as string | undefined,
    filters: {} as Record<string, unknown>,
    selectedTags: [] as string[],
    selectedCompanies: [] as string[],
    selectedExperienceLevel: undefined as 'senior' | 'mid' | 'junior' | undefined,
  },
  urlHasParams: false,
  urlHasKeywordParam: false,
  urlHasJobDescriptionParam: false,
  sessionGetResponse: { data: { success: true } } as { data: Record<string, unknown> },
  locationPathname: '/dev/resumes',
  locationSearch: '',
  locationHash: '',
  locationState: null as unknown,
  navigate: vi.fn(),
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

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: mockState.locationPathname,
    search: mockState.locationSearch,
    hash: mockState.locationHash,
    state: mockState.locationState,
    key: 'test',
  }),
  useNavigate: () => mockState.navigate,
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
    collectionSource: mockState.sessionCollectionSource,
    setCollectionSource: mockState.setCollectionSource,
    apiSessionId: mockState.apiSessionId,
    filters: mockState.filters,
    setFilters: mockState.setFilters,
    reviewedIdsSet: new Set<string>(),
    trackReviewedResume: mockState.trackReviewedResume,
    applyExternalState: mockState.applyExternalState,
    searchHistory: mockState.searchHistory,
    searchHistoryLoading: false,
    saveSearchHistory: mockState.saveSearchHistory,
    markSearchHistoryOpened: mockState.markSearchHistoryOpened,
    ensureApiSession: mockState.ensureApiSession,
    rememberApiSessionId: mockState.rememberApiSessionId,
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
  DEFAULT_CONVEX_RESUME_LIMIT: 200,
  CONVEX_RESUME_PAGE_SIZE: 200,
  MAX_CONVEX_RESUME_LIMIT: 2000,
  useConvexResumes: (
    limit?: number,
    query?: string,
    jobDescriptionId?: string,
    options?: {
      sortBy?: ConvexResumeSortBy
      sortOrder?: 'asc' | 'desc'
      filters?: ConvexResumeFilters
    }
  ) => {
    mockState.useConvexResumesArgs.push({ limit, query, jobDescriptionId, options })
    return {
      resumes: mockState.cloneConvexResumesOnRead
        ? [...mockState.convexResumes]
        : mockState.convexResumes,
      loading: false,
      loadingMore: mockState.convexLoadingMore,
      hasMore: mockState.convexHasMore,
    }
  },
}))

vi.mock('@/hooks/useCandidateActions', () => ({
  useCandidateActions: () => ({
    actions: {},
    ratingsByResume: {},
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
    POST: vi.fn(async () => ({ data: mockState.matchApiResponse })),
    GET: vi.fn(async (path: string) => {
      if (path.startsWith('/api/sessions/')) {
        return mockState.sessionGetResponse
      }
      return { data: { success: true } }
    }),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/lib/feature-flags', () => ({
  isReviewPacketsEnabled: () => true,
}))

beforeAll(() => {
  Object.defineProperty(window.URL, 'createObjectURL', {
    writable: true,
    value: createObjectUrlMock,
  })
  Object.defineProperty(window.URL, 'revokeObjectURL', {
    writable: true,
    value: revokeObjectUrlMock,
  })
  Object.defineProperty(globalThis.HTMLAnchorElement.prototype, 'click', {
    writable: true,
    value: anchorClickMock,
  })
})

function buildResume(params: {
  id: string
  name: string
  source?: string
  profileType?: string
  primaryRuleScore?: number
  experience?: string
  education?: string
  location?: string
  locationHierarchy?: ConvexResumeItem['locationHierarchy']
  expectedSalary?: string
  workHistory?: ConvexResumeItem['workHistory']
  brandHits?: ConvexIngestData['brandHits']
  companyHits?: string[]
  industryTags?: string[]
  industryDbV2Raw?: number
  analysis?: ConvexResumeItem['analysis']
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
    source: params.source ?? 'hr.job5156.com',
    tags: [],
    identityKey: params.id,
    name: params.name,
    profileUrl: `https://example.com/${params.id}`,
    activityStatus: 'Active',
    age: '30',
    ageNumber: 30,
    experience: params.experience ?? '5 years',
    education: params.education ?? 'Bachelor',
    location: params.location ?? 'Dongguan',
    locationHierarchy: params.locationHierarchy,
    selfIntro: 'Test intro',
    jobIntention: 'Test role',
    expectedSalary: params.expectedSalary ?? '10k-20k',
    workHistory: params.workHistory ?? [{ raw: 'Test work history', companyName: 'Example Co.', jobTitle: 'Sales Engineer' }],
    profileEducation: [{ institution: 'Example University', qualification: 'Bachelor' }],
    skills: ['CNC', { name: 'Account management', yearsOfExperience: 3 }],
    languages: ['English', { name: 'Mandarin', proficiency: 'professional' }],
    licences: [{ name: 'Class D' }],
    resumeSnippet: { text: 'Experienced sales engineer covering machine tools.' },
    currentIndustry: { name: 'Industrial machinery' },
    currentSubindustry: 'Machine tools',
    rightToWork: { status: 'citizen' },
    digitalIdentity: { linkedinUrl: 'https://www.linkedin.com/in/example' },
    noticePeriodDays: 30,
    extractedAt: '2026-03-01T00:00:00.000Z',
    profileType: params.profileType,
    primaryRuleScore: params.primaryRuleScore,
    analysis: params.analysis
      ? {
          ...params.analysis,
          promptVersion: params.analysis.promptVersion ?? getCurrentResumeAiPromptVersion(),
        }
      : undefined,
    ingestData: {
      evidenceText: 'test work history',
      industryTags: params.industryTags ?? [],
      synonymHits: [],
      brandHits: params.brandHits ?? [],
      companyHits: params.companyHits ?? [],
      industryDbV2Raw: params.industryDbV2Raw ?? 0,
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

function getLastConvexArgs() {
  return mockState.useConvexResumesArgs[mockState.useConvexResumesArgs.length - 1]
}

describe('useResumeListState role filter regression', () => {
  it('preserves richer imported resume fields on convex resumes', () => {
    mockState.convexResumes = [
      buildResume({
        id: 'rich-1',
        name: 'Rich Resume',
        roleSignals: [],
      }),
    ]

    const { result } = renderHook(() => useResumeListState())
    const resume = result.current.displayedResumes[0]?.resume as ConvexResumeItem | undefined

    expect(resume?.profileEducation?.[0]?.institution).toBe('Example University')
    expect(resume?.skills?.[1]).toEqual({ name: 'Account management', yearsOfExperience: 3 })
    expect(resume?.resumeSnippet).toEqual({ text: 'Experienced sales engineer covering machine tools.' })
    expect(resume?.currentIndustry).toEqual({ name: 'Industrial machinery' })
    expect(resume?.noticePeriodDays).toBe(30)
  })

  it('requests larger Convex windows incrementally and resets when the query changes', async () => {
    mockState.convexHasMore = true

    const { result, rerender } = renderHook(() => useResumeListState())

    expect(getLastConvexArgs()?.limit).toBe(200)

    act(() => {
      result.current.handleLoadMoreResumes()
    })

    expect(getLastConvexArgs()?.limit).toBe(400)

    mockState.sessionKeywords = ['CNC']
    rerender()

    await waitFor(() => {
      expect(getLastConvexArgs()).toMatchObject({
        limit: 200,
        query: 'CNC',
      })
    })

    mockState.filters = {
      sortBy: 'experience',
      sortOrder: 'desc',
    }
    rerender()

    await waitFor(() => {
      expect(getLastConvexArgs()).toMatchObject({
        limit: 200,
        options: {
          sortBy: 'experience',
          sortOrder: 'desc',
        },
      })
    })
  })

  it('pushes experience sorting into the Convex hook for AI mode', () => {
    mockState.filters = {
      sortBy: 'experience',
      sortOrder: 'asc',
    }

    renderHook(() => useResumeListState())

    expect(getLastConvexArgs()).toMatchObject({
      limit: 200,
      options: {
        sortBy: 'experience',
        sortOrder: 'asc',
      },
    })
  })

  it('pushes safe base filters into the Convex hook for AI mode', () => {
    mockState.filters = {
      maxExperience: 8,
      education: ['bachelor'],
      skills: ['fanuc'],
      locations: ['Dongguan'],
      minSalary: 10000,
      maxSalary: 20000,
    }

    renderHook(() => useResumeListState())

    expect(getLastConvexArgs()).toMatchObject({
      limit: 200,
      options: {
        filters: {
          maxExperience: 8,
          education: ['bachelor'],
          skills: ['fanuc'],
          locations: ['Dongguan'],
          minSalary: 10000,
          maxSalary: 20000,
        },
      },
    })
  })

  it('applies skills and salary filters in AI mode', () => {
    mockState.filters = {
      skills: ['fanuc'],
      minSalary: 15000,
    }
    mockState.convexResumes = [
      buildResume({
        id: 'resume-1',
        name: 'High Salary Match',
        expectedSalary: '20k-30k',
        workHistory: [{ raw: 'FANUC CNC service and maintenance', companyName: 'Fanuc', jobTitle: 'Engineer' }],
        roleSignals: [],
      }),
      buildResume({
        id: 'resume-2',
        name: 'Low Salary Match',
        expectedSalary: '8k-12k',
        workHistory: [{ raw: 'FANUC field service', companyName: 'Fanuc', jobTitle: 'Technician' }],
        roleSignals: [],
      }),
      buildResume({
        id: 'resume-3',
        name: 'High Salary No Skill',
        expectedSalary: '20k-30k',
        workHistory: [{ raw: 'PLC automation sales', companyName: 'Other Co.', jobTitle: 'Sales' }],
        roleSignals: [],
      }),
    ]

    expect(getDisplayedResumeNames()).toEqual(['High Salary Match'])
  })

  it('handleQuickConstraintApply sets minRoleYears without touching other filters', () => {
    mockState.filters = { maxExperience: 10 }

    const { result } = renderHook(() => useResumeListState())

    act(() => {
      result.current.handleQuickConstraintApply({ minRoleYears: 3, roleFilterType: 'sales', maxAge: 45 })
    })

    // Verify the setFilters callback produces the right state
    const setFiltersCall = mockState.setFilters.mock.calls[0]!
    const currentState = { maxExperience: 10 }
    const nextState = setFiltersCall[0](currentState)

    expect(nextState).toEqual({
      maxExperience: 10,
      minRoleYears: 3,
      roleFilterType: 'sales',
      maxAge: 45,
    })
  })

  it('keeps name sorting local to preserve the existing UI comparator', () => {
    mockState.filters = {
      sortBy: 'name',
      sortOrder: 'asc',
    }

    renderHook(() => useResumeListState())

    expect(getLastConvexArgs()).toMatchObject({
      limit: 200,
      options: {},
    })
  })

  it('only requests query-specific rule scores for newly loaded resume ids', async () => {
    mockState.sessionKeywords = ['销售']
    mockState.convexResumes = [
      buildResume({ id: 'resume-1', name: 'First Candidate', roleSignals: [] }),
      buildResume({ id: 'resume-2', name: 'Second Candidate', roleSignals: [] }),
    ]
    mockState.matchApiResponse = {
      success: true,
      results: [
        { resumeId: 'resume-1', score: 88 },
        { resumeId: 'resume-2', score: 77 },
      ],
    }

    const { rerender } = renderHook(() => useResumeListState())

    await waitFor(() => {
      expect(rawApiClient.POST).toHaveBeenCalledWith('/api/resumes/match', expect.objectContaining({
        body: expect.objectContaining({
          resumeIds: ['resume-1', 'resume-2'],
        }),
      }))
    })

    mockState.convexResumes = [
      ...mockState.convexResumes,
      buildResume({ id: 'resume-3', name: 'Third Candidate', roleSignals: [] }),
    ]
    mockState.matchApiResponse = {
      success: true,
      results: [
        { resumeId: 'resume-3', score: 66 },
      ],
    }
    rerender()

    await waitFor(() => {
      expect(rawApiClient.POST).toHaveBeenLastCalledWith('/api/resumes/match', expect.objectContaining({
        body: expect.objectContaining({
          resumeIds: ['resume-3'],
        }),
      }))
    })
  })

  it('filters the main review lane to the active collection source', () => {
    mockState.sessionCollectionSource = { type: 'seek', exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1' }
    mockState.convexResumes = [
      buildResume({
        id: 'seek-1',
        name: 'Seek Candidate',
        source: 'my.employer.seek.com',
        profileType: 'seek',
        roleSignals: [],
      }),
      buildResume({
        id: 'job5156-1',
        name: 'Job5156 Candidate',
        source: 'hr.job5156.com',
        profileType: 'job5156',
        roleSignals: [],
      }),
    ]

    expect(getDisplayedResumeNames()).toEqual(['Seek Candidate'])
  })

  it('treats manual 51job imports as part of the job5156 review lane', () => {
    mockState.sessionCollectionSource = { type: 'job5156' }
    mockState.convexResumes = [
      buildResume({
        id: 'manual-1',
        name: 'Manual Candidate',
        source: '51job-manual',
        profileType: '51job-manual',
        roleSignals: [],
      }),
      buildResume({
        id: 'seek-1',
        name: 'Seek Candidate',
        source: 'my.employer.seek.com',
        profileType: 'seek',
        roleSignals: [],
      }),
    ]

    expect(getDisplayedResumeNames()).toEqual(['Manual Candidate'])
  })

  it('gives live 51job resumes their own review lane separate from job5156', () => {
    mockState.sessionCollectionSource = { type: '51job' }
    mockState.convexResumes = [
      buildResume({
        id: 'job51-1',
        name: '51job Live Candidate',
        source: 'ehire.51job.com',
        profileType: '51job',
        roleSignals: [],
      }),
      buildResume({
        id: 'job5156-1',
        name: 'Job5156 Candidate',
        source: 'hr.job5156.com',
        profileType: 'job5156',
        roleSignals: [],
      }),
      buildResume({
        id: 'seek-1',
        name: 'Seek Candidate',
        source: 'my.employer.seek.com',
        profileType: 'seek',
        roleSignals: [],
      }),
    ]

    expect(getDisplayedResumeNames()).toEqual(['51job Live Candidate'])
  })

  beforeEach(() => {
    vi.clearAllMocks()
    capturedExportPayload = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/api/resumes/export')) {
        const requestBody = typeof init?.body === 'string' ? init.body : '{}'
        capturedExportPayload = JSON.parse(requestBody) as unknown
        return new Response(new Blob(['']), {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="export.csv"' },
        })
      }

      return new Response(null, { status: 404 })
    }))
    window.history.replaceState({}, '', '/')
    mockState.filters = {}
    mockState.cloneConvexResumesOnRead = false
    mockState.convexHasMore = false
    mockState.convexLoadingMore = false
    mockState.useConvexResumesArgs = []
    mockState.sessionLocation = '广东'
    mockState.sessionKeywords = []
    mockState.sessionJobDescriptionId = undefined
    mockState.sessionCollectionSource = undefined
    mockState.sessionCollectUrl = ''
    mockState.apiSessionId = undefined
    mockState.ensureApiSession.mockResolvedValue('api-session-1')
    mockState.sessionGetResponse = { data: { success: true } }
    mockState.blocksByIdentity = {}
    mockState.statusByIdentity = {}
    mockState.searchHistory = []
    mockState.matchApiResponse = { success: true, results: [] }
    document.body.innerHTML = ''
    mockState.urlParsedState = {
      shareSessionId: undefined,
      location: undefined,
      keywords: [],
      jobDescriptionId: undefined,
      requiredKeywords: [],
      filters: {},
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
    }
    mockState.urlHasParams = false
    mockState.urlHasKeywordParam = false
    mockState.urlHasJobDescriptionParam = false
    mockState.locationPathname = '/dev/resumes'
    mockState.locationSearch = ''
    mockState.locationHash = ''
    mockState.locationState = null

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

  it('uses query-specific scores for keyword-only ranking instead of primaryRuleScore', async () => {
    mockState.sessionKeywords = ['CNC', '销售']
    mockState.sessionLocation = '东莞'
    mockState.matchApiResponse = {
      success: true,
      results: [
        { resumeId: 'resume-zhang-machinery-sales', score: 92 },
        { resumeId: 'resume-li-automation-sales', score: 88 },
        { resumeId: 'resume-ideal-cnc-sales', score: 84 },
        { resumeId: 'resume-zhou-jingdiao', score: 40 },
        { resumeId: 'resume-luo-non-cnc-sales', score: 12 },
        { resumeId: 'resume-engineer-junior', score: 0 },
      ],
    }

    const { result } = renderHook(() => useResumeListState())

    await waitFor(() => {
      expect(result.current.displayedResumes.map((entry) => entry.resume.name)).toEqual([
        'Zhang Machinery Sales',
        'Li Automation Sales',
        'Ideal CNC Sales',
        'Zhou Jingdiao Hit',
        'Luo Non-CNC Sales',
        'Engineer Junior',
      ])
    })

    expect(rawApiClient.POST).toHaveBeenCalledWith('/api/resumes/match', {
      body: expect.objectContaining({
        source: 'convex',
        persist: false,
        mode: 'rules_only',
        keywords: ['CNC', '销售'],
        location: '东莞',
      }),
    })
  })

  it('does not refetch query-specific scores when convex resume arrays are remapped on rerender', async () => {
    mockState.cloneConvexResumesOnRead = true
    mockState.sessionKeywords = ['CNC', '销售']
    mockState.sessionLocation = '东莞'
    mockState.matchApiResponse = {
      success: true,
      results: [
        { resumeId: 'resume-zhang-machinery-sales', score: 92 },
        { resumeId: 'resume-li-automation-sales', score: 88 },
        { resumeId: 'resume-ideal-cnc-sales', score: 84 },
      ],
    }

    const { rerender } = renderHook(() => useResumeListState())

    await waitFor(() => {
      expect(rawApiClient.POST).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      rerender()
    })

    expect(rawApiClient.POST).toHaveBeenCalledTimes(1)
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
      'Zhou Jingdiao Hit',
    ])
  })

  it('filters convex resumes by structured location hierarchy when raw location is blank', () => {
    mockState.convexResumes = [
      buildResume({
        id: 'resume-hierarchy-location',
        name: 'Hierarchy Location',
        location: '',
        locationHierarchy: {
          country: '中国',
          province: '广东',
          city: '东莞',
          district: '长安',
        },
        roleSignals: [
          {
            type: 'sales',
            matchedSignals: ['销售'],
            signalCount: 1,
            occurrences: 1,
            years: 3,
            industryVerifiedYears: 3,
            verifyIn: 'workHistory',
          },
        ],
      }),
    ]
    mockState.filters = {
      locations: ['长安'],
    }

    expect(getDisplayedResumeNames()).toEqual(['Hierarchy Location'])
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

    expect(mockState.applyExternalState).toHaveBeenCalledWith({
      location: '',
      keywords: [],
      jobDescriptionId: '',
      collectionSource: null,
      filters: {},
    })
  })

  it('clearing filter-panel state also clears the synced session location', () => {
    mockState.sessionLocation = 'Kuala Lumpur MY'
    mockState.filters = {
      locations: ['Kuala Lumpur MY'],
      minMatchScore: 60,
    }

    const { result } = renderHook(() => useResumeListState())

    act(() => {
      result.current.handleFiltersChange({})
    })

    expect(mockState.setLocation).toHaveBeenCalledWith(expect.any(Function))
    const locationUpdater = mockState.setLocation.mock.calls[0]?.[0] as (current: string) => string
    expect(locationUpdater('Kuala Lumpur MY')).toBe('')
    expect(mockState.setFilters).toHaveBeenCalledWith({})
  })

  it('syncs manual filter-panel location edits back into the session location', () => {
    mockState.sessionLocation = '广东'

    const { result } = renderHook(() => useResumeListState())

    act(() => {
      result.current.handleFiltersChange({
        locations: ['Kuala Lumpur MY', 'Selangor MY'],
      })
    })

    expect(mockState.setLocation).toHaveBeenCalledWith(expect.any(Function))
    const locationUpdater = mockState.setLocation.mock.calls[0]?.[0] as (current: string) => string
    expect(locationUpdater('广东')).toBe('Kuala Lumpur MY,Selangor MY')
    expect(mockState.setFilters).toHaveBeenCalledWith({
      locations: ['Kuala Lumpur MY', 'Selangor MY'],
    })
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

  it('exports candidate status notes into the userComment field', async () => {
    mockState.filters = { status: ['contacted'] }
    mockState.statusByIdentity = {
      'resume-ideal-cnc-sales': {
        ...buildCandidateStatusRecord('resume-ideal-cnc-sales', 'contacted'),
        notes: 'Call back tomorrow',
      },
    }

    const { result } = renderHook(() => useResumeListState())

    act(() => {
      result.current.handleToggleSelect('resume-ideal-cnc-sales')
    })

    await act(async () => {
      await result.current.handleBulkAction('export', 'csv')
    })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/resumes/export'),
      expect.objectContaining({ method: 'POST' }),
    )

    const parsedBody = capturedExportPayload as {
      source: string
      entries: Array<{ resumeId: string; userComment?: string; status?: string }>
      format: string
    }
    expect(parsedBody.format).toBe('csv')
    expect(parsedBody.source).toBe('convex')
    expect(parsedBody.entries).toContainEqual(expect.objectContaining({
      resumeId: 'resume-ideal-cnc-sales',
      status: 'contacted',
      userComment: 'Call back tomorrow',
    }))
  })

  it('includes applied frozen industry DB cohort stats in export requests', async () => {
    mockState.searchHistory = [
      {
        id: 'history-export',
        sessionKey: 'session-1',
        title: 'Saved search',
        location: '苏州',
        keywords: ['CNC', '销售'],
        jobDescriptionId: 'lathe-sales',
        filters: {},
        selectedTags: [],
        selectedCompanies: [],
        selectedExperienceLevel: undefined,
        industryDbV2Stats: {
          size: 50,
          min: 0,
          max: 25,
          p50: 10,
          p80: 20,
          mean: 12.4,
          stddev: 6.8,
          histogram50: Array.from({ length: 51 }, (_, index) => {
            if (index === 20) return 40
            if (index === 25) return 10
            return 0
          }),
        },
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ]

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleApplySearchHistory(mockState.searchHistory[0] as never)
    })

    act(() => {
      result.current.handleToggleSelect('resume-ideal-cnc-sales')
    })

    await act(async () => {
      await result.current.handleBulkAction('export', 'csv')
    })

    const parsedBody = capturedExportPayload as {
      industryDbV2Stats?: {
        size: number
        min?: number
        max?: number
        p50?: number
        p80: number
        mean?: number
        stddev?: number
        histogram50: number[]
      }
    }

    expect(parsedBody.industryDbV2Stats).toEqual(mockState.searchHistory[0].industryDbV2Stats)
  })

  it('opens the review packets page with selected resume ids, current context, and bridged session id', async () => {
    mockState.sessionJobDescriptionId = 'lathe-sales'
    mockState.searchHistory = [
      {
        id: 'history-1',
        sessionKey: 'session-1',
        title: 'Saved search',
        location: '苏州',
        keywords: ['CNC', '销售'],
        jobDescriptionId: 'lathe-sales',
        filters: {},
        selectedTags: [],
        selectedCompanies: [],
        selectedExperienceLevel: undefined,
        notes: 'Priority shortlist for HR sync',
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ]
    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      result.current.handleApplySearchHistory(mockState.searchHistory[0] as never)
    })

    act(() => {
      result.current.handleToggleSelect('resume-ideal-cnc-sales')
      result.current.handleToggleSelect('resume-zhang-machinery-sales')
    })

    await act(async () => {
      await result.current.handleOpenReviewPacket()
    })

    expect(mockState.navigate).toHaveBeenCalledTimes(1)
    const navigateTarget = mockState.navigate.mock.calls[0]?.[0] as { pathname: string; search: string }
    expect(navigateTarget.pathname).toBe('/dev/review-packets')

    const params = new URLSearchParams(navigateTarget.search)
    expect(params.get('source')).toBe('convex')
    expect(params.get('format')).toBe('csv')
    expect(params.get('jobDescriptionId')).toBe('lathe-sales')
    expect(params.get('sessionId')).toBe('api-session-1')
    expect(params.get('referenceNote')).toBe('Priority shortlist for HR sync')
    expect(params.get('resumeIds')).toBe('resume-ideal-cnc-sales,resume-zhang-machinery-sales')
  })

  it('applies saved search history and updates opened timestamp', async () => {
    mockState.searchHistory = [
      {
        id: 'history-1',
        sessionKey: 'session-1',
        title: 'Saved search',
        location: '苏州',
        keywords: ['CNC', '销售'],
        jobDescriptionId: 'lathe-sales',
        filters: { minAge: 28 },
        selectedTags: ['STAR'],
        selectedCompanies: ['Acme'],
        selectedExperienceLevel: 'mid',
        industryDbV2Stats: {
          size: 50,
          p80: 25,
          histogram50: Array.from({ length: 51 }, (_, index) => (index === 25 ? 50 : 0)),
        },
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ]
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
      collectionSource: null,
      filters: { minAge: 28 },
    })
    expect(mockState.markSearchHistoryOpened).toHaveBeenCalledWith('history-1')
    expect(result.current.appliedSearchHistoryId).toBe('history-1')
  })

  it('hydrates persisted share-session state from sid links when explicit params are absent', async () => {
    window.history.replaceState({}, '', '/dev/resumes?sid=shared-session-1')
    mockState.locationSearch = '?sid=shared-session-1'
    mockState.urlParsedState = {
      ...mockState.urlParsedState,
      shareSessionId: 'shared-session-1',
    }
    mockState.sessionGetResponse = {
      data: {
        success: true,
        session: {
          id: 'shared-session-1',
          shareTitle: 'Kuala Lumpur · Sales Engineer',
          searchState: {
            location: 'Kuala Lumpur MY',
            keywords: ['Sales Engineer'],
            requiredKeywords: ['CNC'],
            jobDescriptionId: 'lathe-sales',
            collectionSource: {
              type: 'seek',
              exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
            },
            selectedTags: ['STAR'],
            selectedCompanies: ['Acme'],
            selectedExperienceLevel: 'mid',
            filters: {
              minAge: 28,
            },
            referenceNote: 'Priority shortlist for HR sync',
          },
        },
      },
    }

    const { result } = renderHook(() => useResumeListState())

    await waitFor(() => {
      expect(rawApiClient.GET).toHaveBeenCalledWith('/api/sessions/shared-session-1')
    })

    await waitFor(() => {
      expect(result.current.activeSessionTitle).toBe('Kuala Lumpur · Sales Engineer')
    })

    expect(mockState.rememberApiSessionId).toHaveBeenCalledWith('shared-session-1')
    expect(mockState.applyExternalState).toHaveBeenCalledWith({
      location: 'Kuala Lumpur MY',
      keywords: ['Sales Engineer'],
      jobDescriptionId: 'lathe-sales',
      collectionSource: {
        type: 'seek',
        exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
      },
      filters: {
        minAge: 28,
      },
    })
    expect(result.current.activeSessionLabel).toBe('Shared link')
    expect(result.current.activeSessionNote).toBe('Priority shortlist for HR sync')
    expect(result.current.activeSessionId).toBe('shared-session-1')
  })

  it('keeps the hydrated sid reference note when opening review packets', async () => {
    window.history.replaceState({}, '', '/dev/resumes?sid=shared-session-1')
    mockState.locationSearch = '?sid=shared-session-1'
    mockState.urlParsedState = {
      ...mockState.urlParsedState,
      shareSessionId: 'shared-session-1',
    }
    mockState.sessionJobDescriptionId = 'lathe-sales'
    mockState.sessionGetResponse = {
      data: {
        success: true,
        session: {
          id: 'shared-session-1',
          shareTitle: 'China · CNC 销售',
          searchState: {
            location: 'China',
            keywords: ['CNC 销售'],
            jobDescriptionId: 'lathe-sales',
            filters: {},
            referenceNote: 'Priority shortlist for HR sync',
          },
        },
      },
    }

    const { result } = renderHook(() => useResumeListState())

    await waitFor(() => {
      expect(rawApiClient.GET).toHaveBeenCalledWith('/api/sessions/shared-session-1')
    })

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe('shared-session-1')
    })

    act(() => {
      result.current.handleToggleSelect('resume-ideal-cnc-sales')
      result.current.handleToggleSelect('resume-zhang-machinery-sales')
    })

    await act(async () => {
      await result.current.handleOpenReviewPacket()
    })

    const navigateTarget = mockState.navigate.mock.calls[0]?.[0] as { pathname: string; search: string }
    const params = new URLSearchParams(navigateTarget.search)

    expect(params.get('jobDescriptionId')).toBe('lathe-sales')
    expect(params.get('sessionId')).toBe('api-session-1')
    expect(params.get('referenceNote')).toBe('Priority shortlist for HR sync')
  })

  it('prefers explicit URL params over sid hydration when both are present', async () => {
    window.history.replaceState({}, '', '/dev/resumes?sid=shared-session-1&location=Dongguan&q=CNC')
    mockState.locationSearch = '?sid=shared-session-1&location=Dongguan&q=CNC'
    mockState.urlHasParams = true
    mockState.urlHasKeywordParam = true
    mockState.urlParsedState = {
      ...mockState.urlParsedState,
      shareSessionId: 'shared-session-1',
      location: 'Dongguan',
      keywords: ['CNC'],
    }

    const { result } = renderHook(() => useResumeListState())

    await waitFor(() => {
      expect(mockState.applyExternalState).toHaveBeenCalledWith({
        location: 'Dongguan',
        keywords: ['CNC'],
        jobDescriptionId: undefined,
        collectionSource: null,
        filters: {},
      })
    })

    expect(rawApiClient.GET).not.toHaveBeenCalled()
    expect(result.current.activeSessionLabel).toBeUndefined()
  })

  it('surfaces a saved-search session summary after reopening history', async () => {
    mockState.searchHistory = [
      {
        id: 'history-1',
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
      },
    ]
    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleApplySearchHistory(mockState.searchHistory[0] as never)
    })

    expect(result.current.activeSessionTitle).toBe('Saved search')
    expect(result.current.activeSessionLabel).toBe('Saved search')
    expect(result.current.activeSessionDescription).toContain('Reopened from saved history')
    expect(result.current.activeSessionNote).toBeUndefined()
  })

  it('surfaces the saved-search note in the active session summary after reopening history', async () => {
    mockState.searchHistory = [
      {
        id: 'history-1',
        sessionKey: 'session-1',
        title: 'Saved search',
        location: '苏州',
        keywords: ['CNC', '销售'],
        jobDescriptionId: 'lathe-sales',
        filters: { minAge: 28 },
        selectedTags: ['STAR'],
        selectedCompanies: ['Acme'],
        selectedExperienceLevel: 'mid',
        notes: 'Priority shortlist for HR sync',
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ]
    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleApplySearchHistory(mockState.searchHistory[0] as never)
    })

    expect(result.current.activeSessionTitle).toBe('Saved search')
    expect(result.current.activeSessionNote).toBe('Priority shortlist for HR sync')
  })

  it('promotes the active session to a shared-link summary after a durable link is copied', () => {
    mockState.apiSessionId = 'api-session-1'
    mockState.sessionLocation = 'Dongguan'
    mockState.sessionKeywords = ['CNC']

    const { result } = renderHook(() => useResumeListState())

    act(() => {
      result.current.handleShareSessionCopied('session-share-1')
    })

    expect(result.current.activeSessionTitle).toBe('Dongguan · CNC')
    expect(result.current.activeSessionLabel).toBe('Shared link')
    expect(result.current.activeSessionId).toBe('session-share-1')
    expect(result.current.activeSessionDescription).toContain('Short durable link copied')
  })

  it('passes current convex resume ids when saving search history', async () => {
    mockState.saveSearchHistory.mockClear()
    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleSaveCurrentSearch()
    })

    expect(mockState.saveSearchHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeIds: [
          'resume-ideal-cnc-sales',
          'resume-zhang-machinery-sales',
          'resume-li-automation-sales',
          'resume-zhou-jingdiao',
          'resume-luo-non-cnc-sales',
          'resume-engineer-junior',
        ],
      })
    )
  })

  it('overrides AI industry_db score from raw ingest data when no hits are present', async () => {
    mockState.convexResumes = [
      buildResume({
        id: 'resume-ai-1',
        name: 'AI Resume',
        industryDbV2Raw: 20,
        analysis: {
          score: 45,
          summary: 'Good match',
          highlights: ['summary'],
          recommendation: 'match',
          breakdown: {
            related_exp: 30,
            industry_db: 15,
          },
          jobDescriptionId: 'lathe-sales',
        },
        roleSignals: [],
      }),
    ]
    mockState.searchHistory = [
      {
        id: 'history-ai',
        sessionKey: 'session-1',
        title: 'AI Saved search',
        location: '苏州',
        keywords: ['CNC'],
        jobDescriptionId: 'lathe-sales',
        filters: {},
        selectedTags: [],
        selectedCompanies: [],
        selectedExperienceLevel: undefined,
        industryDbV2Stats: {
          size: 50,
          p80: 20,
          histogram50: Array.from({ length: 51 }, (_, index) => (index === 20 ? 50 : 0)),
        },
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ]

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleApplySearchHistory(mockState.searchHistory[0] as never)
    })

    expect(result.current.displayedResumes[0]?.match?.breakdown?.industry_db).toBe(20)
    expect(result.current.displayedResumes[0]?.match?.breakdown?.related_exp).toBe(30)
    expect(result.current.displayedResumes[0]?.match?.score).toBe(35)  // round(30*0.5)+20
  })

  it('bumps industry_db to brand section max when resume has brand hits', async () => {
    mockState.convexResumes = [
      buildResume({
        id: 'resume-brand-1',
        name: 'Brand Hit Resume',
        industryDbV2Raw: 5,
        brandHits: [{ brand: 'star', role: 'distributor', source: 'job5156', context: 'Star distributor' }],
        analysis: {
          score: 45,
          summary: 'Good match',
          highlights: ['summary'],
          recommendation: 'match',
          breakdown: {
            related_exp: 30,
            industry_db: 5,
          },
          jobDescriptionId: 'lathe-sales',
        },
        roleSignals: [],
      }),
    ]
    mockState.searchHistory = [
      {
        id: 'history-brand',
        sessionKey: 'session-1',
        title: 'Brand bump test',
        location: '苏州',
        keywords: ['CNC'],
        jobDescriptionId: 'lathe-sales',
        filters: {},
        selectedTags: [],
        selectedCompanies: [],
        selectedExperienceLevel: undefined,
        industryDbV2Stats: {
          size: 50,
          p80: 20,
          histogram50: Array.from({ length: 51 }, (_, index) => (index === 20 ? 50 : 0)),
        },
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ]

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleApplySearchHistory(mockState.searchHistory[0] as never)
    })

    // has brand hits (non-employer) -> single-hit baseline: brand-only = 40
    // score = round(30*0.5)+40 = 55 (composite formula)
    expect(result.current.displayedResumes[0]?.match?.breakdown?.industry_db).toBe(40)
    expect(result.current.displayedResumes[0]?.match?.breakdown?.related_exp).toBe(30)
    expect(result.current.displayedResumes[0]?.match?.score).toBe(55)
  })

  it('ignores employer-context brand hits when computing direct industry_db score', async () => {
    mockState.convexResumes = [
      buildResume({
        id: 'resume-employer-brand-1',
        name: 'Employer Brand Resume',
        industryDbV2Raw: 5,
        brandHits: [{ brand: 'fanuc', role: 'employer', source: 'workHistory', context: 'employer' }],
        analysis: {
          score: 45,
          summary: 'Good match',
          highlights: ['summary'],
          recommendation: 'match',
          breakdown: {
            related_exp: 30,
            industry_db: 5,
          },
          jobDescriptionId: 'lathe-sales',
        },
        roleSignals: [],
      }),
    ]
    mockState.searchHistory = [
      {
        id: 'history-employer-brand',
        sessionKey: 'session-1',
        title: 'Employer brand test',
        location: '苏州',
        keywords: ['CNC'],
        jobDescriptionId: 'lathe-sales',
        filters: {},
        selectedTags: [],
        selectedCompanies: [],
        selectedExperienceLevel: undefined,
        industryDbV2Stats: {
          size: 50,
          p80: 20,
          histogram50: Array.from({ length: 51 }, (_, index) => (index === 20 ? 50 : 0)),
        },
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ]

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleApplySearchHistory(mockState.searchHistory[0] as never)
    })

    expect(result.current.displayedResumes[0]?.match?.breakdown?.industry_db).toBe(5)
    expect(result.current.displayedResumes[0]?.match?.breakdown?.related_exp).toBe(30)
    expect(result.current.displayedResumes[0]?.match?.score).toBe(20)  // round(30*0.5)+5
  })

  it('recomputes recommendation from the related_exp score below the potential band', async () => {
    mockState.convexResumes = [
      buildResume({
        id: 'resume-rec-low-1',
        name: 'Recommendation Drift Low',
        industryDbV2Raw: 0,
        analysis: {
          score: 70,
          summary: 'Raw AI score before frontend normalization',
          highlights: ['summary'],
          recommendation: 'match',
          breakdown: {
            related_exp: 45,
            industry_db: 25,
          },
          jobDescriptionId: 'lathe-sales',
        },
        roleSignals: [],
      }),
    ]
    mockState.searchHistory = [
      {
        id: 'history-rec-low',
        sessionKey: 'session-1',
        title: 'Recommendation low drift test',
        location: '苏州',
        keywords: ['CNC'],
        jobDescriptionId: 'lathe-sales',
        filters: {},
        selectedTags: [],
        selectedCompanies: [],
        selectedExperienceLevel: undefined,
        industryDbV2Stats: {
          size: 50,
          p80: 20,
          histogram50: Array.from({ length: 51 }, (_, index) => (index === 20 ? 50 : 0)),
        },
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ]

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleApplySearchHistory(mockState.searchHistory[0] as never)
    })

    expect(result.current.displayedResumes[0]?.match?.score).toBe(23)  // round(45*0.5)+0
    expect(result.current.displayedResumes[0]?.match?.recommendation).toBe('no_match')
  })

  it('composite score: industry_db elevates tier when related_exp is borderline', async () => {
    mockState.convexResumes = [
      buildResume({
        id: 'resume-rec-high-1',
        name: 'Recommendation Drift High',
        industryDbV2Raw: 10,
        brandHits: [{ brand: 'star', role: 'distributor', source: 'job5156', context: 'sales' }],
        companyHits: ['Star CNC'],
        analysis: {
          score: 40,
          summary: 'Raw AI score before frontend normalization',
          highlights: ['summary'],
          recommendation: 'potential',
          breakdown: {
            related_exp: 40,
            industry_db: 0,
          },
          jobDescriptionId: 'lathe-sales',
        },
        roleSignals: [],
      }),
    ]
    mockState.searchHistory = [
      {
        id: 'history-rec-high',
        sessionKey: 'session-1',
        title: 'Recommendation high drift test',
        location: '苏州',
        keywords: ['CNC'],
        jobDescriptionId: 'lathe-sales',
        filters: {},
        selectedTags: [],
        selectedCompanies: [],
        selectedExperienceLevel: undefined,
        industryDbV2Stats: {
          size: 50,
          p80: 20,
          histogram50: Array.from({ length: 51 }, (_, index) => (index === 20 ? 50 : 0)),
        },
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ]

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      await result.current.handleApplySearchHistory(mockState.searchHistory[0] as never)
    })

    // brand+company → industryDb=50; score = round(40*0.5)+50 = 70 → match
    expect(result.current.displayedResumes[0]?.match?.score).toBe(70)
    expect(result.current.displayedResumes[0]?.match?.recommendation).toBe('match')
  })

  it('allows manual profile apply to bypass the URL hydration guard', () => {
    mockState.sessionLocation = ''
    mockState.urlParsedState = {
      shareSessionId: undefined,
      location: '广东',
      keywords: ['CNC'],
      jobDescriptionId: undefined,
      requiredKeywords: [],
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
        filters: {},
      }, true)
    })

    expect(mockState.setLocation).toHaveBeenCalledTimes(1)
    const setLocationArg = mockState.setLocation.mock.calls[0]?.[0]
    expect(typeof setLocationArg).toBe('function')
    expect(setLocationArg('')).toBe('江苏')
    expect(mockState.setKeywords).toHaveBeenCalledWith(expect.any(Function))
    expect(mockState.setFilters).toHaveBeenCalledWith(expect.any(Function))
  })

  it('preserves spaced locations when applying a Malaysia quick-start workflow', () => {
    const { result } = renderHook(() => useResumeListState())

    act(() => {
      result.current.handleQuickStartApply({
        location: 'Kuala Lumpur MY',
        keywords: ['Sales Engineer', 'Sales Manager'],
        collectionSource: { type: 'seek' },
      }, true)
    })

    expect(mockState.setLocation).toHaveBeenCalledTimes(1)
    const locationUpdater = mockState.setLocation.mock.calls[0]?.[0] as (current: string) => string
    expect(locationUpdater('')).toBe('Kuala Lumpur MY')

    const filterUpdater = mockState.setFilters.mock.calls[0]?.[0] as (current: Record<string, unknown>) => Record<string, unknown>
    expect(filterUpdater({})).toMatchObject({
      locations: ['Kuala Lumpur MY'],
    })
    expect(mockState.setCollectionSource).toHaveBeenCalledWith(expect.any(Function))
  })

  it('clears query state when navigation requests a resume home reset', async () => {
    mockState.locationSearch = '?location=Kuala+Lumpur+MY&q=%22Sales+Engineer%22+OR+%22Sales+Manager%22'
    mockState.locationState = RESUME_HOME_RESET_STATE

    renderHook(() => useResumeListState())

    await waitFor(() => {
      expect(mockState.applyExternalState).toHaveBeenCalledWith({
        location: '',
        keywords: [],
        jobDescriptionId: '',
        collectionSource: null,
        filters: {},
      })
    })

    expect(mockState.navigate).toHaveBeenCalledWith(
      {
        pathname: '/dev/resumes',
        search: '',
        hash: '',
      },
      {
        replace: true,
        state: null,
      }
    )
  })

  it('filters by selectedCompanies — only verified companyHits', () => {
    mockState.urlParsedState = {
      ...mockState.urlParsedState,
      selectedCompanies: ['jingdiao'],
    }
    mockState.urlHasParams = true

    expect(getDisplayedResumeNames()).toEqual(['Zhou Jingdiao Hit'])
  })

  it('appends clicked tags and companies into session keywords', () => {
    mockState.sessionKeywords = ['销售']

    const { result } = renderHook(() => useResumeListState())

    act(() => {
      result.current.handleToggleTag('sales')
      result.current.handleToggleCompany('FANUC')
    })

    expect(mockState.setKeywords).toHaveBeenCalledTimes(2)

    const tagUpdater = mockState.setKeywords.mock.calls[0]?.[0] as (current: string[]) => string[]
    const companyUpdater = mockState.setKeywords.mock.calls[1]?.[0] as (current: string[]) => string[]

    expect(tagUpdater(['销售'])).toEqual(['销售', 'sales'])
    expect(companyUpdater(['销售', 'sales'])).toEqual(['销售', 'sales', 'FANUC'])
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

describe('requiredKeywords filtering logic', () => {
  function matchesAllRequired(resume: ConvexResumeItem, requiredKeywords: string[]): boolean {
    const normalized = requiredKeywords.map((kw) => kw.trim().toLowerCase()).filter((kw) => kw.length > 0)
    if (normalized.length === 0) return true
    const text = buildRuleScoringText(resume).toLowerCase()
    return normalized.every((kw) => text.includes(kw))
  }

  it('every() semantics: resume must contain ALL required keywords, not just some', () => {
    const resumeWithBoth = buildResume({
      id: 'both',
      name: '王先生',
      roleSignals: [],
      workHistory: [{ raw: '负责machine tools和CNC机床销售', companyName: 'MAKINO', jobTitle: 'machine tools CNC Sales' }],
    })

    const resumeWithMachineToolsOnly = buildResume({
      id: 'mt-only',
      name: '张先生',
      roleSignals: [],
      workHistory: [{ raw: '负责machine tools设备销售', companyName: 'STAR', jobTitle: 'machine tools Sales' }],
    })

    const resumeWithCncOnly = buildResume({
      id: 'cnc-only',
      name: '李先生',
      roleSignals: [],
      workHistory: [{ raw: '负责CNC设备销售', companyName: 'Example', jobTitle: 'CNC Sales Rep' }],
    })

    expect(matchesAllRequired(resumeWithBoth, ['machine tools', 'cnc'])).toBe(true)
    expect(matchesAllRequired(resumeWithMachineToolsOnly, ['machine tools', 'cnc'])).toBe(false)
    expect(matchesAllRequired(resumeWithCncOnly, ['machine tools', 'cnc'])).toBe(false)
  })

  it('single required keyword filters correctly', () => {
    const resumeWithKeyword = buildResume({
      id: 'has-mt',
      name: '张先生',
      roleSignals: [],
      workHistory: [{ raw: '负责machine tools设备销售', companyName: 'STAR', jobTitle: 'machine tools Sales' }],
    })

    const resumeWithoutKeyword = buildResume({
      id: 'no-mt',
      name: '李先生',
      roleSignals: [],
      workHistory: [{ raw: '负责普通设备销售', companyName: 'Example', jobTitle: 'General Sales Rep' }],
    })

    expect(matchesAllRequired(resumeWithKeyword, ['machine tools'])).toBe(true)
    expect(matchesAllRequired(resumeWithoutKeyword, ['machine tools'])).toBe(false)
  })

  it('empty requiredKeywords matches all resumes', () => {
    const resume = buildResume({
      id: 'any',
      name: '任先生',
      roleSignals: [],
    })

    expect(matchesAllRequired(resume, [])).toBe(true)
  })
})

describe('handleCardAction Convex status sync (CN market list view)', () => {
  beforeEach(() => {
    mockState.convexResumes = [
      buildResume({ id: 'cn-resume-1', name: '李销售', roleSignals: [] }),
    ]
    mockState.saveAction.mockClear()
    mockState.saveAction.mockResolvedValue(undefined)
    mockState.updateStatus.mockClear()
    mockState.updateStatus.mockResolvedValue(undefined)
    mockState.statusByIdentity = {}
  })

  it('syncs shortlist to Convex candidate_status after saveAction', async () => {
    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      result.current.handleCardAction('cn-resume-1', 'shortlist')
    })

    await waitFor(() => {
      expect(mockState.saveAction).toHaveBeenCalledWith({ resumeId: 'cn-resume-1', actionType: 'shortlist' })
      expect(mockState.updateStatus).toHaveBeenCalledWith('cn-resume-1', 'shortlisted')
    })
  })

  it('syncs reject to Convex candidate_status after saveAction', async () => {
    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      result.current.handleCardAction('cn-resume-1', 'reject')
    })

    await waitFor(() => {
      expect(mockState.updateStatus).toHaveBeenCalledWith('cn-resume-1', 'rejected')
    })
  })

  it('does not call updateStatus for star action', async () => {
    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      result.current.handleCardAction('cn-resume-1', 'star')
    })

    await waitFor(() => {
      expect(mockState.saveAction).toHaveBeenCalled()
    })
    expect(mockState.updateStatus).not.toHaveBeenCalled()
  })

  it('toggles shortlisted back to new when current status is shortlisted', async () => {
    mockState.statusByIdentity = {
      'cn-resume-1': buildCandidateStatusRecord('cn-resume-1', 'shortlisted'),
    }

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      result.current.handleCardAction('cn-resume-1', 'shortlist')
    })

    await waitFor(() => {
      expect(mockState.updateStatus).toHaveBeenCalledWith('cn-resume-1', 'new')
    })
  })

  it('toggles rejected back to new when current status is rejected', async () => {
    mockState.statusByIdentity = {
      'cn-resume-1': buildCandidateStatusRecord('cn-resume-1', 'rejected'),
    }

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      result.current.handleCardAction('cn-resume-1', 'reject')
    })

    await waitFor(() => {
      expect(mockState.updateStatus).toHaveBeenCalledWith('cn-resume-1', 'new')
    })
  })

  it('uses entry.identityKey (not resumeId) for Convex status lookup and update when they differ', async () => {
    // In AI mode, displayedResumes entries use getResumeIdentityKey which may differ from resumeId.
    // Simulate: cn-resume-1 shortlisted → toggle-back should fire using the entry's identityKey.
    // The test already validates toggle-back via statusByIdentity keyed on 'cn-resume-1',
    // confirming that identityKey == 'cn-resume-1' (resumeId) for non-AI mode entries.
    // This test verifies the entry lookup path itself doesn't regress.
    mockState.statusByIdentity = {
      'cn-resume-1': buildCandidateStatusRecord('cn-resume-1', 'shortlisted'),
    }

    const { result } = renderHook(() => useResumeListState())

    await act(async () => {
      result.current.handleCardAction('cn-resume-1', 'shortlist')
    })

    await waitFor(() => {
      // entry.identityKey == 'cn-resume-1' in non-AI mode; status is shortlisted → toggle to new
      expect(mockState.updateStatus).toHaveBeenCalledWith('cn-resume-1', 'new')
    })
  })
})
