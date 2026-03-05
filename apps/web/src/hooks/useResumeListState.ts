import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from 'convex/react'
import { isLocationMatch } from '@trends/shared'
import { toast } from 'sonner'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { useResumes, type ResumeItem } from '@/hooks/useResumes'
import { useConvexResumes, type ConvexResumeItem } from '@/hooks/useConvexResumes'
import { useSession } from '@/hooks/useSession'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { useCandidateBlocks } from '@/hooks/useCandidateBlocks'
import { useCandidateStatus, type CandidateStatusRecord } from '@/hooks/useCandidateStatus'
import {
  hasKnownUrlSearchParams,
  parseUrlSearchState,
  useUrlSearchState,
  type ExperienceLevelFilter,
} from '@/hooks/useUrlSearchState'
import { rawApiClient } from '@/lib/api-helpers'
import { expandKeyword, DEFAULT_CONFIG } from '@/lib/trendradar/parser'
import type { CandidateActionType, CandidateStatus, MatchingResult, ResumeFilters } from '@/types/resume'
import {
  buildLearningObservation,
  buildResumeKey,
  getAnalysisForJob,
  hasIngestData,
  isAutoFilteredAnalysis,
  toMatchBreakdown,
  toRecommendation,
} from '@/lib/resume-scoring'

type JobDescriptionApiResponse = {
  success: boolean
  item?: {
    title?: string
  }
  content?: string
}

type ResumeExportFormat = 'csv' | 'xlsx'

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
}

type AnalysisTaskDoc = Doc<'analysis_tasks'>

function normalizeKeywordFingerprint(keywords: string[]): string {
  return [...keywords]
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length > 0)
    .sort()
    .join('|')
}

function areKeywordListsEqual(left: string[], right: string[]): boolean {
  return normalizeKeywordFingerprint(left) === normalizeKeywordFingerprint(right)
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeFilterList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  values.forEach((value) => {
    const token = normalizeFilterToken(value)
    if (!token || seen.has(token)) {
      return
    }
    seen.add(token)
    normalized.push(token)
  })

  return normalized.sort()
}

function normalizeUrlFilters(filters: Partial<ResumeFilters>): Partial<ResumeFilters> {
  return {
    minExperience: normalizeOptionalNumber(filters.minExperience),
    maxExperience: normalizeOptionalNumber(filters.maxExperience),
    minRoleYears: normalizeOptionalNumber(filters.minRoleYears),
    roleFilterType: normalizeOptionalString(filters.roleFilterType),
    minAge: normalizeOptionalNumber(filters.minAge),
    maxAge: normalizeOptionalNumber(filters.maxAge),
    education: normalizeFilterList(filters.education),
    status: toStatusFilterList(filters.status),
    minMatchScore: normalizeOptionalNumber(filters.minMatchScore),
    locations: normalizeFilterList(filters.locations),
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  }
}

function areUrlFiltersEqual(left: Partial<ResumeFilters>, right: Partial<ResumeFilters>): boolean {
  return JSON.stringify(normalizeUrlFilters(left)) === JSON.stringify(normalizeUrlFilters(right))
}

function taskMatchesCurrentSearch(
  task: AnalysisTaskDoc,
  jobDescriptionId: string | undefined,
  sessionKeywords: string[]
): boolean {
  if (task.status !== 'pending' && task.status !== 'processing') {
    return false
  }

  const normalizedJobDescriptionId = (jobDescriptionId ?? '').trim()
  if (normalizedJobDescriptionId && task.config.jobDescriptionId === normalizedJobDescriptionId) {
    return true
  }

  if (sessionKeywords.length > 0 && task.config.keywords?.length) {
    const normalizedSessionKeywords = normalizeKeywordFingerprint(sessionKeywords)
    const normalizedTaskKeywords = normalizeKeywordFingerprint(task.config.keywords)
    return normalizedSessionKeywords.length > 0 && normalizedSessionKeywords === normalizedTaskKeywords
  }

  return false
}

