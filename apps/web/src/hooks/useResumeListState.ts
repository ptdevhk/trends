import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildWorkHistoryEntryText,
  deriveMarketFromSourceKey,
  formatKeywordQuery,
  isCompanyWorkflowBlocked,
  isLocationMatch,
  selectLatestWorkHistory,
} from '@trends/shared'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useResumes, type ResumeItem } from '@/hooks/useResumes'
import {
  CONVEX_RESUME_PAGE_SIZE,
  DEFAULT_CONVEX_RESUME_LIMIT,
  MAX_CONVEX_RESUME_LIMIT,
  useConvexResumes,
  type ConvexResumeFilters,
  type ConvexResumeItem,
  type ConvexResumeSortBy,
} from '@/hooks/useConvexResumes'
import { useSession } from '@/hooks/useSession'
import { useAnalysisTasks } from '@/contexts/AnalysisTasksContext'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { useCandidateBlocks } from '@/hooks/useCandidateBlocks'
import { useCandidateStatus, type CandidateStatusRecord } from '@/hooks/useCandidateStatus'
import { matchResumeCompanyPolicyCached } from '@/hooks/useCompanyPolicyIndex'
import {
  areKeywordListsEqual,
  areUrlFiltersEqual,
  appendKeywordToken,
  buildSearchHistoryTitle,
  getResumeIdentityKey,
  getResumeLocationText,
  getRoleYears,
  hasMatchingRoleSignal,
  matchesAllRequiredKeywords,
  matchesEducationFilter,
  matchesSalaryFilter,
  normalizeFilterToken,
  normalizeOptionalString,
  normalizeUrlFilters,
  normalizeUrlSearchStateValue,
  parseExtractedAt,
  parseSerializedStringArray,
  resolveAnalysisSourceKeyForResume,
  serializeLocationFilter,
  taskMatchesCurrentSearch,
  toExperienceLevel,
  toStatusFilterList,
} from '@/hooks/resume-filter-helpers'
import {
  hasKnownUrlSearchParams,
  parseUrlSearchState,
  useUrlSearchState,
} from '@/hooks/useUrlSearchState'
import type { ExperienceLevelFilter } from '@/hooks/useUrlSearchState'
import { rawApiClient } from '@/lib/api-helpers'
import {
  getCurrentResumeAiPromptVersion,
} from '@/lib/analysis-utils'
import { resolveResumeRefreshState } from '@/lib/resume-freshness'
import { submitResumeExportDownload, type ResumeExportRequestBody } from '@/lib/resume-export'
import { getResumeAge, parseExperienceYears } from '@/lib/resume-filtering'
import { isResumeHomeResetState } from '@/lib/resume-home-navigation'
import type { ResumeSearchShareState, SearchHistoryItem } from '@/hooks/useSession'
import {
  aiFeedbackToActionType,
  type AiFeedbackSentiment,
  type AiFeedbackTarget,
  type CandidateActionType,
  type CandidateStatus,
  type MatchingResult,
  type ResumeExportFormat,
  type ResumeFilters,
} from '@/types/resume'
import {
  buildLearningObservation,
  buildResumeKey,
  computeDirectIndustryDb,
  getAnalysisForJob,
  getNameSortLocale,
  hasIngestData,
  isAutoFilteredAnalysis,
  overrideIndustryDbBreakdown,
  recommendationFromScore,
  toMatchBreakdown,
} from '@/lib/resume-scoring'
import type { CollectionSource } from '@/lib/search-profile-sources'
import { isReviewPacketsEnabled } from '@/lib/feature-flags'

const CARD_ACTION_TO_STATUS: Partial<Record<CandidateActionType, 'shortlisted' | 'rejected'>> = {
  shortlist: 'shortlisted',
  reject: 'rejected',
}

type JobDescriptionApiResponse = {
  success: boolean
  item?: {
    title?: string
  }
  content?: string
}

type SearchSessionApiResponse = {
  success: boolean
  session?: {
    id?: string
    shareTitle?: string
    searchState?: ResumeSearchShareState
  }
}

type ScoredConvexResume = ConvexResumeItem & {
  _ruleScore: number
}

type EnrichedResume = {
  resume: ConvexResumeItem | ResumeItem
  key: string
  identityKey: string
  blocked: boolean
  status: CandidateStatus
  statusMeta?: CandidateStatusRecord
  match?: MatchingResult
  ruleScore?: number
  action?: CandidateActionType | undefined
  userRating?: number
  refreshState: ReturnType<typeof resolveResumeRefreshState>
}

function resolveWorkspaceSlugFromPathname(pathname: string): string {
  const slug = pathname.split('/').filter(Boolean)[0]
  return slug && slug.length > 0 ? slug : 'dev'
}


function buildResumeFilterSearchText(resume: ConvexResumeItem): string {
  const parts = [
    resume.name,
    resume.education,
    getResumeLocationText(resume),
    resume.expectedSalary,
    ...selectLatestWorkHistory(resume.workHistory).map((entry) => buildWorkHistoryEntryText(entry)),
  ]

  return parts
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
    .join(' ')
}

