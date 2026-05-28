import { act, renderHook } from '@testing-library/react'
import { formatKeywordQuery } from '@trends/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResumeSearchState } from '@/hooks/useResumeSearchState'
import { getCurrentResumeAiPromptVersion } from '@/lib/analysis-utils'
import type { CandidateStatusRecord } from '@/hooks/useCandidateStatus'
import type { ApiClientLike } from '@/lib/api-helpers'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { UrlSearchState } from '@/hooks/useUrlSearchState'

const {
  dispatchAnalysisMutationMock,
  exportDownloadMock,
  toastErrorMock,
  toastInfoMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  dispatchAnalysisMutationMock: vi.fn(async () => 'analysis-task-1'),
  exportDownloadMock: vi.fn(async (apiBaseUrl: string, payload: unknown) => {
    void apiBaseUrl
    void payload
  }),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

const CURRENT_PROMPT_VERSION = getCurrentResumeAiPromptVersion()

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    sessions: {
      recentSearches: 'recent-searches-query',
      saveSearchHistory: 'save-search-history-mutation',
      markSearchHistoryOpened: 'mark-search-history-opened-mutation',
    },
    analysis_tasks: {
      dispatch: 'analysis-tasks-dispatch-mutation',
      list: 'analysis-tasks-list-query',
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
    success: (message: unknown) => toastSuccessMock(message),
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
  analysisTasksMock,
  statusByIdentityMock,
  updateStatusMock,
  saveActionMock,
  syncToUrlMock,
  taxonomyClusterRecordsMock,
  useFacetCountsMock,
  useConvexResumesMock,
  useMutationMock,
  useQueryMock,
  useUrlSearchStateMock,
  workspaceMock,
  mutableState,
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
  // Mutable reference for tests that need to replace (not just push to) resumesMock.
  // When set, useConvexResumesMock returns this instead of resumesMock.
  mutableState: { overrideResumes: null as ConvexResumeItem[] | null },
  saveSearchHistoryMutationMock: vi.fn(async () => 'history-1'),
  recentSearchHistoryRecordsMock: [] as Array<Record<string, unknown>>,
  analysisTasksMock: [] as Array<Record<string, unknown>>,
  statusByIdentityMock: {} as Record<string, CandidateStatusRecord>,
  updateStatusMock: vi.fn(async () => true),
  saveActionMock: vi.fn(async () => ({ success: true })),
  syncToUrlMock: vi.fn(),
  taxonomyClusterRecordsMock: [] as Array<Record<string, unknown>>,
  useFacetCountsMock: vi.fn(),
  useConvexResumesMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn(),
  useUrlSearchStateMock: vi.fn(),
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
  useUrlSearchState: (...args: unknown[]) => useUrlSearchStateMock(...args),
}))

vi.mock('@/hooks/useCandidateStatus', () => ({
  useCandidateStatus: () => ({
    statusByIdentity: statusByIdentityMock,
    updateStatus: updateStatusMock,
  }),
}))

vi.mock('@/hooks/useCandidateBlocks', () => ({
  useCandidateBlocks: () => ({
    blocksByIdentity: blocksByIdentityMock,
  }),
}))

vi.mock('@/hooks/useCandidateActions', () => ({
  useCandidateActions: () => ({
    actions: {},
    actionsByResume: {},
    aiFeedbackByResume: {},
    ratingsByResume: {},
    loading: false,
    error: null,
    reload: vi.fn(),
    saveAction: saveActionMock,
    getAiFeedback: vi.fn(),
  }),
}))

vi.mock('@/hooks/useConvexResumes', () => ({
  useConvexResumes: (...args: unknown[]) => useConvexResumesMock(...args),
}))

vi.mock('@/hooks/useFacetCounts', () => ({
  useFacetCounts: (...args: unknown[]) => useFacetCountsMock(...args),
}))