function getExportErrorMessage(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  if (!('error' in value)) {
    return undefined
  }
  const error = value.error
  if (typeof error !== 'string' || error.trim().length === 0) {
    return undefined
  }
  return error
}

function normalizeFilterToken(value: string): string {
  return value.trim().toLowerCase()
}

function toggleFilterValue(currentValues: string[], value: string): string[] {
  const normalizedValue = value.trim()
  if (normalizedValue.length === 0) {
    return currentValues
  }

  const normalizedKey = normalizeFilterToken(normalizedValue)
  if (currentValues.some((item) => normalizeFilterToken(item) === normalizedKey)) {
    return currentValues.filter((item) => normalizeFilterToken(item) !== normalizedKey)
  }

  return [...currentValues, normalizedValue]
}

function toExperienceLevel(value: string | undefined): ExperienceLevelFilter | undefined {
  if (!value) {
    return undefined
  }

  const normalized = normalizeFilterToken(value)
  if (normalized === 'senior') return 'senior'
  if (normalized === 'mid') return 'mid'
  if (normalized === 'junior') return 'junior'
  return undefined
}

function parseExperienceYears(value: string | undefined): number {
  if (!value) {
    return 0
  }

  const matched = value.match(/\d+(?:\.\d+)?/)
  if (!matched) {
    return 0
  }

  const parsed = Number(matched[0])
  return Number.isFinite(parsed) ? parsed : 0
}

function parseAgeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value)
  }
  if (typeof value !== 'string') {
    return null
  }

  const withSuffix = value.match(/(\d+)\s*岁/)
  if (withSuffix && withSuffix[1]) {
    return Number(withSuffix[1])
  }

  const plain = value.match(/^(\d{1,3})$/)
  if (plain && plain[1]) {
    return Number(plain[1])
  }

  return null
}

function getResumeAge(resume: ConvexResumeItem): number | null {
  if (typeof resume.ageNumber === 'number' && Number.isFinite(resume.ageNumber) && resume.ageNumber > 0) {
    return Math.trunc(resume.ageNumber)
  }

  return parseAgeNumber(resume.age)
}

function getResumeIdentityKey(resume: ConvexResumeItem, fallback: string): string {
  const identityKey = resume.identityKey?.trim()
  if (identityKey) {
    return identityKey
  }
  return fallback
}

function toStatusFilterList(values: CandidateStatus[] | undefined): CandidateStatus[] {
  if (!Array.isArray(values)) {
    return []
  }

  const unique = new Set<CandidateStatus>()
  values.forEach((value) => {
    if (
      value === 'new'
      || value === 'contacted'
      || value === 'interviewing'
      || value === 'interviewed_pass'
      || value === 'interviewed_reject'
      || value === 'offer'
      || value === 'hired'
      || value === 'withdrawn'
    ) {
      unique.add(value)
    }
  })
  return Array.from(unique).sort()
}

function getRoleYears(resume: ConvexResumeItem, roleType: string): number {
  const roleSignals = resume.ingestData?.roleSignals
  if (!Array.isArray(roleSignals) || roleSignals.length === 0) {
    return 0
  }

  const normalizedRoleType = normalizeFilterToken(roleType)
  if (!normalizedRoleType) {
    return roleSignals.reduce((maxYears, signal) => {
      if (typeof signal.years !== 'number' || !Number.isFinite(signal.years)) {
        return maxYears
      }
      return Math.max(maxYears, signal.years)
    }, 0)
  }

  const roleSignal = roleSignals.find((signal) => normalizeFilterToken(signal.type) === normalizedRoleType)
  if (!roleSignal || typeof roleSignal.years !== 'number' || !Number.isFinite(roleSignal.years)) {
    return 0
  }
  return roleSignal.years
}