export function useResumeListState(loadSearchHistory = false) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const {
    apiSessionId,
    location: sessionLocation,
    setLocation: setSessionLocation,
    keywords: sessionKeywords,
    setKeywords: setSessionKeywords,
    jobDescriptionId,
    setJobDescriptionId,
    collectionSource: sessionCollectionSource,
    setCollectionSource: setSessionCollectionSource,
    filters,
    setFilters,
    reviewedIdsSet,
    trackReviewedResume,
    applyExternalState,
    searchHistory,
    searchHistoryLoading,
    saveSearchHistory,
    markSearchHistoryOpened,
    ensureApiSession,
    rememberApiSessionId,
  } = useSession(loadSearchHistory)

  const {
    parsedState: parsedUrlState,
    hasUrlParams,
    hasKeywordParam,
    hasJobDescriptionParam,
    syncToUrl,
  } = useUrlSearchState()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkExportFormat, setBulkExportFormat] = useState<ResumeExportFormat>('csv')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [requiredKeywords, setRequiredKeywords] = useState<string[]>([])
  const [selectedExperienceLevel, setSelectedExperienceLevel] = useState<ExperienceLevelFilter | undefined>(undefined)
  const [appliedSearchHistoryId, setAppliedSearchHistoryId] = useState<string | undefined>(undefined)
  const [copiedShareSessionId, setCopiedShareSessionId] = useState<string | undefined>(undefined)
  const [copiedShareScopeSignature, setCopiedShareScopeSignature] = useState<string | undefined>(undefined)
  const [queryRuleScoreMap, setQueryRuleScoreMap] = useState<Record<string, number>>({})
  const [requestedConvexLimit, setRequestedConvexLimit] = useState(DEFAULT_CONVEX_RESUME_LIMIT)
  const [hasCompletedInitialConvexLoad, setHasCompletedInitialConvexLoad] = useState(false)
  const [mode] = useState<'ai'>('ai')
  const hydratedSessionIdRef = useRef<string | null>(null)
  const hasInitializedUrlHydrationRef = useRef(false)
  const lastAppliedUrlStateRef = useRef<string | null>(null)
  const skipNextUrlSyncRef = useRef(false)
  const isUrlPushingRef = useRef(false)
  const queryRuleScoreScopeRef = useRef<string | null>(null)
  const queryRuleScoreMapScopeRef = useRef<string | null>(null)
  const completedQueryRuleScoreIdsRef = useRef<Set<string>>(new Set())
  const initialWindowSearchStateRef = useRef<{
    hasUrlParams: boolean
    hasKeywordParam: boolean
    hasJobDescriptionParam: boolean
    parsedState: ReturnType<typeof parseUrlSearchState>
  } | null>(null)
  const [hasCompletedUrlHydration, setHasCompletedUrlHydration] = useState(false)
  const [hasCompletedShareSessionHydration, setHasCompletedShareSessionHydration] = useState(false)
  const hydratedShareSessionIdRef = useRef<string | null>(null)
  const [hydratedShareSessionTitle, setHydratedShareSessionTitle] = useState<string | undefined>(undefined)
  const [hydratedShareSessionReferenceNote, setHydratedShareSessionReferenceNote] = useState<string | undefined>(undefined)

  if (!initialWindowSearchStateRef.current) {
    const params = new URLSearchParams(window.location.search)
    initialWindowSearchStateRef.current = {
      hasUrlParams: hasKnownUrlSearchParams(params),
      hasKeywordParam: params.has('kw'),
      hasJobDescriptionParam: params.has('jd'),
      parsedState: normalizeUrlSearchStateValue(parseUrlSearchState(params)),
    }
  }

  const initialWindowSearchState = initialWindowSearchStateRef.current
  const session = useMemo(() => ({ id: 'convex', jobDescriptionId, filters }), [jobDescriptionId, filters])
  const normalizedParsedUrlState = useMemo(
    () => normalizeUrlSearchStateValue(parsedUrlState),
    [parsedUrlState]
  )
  const activeHasUrlParams = hasUrlParams
    || (!hasInitializedUrlHydrationRef.current && initialWindowSearchState.hasUrlParams)
  const activeHasKeywordParam = hasUrlParams
    ? hasKeywordParam
    : initialWindowSearchState.hasKeywordParam
  const activeHasJobDescriptionParam = hasUrlParams
    ? hasJobDescriptionParam
    : initialWindowSearchState.hasJobDescriptionParam
  const activeParsedUrlState = hasUrlParams
    ? normalizedParsedUrlState
    : initialWindowSearchState.parsedState
  const activeShareSessionId = normalizeOptionalString(parsedUrlState.shareSessionId)
    ?? (!hasInitializedUrlHydrationRef.current
      ? normalizeOptionalString(initialWindowSearchState.parsedState.shareSessionId)
      : undefined)
  const activeUrlStateSignature = useMemo(
    () => JSON.stringify({
      hasKeywordParam: activeHasKeywordParam,
      hasJobDescriptionParam: activeHasJobDescriptionParam,
      hasUrlParams: activeHasUrlParams,
      location: activeParsedUrlState.location ?? '',
      keywords: activeParsedUrlState.keywords,
      requiredKeywords: activeParsedUrlState.requiredKeywords,
      jobDescriptionId: activeParsedUrlState.jobDescriptionId ?? '',
      selectedTags: activeParsedUrlState.selectedTags,
      selectedCompanies: activeParsedUrlState.selectedCompanies,
      selectedExperienceLevel: activeParsedUrlState.selectedExperienceLevel ?? '',
      filters: normalizeUrlFilters(activeParsedUrlState.filters),
    }),
    [activeHasJobDescriptionParam, activeHasKeywordParam, activeHasUrlParams, activeParsedUrlState]
  )
  const hasCompletedSearchHydration = hasCompletedUrlHydration && hasCompletedShareSessionHydration

  const {
    resumes,
    summary,
    loading,
    error,
    selectedSample,
    refresh,
    reloadSamples,
  } = useResumes({
    limit: 200,
    autoFetch: false,
    loadSamples: false,
    sessionId: undefined,
    jobDescriptionId,
  })

  const sessionActionScope = useMemo(() => {
    const normalizedJobDescriptionId = jobDescriptionId?.trim()
    const normalizedKeywords = sessionKeywords
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0)
      .sort()
    return normalizedJobDescriptionId || normalizedKeywords.join('|') || 'global'
  }, [jobDescriptionId, sessionKeywords])

  const expandedQuery = useMemo(() => {
    const kw = formatKeywordQuery(sessionKeywords).trim()
    if (!kw) return undefined
    return kw
  }, [sessionKeywords])

  const convexSourceSortBy = useMemo<ConvexResumeSortBy | undefined>(() => {
    if (filters.sortBy === 'experience' || filters.sortBy === 'extractedAt') {
      return filters.sortBy
    }
    return undefined
  }, [filters.sortBy])
  const convexSourceSortOrder = useMemo(
    () => (convexSourceSortBy ? (filters.sortOrder ?? 'desc') : undefined),
    [convexSourceSortBy, filters.sortOrder]
  )
  const convexSourceFilters = useMemo<ConvexResumeFilters | undefined>(() => {
    const normalized: ConvexResumeFilters = {
      ...(typeof filters.maxExperience === 'number' ? { maxExperience: filters.maxExperience } : {}),
      ...(typeof filters.minRoleYears === 'number' && filters.minRoleYears > 0 ? { minRoleYears: filters.minRoleYears } : {}),
      ...(filters.roleFilterType ? { roleFilterType: filters.roleFilterType } : {}),
      ...(typeof filters.minAge === 'number' ? { minAge: filters.minAge } : {}),
      ...(typeof filters.maxAge === 'number' ? { maxAge: filters.maxAge } : {}),
      ...(Array.isArray(filters.education) && filters.education.length > 0 ? { education: filters.education } : {}),
      ...(Array.isArray(filters.skills) && filters.skills.length > 0 ? { skills: filters.skills } : {}),
      ...(requiredKeywords.length > 0 ? { requiredKeywords } : {}),
      ...(Array.isArray(filters.locations) && filters.locations.length > 0 ? { locations: filters.locations } : {}),
      ...(typeof filters.minSalary === 'number' ? { minSalary: filters.minSalary } : {}),
      ...(typeof filters.maxSalary === 'number' ? { maxSalary: filters.maxSalary } : {}),
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined
  }, [filters.education, filters.locations, filters.maxAge, filters.maxExperience, filters.maxSalary, filters.minAge, filters.minRoleYears, filters.minSalary, filters.roleFilterType, filters.skills, requiredKeywords])
  const convexQueryScopeKey = useMemo(
    () => JSON.stringify({
      jobDescriptionId: jobDescriptionId?.trim() ?? '',
      query: expandedQuery ?? '',
      sortBy: convexSourceSortBy ?? '',
      sortOrder: convexSourceSortOrder ?? '',
      filters: convexSourceFilters ?? null,
    }),
    [convexSourceFilters, convexSourceSortBy, convexSourceSortOrder, expandedQuery, jobDescriptionId]
  )
  const {
    resumes: convexResumes,
    loading: convexLoading,
    loadingMore: convexLoadingMore,
    hasMore: convexHasMore,
  } = useConvexResumes(requestedConvexLimit, expandedQuery, jobDescriptionId, {
    filters: convexSourceFilters,
    sortBy: convexSourceSortBy,
    sortOrder: convexSourceSortOrder,
  })
  useEffect(() => {
    if (mode !== 'ai' || !convexLoading) {
      setHasCompletedInitialConvexLoad(true)
    }
  }, [convexLoading, mode])

  const auxiliaryResumeDataEnabled = mode !== 'ai' || hasCompletedInitialConvexLoad
  const { actions, ratingsByResume, commentsByResume, saveAction, getAiFeedback } = useCandidateActions(
    sessionActionScope,
    jobDescriptionId,
    auxiliaryResumeDataEnabled,
  )
  const { blocksByIdentity, blockCandidates, unblockCandidate } = useCandidateBlocks(auxiliaryResumeDataEnabled)
  const { statusByIdentity, updateStatus: updateCandidateStatus } = useCandidateStatus(auxiliaryResumeDataEnabled)
  const { tasks: analysisTasks, dispatch: dispatchAnalysis } = useAnalysisTasks()
  const [analyzing, setAnalyzing] = useState(false)
  const [lastDispatchTime, setLastDispatchTime] = useState<number>(0)
  const DISPATCH_COOLDOWN_MS = 2000
  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || '/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])
  const currentPromptVersion = getCurrentResumeAiPromptVersion()
  const keywordOnlyQueryScoring = sessionKeywords.length > 0 && !jobDescriptionId?.trim()
  const querySpecificKeywordsKey = useMemo(
    () => JSON.stringify(sessionKeywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0)),
    [sessionKeywords]
  )
  const querySpecificResumeIdsKey = useMemo(
    () =>
      JSON.stringify(
        Array.from(new Set(convexResumes.map((resume) => String(resume.resumeId)))).sort()
      ),
    [convexResumes]
  )
  const querySpecificScoreScopeKey = useMemo(
    () => `${sessionLocation.trim()}::${querySpecificKeywordsKey}`,
    [querySpecificKeywordsKey, sessionLocation]
  )
  const querySpecificScoreRequest = useMemo(() => {
    if (!keywordOnlyQueryScoring) {
      return null
    }

    const keywords = parseSerializedStringArray(querySpecificKeywordsKey)
    const resumeIds = parseSerializedStringArray(querySpecificResumeIdsKey)
    if (keywords.length === 0 || resumeIds.length === 0) {
      return null
    }

    return {
      keywords,
      location: sessionLocation.trim(),
      resumeIds,
      scopeKey: querySpecificScoreScopeKey,
    }
  }, [keywordOnlyQueryScoring, querySpecificKeywordsKey, querySpecificResumeIdsKey, querySpecificScoreScopeKey, sessionLocation])

  const activeLoading = mode === 'ai' ? convexLoading : loading
  const loadedConvexResumeCount = convexResumes.length
  const canLoadMoreResumes = mode === 'ai'
    && convexHasMore
    && requestedConvexLimit < MAX_CONVEX_RESUME_LIMIT
  const hasActiveTask = useMemo(() => {
    if (analysisTasks.length === 0) {
      return false
    }
    return analysisTasks.some((task) =>
      taskMatchesCurrentSearch(task, jobDescriptionId, sessionKeywords, sessionLocation, currentPromptVersion)
    )
  }, [analysisTasks, currentPromptVersion, jobDescriptionId, sessionKeywords, sessionLocation])

  useEffect(() => {
    if (!querySpecificScoreRequest) {
      queryRuleScoreScopeRef.current = null
      queryRuleScoreMapScopeRef.current = null
      completedQueryRuleScoreIdsRef.current = new Set()
      setQueryRuleScoreMap((current) => (Object.keys(current).length === 0 ? current : {}))
      return
    }

    if (queryRuleScoreScopeRef.current === querySpecificScoreRequest.scopeKey) {
      return
    }

    queryRuleScoreScopeRef.current = querySpecificScoreRequest.scopeKey
    queryRuleScoreMapScopeRef.current = null
    completedQueryRuleScoreIdsRef.current = new Set()
    setQueryRuleScoreMap((current) => (Object.keys(current).length === 0 ? current : {}))
  }, [querySpecificScoreRequest])

  useEffect(() => {
    let active = true

    if (!querySpecificScoreRequest) {
      return () => {
        active = false
      }
    }

    const activeQueryRuleScoreMap = queryRuleScoreMapScopeRef.current === querySpecificScoreRequest.scopeKey
      ? queryRuleScoreMap
      : {}
    const pendingResumeIds = querySpecificScoreRequest.resumeIds.filter((resumeId) =>
      activeQueryRuleScoreMap[resumeId] === undefined && !completedQueryRuleScoreIdsRef.current.has(resumeId)
    )

    if (pendingResumeIds.length === 0) {
      return () => {
        active = false
      }
    }

    for (const resumeId of pendingResumeIds) {
      completedQueryRuleScoreIdsRef.current.add(resumeId)
    }

    const scopeKey = querySpecificScoreRequest.scopeKey

    void rawApiClient
      .POST<{
        success: boolean
        results?: Array<{
          resumeId: string
          score: number
        }>
      }>('/api/resumes/match', {
        body: {
          source: 'convex',
          persist: false,
          mode: 'rules_only',
          keywords: querySpecificScoreRequest.keywords,
          location: querySpecificScoreRequest.location,
          resumeIds: pendingResumeIds,
        },
      })
      .then(({ data, error }) => {
        if (!active || queryRuleScoreScopeRef.current !== scopeKey) {
          return
        }

        if (error || !data?.success) {
          for (const resumeId of pendingResumeIds) {
            completedQueryRuleScoreIdsRef.current.delete(resumeId)
          }
          return
        }

        queryRuleScoreMapScopeRef.current = scopeKey
        setQueryRuleScoreMap((current) => {
          let changed = false
          const nextMap = { ...current }

          for (const item of data.results ?? []) {
            if (nextMap[item.resumeId] === item.score) {
              continue
            }

            nextMap[item.resumeId] = item.score
            changed = true
          }

          return changed ? nextMap : current
        })
      })
      .catch((error: unknown) => {
        console.error('Failed to load query-specific resume scores', error)
        if (active && queryRuleScoreScopeRef.current === scopeKey) {
          for (const resumeId of pendingResumeIds) {
            completedQueryRuleScoreIdsRef.current.delete(resumeId)
          }
        }
      })

    return () => {
      active = false
    }
  }, [queryRuleScoreMap, querySpecificScoreRequest])

  useEffect(() => {
    setRequestedConvexLimit(DEFAULT_CONVEX_RESUME_LIMIT)
  }, [convexQueryScopeKey])

  useEffect(() => {
    if (!activeHasUrlParams) {
      hasInitializedUrlHydrationRef.current = true
      lastAppliedUrlStateRef.current = null
      setHasCompletedUrlHydration(true)
      return
    }

    if (isUrlPushingRef.current) {
      isUrlPushingRef.current = false
      lastAppliedUrlStateRef.current = activeUrlStateSignature
      return
    }

    if (lastAppliedUrlStateRef.current === activeUrlStateSignature) {
      return
    }

    hasInitializedUrlHydrationRef.current = true
    setHasCompletedUrlHydration(false)
    lastAppliedUrlStateRef.current = activeUrlStateSignature
    const jobDescriptionIdForExternalState =
      activeHasJobDescriptionParam
        ? (activeParsedUrlState.jobDescriptionId ?? '')
        : activeParsedUrlState.jobDescriptionId

    skipNextUrlSyncRef.current = true
    applyExternalState({
      location: activeParsedUrlState.location,
      keywords: activeParsedUrlState.keywords,
      jobDescriptionId: jobDescriptionIdForExternalState,
      collectionSource: null,
      filters: activeParsedUrlState.filters,
    })
    setSelectedTags(activeParsedUrlState.selectedTags)
    setSelectedCompanies(activeParsedUrlState.selectedCompanies)
    setRequiredKeywords(activeParsedUrlState.requiredKeywords)
    setSelectedExperienceLevel(activeParsedUrlState.selectedExperienceLevel)
  }, [
    applyExternalState,
    activeHasJobDescriptionParam,
    activeHasUrlParams,
    activeParsedUrlState,
    activeUrlStateSignature,
  ])

  const hasHydratedUrlState = useMemo(() => {
    if (!activeHasUrlParams) {
      return true
    }

    const currentLocation = normalizeOptionalString(sessionLocation)
    const expectedLocation = normalizeOptionalString(activeParsedUrlState.location)
    if (expectedLocation && currentLocation !== expectedLocation) {
      return false
    }

    if (!areKeywordListsEqual(sessionKeywords, activeParsedUrlState.keywords)) {
      return false
    }

    const expectedJobDescriptionId =
      activeHasJobDescriptionParam
        ? normalizeOptionalString(activeParsedUrlState.jobDescriptionId) ?? ''
        : normalizeOptionalString(activeParsedUrlState.jobDescriptionId) ?? ''
    const currentJobDescriptionId = normalizeOptionalString(jobDescriptionId) ?? ''
    if (currentJobDescriptionId !== expectedJobDescriptionId) {
      return false
    }

    if (!areUrlFiltersEqual(filters, activeParsedUrlState.filters)) {
      return false
    }

    if (!areKeywordListsEqual(selectedTags, activeParsedUrlState.selectedTags)) {
      return false
    }

    if (!areKeywordListsEqual(selectedCompanies, activeParsedUrlState.selectedCompanies)) {
      return false
    }

    return (selectedExperienceLevel ?? '') === (activeParsedUrlState.selectedExperienceLevel ?? '')
  }, [
    activeHasJobDescriptionParam,
    activeHasUrlParams,
    activeParsedUrlState,
    filters,
    jobDescriptionId,
    selectedCompanies,
    selectedExperienceLevel,
    selectedTags,
    sessionKeywords,
    sessionLocation,
  ])

  useEffect(() => {
    if (!activeHasUrlParams || hasCompletedUrlHydration || hasHydratedUrlState) {
      return
    }

    const jobDescriptionIdForExternalState =
      activeHasJobDescriptionParam
        ? (activeParsedUrlState.jobDescriptionId ?? '')
        : activeParsedUrlState.jobDescriptionId

    skipNextUrlSyncRef.current = true
    applyExternalState({
      location: activeParsedUrlState.location,
      keywords: activeParsedUrlState.keywords,
      jobDescriptionId: jobDescriptionIdForExternalState,
      collectionSource: null,
      filters: activeParsedUrlState.filters,
    })
    setSelectedTags((current) =>
      areKeywordListsEqual(current, activeParsedUrlState.selectedTags)
        ? current
        : activeParsedUrlState.selectedTags
    )
    setSelectedCompanies((current) =>
      areKeywordListsEqual(current, activeParsedUrlState.selectedCompanies)
        ? current
        : activeParsedUrlState.selectedCompanies
    )
    setRequiredKeywords((current) =>
      areKeywordListsEqual(current, activeParsedUrlState.requiredKeywords)
        ? current
        : activeParsedUrlState.requiredKeywords
    )
    setSelectedExperienceLevel((current) =>
      (current ?? '') === (activeParsedUrlState.selectedExperienceLevel ?? '')
        ? current
        : activeParsedUrlState.selectedExperienceLevel
    )
  }, [
    activeHasJobDescriptionParam,
    activeHasUrlParams,
    activeParsedUrlState,
    applyExternalState,
    hasCompletedUrlHydration,
    hasHydratedUrlState,
  ])

  useEffect(() => {
    if (hasCompletedUrlHydration) {
      return
    }

    if (hasHydratedUrlState) {
      setHasCompletedUrlHydration(true)
    }
  }, [hasCompletedUrlHydration, hasHydratedUrlState])

  useEffect(() => {
    if (activeHasUrlParams) {
      hydratedShareSessionIdRef.current = null
      setHydratedShareSessionTitle(undefined)
      setHasCompletedShareSessionHydration(true)
      return
    }

    if (!activeShareSessionId) {
      hydratedShareSessionIdRef.current = null
      setHydratedShareSessionTitle(undefined)
      setHasCompletedShareSessionHydration(true)
      return
    }

    if (hydratedShareSessionIdRef.current === activeShareSessionId) {
      setHasCompletedShareSessionHydration(true)
      return
    }

    let active = true
    hydratedShareSessionIdRef.current = activeShareSessionId
    setHasCompletedShareSessionHydration(false)
    setHydratedShareSessionReferenceNote(undefined)

    void rawApiClient
      .GET<SearchSessionApiResponse>(`/api/sessions/${encodeURIComponent(activeShareSessionId)}`)
      .then(({ data, error }) => {
        if (!active) {
          return
        }

        const sharedSearchState = data?.session?.searchState
        if (error || !data?.success || !sharedSearchState) {
          console.error('Failed to hydrate shared search session', error ?? data)
          setHydratedShareSessionTitle(undefined)
          setHydratedShareSessionReferenceNote(undefined)
          setHasCompletedShareSessionHydration(true)
          return
        }

        skipNextUrlSyncRef.current = true
        rememberApiSessionId(activeShareSessionId)
        setHydratedShareSessionTitle(
          normalizeOptionalString(data.session?.shareTitle)
            ?? buildSearchHistoryTitle(
              sharedSearchState.location ?? '',
              sharedSearchState.keywords ?? [],
              sharedSearchState.jobDescriptionId,
            )
        )
        setHydratedShareSessionReferenceNote(normalizeOptionalString(sharedSearchState.referenceNote))
        applyExternalState({
          location: sharedSearchState.location,
          keywords: sharedSearchState.keywords,
          jobDescriptionId: sharedSearchState.jobDescriptionId ?? '',
          collectionSource: sharedSearchState.collectionSource ?? null,

          filters: sharedSearchState.filters ?? {},
        })
        setAppliedSearchHistoryId(undefined)
        setSelectedTags(sharedSearchState.selectedTags ?? [])
        setSelectedCompanies(sharedSearchState.selectedCompanies ?? [])
        setRequiredKeywords(sharedSearchState.requiredKeywords ?? [])
        setSelectedExperienceLevel(sharedSearchState.selectedExperienceLevel)
        setHasCompletedShareSessionHydration(true)
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }

        console.error('Failed to hydrate shared search session', error)
        setHydratedShareSessionTitle(undefined)
        setHydratedShareSessionReferenceNote(undefined)
        setHasCompletedShareSessionHydration(true)
      })

    return () => {
      active = false
    }
  }, [
    activeHasUrlParams,
    activeShareSessionId,
    applyExternalState,
    rememberApiSessionId,
  ])

  useEffect(() => {
    if (!hasCompletedSearchHydration) {
      return
    }

    if (skipNextUrlSyncRef.current) {
      skipNextUrlSyncRef.current = false
      return
    }

    const timer = window.setTimeout(() => {
      const normalizedLocation = sessionLocation.trim()
      const locationForUrl =
        normalizedLocation.length > 0
          ? normalizedLocation
          : undefined
      const locationFilters = locationForUrl
        ? locationForUrl.split(/[,，、]+/).map((item) => item.trim()).filter(Boolean)
        : undefined
      const filtersForUrl: Partial<ResumeFilters> = {
        ...filters,
        locations: locationFilters,
      }

      isUrlPushingRef.current = true
      syncToUrl({
        location: locationForUrl,
        keywords: sessionKeywords,
        requiredKeywords,
        jobDescriptionId,
        selectedTags,
        selectedCompanies,
        selectedSources: [],
        selectedBrands: [],
        selectedExperienceLevel,
        filters: filtersForUrl,
      })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [
    filters,
    hasCompletedSearchHydration,
    jobDescriptionId,
    requiredKeywords,
    selectedCompanies,
    selectedExperienceLevel,
    selectedTags,
    sessionKeywords,
    sessionLocation,
    syncToUrl,
  ])

  const filteredConvexResumes = useMemo(() => {
    let result: ScoredConvexResume[] = convexResumes
      .filter((resume: ConvexResumeItem) =>
        !sessionCollectionSource
        || resolveAnalysisSourceKeyForResume(resume, undefined) === sessionCollectionSource.type
      )
      .filter((resume: ConvexResumeItem) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords, {
          location: sessionLocation,
          promptVersion: currentPromptVersion,
          sourceKey: resolveAnalysisSourceKeyForResume(resume, sessionCollectionSource),
        })
        return !isAutoFilteredAnalysis(analysis)
      })
      .map((resume: ConvexResumeItem) => {
        const querySpecificRuleScore = keywordOnlyQueryScoring
          ? queryRuleScoreMap[String(resume.resumeId)]
          : undefined
        return {
          ...resume,
          _ruleScore:
            typeof querySpecificRuleScore === 'number'
              ? querySpecificRuleScore
              : (resume.primaryRuleScore ?? 0),
        }
      })

    if (!convexSourceSortBy) {
      result = [...result].sort((a: ScoredConvexResume, b: ScoredConvexResume) => b._ruleScore - a._ruleScore)
    }

    const showBlocked = filters.showBlocked === true
    if (!showBlocked) {
      result = result.filter((resume: ScoredConvexResume) => {
        const identityKey = getResumeIdentityKey(resume, String(resume.resumeId))
        return !blocksByIdentity[identityKey]
      })
    }

    const statusFilterActive = filters.status?.length
    const showRejected = filters.showRejected === true

    if (statusFilterActive) {
      const activeStatuses = new Set(toStatusFilterList(filters.status))
      result = result.filter((resume: ScoredConvexResume) => {
        const identityKey = getResumeIdentityKey(resume, String(resume.resumeId))
        const status = statusByIdentity[identityKey]?.status ?? 'new'
        return activeStatuses.has(status)
      })
    } else {
      // Default: show only new (untriaged) resumes.
      // The "Show rejected candidates" toggle adds rejected on top.
      result = result.filter((resume: ScoredConvexResume) => {
        const identityKey = getResumeIdentityKey(resume, String(resume.resumeId))
        const status = statusByIdentity[identityKey]?.status ?? 'new'
        if (status === 'new') return true
        if (showRejected && status === 'rejected') return true
        return false
      })
    }

    if (filters.locations?.length) {
      const locations = filters.locations
      result = result.filter((resume: ScoredConvexResume) =>
        locations.some((location) => isLocationMatch(getResumeLocationText(resume), location))
      )
    }

    const maxExperience = filters.maxExperience
    if (typeof maxExperience === 'number') {
      result = result.filter((resume: ScoredConvexResume) => {
        const expYears = parseExperienceYears(resume.experience)
        // Unknown experience — cannot guarantee cap, exclude
        if (expYears === 0 && !resume.experience) return false
        return expYears <= maxExperience
      })
    }

    const minRoleYears = filters.minRoleYears
    if (filters.roleFilterType) {
      result = result.filter((resume: ScoredConvexResume) =>
        hasMatchingRoleSignal(resume, filters.roleFilterType)
      )
    }
    if (typeof minRoleYears === 'number') {
      result = result.filter((resume: ScoredConvexResume) =>
        getRoleYears(resume, filters.roleFilterType ?? '') >= minRoleYears
      )
    }

    const minAge = filters.minAge
    const maxAge = filters.maxAge
    if (typeof minAge === 'number' || typeof maxAge === 'number') {
      result = result.filter((resume: ScoredConvexResume) => {
        const age = getResumeAge(resume)
        if (age === null) {
          return true
        }

        if (typeof minAge === 'number' && age < minAge) {
          return false
        }

        if (typeof maxAge === 'number' && age > maxAge) {
          return false
        }

        return true
      })
    }

    if (filters.education?.length) {
      result = result.filter((resume: ScoredConvexResume) =>
        matchesEducationFilter(resume.education, filters.education ?? [])
      )
    }

    if (filters.skills?.length) {
      result = result.filter((resume: ScoredConvexResume) => {
        const haystack = buildResumeFilterSearchText(resume)
        return filters.skills?.some((skill) => haystack.includes(normalizeFilterToken(skill))) ?? false
      })
    }

    if (typeof filters.minSalary === 'number' || typeof filters.maxSalary === 'number') {
      result = result.filter((resume: ScoredConvexResume) =>
        matchesSalaryFilter(resume.expectedSalary, filters.minSalary, filters.maxSalary),
      )
    }

    const minMatchScore = filters.minMatchScore
    if (typeof minMatchScore === 'number') {
      result = result.filter((resume: ScoredConvexResume) => {
        const rScore = resume._ruleScore
        if (rScore > 0) {
          return rScore >= minMatchScore
        }
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords, {
          location: sessionLocation,
          promptVersion: currentPromptVersion,
          sourceKey: resolveAnalysisSourceKeyForResume(resume, sessionCollectionSource),
        })
        return (analysis?.score ?? 0) >= minMatchScore
      })
    }

    if (selectedTags.length > 0) {
      const activeTagSet = new Set(selectedTags.map(normalizeFilterToken))
      result = result.filter((resume: ScoredConvexResume) =>
        (resume.ingestData?.industryTags ?? []).some((tag) => activeTagSet.has(normalizeFilterToken(tag)))
      )
    }

    if (selectedCompanies.length > 0) {
      const activeCompanySet = new Set(selectedCompanies.map(normalizeFilterToken))
      result = result.filter((resume: ScoredConvexResume) =>
        (resume.ingestData?.companyHits ?? []).some((company) => activeCompanySet.has(normalizeFilterToken(company)))
      )
    }

    if (selectedExperienceLevel) {
      result = result.filter((resume: ScoredConvexResume) =>
        normalizeFilterToken(resume.ingestData?.experienceLevel ?? '') === selectedExperienceLevel
      )
    }

    if (requiredKeywords.length > 0) {
      result = result.filter((resume: ScoredConvexResume) => {
        const text = buildResumeFilterSearchText(resume)
        return matchesAllRequiredKeywords(text, requiredKeywords)
      })
    }

    return result
  }, [
    blocksByIdentity,
    convexResumes,
    filters,
    jobDescriptionId,
    keywordOnlyQueryScoring,
    queryRuleScoreMap,
    requiredKeywords,
    selectedCompanies,
    selectedExperienceLevel,
    selectedTags,
    currentPromptVersion,
    convexSourceSortBy,
    sessionKeywords,
    sessionCollectionSource,
    sessionLocation,
    statusByIdentity,
  ])

  useEffect(() => {
    if (!session?.id) return
    if (hydratedSessionIdRef.current === session.id) return
    hydratedSessionIdRef.current = session.id
  }, [filters.minMatchScore, filters.skills?.length, session])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [mode, jobDescriptionId, expandedQuery])

  const handleRefresh = useCallback(async () => {
    if (mode === 'ai') {
      setRequestedConvexLimit(DEFAULT_CONVEX_RESUME_LIMIT)
      return
    }
    await reloadSamples()
    await refresh()
  }, [mode, refresh, reloadSamples])

  const handleLoadMoreResumes = useCallback(() => {
    setRequestedConvexLimit((current) => (
      current >= MAX_CONVEX_RESUME_LIMIT
        ? current
        : Math.min(current + CONVEX_RESUME_PAGE_SIZE, MAX_CONVEX_RESUME_LIMIT)
    ))
  }, [])

  const handleJobChange = useCallback(
    (value: string) => {
      setJobDescriptionId(value)
    },
    [setJobDescriptionId]
  )

  const handleAnalyzeAll = useCallback(async () => {
    if (!convexResumes.length) return
    if (!jobDescriptionId && sessionKeywords.length === 0) return
    if (!dispatchAnalysis) {
      toast.error(t('aiTasks.error'))
      return
    }
    if (hasActiveTask) {
      toast.info(t('aiTasks.waitForCompletion', 'Please wait for current analysis to complete.'))
      return
    }

    const now = Date.now()
    if (now - lastDispatchTime < DISPATCH_COOLDOWN_MS) {
      toast.info(t('aiTasks.waitForCompletion', 'Please wait for current analysis to complete.'))
      return
    }

    setAnalyzing(true)
    try {
      const candidatesToAnalyze = filteredConvexResumes
        .filter((resume: ConvexResumeItem) =>
          !getAnalysisForJob(resume, jobDescriptionId, sessionKeywords, {
            location: sessionLocation,
            promptVersion: currentPromptVersion,
            sourceKey: resolveAnalysisSourceKeyForResume(resume, sessionCollectionSource),
          })
        )

      if (candidatesToAnalyze.length === 0) {
        toast.info(t('aiTasks.noNewCandidates', 'No new candidates to analyze among top matches.'))
        setAnalyzing(false)
        return
      }

      const resumeIds = candidatesToAnalyze.map((resume: ConvexResumeItem) => resume.resumeId)
      const normalizedKeywords = sessionKeywords
        .map((keyword) => keyword.trim().toLowerCase())
        .filter((keyword) => keyword.length > 0)

      if (!jobDescriptionId && normalizedKeywords.length > 0) {
        const matchCount = candidatesToAnalyze.filter((resume) => {
          const text = JSON.stringify(resume).toLowerCase()
          return normalizedKeywords.some((keyword) => text.includes(keyword))
        }).length

        if (matchCount === 0) {
          toast.warning(
            t(
              'aiTasks.lowKeywordMatch',
              'Keywords may not match displayed resumes. Consider collecting new resumes first.'
            )
          )
        }
      }

      if (jobDescriptionId) {
        let jdContent = ''
        let jdTitle = ''
        try {
          const { data } = await rawApiClient.GET<JobDescriptionApiResponse>(
            `/api/job-descriptions/${jobDescriptionId}`
          )
          if (data?.success && data.content) {
            jdTitle = data.item?.title || jobDescriptionId
            jdContent = data.content
          }
        } catch (error) {
          console.error('Failed to fetch JD', error)
        }

        await dispatchAnalysis({
          jobDescriptionId,
          jobDescriptionTitle: jdTitle || undefined,
          jobDescriptionContent: jdContent || undefined,
          location: sessionLocation.trim() || undefined,
          promptVersion: currentPromptVersion,
          sample: selectedSample || undefined,
          resumeIds,
        })
      } else if (sessionKeywords.length > 0) {
        await dispatchAnalysis({
          keywords: sessionKeywords,
          location: sessionLocation.trim() || undefined,
          promptVersion: currentPromptVersion,
          sample: selectedSample || undefined,
          resumeIds,
        })
      }

      setLastDispatchTime(Date.now())
      toast.success(t('aiTasks.dispatchedTop', { count: resumeIds.length, defaultValue: `Analyzing top ${resumeIds.length} candidates...` }))
    } catch (error) {
      console.error(error)
      toast.error(t('aiTasks.error'))
    } finally {
      setAnalyzing(false)
    }
  }, [
    convexResumes.length,
    dispatchAnalysis,
    filteredConvexResumes,
    hasActiveTask,
    jobDescriptionId,
    lastDispatchTime,
    currentPromptVersion,
    selectedSample,
    sessionCollectionSource,
    sessionKeywords,
    sessionLocation,
    t,
  ])

  const handleFiltersChange = useCallback(
    (nextFilters: typeof filters) => {
      const nextLocations = Array.isArray(nextFilters.locations) ? nextFilters.locations : undefined
      const currentLocations = Array.isArray(filters.locations) ? filters.locations : undefined
      const shouldSyncLocation =
        nextLocations !== undefined
        || (currentLocations?.length ?? 0) > 0

      if (shouldSyncLocation) {
        const nextLocation = serializeLocationFilter(nextLocations)
        setSessionLocation((current) => (current === nextLocation ? current : nextLocation))
      }

      setFilters(nextFilters)
    },
    [filters.locations, setFilters, setSessionLocation]
  )

  const handleToggleTag = useCallback((tag: string) => {
    setSessionKeywords((current) => appendKeywordToken(current, tag))
  }, [setSessionKeywords])

  const handleToggleCompany = useCallback((company: string) => {
    setSessionKeywords((current) => appendKeywordToken(current, company))
  }, [setSessionKeywords])

  const handleToggleExperienceLevel = useCallback((level: string | undefined) => {
    const normalizedLevel = toExperienceLevel(level)
    if (!normalizedLevel) {
      return
    }

    setSelectedExperienceLevel((current) => (current === normalizedLevel ? undefined : normalizedLevel))
  }, [])

  const handleClearLocation = useCallback(() => {
    setSessionLocation('')
    setFilters((current) => ({
      ...current,
      locations: [],
    }))
  }, [setFilters, setSessionLocation])

  const handleClearTagFilters = useCallback(() => {
    setSelectedTags([])
    setSelectedCompanies([])
    setSelectedExperienceLevel(undefined)
    handleClearLocation()
  }, [handleClearLocation])

  const activeTagFilters = useMemo(
    () => new Set(selectedTags.map(normalizeFilterToken)),
    [selectedTags]
  )

  const activeCompanyFilters = useMemo(
    () => new Set(selectedCompanies.map(normalizeFilterToken)),
    [selectedCompanies]
  )

  const appliedSearchHistory = useMemo(
    () => searchHistory.find((entry) => entry.id === appliedSearchHistoryId),
    [appliedSearchHistoryId, searchHistory]
  )
  const continuityReferenceNote = useMemo(
    () => normalizeOptionalString(appliedSearchHistory?.notes) ?? hydratedShareSessionReferenceNote,
    [appliedSearchHistory?.notes, hydratedShareSessionReferenceNote]
  )

  const enrichedResumes = useMemo<EnrichedResume[]>(() => {
    if (mode === 'ai') {
      return filteredConvexResumes.map((resume: ScoredConvexResume, index: number) => {
        const resumeKey = buildResumeKey(resume, index)
        const identityKey = getResumeIdentityKey(resume, resumeKey)
        const analysisSourceKey = resolveAnalysisSourceKeyForResume(resume, sessionCollectionSource)
        const refreshState = resolveResumeRefreshState({
          resume,
          analysisContext: {
            jobDescriptionId,
            keywords: sessionKeywords,
            location: sessionLocation,
            sourceKey: analysisSourceKey,
          },
          currentPromptVersion: currentPromptVersion,
        })
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords, {
          location: sessionLocation,
          promptVersion: currentPromptVersion,
          sourceKey: analysisSourceKey,
        })
        const isAnalysisValid = !jobDescriptionId || analysis?.jobDescriptionId === jobDescriptionId
        const ingestData = resume.ingestData
        const hasBrandHits = (ingestData?.brandHits ?? []).some((hit) => hit.context !== 'employer')
        const hasCompanyHits = (ingestData?.companyHits?.length ?? 0) > 0
        const normalizedAnalysis = analysis && isAnalysisValid
          ? overrideIndustryDbBreakdown(
              analysis,
              computeDirectIndustryDb(
                ingestData?.industryDbV2Raw,
                hasBrandHits,
                hasCompanyHits,
              ),
              ingestData?.market ?? deriveMarketFromSourceKey(analysisSourceKey),
            )
          : undefined

        const match: MatchingResult | undefined = normalizedAnalysis
          ? {
            resumeId: resumeKey,
            score: normalizedAnalysis.score,
            summary: normalizedAnalysis.summary,
            highlights: normalizedAnalysis.highlights,
            recommendation: recommendationFromScore(normalizedAnalysis.score),
            concerns: normalizedAnalysis.concerns ?? [],
            breakdown: toMatchBreakdown(normalizedAnalysis.breakdown),
            scoreSource: 'ai',
            matchedAt: new Date().toISOString(),
            jobDescriptionId: normalizedAnalysis.jobDescriptionId,
            promptVersion: normalizedAnalysis.promptVersion,
            locale: normalizedAnalysis.locale,
          }
          : undefined

        return {
          resume,
          key: resumeKey,
          identityKey,
          blocked: Boolean(blocksByIdentity[identityKey]),
          status: statusByIdentity[identityKey]?.status ?? 'new',
          statusMeta: statusByIdentity[identityKey],
          match,
          ruleScore: resume._ruleScore || 0,
          action: actions[resumeKey],
          userRating: ratingsByResume[resumeKey],
          refreshState,
        }
      })
    }

    return resumes.map((resume, index) => {
      const resumeKey = buildResumeKey(resume, index)
      const refreshState = resolveResumeRefreshState({
        resume,
        analysisContext: {
          jobDescriptionId,
          keywords: sessionKeywords,
          location: sessionLocation,
          sourceKey: resolveAnalysisSourceKeyForResume(resume, sessionCollectionSource),
        },
        currentPromptVersion: currentPromptVersion,
      })
      return {
        resume,
        key: resumeKey,
        identityKey: resumeKey,
        blocked: false,
        status: 'new',
        statusMeta: undefined,
        match: undefined,
        ruleScore: 0,
        action: actions[resumeKey],
        userRating: ratingsByResume[resumeKey],
        refreshState,
      }
    })
  }, [
    actions,
    ratingsByResume,
    blocksByIdentity,
    currentPromptVersion,
    filteredConvexResumes,
    jobDescriptionId,
    mode,
    resumes,
    sessionCollectionSource,
    sessionKeywords,
    sessionLocation,
    statusByIdentity,
  ])

  const displayedResumes = useMemo(() => {
    if (mode === 'ai' && convexSourceSortBy) {
      return enrichedResumes
    }

    const sortBy = filters.sortBy ?? 'extractedAt'
    const sortOrder = filters.sortOrder ?? 'desc'
    const direction = sortOrder === 'asc' ? 1 : -1

    return [...enrichedResumes].sort((a, b) => {
      if (sortBy === 'name') {
        const locale = getNameSortLocale(a.resume)
        return a.resume.name.localeCompare(b.resume.name, locale) * direction
      }

      if (sortBy === 'experience') {
        return (parseExperienceYears(a.resume.experience) - parseExperienceYears(b.resume.experience)) * direction
      }

      if (sortBy === 'extractedAt') {
        return (parseExtractedAt(a.resume.extractedAt) - parseExtractedAt(b.resume.extractedAt)) * direction
      }

      // AI score takes priority; fall back to rule score
      const scoreA = a.match?.score ?? a.ruleScore ?? 0
      const scoreB = b.match?.score ?? b.ruleScore ?? 0
      return (scoreA - scoreB) * direction
    })
  }, [convexSourceSortBy, enrichedResumes, filters.sortBy, filters.sortOrder, mode])

  const displayedResumeMap = useMemo(
    () => new Map(displayedResumes.map((entry) => [entry.key, entry.resume])),
    [displayedResumes]
  )

  const feedbackQuery = useMemo(() => {
    const keywordQuery = formatKeywordQuery(sessionKeywords).trim()
    const normalizedLocation = sessionLocation.trim()
    const query = [keywordQuery, normalizedLocation].filter((value) => value.length > 0).join(' ').trim()
    return query.length > 0 ? query : undefined
  }, [sessionKeywords, sessionLocation])

  const sendLearningFeedback = useCallback(
    (action: 'shortlist' | 'reject', resumeId: string, resume: ConvexResumeItem | ResumeItem | undefined) => {
      if (!resume || !hasIngestData(resume)) {
        return
      }

      const observation = buildLearningObservation(action, resume)
      void rawApiClient
        .POST<{ success: boolean; entry?: string }>('/api/resumes/learning-feedback', {
          body: {
            observation,
            action,
            resumeId,
            query: feedbackQuery,
          },
        })
        .catch((error: unknown) => {
          console.error('Failed to send learning feedback', error)
        })
    },
    [feedbackQuery]
  )

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(displayedResumes.map((entry) => entry.key)))
  }, [displayedResumes])

  const replaceSelection = useCallback((keys: Iterable<string>) => {
    setSelectedIds(new Set(keys))
  }, [])

  const pruneSelection = useCallback((allowedKeys: Iterable<string>) => {
    const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys)
    setSelectedIds((current) => {
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (allowed.has(key)) {
          next.add(key)
        } else {
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [])

  const handleSelectHighScore = useCallback(() => {
    setSelectedIds(
      new Set(
        displayedResumes
          .filter((entry) => (entry.match?.score ?? 0) >= 80)
          .map((entry) => entry.key)
      )
    )
  }, [displayedResumes])

  const resetResumeSearchState = useCallback(() => {
    setAppliedSearchHistoryId(undefined)
    setHydratedShareSessionReferenceNote(undefined)
    applyExternalState({
      location: '',
      keywords: [],
      jobDescriptionId: '',
      collectionSource: null,
      filters: {},
    })
    setSelectedTags([])
    setSelectedCompanies([])
    setRequiredKeywords([])
    setSelectedExperienceLevel(undefined)
  }, [applyExternalState])

  useEffect(() => {
    if (!isResumeHomeResetState(location.state)) {
      return
    }

    skipNextUrlSyncRef.current = true
    isUrlPushingRef.current = false
    hasInitializedUrlHydrationRef.current = true
    lastAppliedUrlStateRef.current = null
    setHasCompletedUrlHydration(true)
    resetResumeSearchState()

    navigate(
      {
        pathname: location.pathname,
        search: '',
        hash: location.hash,
      },
      {
        replace: true,
        state: null,
      }
    )
  }, [location.hash, location.pathname, location.state, navigate, resetResumeSearchState])

  const handleResetAll = resetResumeSearchState

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleToggleSelect = useCallback((resumeId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(resumeId)) {
        next.delete(resumeId)
      } else {
        next.add(resumeId)
      }
      return next
    })
  }, [])

  const handleBulkAction = useCallback(
    async (action: 'shortlist' | 'reject' | 'block' | 'export', format?: ResumeExportFormat) => {
      if (selectedIds.size === 0) return

      const selectedEntries = displayedResumes.filter((entry) => selectedIds.has(entry.key))

      if (action === 'block') {
        const identityKeys = selectedEntries.map((entry) => entry.identityKey)
        const success = await blockCandidates(identityKeys, 'bulk_block')
        if (success) {
          toast.success(t('bulk.blocked', { count: identityKeys.length, defaultValue: `Blocked ${identityKeys.length} candidates` }))
          setSelectedIds(new Set())
        } else {
          toast.error(t('bulk.blockFailed', { defaultValue: 'Bulk block failed. Please try again.' }))
        }
        return
      }

      if (action === 'export') {
        if (mode !== 'ai' && !selectedSample) {
          toast.error(t('bulk.exportFailed', { defaultValue: 'Export failed: sample context is missing. Please refresh and try again.' }))
          return
        }

        const exportEntries = selectedEntries.map(({ key, match, action: currentAction, ruleScore, status, statusMeta, userRating }) => ({
          resumeId: key,
          match,
          action: currentAction,
          status,
          ruleScore: typeof match?.score === 'number' ? undefined : ruleScore,
          userComment: normalizeOptionalString(statusMeta?.notes),
          userRating,
        }))
        const exportFormat = format ?? bulkExportFormat
        const normalizedJobDescriptionId = normalizeOptionalString(jobDescriptionId)
        const exportRequest: ResumeExportRequestBody = {
          format: exportFormat,
          source: mode === 'ai' ? 'convex' : 'sample',
          sessionId: sessionActionScope,
          ...(normalizedJobDescriptionId ? { jobDescriptionId: normalizedJobDescriptionId } : {}),
          entries: exportEntries,
          ...(appliedSearchHistory?.industryDbV2Stats
            ? { industryDbV2Stats: appliedSearchHistory.industryDbV2Stats }
            : {}),
          ...(mode === 'ai' ? {} : { sample: selectedSample }),
        }

        try {
          await submitResumeExportDownload(apiBaseUrl, exportRequest)
          toast.info(t('bulk.exportStarted', { count: exportEntries.length, defaultValue: `Started export for ${exportEntries.length} resumes` }))
          return
        } catch (error) {
          console.error('Export failed', error)
          const message = error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t('bulk.exportFailed', { defaultValue: 'Export failed. Please try again.' })
          toast.error(message)
          return
        }
      }

      try {
        let entriesForAction = selectedEntries
        if (action === 'shortlist') {
          const allowed = selectedEntries.filter((entry) => {
            const ingest = hasIngestData(entry.resume) ? entry.resume.ingestData : undefined
            const hits = matchResumeCompanyPolicyCached({
              workHistory: entry.resume.workHistory,
              companyHits: ingest?.companyHits,
            })
            return !isCompanyWorkflowBlocked(hits)
          })
          const skipped = selectedEntries.length - allowed.length
          if (skipped > 0) {
            toast.message(
              t('settings.policies.runtime.bulkSkipped', {
                defaultValue: 'Skipped {{count}} no-hire company-policy row(s)',
                count: skipped,
              }),
            )
          }
          entriesForAction = allowed
          if (entriesForAction.length === 0) {
            return
          }
        }

        if (action === 'shortlist' || action === 'reject') {
          entriesForAction.forEach((entry) => {
            sendLearningFeedback(action, entry.key, entry.resume)
          })
        }

        await Promise.all(
          entriesForAction.map((entry) =>
            saveAction({ resumeId: entry.key, actionType: action })
          )
        )

        // Sync candidate_status in Convex for shortlist/reject
        if (action === 'shortlist' || action === 'reject') {
          const targetStatus = action === 'shortlist' ? 'shortlisted' : 'rejected'
          await Promise.all(
            entriesForAction.map((entry) =>
              updateCandidateStatus(entry.identityKey, targetStatus)
            )
          )
        }

        const actionLabels: Record<string, string> = { shortlist: 'shortlisted', reject: 'rejected' }
        toast.success(t('bulk.actionDone', { count: entriesForAction.length, action: actionLabels[action] || action, defaultValue: `${entriesForAction.length} resumes ${actionLabels[action] || action}` }))
      } catch (error) {
        console.error('Bulk action failed', error)
        toast.error(t('bulk.actionFailed', { defaultValue: 'Bulk action failed. Please try again.' }))
      }
    },
    [apiBaseUrl, appliedSearchHistory?.industryDbV2Stats, blockCandidates, bulkExportFormat, displayedResumes, jobDescriptionId, mode, saveAction, selectedIds, selectedSample, sendLearningFeedback, sessionActionScope, t, updateCandidateStatus]
  )

  const handleOpenReviewPacket = useCallback(async () => {
    if (!isReviewPacketsEnabled() || selectedIds.size === 0) {
      return
    }

    const selectedEntries = displayedResumes.filter((entry) => selectedIds.has(entry.key))
    if (selectedEntries.length === 0) {
      return
    }

    if (mode !== 'ai' && !selectedSample) {
      toast.error(t('bulk.exportFailed', { defaultValue: 'Export failed: sample context is missing. Please refresh and try again.' }))
      return
    }

    const params = new URLSearchParams()
    params.set('source', mode === 'ai' ? 'convex' : 'sample')
    params.set('format', bulkExportFormat)
    params.set('resumeIds', selectedEntries.map((entry) => entry.key).join(','))

    const normalizedSample = normalizeOptionalString(selectedSample)
    if (mode !== 'ai' && normalizedSample) {
      params.set('sample', normalizedSample)
    }

    const normalizedJobDescriptionId = normalizeOptionalString(jobDescriptionId)
    if (normalizedJobDescriptionId) {
      params.set('jobDescriptionId', normalizedJobDescriptionId)
    }

    const bridgedSessionId = await ensureApiSession()
    if (bridgedSessionId) {
      params.set('sessionId', bridgedSessionId)
    }

    const normalizedReferenceNote = continuityReferenceNote
    if (normalizedReferenceNote) {
      params.set('referenceNote', normalizedReferenceNote)
    }

    navigate({
      pathname: `/${resolveWorkspaceSlugFromPathname(location.pathname)}/review-packets`,
      search: `?${params.toString()}`,
    })
  }, [
    bulkExportFormat,
    continuityReferenceNote,
    displayedResumes,
    ensureApiSession,
    jobDescriptionId,
    location.pathname,
    mode,
    navigate,
    selectedIds,
    selectedSample,
    t,
  ])

  const actionFeedbackLabels = useMemo<Partial<Record<CandidateActionType, string>>>(
    () => ({
      shortlist: t('resumes.actions.shortlist', '入围'),
      reject: t('resumes.actions.reject', '拒绝'),
      star: t('resumes.actions.star', '标星'),
      contact: '联系',
    }),
    [t]
  )

  const handleCardAction = useCallback(
    (resumeId: string, action: CandidateActionType) => {
      const actionLabel = actionFeedbackLabels[action] ?? action
      if (action === 'shortlist' || action === 'reject') {
        sendLearningFeedback(action, resumeId, displayedResumeMap.get(resumeId))
      }

      const nextStatus = CARD_ACTION_TO_STATUS[action]
      const targetEntry = displayedResumes.find((entry) => entry.key === resumeId)
      const identityKey = targetEntry?.identityKey ?? resumeId

      void (async () => {
        try {
          await saveAction({ resumeId, actionType: action })
          toast.success(`${actionLabel} 已保存`)

          if (nextStatus) {
            const currentStatus = statusByIdentity[identityKey]?.status
            const finalStatus = currentStatus === nextStatus ? ('new' as const) : nextStatus
            await updateCandidateStatus(identityKey, finalStatus)
          }
        } catch (error: unknown) {
          console.error('Individual action failed', error)
          toast.error('Action failed. Please try again.')
        }
      })()
    },
    [actionFeedbackLabels, displayedResumeMap, displayedResumes, saveAction, sendLearningFeedback, statusByIdentity, updateCandidateStatus]
  )

  const handleAiFeedback = useCallback(
    (resumeId: string, target: AiFeedbackTarget, sentiment: AiFeedbackSentiment) => {
      void saveAction({
        resumeId,
        actionType: aiFeedbackToActionType(target, sentiment),
        actionData: {
          target,
          sentiment,
          jobDescriptionId: jobDescriptionId ?? undefined,
        },
      })
        .then((result) => {
          if (result) {
            toast.success(t('feedback.saved', { defaultValue: 'Feedback saved' }))
          } else {
            toast.error(t('feedback.failed', { defaultValue: 'Failed to save feedback' }))
          }
        })
        .catch((error: unknown) => {
          console.error('AI feedback save failed', error)
          toast.error(t('feedback.failed', { defaultValue: 'Failed to save feedback' }))
        })
    },
    [jobDescriptionId, saveAction, t]
  )

  const handleRating = useCallback(
    (resumeId: string, rating: number) => {
      void saveAction({
        resumeId,
        actionType: 'rating',
        actionData: { rating },
      })
        .then((result) => {
          if (result) {
            toast.success(rating === 0 ? '评分已清除' : `评分已保存: ${rating}星`)
            return
          }

          toast.error('Failed to save rating')
        })
        .catch((error: unknown) => {
          console.error('Rating save failed', error)
          toast.error('Failed to save rating')
        })
    },
    [saveAction]
  )

  const handleRatingComment = useCallback(
    (resumeId: string, comment: string) => {
      const trimmed = comment.trim()
      if (!trimmed) {
        return
      }

      const entry = displayedResumes.find(
        (item) => item.key === resumeId || item.resume.resumeId === resumeId,
      )
      if (!entry?.identityKey) {
        toast.error('备注保存失败')
        return
      }

      const currentStatus =
        statusByIdentity[entry.identityKey]?.status
        ?? entry.status
        ?? 'new'

      void updateCandidateStatus(entry.identityKey, currentStatus, trimmed)
        .then((success) => {
          if (success) {
            toast.success('备注已保存')
            return
          }
          toast.error('备注保存失败')
        })
        .catch((error: unknown) => {
          console.error('Rating comment save failed', error)
          toast.error('备注保存失败')
        })
    },
    [displayedResumes, statusByIdentity, updateCandidateStatus]
  )

  const handleToggleBlock = useCallback(
    async (identityKey: string, blocked: boolean, reason?: string) => {
      if (!identityKey.trim()) {
        return
      }

      if (blocked) {
        const removed = await unblockCandidate(identityKey)
        if (removed) {
          toast.success('已取消屏蔽')
        } else {
          toast.error('取消屏蔽失败，请重试')
        }
        return
      }

      const success = await blockCandidates([identityKey], reason || 'manual_block')
      if (success) {
        toast.success('已屏蔽候选人')
      } else {
        toast.error('屏蔽失败，请重试')
      }
    },
    [blockCandidates, unblockCandidate]
  )

  const handleCandidateStatusChange = useCallback(
    async (identityKey: string, status: CandidateStatus, notes?: string) => {
      if (!identityKey.trim()) {
        return
      }

      const success = await updateCandidateStatus(identityKey, status, notes)
      if (!success) {
        toast.error('更新候选人状态失败，请重试')
      }
    },
    [updateCandidateStatus]
  )

  const highScoreCount = useMemo(() => {
    return displayedResumes.filter((entry) => (entry.match?.score ?? 0) >= 80).length
  }, [displayedResumes])

  const blockedCount = useMemo(() => Object.keys(blocksByIdentity).length, [blocksByIdentity])

  const hasInput = Boolean(jobDescriptionId) || sessionKeywords.length > 0
  const disableAnalyzeButton = (filteredConvexResumes.length === 0 || analyzing || !hasInput || hasActiveTask || !dispatchAnalysis)
  const shouldBlockQuickStartSync = activeHasUrlParams && !hasCompletedUrlHydration

  const handleQuickStartApply = useCallback(
    (config: {
      location: string
      keywords: string[]
      requiredKeywords?: string[]
      jobDescriptionId?: string
      collectionSource?: CollectionSource | null
      filters?: Partial<ResumeFilters>
    }, applyDuringUrlHydration?: boolean) => {
      if (shouldBlockQuickStartSync && !applyDuringUrlHydration) {
        return
      }

      const normalizedKeywords = config.keywords
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
      const normalizedJobDescriptionId = config.jobDescriptionId?.trim() ?? ''
      const normalizedLocation = config.location.trim()
      setSessionLocation((current) => {
        if (current === normalizedLocation) {
          return current
        }
        return normalizedLocation
      })

      setSessionKeywords((current) => (areKeywordListsEqual(current, normalizedKeywords) ? current : normalizedKeywords))
      if (config.requiredKeywords !== undefined) {
        const normalizedRequiredKeywords = config.requiredKeywords.map((kw) => kw.trim()).filter((kw) => kw.length > 0)
        setRequiredKeywords((current) => (areKeywordListsEqual(current, normalizedRequiredKeywords) ? current : normalizedRequiredKeywords))
      }
      setJobDescriptionId((current) => (current === normalizedJobDescriptionId ? current : normalizedJobDescriptionId))
      setSessionCollectionSource((current) => {
        if (config.collectionSource === undefined) {
          return current
        }

        return JSON.stringify(current ?? null) === JSON.stringify(config.collectionSource ?? null)
          ? current
          : (config.collectionSource ?? undefined)
      })
      setFilters((current) => ({
        ...current,
        ...(config.filters ?? {}),
        locations: normalizedLocation
          ? normalizedLocation
            .split(/[,，、]+/)
            .map((item) => item.trim())
            .filter(Boolean)
          : [],
      }))
    },
    [setFilters, setJobDescriptionId, setRequiredKeywords, setSessionCollectionSource, setSessionKeywords, setSessionLocation, shouldBlockQuickStartSync]
  )

  const handleQuickConstraintApply = useCallback(
    (constraints: {
      minRoleYears?: number
      roleFilterType?: string
      maxAge?: number
    }) => {
      setFilters((current) => ({
        ...current,
        minRoleYears: constraints.minRoleYears,
        roleFilterType: normalizeOptionalString(constraints.roleFilterType),
        maxAge: constraints.maxAge,
      }))
    },
    [setFilters]
  )

  const handleCollectionSourceChange = useCallback((nextSource: CollectionSource) => {
    setSessionCollectionSource((current) => (
      JSON.stringify(current ?? null) === JSON.stringify(nextSource)
        ? current
        : nextSource
    ))
  }, [setSessionCollectionSource])

  const handleSaveCurrentSearch = useCallback(async () => {
    const title = buildSearchHistoryTitle(sessionLocation, sessionKeywords, jobDescriptionId)
    const saved = await saveSearchHistory({
      title,
      location: sessionLocation,
      keywords: sessionKeywords,
      jobDescriptionId,
      collectionSource: sessionCollectionSource,
      filters,
      selectedTags,
      selectedCompanies,
      selectedExperienceLevel,
      resumeIds: filteredConvexResumes.map((resume) => String(resume.resumeId)),
    })

    if (saved) {
      toast.success(t('quickStart.history.saveSuccess', 'Saved to search history'))
    } else {
      toast.error(t('quickStart.history.saveError', 'Failed to save search history'))
    }
  }, [filteredConvexResumes, filters, jobDescriptionId, saveSearchHistory, selectedCompanies, selectedExperienceLevel, selectedTags, sessionCollectionSource, sessionKeywords, sessionLocation, t])

  const handleApplySearchHistory = useCallback(async (entry: SearchHistoryItem) => {
    skipNextUrlSyncRef.current = true
    setHydratedShareSessionReferenceNote(undefined)
    applyExternalState({
      location: entry.location,
      keywords: entry.keywords,
      jobDescriptionId: entry.jobDescriptionId ?? '',
      collectionSource: entry.collectionSource ?? null,
      filters: entry.filters,
    })
    setAppliedSearchHistoryId(entry.id)
    setSelectedTags(entry.selectedTags)
    setSelectedCompanies(entry.selectedCompanies)
    setRequiredKeywords([])
    setSelectedExperienceLevel(toExperienceLevel(entry.selectedExperienceLevel))
    await markSearchHistoryOpened(entry.id)
    toast.success(t('quickStart.history.applySuccess', 'Applied saved search'))
  }, [applyExternalState, markSearchHistoryOpened, t])

  const shareTitle = useMemo(
    () => buildSearchHistoryTitle(sessionLocation, sessionKeywords, jobDescriptionId),
    [jobDescriptionId, sessionKeywords, sessionLocation]
  )
  const shareScopeSignature = useMemo(
    () => JSON.stringify({
      title: shareTitle,
      location: normalizeOptionalString(sessionLocation),
      keywords: sessionKeywords,
      requiredKeywords,
      jobDescriptionId: normalizeOptionalString(jobDescriptionId),
      collectionSource: sessionCollectionSource ?? null,
      filters: normalizeUrlFilters(filters),
      selectedTags,
      selectedCompanies,
      selectedExperienceLevel,
      referenceNote: continuityReferenceNote,
    }),
    [
      continuityReferenceNote,
      filters,
      jobDescriptionId,
      requiredKeywords,
      selectedCompanies,
      selectedExperienceLevel,
      selectedTags,
      sessionCollectionSource,
      sessionKeywords,
      sessionLocation,
      shareTitle,
    ]
  )
  const linkedShareSessionId = !activeHasUrlParams ? activeShareSessionId : undefined
  const hasShareableSessionContext = useMemo(
    () => Boolean(
      normalizeOptionalString(sessionLocation)
      || sessionKeywords.length > 0
      || normalizeOptionalString(jobDescriptionId)
      || sessionCollectionSource
    ),
    [jobDescriptionId, sessionCollectionSource, sessionKeywords, sessionLocation]
  )
  useEffect(() => {
    if (!copiedShareSessionId || !copiedShareScopeSignature) {
      return
    }

    if (copiedShareScopeSignature !== shareScopeSignature) {
      setCopiedShareSessionId(undefined)
      setCopiedShareScopeSignature(undefined)
    }
  }, [copiedShareScopeSignature, copiedShareSessionId, shareScopeSignature])

  const activeSessionId = linkedShareSessionId
    ?? copiedShareSessionId
    ?? (apiSessionId && hasShareableSessionContext ? apiSessionId : undefined)
  const activeSessionTitle = useMemo(() => {
    if (linkedShareSessionId) {
      return hydratedShareSessionTitle ?? shareTitle
    }

    if (copiedShareSessionId) {
      return shareTitle
    }

    if (appliedSearchHistory) {
      return appliedSearchHistory.title
    }

    if (apiSessionId && hasShareableSessionContext) {
      return shareTitle
    }

    return undefined
  }, [
    copiedShareSessionId,
    linkedShareSessionId,
    apiSessionId,
    appliedSearchHistory,
    hasShareableSessionContext,
    hydratedShareSessionTitle,
    shareTitle,
  ])
  const activeSessionLabel = useMemo(() => {
    if (linkedShareSessionId) {
      return 'Shared link'
    }

    if (copiedShareSessionId) {
      return 'Shared link'
    }

    if (appliedSearchHistory) {
      return 'Saved search'
    }

    if (apiSessionId && hasShareableSessionContext) {
      return 'Share-ready'
    }

    return undefined
  }, [copiedShareSessionId, linkedShareSessionId, apiSessionId, appliedSearchHistory, hasShareableSessionContext])
  const activeSessionDescription = useMemo(() => {
    if (linkedShareSessionId) {
      return 'Opened from a durable sid link and ready to refine or reshare.'
    }

    if (copiedShareSessionId) {
      return 'Short durable link copied for this search and ready to reopen or share.'
    }

    if (appliedSearchHistory) {
      return 'Reopened from saved history so you can continue the same search with less re-entry.'
    }

    if (apiSessionId && hasShareableSessionContext) {
      return 'This search already has a persisted session record for short durable share links.'
    }

    return undefined
  }, [copiedShareSessionId, linkedShareSessionId, apiSessionId, appliedSearchHistory, hasShareableSessionContext])
  const activeSessionNote = activeSessionTitle ? continuityReferenceNote : undefined
  const handleShareSessionCopied = useCallback((sessionId: string | undefined) => {
    const normalizedSessionId = normalizeOptionalString(sessionId)
    if (!normalizedSessionId) {
      return
    }

    setCopiedShareSessionId(normalizedSessionId)
    setCopiedShareScopeSignature(shareScopeSignature)
  }, [shareScopeSignature])
  const shareState = useMemo<ResumeSearchShareState>(() => {
    const normalizedLocation = normalizeOptionalString(sessionLocation)
    const locationFilters = normalizedLocation
      ? normalizedLocation.split(/[,，、]+/).map((item) => item.trim()).filter(Boolean)
      : (Array.isArray(filters.locations) ? filters.locations : [])

    return {
      location: normalizedLocation,
      keywords: sessionKeywords,
      requiredKeywords,
      jobDescriptionId: normalizeOptionalString(jobDescriptionId),
      collectionSource: sessionCollectionSource,
      filters: {
        ...filters,
        locations: locationFilters,
      },
      selectedTags,
      selectedCompanies,
      selectedExperienceLevel,
      referenceNote: continuityReferenceNote,
    }
  }, [
    continuityReferenceNote,
    filters,
    jobDescriptionId,
    requiredKeywords,
    selectedCompanies,
    selectedExperienceLevel,
    selectedTags,
    sessionCollectionSource,
    sessionKeywords,
    sessionLocation,
  ])

  return {
    sessionLocation,
    sessionKeywords,
    sessionCollectionSource,
    jobDescriptionId,
    appliedSearchHistoryId,
    filters,
    reviewedIdsSet,
    trackReviewedResume,
    summary,
    resumes,
    convexResumes,
    selectedSample,
    error,
    activeLoading,
    analyzing,
    hasActiveTask,
    disableAnalyzeButton,
    selectedIds,
    activeSessionTitle,
    activeSessionLabel,
    activeSessionDescription,
    activeSessionNote,
    activeSessionId,
    shareTitle,
    shareState,
    selectedTags,
    selectedCompanies,
    requiredKeywords,
    setRequiredKeywords,
    selectedExperienceLevel,
    activeTagFilters,
    activeCompanyFilters,
    highScoreCount,
    blockedCount,
    bulkExportFormat,
    displayedResumes,
    loadedConvexResumeCount,
    canLoadMoreResumes,
    convexLoadingMore,
    searchHistory,
    searchHistoryLoading,
    setBulkExportFormat,
    handleAnalyzeAll,
    handleRefresh,
    handleLoadMoreResumes,
    handleQuickStartApply,
    handleQuickConstraintApply,
    handleCollectionSourceChange,
    handleSaveCurrentSearch,
    handleApplySearchHistory,
    handleJobChange,
    handleFiltersChange,
    handleToggleTag,
    handleToggleCompany,
    handleToggleExperienceLevel,
    handleClearLocation,
    handleClearTagFilters,
    handleSelectAll,
    handleSelectHighScore,
    replaceSelection,
    pruneSelection,
    handleClearSelection,
    handleToggleSelect,
    handleBulkAction,
    handleOpenReviewPacket,
    handleCardAction,
    handleAiFeedback,
    handleRating,
    handleRatingComment,
    getAiFeedback,
    ratingsByResume,
    commentsByResume,
    handleToggleBlock,
    handleCandidateStatusChange,
    handleResetAll,
    ensureApiSession,
    handleShareSessionCopied,
  }
}