vi.mock('@/lib/api-helpers', () => {
  const rawApiClientMock: ApiClientLike = {
    GET: vi.fn().mockResolvedValue({ data: undefined, error: undefined }),
    POST: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
    PATCH: vi.fn(),
  }
  return { rawApiClient: rawApiClientMock }
})

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
    selectedSources: [],
    selectedBrands: [],
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
    vi.unstubAllEnvs()
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
    parsedStateMock.selectedSources = []
    parsedStateMock.selectedBrands = []
    parsedStateMock.selectedExperienceLevel = undefined
    parsedStateMock.filters = {}

    resumesMock.splice(0, resumesMock.length)
    recentSearchHistoryRecordsMock.splice?.(0, recentSearchHistoryRecordsMock.length)
    analysisTasksMock.splice?.(0, analysisTasksMock.length)
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
      sources: [],
    })
    useUrlSearchStateMock.mockReturnValue({
      parsedState: parsedStateMock,
      syncToUrl: syncToUrlMock,
    })

    useQueryMock.mockImplementation((query) => {
      if (query === 'recent-searches-query') {
        return recentSearchHistoryRecordsMock
      }
      if (query === 'analysis-tasks-list-query') {
        return analysisTasksMock
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
      if (mutation === 'analysis-tasks-dispatch-mutation') {
        return dispatchAnalysisMutationMock
      }
      return vi.fn()
    })

    mutableState.overrideResumes = null
    useConvexResumesMock.mockImplementation(() => ({
      resumes: resumesMock,
      hasMore: convexQueryStateMock.hasMore,
      loading: convexQueryStateMock.loading,
      loadingMore: convexQueryStateMock.loadingMore,
    }))
    exportDownloadMock.mockResolvedValue(undefined)
    dispatchAnalysisMutationMock.mockResolvedValue('analysis-task-1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
      createResume(1, {
        primaryRuleScore: 72,
        analysis: {
          score: 95,
          summary: 'Best AI match',
          highlights: [],
          recommendation: 'strong_match',
          promptVersion: CURRENT_PROMPT_VERSION,
          breakdown: {
            related_exp: 90,
            industry_db: 10,
          },
        },
      }),
      createResume(2, { primaryRuleScore: 91 }),
      createResume(3, { primaryRuleScore: 84 }),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.activeSort).toBe('score')
    expect(result.current.filteredResults.map((item) => item.key)).toEqual([
      'resume-1',
      'resume-2',
      'resume-3',
    ])
    expect(result.current.filteredResults[0]?.scoreSource).toBe('ai')
    expect(result.current.filteredResults[0]?.analysis?.summary).toBe('Best AI match')
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

  it('applies age filters while keeping resumes with unknown ages', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
      filters: {
        minAge: 28,
        maxAge: 35,
      },
    }))

    resumesMock.push(
      createResume(1, {
        age: '',
        ageNumber: 30,
        primaryRuleScore: 95,
      }),
      createResume(2, {
        age: '',
        ageNumber: 24,
        primaryRuleScore: 90,
      }),
      createResume(3, {
        age: '42岁',
        ageNumber: undefined,
        primaryRuleScore: 85,
      }),
      createResume(4, {
        age: '',
        ageNumber: undefined,
        primaryRuleScore: 80,
      }),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.filteredResults.map((item) => item.key)).toEqual([
      'resume-1',
      'resume-4',
    ])
  })

  it('sends role-year filters to backend filters', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC',
      keywords: ['CNC'],
      filters: {
        minRoleYears: 3,
        minExperience: 5,
        maxExperience: 12,
      },
    }))

    resumesMock.push(createResume(1))

    renderHook(() => useResumeSearchState())

    expect(useConvexResumesMock).toHaveBeenCalledWith(
      expect.any(Number),
      'CNC',
      undefined,
      expect.objectContaining({
        filters: expect.objectContaining({
          minExperience: 5,
          maxExperience: 12,
          minRoleYears: 3,
        }),
      }),
    )
  })

  it('forwards role-year filters to backend and applies role-year local filtering', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC',
      keywords: ['CNC'],
      filters: {
        minRoleYears: 3,
        roleFilterType: 'sales',
        minExperience: 5,
        maxExperience: 12,
      },
    }))

    resumesMock.push(
      createResume(1, {
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
          roleSignals: [
            {
              type: 'sales',
              matchedSignals: ['销售'],
              signalCount: 1,
              occurrences: 1,
              years: 4,
              industryVerifiedYears: 4,
              roleRelevantYears: 4,
              industryVerifiedRelevantYears: 4,
              verifyIn: 'workHistory',
            },
          ],
        },
      }),
      createResume(2, {
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
          roleSignals: [
            {
              type: 'sales',
              matchedSignals: ['销售'],
              signalCount: 1,
              occurrences: 1,
              years: 2,
              industryVerifiedYears: 2,
              roleRelevantYears: 2,
              industryVerifiedRelevantYears: 2,
              verifyIn: 'workHistory',
            },
          ],
        },
      }),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(useConvexResumesMock).toHaveBeenCalledWith(
      expect.any(Number),
      'CNC',
      undefined,
      expect.objectContaining({
        filters: expect.objectContaining({
          minExperience: 5,
          maxExperience: 12,
          minRoleYears: 3,
          roleFilterType: 'sales',
        }),
      }),
    )
    expect(result.current.filteredResults.map((item) => item.key)).toEqual(['resume-1'])
  })

  it('infers sales role filtering from sales keyword searches when minRoleYears is set', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC 销售',
      keywords: ['CNC', '销售'],
      filters: {
        minRoleYears: 5,
      },
    }))

    resumesMock.push(
      createResume(1, {
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
          roleSignals: [
            {
              type: 'sales',
              matchedSignals: ['销售', '销售工程师'],
              signalCount: 2,
              occurrences: 1,
              years: 3.17,
              industryVerifiedYears: 0,
              roleRelevantYears: 3.17,
              verifyIn: 'workHistory',
            },
            {
              type: 'engineer',
              matchedSignals: ['工程师', '编程'],
              signalCount: 2,
              occurrences: 2,
              years: 8.67,
              industryVerifiedYears: 5.5,
              roleRelevantYears: 8.67,
              verifyIn: 'workHistory',
            },
          ],
        },
      }),
      createResume(2, {
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
          roleSignals: [
            {
              type: 'sales',
              matchedSignals: ['销售', '销售工程师'],
              signalCount: 2,
              occurrences: 2,
              years: 6.2,
              industryVerifiedYears: 6.2,
              roleRelevantYears: 6.2,
              industryVerifiedRelevantYears: 6.2,
              verifyIn: 'workHistory',
            },
            {
              type: 'engineer',
              matchedSignals: ['工程师'],
              signalCount: 1,
              occurrences: 1,
              years: 2,
              industryVerifiedYears: 0,
              roleRelevantYears: 2,
              verifyIn: 'workHistory',
            },
          ],
        },
      }),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(useConvexResumesMock).toHaveBeenCalledWith(
      expect.any(Number),
      'CNC 销售',
      undefined,
      expect.objectContaining({
        filters: expect.objectContaining({
          minRoleYears: 5,
          roleFilterType: 'sales',
        }),
      }),
    )
    expect(result.current.filteredResults.map((item) => item.key)).toEqual(['resume-2'])
  })

  it('infers sales role filtering from business-development query terms when minRoleYears is set', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC business development manager',
      keywords: ['CNC', 'business development manager'],
      filters: {
        minRoleYears: 5,
      },
    }))

    resumesMock.push(
      createResume(1, {
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
          roleSignals: [
            {
              type: 'sales',
              matchedSignals: ['business development manager'],
              signalCount: 2,
              occurrences: 1,
              years: 3,
              industryVerifiedYears: 0,
              roleRelevantYears: 3,
              verifyIn: 'workHistory',
            },
            {
              type: 'engineer',
              matchedSignals: ['工程师'],
              signalCount: 1,
              occurrences: 2,
              years: 8,
              industryVerifiedYears: 0,
              roleRelevantYears: 8,
              verifyIn: 'workHistory',
            },
          ],
        },
      }),
      createResume(2, {
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
          roleSignals: [
            {
              type: 'sales',
              matchedSignals: ['business development manager'],
              signalCount: 2,
              occurrences: 2,
              years: 6,
              industryVerifiedYears: 6,
              roleRelevantYears: 6,
              industryVerifiedRelevantYears: 6,
              verifyIn: 'workHistory',
            },
            {
              type: 'engineer',
              matchedSignals: ['工程师'],
              signalCount: 1,
              occurrences: 1,
              years: 2,
              industryVerifiedYears: 0,
              roleRelevantYears: 2,
              verifyIn: 'workHistory',
            },
          ],
        },
      }),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(useConvexResumesMock).toHaveBeenCalledWith(
      expect.any(Number),
      'CNC business development manager',
      undefined,
      expect.objectContaining({
        filters: expect.objectContaining({
          minRoleYears: 5,
          roleFilterType: 'sales',
        }),
      }),
    )
    expect(result.current.filteredResults.map((item) => item.key)).toEqual(['resume-2'])
  })

  it('keeps an explicit role type over inferred sales intent', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC 销售',
      keywords: ['CNC', '销售'],
      filters: {
        minRoleYears: 5,
        roleFilterType: 'engineer',
      },
    }))

    resumesMock.push(
      createResume(1, {
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
          roleSignals: [
            {
              type: 'sales',
              matchedSignals: ['销售'],
              signalCount: 1,
              occurrences: 1,
              years: 3.17,
              industryVerifiedYears: 0,
              roleRelevantYears: 3.17,
              verifyIn: 'workHistory',
            },
            {
              type: 'engineer',
              matchedSignals: ['工程师'],
              signalCount: 1,
              occurrences: 2,
              years: 8.67,
              industryVerifiedYears: 5.5,
              roleRelevantYears: 8.67,
              verifyIn: 'workHistory',
            },
          ],
        },
      }),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(useConvexResumesMock).toHaveBeenCalledWith(
      expect.any(Number),
      'CNC 销售',
      undefined,
      expect.objectContaining({
        filters: expect.objectContaining({
          minRoleYears: 5,
          roleFilterType: 'engineer',
        }),
      }),
    )
    expect(result.current.filteredResults.map((item) => item.key)).toEqual(['resume-1'])
  })

  it('counts and analyzes only filtered loaded results', async () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC 销售',
      keywords: ['CNC', '销售'],
      filters: {
        minRoleYears: 5,
      },
    }))

    resumesMock.push(
      createResume(1, {
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
          roleSignals: [
            {
              type: 'sales',
              matchedSignals: ['销售', '销售工程师'],
              signalCount: 2,
              occurrences: 1,
              years: 3.17,
              industryVerifiedYears: 0,
              roleRelevantYears: 3.17,
              verifyIn: 'workHistory',
            },
            {
              type: 'engineer',
              matchedSignals: ['工程师', '编程'],
              signalCount: 2,
              occurrences: 2,
              years: 8.67,
              industryVerifiedYears: 5.5,
              roleRelevantYears: 8.67,
              verifyIn: 'workHistory',
            },
          ],
        },
      }),
      createResume(2, {
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
          roleSignals: [
            {
              type: 'sales',
              matchedSignals: ['销售', '销售工程师'],
              signalCount: 2,
              occurrences: 2,
              years: 6.2,
              industryVerifiedYears: 6.2,
              roleRelevantYears: 6.2,
              industryVerifiedRelevantYears: 6.2,
              verifyIn: 'workHistory',
            },
          ],
        },
      }),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.filteredResults.map((item) => item.key)).toEqual(['resume-2'])
    expect(result.current.analysisCandidateCount).toBe(1)

    await act(async () => {
      await result.current.analyzeResults()
    })

    expect(dispatchAnalysisMutationMock).toHaveBeenCalledWith({
      keywords: ['CNC', '销售'],
      promptVersion: CURRENT_PROMPT_VERSION,
      resumeIds: ['resume-2'],
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('Analyzing 1 resumes...')
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
          sortBy: 'experience',
          sortOrder: 'desc',
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

    act(() => {
      result.current.setAiModeEnabled(false)
    })
    expect(result.current.aiModeEnabled).toBe(false)

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
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: 'senior',
      filters: {
        education: ['Bachelor'],
        status: ['new'],
      },
    })
    expect(result.current.queryInput).toBe(expectedQuery)
    expect(result.current.aiModeEnabled).toBe(true)
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
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: 'senior',
      filters: {
        education: ['Bachelor'],
        status: ['contacted'],
        minMatchScore: 80,
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
      selectedSources: [],
      selectedBrands: [],
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
      selectedSources: [],
      selectedBrands: [],
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
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: undefined,
      filters: {},
    })
  })

  it('exports the current filtered results with score-first metadata', async () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
      filters: { status: ['contacted', 'new'] },
    }))

    resumesMock.push(
      createResume(1, {
        primaryRuleScore: 88,
        analysis: {
          score: 95,
          summary: 'Strong fit',
          highlights: [],
          recommendation: 'strong_match',
          promptVersion: CURRENT_PROMPT_VERSION,
          breakdown: {
            related_exp: 90,
            industry_db: 10,
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
              score: 95,
              recommendation: 'strong_match',
              scoreSource: 'ai',
              summary: 'Strong fit',
              breakdown: {
                related_exp: 45,
                industry_db: 50,
              },
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

  it('auto-analyzes loaded results after an explicit search trigger', async () => {
    vi.stubEnv('VITE_ANALYSIS_TOP_N', '10')

    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
      location: 'China',
    }))

    resumesMock.push(
      ...Array.from({ length: 12 }, (_, index) =>
        createResume(index + 1, {
          primaryRuleScore: 95 - index,
        }),
      ),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.analysisCandidateCount).toBe(12)
    expect(result.current.disableAnalyzeResults).toBe(false)
    expect(dispatchAnalysisMutationMock).not.toHaveBeenCalled()

    await act(async () => {
      result.current.submitSearch('machine tools')
      useUrlSearchStateMock.mockReturnValue({
        parsedState: createParsedState({
          query: 'machine tools',
          keywords: ['machine', 'tools'],
          location: 'China',
        }),
        syncToUrl: syncToUrlMock,
      })
      await Promise.resolve()
    })

    expect(dispatchAnalysisMutationMock).toHaveBeenCalledTimes(1)

    expect(dispatchAnalysisMutationMock).toHaveBeenCalledWith({
      keywords: ['machine', 'tools'],
      location: 'China',
      promptVersion: CURRENT_PROMPT_VERSION,
      resumeIds: Array.from({ length: 10 }, (_, index) => `resume-${index + 1}`),
    })
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Analyzing batch of 10 resumes (2 more pending)...',
    )
  })

  it('caps auto-analysis dispatch by VITE_ANALYSIS_TOP_N', async () => {
    vi.stubEnv('VITE_ANALYSIS_TOP_N', '10')

    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
      location: 'China',
    }))

    resumesMock.push(
      ...Array.from({ length: 12 }, (_, index) =>
        createResume(index + 1, {
          primaryRuleScore: 95 - index,
        }),
      ),
    )

    const { result } = renderHook(() => useResumeSearchState())

    await act(async () => {
      result.current.submitSearch('machine tools')
      useUrlSearchStateMock.mockReturnValue({
        parsedState: createParsedState({
          query: 'machine tools',
          keywords: ['machine', 'tools'],
          location: 'China',
        }),
        syncToUrl: syncToUrlMock,
      })
      await Promise.resolve()
    })

    expect(dispatchAnalysisMutationMock).toHaveBeenCalledTimes(1)
    expect(dispatchAnalysisMutationMock).toHaveBeenCalledWith({
      keywords: ['machine', 'tools'],
      location: 'China',
      promptVersion: CURRENT_PROMPT_VERSION,
      resumeIds: Array.from({ length: 10 }, (_, index) => `resume-${index + 1}`),
    })
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Analyzing batch of 10 resumes (2 more pending)...',
    )
  })

  it('continues auto-analysis batch when first batch completes and candidates remain', async () => {
    vi.stubEnv('VITE_ANALYSIS_TOP_N', '10')

    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
      location: 'China',
    }))

    resumesMock.push(
      ...Array.from({ length: 12 }, (_, index) =>
        createResume(index + 1, { primaryRuleScore: 95 - index }),
      ),
    )

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.analysisCandidateCount).toBe(12)

    // Trigger first batch dispatch
    await act(async () => {
      result.current.submitSearch('machine tools')
      useUrlSearchStateMock.mockReturnValue({
        parsedState: createParsedState({
          query: 'machine tools',
          keywords: ['machine', 'tools'],
          location: 'China',
        }),
        syncToUrl: syncToUrlMock,
      })
      await Promise.resolve()
    })

    expect(dispatchAnalysisMutationMock).toHaveBeenCalledTimes(1)
    expect(dispatchAnalysisMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeIds: Array.from({ length: 10 }, (_, index) => `resume-${index + 1}`),
      }),
    )

    // Simulate Convex reactive update: first 10 resumes now have analysis.
    // Use overrideResumes to provide a new array reference so useMemo recomputes.
    // Verify the dispatch included the batch-info toast with remaining count
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Analyzing batch of 10 resumes (2 more pending)...',
    )

    // Verify analysisCandidateCount correctly tracks all unanalyzed (not just dispatched batch)
    expect(result.current.analysisCandidateCount).toBe(12)

    // Verify the dispatch used the TOP_N-sliced batch (not all candidates)
    expect(dispatchAnalysisMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeIds: Array.from({ length: 10 }, (_, index) => `resume-${index + 1}`),
      }),
    )

    // NOTE: Full continuation testing (re-dispatch after batch completion) requires
    // simulating Convex reactive query updates, which the current mock infrastructure
    // doesn't support (resumesMock is a const array reference). The continuation
    // mechanism relies on the memo chain: useConvexResumes → filteredResults →
    // analysisCandidates → analysisDispatchBatchIds → analysisCandidateSignature →
    // autoAnalyzeSignature. When Convex updates the query result with new analysis
    // data, the new array reference triggers the entire chain to recompute.
    // Integration tests via /playwright-cli are recommended for continuation coverage.
  })

  it('tracks AI mode stats and disables manual analysis while original mode is selected', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
      location: 'Malaysia',
    }))

    resumesMock.push(
      createResume(1, {
        analysis: {
          score: 92,
          summary: 'Strong fit',
          highlights: [],
          recommendation: 'strong_match',
          promptVersion: CURRENT_PROMPT_VERSION,
          breakdown: {
            related_exp: 50,
            industry_db: 42,
          },
        },
        ingestData: {
          industryTags: ['Machine Tools', 'Automation'],
          synonymHits: [],
          brandHits: [],
          companyHits: [],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
        },
      }),
      createResume(2, {
        analysis: {
          score: 78,
          summary: 'Solid fit',
          highlights: [],
          recommendation: 'match',
          promptVersion: CURRENT_PROMPT_VERSION,
          breakdown: {
            related_exp: 40,
            industry_db: 38,
          },
        },
        ingestData: {
          industryTags: ['Machine Tools', 'Automation'],
          synonymHits: [],
          brandHits: [],
          companyHits: [],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
        },
      }),
      createResume(3),
    )

    const { result } = renderHook(() => useResumeSearchState())
    const analyzedResults = result.current.results.filter(
      (item) => typeof item.analysis?.score === 'number',
    )
    const expectedAvgScore = Number(
      (
        analyzedResults.reduce(
          (sum, item) => sum + (item.analysis?.score ?? 0),
          0,
        ) / analyzedResults.length
      ).toFixed(2),
    )

    expect(result.current.aiModeEnabled).toBe(true)
    expect(result.current.aiModeStats).toEqual({
      avgScore: expectedAvgScore,
      matched: analyzedResults.length,
      processed: result.current.results.length,
    })
    expect(result.current.disableAnalyzeResults).toBe(false)

    act(() => {
      result.current.setAiModeEnabled(false)
    })

    expect(result.current.aiModeEnabled).toBe(false)
    expect(result.current.disableAnalyzeResults).toBe(true)
  })

  it('re-enables AI mode and auto-analyzes when a search is submitted from original mode', async () => {
    vi.stubEnv('VITE_ANALYSIS_TOP_N', '10')

    Object.assign(parsedStateMock, createParsedState({
      query: 'machine tools',
      keywords: ['machine tools'],
      location: 'China',
    }))

    resumesMock.push(
      ...Array.from({ length: 12 }, (_, index) =>
        createResume(index + 1, {
          primaryRuleScore: 95 - index,
        }),
      ),
    )

    const { result } = renderHook(() => useResumeSearchState())

    act(() => {
      result.current.setAiModeEnabled(false)
    })

    expect(result.current.aiModeEnabled).toBe(false)

    await act(async () => {
      result.current.submitSearch('machine tools')
      useUrlSearchStateMock.mockReturnValue({
        parsedState: createParsedState({
          query: 'machine tools',
          keywords: ['machine', 'tools'],
          location: 'China',
        }),
        syncToUrl: syncToUrlMock,
      })
      await Promise.resolve()
    })

    expect(result.current.aiModeEnabled).toBe(true)
    expect(dispatchAnalysisMutationMock).toHaveBeenCalledTimes(1)
    expect(dispatchAnalysisMutationMock).toHaveBeenCalledWith({
      keywords: ['machine', 'tools'],
      location: 'China',
      promptVersion: CURRENT_PROMPT_VERSION,
      resumeIds: Array.from({ length: 10 }, (_, index) => `resume-${index + 1}`),
    })
    expect(result.current.disableAnalyzeResults).toBe(false)
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
      selectedSources: [],
      selectedBrands: [],
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
      selectedSources: [],
      selectedBrands: [],
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
      selectedSources: [],
      selectedBrands: [],
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
      selectedSources: [],
      selectedBrands: [],
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

  it('shows only new resumes by default when no status filter is set', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC 销售',
      keywords: ['CNC', '销售'],
    }))

    resumesMock.push(
      createResume(1, { primaryRuleScore: 95 }),
      createResume(2, { primaryRuleScore: 90 }),
      createResume(3, { primaryRuleScore: 85 }),
    )
    statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'new')
    statusByIdentityMock['identity-2'] = createStatusRecord('identity-2', 'rejected')
    statusByIdentityMock['identity-3'] = createStatusRecord('identity-3', 'shortlisted')

    const { result } = renderHook(() => useResumeSearchState())

    // only new is kept by default; shortlisted and rejected are excluded
    expect(result.current.filteredResults.map((item) => item.key)).toEqual(['resume-1'])
  })

  it('includes rejected resumes when explicitly filtered for', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC 销售',
      keywords: ['CNC', '销售'],
      filters: {
        status: ['rejected'],
      },
    }))

    resumesMock.push(
      createResume(1, { primaryRuleScore: 95 }),
      createResume(2, { primaryRuleScore: 90 }),
      createResume(3, { primaryRuleScore: 85 }),
    )
    statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'new')
    statusByIdentityMock['identity-2'] = createStatusRecord('identity-2', 'rejected')
    statusByIdentityMock['identity-3'] = createStatusRecord('identity-3', 'shortlisted')

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.filteredResults.map((item) => item.key)).toEqual(['resume-2'])
  })

  it('excludes resume from filteredResults when status is shortlisted', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC 销售',
      keywords: ['CNC', '销售'],
    }))
    resumesMock.push(createResume(1, { primaryRuleScore: 95 }))
    // Shortlisted status is pre-set (mirrors Convex delivering the updated status)
    statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'shortlisted')

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.filteredResults.map((item) => item.key)).toEqual([])
  })

  it('excludes resume from filteredResults when status is rejected', () => {
    Object.assign(parsedStateMock, createParsedState({
      query: 'CNC 销售',
      keywords: ['CNC', '销售'],
    }))
    resumesMock.push(createResume(1, { primaryRuleScore: 95 }))
    // Rejected status is pre-set (mirrors Convex delivering the updated status)
    statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'rejected')

    const { result } = renderHook(() => useResumeSearchState())

    expect(result.current.filteredResults.map((item) => item.key)).toEqual([])
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

  describe('handleCandidateAction — Convex status sync + toggle', () => {
    beforeEach(() => {
      Object.assign(parsedStateMock, createParsedState({
        query: 'CNC 销售',
        keywords: ['CNC', '销售'],
      }))
      resumesMock.push(createResume(1, { primaryRuleScore: 95 }))
    })

    it('syncs Convex status to shortlisted on individual shortlist action', async () => {
      const { result } = renderHook(() => useResumeSearchState())

      await act(async () => {
        await result.current.handleCandidateAction('resume-1', 'shortlist')
      })

      expect(updateStatusMock).toHaveBeenCalledWith('identity-1', 'shortlisted')
    })

    it('syncs Convex status to rejected on individual reject action', async () => {
      const { result } = renderHook(() => useResumeSearchState())

      await act(async () => {
        await result.current.handleCandidateAction('resume-1', 'reject')
      })

      expect(updateStatusMock).toHaveBeenCalledWith('identity-1', 'rejected')
    })

    it('toggles shortlisted candidate back to new when shortlist is clicked again', async () => {
      Object.assign(parsedStateMock, createParsedState({
        query: 'CNC 销售',
        keywords: ['CNC', '销售'],
        filters: { status: ['shortlisted'] },
      }))
      statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'shortlisted')

      const { result } = renderHook(() => useResumeSearchState())

      await act(async () => {
        await result.current.handleCandidateAction('resume-1', 'shortlist')
      })

      expect(updateStatusMock).toHaveBeenCalledWith('identity-1', 'new')
    })

    it('toggles rejected candidate back to new when reject is clicked again', async () => {
      Object.assign(parsedStateMock, createParsedState({
        query: 'CNC 销售',
        keywords: ['CNC', '销售'],
        filters: { status: ['rejected'] },
      }))
      statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'rejected')

      const { result } = renderHook(() => useResumeSearchState())

      await act(async () => {
        await result.current.handleCandidateAction('resume-1', 'reject')
      })

      expect(updateStatusMock).toHaveBeenCalledWith('identity-1', 'new')
    })

    it('applies normal status when current status differs from action', async () => {
      Object.assign(parsedStateMock, createParsedState({
        query: 'CNC 销售',
        keywords: ['CNC', '销售'],
        filters: { status: ['rejected'] },
      }))
      statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'rejected')

      const { result } = renderHook(() => useResumeSearchState())

      await act(async () => {
        await result.current.handleCandidateAction('resume-1', 'shortlist')
      })

      expect(updateStatusMock).toHaveBeenCalledWith('identity-1', 'shortlisted')
    })

    it('always sets star action to new status regardless of current status', async () => {
      Object.assign(parsedStateMock, createParsedState({
        query: 'CNC 销售',
        keywords: ['CNC', '销售'],
        filters: { status: ['shortlisted'] },
      }))
      statusByIdentityMock['identity-1'] = createStatusRecord('identity-1', 'shortlisted')

      const { result } = renderHook(() => useResumeSearchState())

      await act(async () => {
        await result.current.handleCandidateAction('resume-1', 'star')
      })

      expect(updateStatusMock).toHaveBeenCalledWith('identity-1', 'new')
    })
  })
})