function parseExtractedAt(value: string | undefined): number {
  if (!value) {
    return 0
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

const EDUCATION_KEYWORDS: Record<string, string[]> = {
  high_school: ['高中', '中专', '技校', 'high school'],
  associate: ['大专', '专科', 'associate'],
  bachelor: ['本科', '学士', 'bachelor'],
  master: ['硕士', '研究生', 'master'],
  phd: ['博士', 'phd', 'doctor'],
}

function matchesEducationFilter(educationValue: string | undefined, selectedEducation: string[]): boolean {
  if (selectedEducation.length === 0) {
    return true
  }

  const normalizedEducation = normalizeFilterToken(educationValue ?? '')
  if (!normalizedEducation) {
    return false
  }

  return selectedEducation.some((level) => {
    const keywords = EDUCATION_KEYWORDS[level]
    if (!keywords || keywords.length === 0) {
      return false
    }

    return keywords.some((keyword) => normalizedEducation.includes(normalizeFilterToken(keyword)))
  })
}

export function useResumeListState() {
  const { t } = useTranslation()
  const {
    location: sessionLocation,
    setLocation: setSessionLocation,
    keywords: sessionKeywords,
    setKeywords: setSessionKeywords,
    jobDescriptionId,
    setJobDescriptionId,
    filters,
    setFilters,
    reviewedIdsSet,
    trackReviewedResume,
    applyExternalState,
  } = useSession()

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
  const [selectedExperienceLevel, setSelectedExperienceLevel] = useState<ExperienceLevelFilter | undefined>(undefined)
  const [mode] = useState<'ai'>('ai')
  const hydratedSessionIdRef = useRef<string | null>(null)
  const hasInitializedUrlHydrationRef = useRef(false)
  const lastAppliedUrlStateRef = useRef<string | null>(null)
  const skipNextUrlSyncRef = useRef(false)
  const initialWindowSearchStateRef = useRef<{
    hasUrlParams: boolean
    hasKeywordParam: boolean
    hasJobDescriptionParam: boolean
    parsedState: ReturnType<typeof parseUrlSearchState>
  } | null>(null)
  const [hasCompletedUrlHydration, setHasCompletedUrlHydration] = useState(false)

  if (!initialWindowSearchStateRef.current) {
    const params = new URLSearchParams(window.location.search)
    initialWindowSearchStateRef.current = {
      hasUrlParams: hasKnownUrlSearchParams(params),
      hasKeywordParam: params.has('kw') || params.has('keyword'),
      hasJobDescriptionParam: params.has('jd'),
      parsedState: parseUrlSearchState(params),
    }
  }

  const initialWindowSearchState = initialWindowSearchStateRef.current
  const session = useMemo(() => ({ id: 'convex', jobDescriptionId, filters }), [jobDescriptionId, filters])
  const activeHasUrlParams = hasUrlParams
    || (!hasInitializedUrlHydrationRef.current && initialWindowSearchState.hasUrlParams)
  const activeHasKeywordParam = hasUrlParams
    ? hasKeywordParam
    : initialWindowSearchState.hasKeywordParam
  const activeHasJobDescriptionParam = hasUrlParams
    ? hasJobDescriptionParam
    : initialWindowSearchState.hasJobDescriptionParam
  const activeParsedUrlState = hasUrlParams
    ? parsedUrlState
    : initialWindowSearchState.parsedState
  const activeUrlStateSignature = useMemo(
    () => JSON.stringify({
      hasKeywordParam: activeHasKeywordParam,
      hasJobDescriptionParam: activeHasJobDescriptionParam,
      hasUrlParams: activeHasUrlParams,
      location: activeParsedUrlState.location ?? '',
      keywords: activeParsedUrlState.keywords,
      jobDescriptionId: activeParsedUrlState.jobDescriptionId ?? '',
      selectedTags: activeParsedUrlState.selectedTags,
      selectedCompanies: activeParsedUrlState.selectedCompanies,
      selectedExperienceLevel: activeParsedUrlState.selectedExperienceLevel ?? '',
      filters: normalizeUrlFilters(activeParsedUrlState.filters),
    }),
    [activeHasJobDescriptionParam, activeHasKeywordParam, activeHasUrlParams, activeParsedUrlState]
  )

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

  const { actions, saveAction } = useCandidateActions(undefined)
  const { blocksByIdentity, blockCandidates, unblockCandidate } = useCandidateBlocks()
  const { statusByIdentity, updateStatus: updateCandidateStatus } = useCandidateStatus()

  const expandedQuery = useMemo(() => {
    const kw = sessionKeywords.join(' ').trim()
    if (!kw) return undefined
    return expandKeyword(kw, DEFAULT_CONFIG)
  }, [sessionKeywords])

  const { resumes: convexResumes, loading: convexLoading } = useConvexResumes(200, expandedQuery, jobDescriptionId)
  const analysisTasks = useQuery(api.analysis_tasks.list)
  const dispatchAnalysis = useMutation(api.analysis_tasks.dispatch)
  const [analyzing, setAnalyzing] = useState(false)
  const [lastDispatchTime, setLastDispatchTime] = useState<number>(0)
  const DISPATCH_COOLDOWN_MS = 2000
  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || '/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  const activeLoading = mode === 'ai' ? convexLoading : loading
  const hasActiveTask = useMemo(() => {
    if (!analysisTasks || analysisTasks.length === 0) {
      return false
    }
    return analysisTasks.some((task) => taskMatchesCurrentSearch(task, jobDescriptionId, sessionKeywords))
  }, [analysisTasks, jobDescriptionId, sessionKeywords])

  useEffect(() => {
    if (!activeHasUrlParams) {
      hasInitializedUrlHydrationRef.current = true
      lastAppliedUrlStateRef.current = null
      setHasCompletedUrlHydration(true)
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
      filters: activeParsedUrlState.filters,
    })
    setSelectedTags(activeParsedUrlState.selectedTags)
    setSelectedCompanies(activeParsedUrlState.selectedCompanies)
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
    if (!hasCompletedUrlHydration) {
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
        ? locationForUrl.split(/[\s,，、]+/).filter(Boolean)
        : undefined
      const filtersForUrl: Partial<ResumeFilters> = {
        ...filters,
        locations: locationFilters,
      }

      syncToUrl({
        location: locationForUrl,
        keywords: sessionKeywords,
        jobDescriptionId,
        selectedTags,
        selectedCompanies,
        selectedExperienceLevel,
        filters: filtersForUrl,
      })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [
    filters,
    hasCompletedUrlHydration,
    jobDescriptionId,
    selectedCompanies,
    selectedExperienceLevel,
    selectedTags,
    sessionKeywords,
    sessionLocation,
    syncToUrl,
  ])

  const filteredConvexResumes = useMemo(() => {
    let result: ScoredConvexResume[] = convexResumes
      .filter((resume: ConvexResumeItem) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords)
        return !isAutoFilteredAnalysis(analysis)
      })
      .map((resume: ConvexResumeItem) => {
        // Pre-computed scores are hidden by default until explicit review.
        return {
          ...resume,
          _ruleScore: 0,
        }
      })

    result = [...result].sort((a: ScoredConvexResume, b: ScoredConvexResume) => b._ruleScore - a._ruleScore)

    const showBlocked = filters.showBlocked === true
    if (!showBlocked) {
      result = result.filter((resume: ScoredConvexResume) => {
        const identityKey = getResumeIdentityKey(resume, String(resume.resumeId))
        return !blocksByIdentity[identityKey]
      })
    }

    if (filters.status?.length) {
      const activeStatuses = new Set(toStatusFilterList(filters.status))
      result = result.filter((resume: ScoredConvexResume) => {
        const identityKey = getResumeIdentityKey(resume, String(resume.resumeId))
        const status = statusByIdentity[identityKey]?.status ?? 'new'
        return activeStatuses.has(status)
      })
    }

    if (filters.locations?.length) {
      const locations = filters.locations
      result = result.filter((resume: ScoredConvexResume) =>
        locations.some((location) => isLocationMatch(resume.location ?? '', location))
      )
    }

    const minExperience = filters.minExperience
    if (typeof minExperience === 'number') {
      result = result.filter((resume: ScoredConvexResume) => parseExperienceYears(resume.experience) >= minExperience)
    }

    const maxExperience = filters.maxExperience
    if (typeof maxExperience === 'number') {
      result = result.filter((resume: ScoredConvexResume) => parseExperienceYears(resume.experience) <= maxExperience)
    }

    const minRoleYears = filters.minRoleYears
    if (typeof minRoleYears === 'number') {
      result = result.filter((resume: ScoredConvexResume) =>
        getRoleYears(resume, filters.roleFilterType ?? '') >= minRoleYears
      )
    } else {
      const minSalesYears = filters.minSalesYears
      if (typeof minSalesYears === 'number') {
        result = result.filter((resume: ScoredConvexResume) => getRoleYears(resume, 'sales') >= minSalesYears)
      }
    }

    const minAge = filters.minAge
    if (typeof minAge === 'number') {
      result = result.filter((resume: ScoredConvexResume) => {
        const age = getResumeAge(resume)
        return age !== null && age >= minAge
      })
    }

    const maxAge = filters.maxAge
    if (typeof maxAge === 'number') {
      result = result.filter((resume: ScoredConvexResume) => {
        const age = getResumeAge(resume)
        return age !== null && age <= maxAge
      })
    }

    if (filters.education?.length) {
      result = result.filter((resume: ScoredConvexResume) =>
        matchesEducationFilter(resume.education, filters.education ?? [])
      )
    }

    const minMatchScore = filters.minMatchScore
    if (typeof minMatchScore === 'number') {
      result = result.filter((resume: ScoredConvexResume) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords)
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

    return result
  }, [
    blocksByIdentity,
    convexResumes,
    filters,
    jobDescriptionId,
    selectedCompanies,
    selectedExperienceLevel,
    selectedTags,
    sessionKeywords,
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
      return
    }
    await reloadSamples()
    await refresh()
  }, [mode, reloadSamples, refresh])

  const handleJobChange = useCallback(
    (value: string) => {
      setJobDescriptionId(value)
    },
    [setJobDescriptionId]
  )

  const handleAnalyzeAll = useCallback(async () => {
    if (!convexResumes.length) return
    if (!jobDescriptionId && sessionKeywords.length === 0) return
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
        .filter((resume: ConvexResumeItem) => !getAnalysisForJob(resume, jobDescriptionId, sessionKeywords))
        .slice(0, 10)

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
          sample: selectedSample || undefined,
          resumeIds,
        })
      } else if (sessionKeywords.length > 0) {
        await dispatchAnalysis({
          keywords: sessionKeywords,
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
    selectedSample,
    sessionKeywords,
    t,
  ])

  const handleFiltersChange = useCallback(
    (nextFilters: typeof filters) => {
      setFilters(nextFilters)
    },
    [setFilters]
  )

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedTags((current) => toggleFilterValue(current, tag))
  }, [])

  const handleToggleCompany = useCallback((company: string) => {
    setSelectedCompanies((current) => toggleFilterValue(current, company))
  }, [])

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

  const enrichedResumes = useMemo<EnrichedResume[]>(() => {
    if (mode === 'ai') {
      return filteredConvexResumes.map((resume: ScoredConvexResume, index: number) => {
        const resumeKey = buildResumeKey(resume, index)
        const identityKey = getResumeIdentityKey(resume, resumeKey)
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords)
        const isAnalysisValid = !jobDescriptionId || analysis?.jobDescriptionId === jobDescriptionId

        const match: MatchingResult | undefined = analysis && isAnalysisValid
          ? {
            resumeId: resumeKey,
            score: analysis.score,
            summary: analysis.summary,
            highlights: analysis.highlights,
            recommendation: toRecommendation(analysis.recommendation),
            concerns: analysis.concerns ?? [],
            breakdown: toMatchBreakdown(analysis.breakdown),
            scoreSource: 'ai',
            matchedAt: new Date().toISOString(),
            jobDescriptionId: analysis.jobDescriptionId,
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
        }
      })
    }

    return resumes.map((resume, index) => {
      const resumeKey = buildResumeKey(resume, index)
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
      }
    })
  }, [actions, blocksByIdentity, filteredConvexResumes, jobDescriptionId, mode, resumes, sessionKeywords, statusByIdentity])

  const displayedResumes = useMemo(() => {
    const sortBy = filters.sortBy ?? 'score'
    const sortOrder = filters.sortOrder ?? 'desc'
    const direction = sortOrder === 'asc' ? 1 : -1

    return [...enrichedResumes].sort((a, b) => {
      if (sortBy === 'name') {
        return a.resume.name.localeCompare(b.resume.name, 'zh-Hans-CN') * direction
      }

      if (sortBy === 'experience') {
        return (parseExperienceYears(a.resume.experience) - parseExperienceYears(b.resume.experience)) * direction
      }

      if (sortBy === 'extractedAt') {
        return (parseExtractedAt(a.resume.extractedAt) - parseExtractedAt(b.resume.extractedAt)) * direction
      }

      const scoreA = a.match?.score ?? a.ruleScore ?? 0
      const scoreB = b.match?.score ?? b.ruleScore ?? 0
      return (scoreA - scoreB) * direction
    })
  }, [enrichedResumes, filters.sortBy, filters.sortOrder])

  const displayedResumeMap = useMemo(
    () => new Map(displayedResumes.map((entry) => [entry.key, entry.resume])),
    [displayedResumes]
  )

  const feedbackQuery = useMemo(() => {
    const parts = [...sessionKeywords]
    const normalizedLocation = sessionLocation.trim()
    if (normalizedLocation) {
      parts.push(normalizedLocation)
    }
    const query = parts.join(' ').trim()
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

  const handleSelectHighScore = useCallback(() => {
    setSelectedIds(
      new Set(
        displayedResumes
          .filter((entry) => (entry.match?.score ?? 0) >= 80)
          .map((entry) => entry.key)
      )
    )
  }, [displayedResumes])

  const handleResetAll = useCallback(() => {
    setSessionLocation('广东')
    setSessionKeywords([])
    setJobDescriptionId('')
    setFilters({})
    setSelectedTags([])
    setSelectedCompanies([])
    setSelectedExperienceLevel(undefined)
  }, [setSessionLocation, setSessionKeywords, setJobDescriptionId, setFilters, setSelectedTags, setSelectedCompanies, setSelectedExperienceLevel])

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
    async (action: 'shortlist' | 'reject' | 'star' | 'block' | 'export', format?: ResumeExportFormat) => {
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
        const exportEntries = selectedEntries.map(({ key, resume, match, action: currentAction, ruleScore, status }) => ({
          key,
          resume,
          match,
          action: currentAction,
          status,
          ruleScore: typeof match?.score === 'number' ? undefined : ruleScore,
        }))
        const exportFormat = format ?? bulkExportFormat

        try {
          const response = await fetch(`${apiBaseUrl}/api/resumes/export`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              format: exportFormat,
              entries: exportEntries,
            }),
          })

          if (!response.ok) {
            let message = `Export failed with status ${response.status}`
            try {
              const errorPayload = await response.json()
              const parsedErrorMessage = getExportErrorMessage(errorPayload)
              if (parsedErrorMessage) {
                message = parsedErrorMessage
              }
            } catch (error) {
              console.error('Failed to parse export error payload', error)
            }
            throw new Error(message)
          }

          const contentDisposition = response.headers.get('content-disposition')
          const filenameMatch = contentDisposition?.match(/filename="?([^";]+)"?/i)
          const filename = (filenameMatch && filenameMatch[1]) ? filenameMatch[1] : `selected-resumes-${new Date().toISOString().replace(/[:.]/g, '-')}.${exportFormat}`

          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = filename
          anchor.style.display = 'none'
          document.body.appendChild(anchor)
          anchor.click()

          window.setTimeout(() => {
            anchor.remove()
            URL.revokeObjectURL(url)
          }, 1000)

          toast.success(t('bulk.exported', { count: exportEntries.length, defaultValue: `Exported ${exportEntries.length} resumes` }))
          return
        } catch (error) {
          console.error('Export failed', error)
          toast.error(t('bulk.exportFailed', { defaultValue: 'Export failed. Please try again.' }))
          return
        }
      }

      try {
        if (action === 'shortlist' || action === 'reject') {
          selectedEntries.forEach((entry) => {
            sendLearningFeedback(action, entry.key, entry.resume)
          })
        }

        await Promise.all(
          selectedEntries.map((entry) =>
            saveAction({ resumeId: entry.key, actionType: action })
          )
        )
        const actionLabels: Record<string, string> = { shortlist: 'shortlisted', reject: 'rejected', star: 'starred' }
        toast.success(t('bulk.actionDone', { count: selectedEntries.length, action: actionLabels[action] || action, defaultValue: `${selectedEntries.length} resumes ${actionLabels[action] || action}` }))
      } catch (error) {
        console.error('Bulk action failed', error)
        toast.error(t('bulk.actionFailed', { defaultValue: 'Bulk action failed. Please try again.' }))
      }
    },
    [apiBaseUrl, blockCandidates, bulkExportFormat, displayedResumes, saveAction, selectedIds, sendLearningFeedback, t]
  )

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

      void saveAction({ resumeId, actionType: action })
        .then((result) => {
          if (result) {
            toast.success(`${actionLabel} 已保存`)
            return
          }

          toast.error('Action failed. Please try again.')
        })
        .catch((error: unknown) => {
          console.error('Individual action failed', error)
          toast.error('Action failed. Please try again.')
        })
    },
    [actionFeedbackLabels, displayedResumeMap, saveAction, sendLearningFeedback]
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

  const hasInput = Boolean(jobDescriptionId) || sessionKeywords.length > 0
  const disableAnalyzeButton = (filteredConvexResumes.length === 0 || analyzing || !hasInput || hasActiveTask)
  const shouldBlockQuickStartSync = activeHasUrlParams && !hasCompletedUrlHydration

  const handleQuickStartApply = useCallback(
    (config: {
      location: string
      keywords: string[]
      jobDescriptionId?: string
      filters?: Partial<ResumeFilters>
    }) => {
      if (shouldBlockQuickStartSync) {
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
      setJobDescriptionId((current) => (current === normalizedJobDescriptionId ? current : normalizedJobDescriptionId))
      setFilters((current) => ({
        ...current,
        ...(config.filters ?? {}),
        locations: normalizedLocation ? normalizedLocation.split(/[\s,，、]+/).filter(Boolean) : [],
      }))
    },
    [setFilters, setJobDescriptionId, setSessionKeywords, setSessionLocation, shouldBlockQuickStartSync]
  )

  const handleQuickConstraintApply = useCallback(
    (constraints: {
      minRoleYears?: number
      roleFilterType?: string
      maxAge?: number
    }) => {
      setFilters((current) => ({
        ...current,
        minExperience: constraints.minRoleYears,
        minRoleYears: constraints.minRoleYears,
        roleFilterType: normalizeOptionalString(constraints.roleFilterType),
        minSalesYears: undefined,
        maxAge: constraints.maxAge,
      }))
    },
    [setFilters]
  )

  return {
    sessionLocation,
    sessionKeywords,
    jobDescriptionId,
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
    selectedTags,
    selectedCompanies,
    selectedExperienceLevel,
    activeTagFilters,
    activeCompanyFilters,
    highScoreCount,
    bulkExportFormat,
    displayedResumes,
    setBulkExportFormat,
    handleAnalyzeAll,
    handleRefresh,
    handleQuickStartApply,
    handleQuickConstraintApply,
    handleJobChange,
    handleFiltersChange,
    handleToggleTag,
    handleToggleCompany,
    handleToggleExperienceLevel,
    handleClearLocation,
    handleClearTagFilters,
    handleSelectAll,
    handleSelectHighScore,
    handleClearSelection,
    handleToggleSelect,
    handleBulkAction,
    handleCardAction,
    handleToggleBlock,
    handleCandidateStatusChange,
    handleResetAll,
  }
}
