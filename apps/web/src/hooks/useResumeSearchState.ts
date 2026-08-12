import { deriveMarketFromSourceKey, formatKeywordQuery, isCompanyWorkflowBlocked, isSalesRequiredContext, parseKeywordQuery, resolveLocationHierarchy } from '@trends/shared'
import { matchesSalaryFilter } from '@/hooks/resume-filter-helpers'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { logSearchEvent } from '@/lib/search-analytics'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useAnalysisTasks } from '@/contexts/AnalysisTasksContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { useCandidateBlocks } from '@/hooks/useCandidateBlocks'
import { useCandidateStatus } from '@/hooks/useCandidateStatus'
import { matchResumeCompanyPolicyCached } from '@/hooks/useCompanyPolicyIndex'

import { useStableQuery } from '@/hooks/useStableQuery'
import {
  useConvexResumes,
  type ConvexResumeFilters,
  type ConvexResumeItem,
} from '@/hooks/useConvexResumes'
import { useFacetCounts } from '@/hooks/useFacetCounts'
import { useStatusCounts, type StatusCounts } from '@/hooks/useStatusCounts'
import {
  useUrlSearchState,
  type ExperienceLevelFilter,
  type UrlSearchState,
} from '@/hooks/useUrlSearchState'
import {
  submitResumeExportDownload,
  type ResumeExportRequestBody,
} from '@/lib/resume-export'
import { rawApiClient } from '@/lib/api-helpers'
import {
  createTaxonomyClusterResolver,
  fromClusterFilterToken,
  isClusterFilterToken,
  toClusterFilterToken,
  type TaxonomyClusterInput,
  type TaxonomyClusterResolver,
} from '@/lib/taxonomy'
import {
  getAnalysisForJob,
  computeDirectIndustryDb,
  normalizeExperienceLevel,
  overrideIndustryDbBreakdown,
  recommendationFromScore,
  toIndustryDbV2Stats,
} from '@/lib/resume-scoring'
import {
  getCurrentResumeAiPromptVersion,
  resolveAnalysisTopN,
  resolveResumeAnalysisSourceKey,
} from '@/lib/analysis-utils'
import { parseExperienceYears } from '@/lib/resume-filtering'
import { resolveResumeRefreshState } from '@/lib/resume-freshness'
import { getCollectionSourceMarket, resolveCollectionSource, getSourceLabelFromHostname } from '@/lib/search-profile-sources'
import type { SearchHistoryItem } from '@/hooks/useSession'
import {
  CANDIDATE_STATUS_VALUES,
  type CandidateActionType,
  type CandidateStatus,
  type ResumeExportFormat,
  type ResumeFilters,
} from '@/types/resume'
import type {
  FacetCounts,
  ResumeSearchRecentItem,
  ResumeSearchResultItem,
  SearchSortValue,
} from '@/components/search/search-types'

const INITIAL_RESUME_LIMIT = 200
const RESUME_PAGE_INCREMENT = 200
const SESSION_KEY_PREFIX = 'trends.resume.search.sessionKey'
const SERVER_STATUS_FACET_VALUES = CANDIDATE_STATUS_VALUES

type JobDescriptionApiResponse = {
  success: boolean
  item?: {
    title?: string
  }
  content?: string
}

type SearchHistoryRecord = {
  _id: SearchHistoryItem['id']
  sessionKey: string
  title: string
  location: string
  keywords: string[]
  jobDescriptionId?: string
  collectionSource?: SearchHistoryItem['collectionSource']
  filters?: Partial<ResumeFilters>
  selectedTags?: string[]
  selectedCompanies?: string[]
  selectedExperienceLevel?: string
  collectionTaskId?: string
  analysisTaskId?: string
  notes?: string
  industryDbV2Stats?: unknown
  createdAt: number
  lastOpenedAt?: number
}

type ResumeExportEntryMatch =
  NonNullable<ResumeExportRequestBody['entries'][number]['match']>

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function normalizeStringList(values: string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return []
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  values.forEach((value) => {
    const token = value.trim()
    const key = token.toLowerCase()
    if (!token || seen.has(key)) {
      return
    }

    seen.add(key)
    normalized.push(token)
  })

  return normalized
}

function queryImpliesSalesRole(
  query: string | undefined,
  keywords: string[],
): boolean {
  const normalizedTokens = normalizeStringList([
    ...keywords,
    ...parseKeywordQuery(query ?? '').keywords,
  ])

  return isSalesRequiredContext(query, ...normalizedTokens)
}

function resolveEffectiveRoleFilterType(state: UrlSearchState): string | undefined {
  const explicitRoleFilterType = normalizeOptionalString(state.filters.roleFilterType)
  if (explicitRoleFilterType) {
    return explicitRoleFilterType
  }

  if (typeof state.filters.minRoleYears !== 'number') {
    return undefined
  }

  return queryImpliesSalesRole(state.query, state.keywords) ? 'sales' : undefined
}

function resolveRelatedExpMarket(
  state: UrlSearchState,
  recentSearches: ResumeSearchRecentItem[],
): 'CN' | 'MY' | undefined {
  const explicitCollectionSource = recentSearches.find(
    (item) => item.collectionSource,
  )?.collectionSource

  if (!explicitCollectionSource) {
    const normalizedLocation = normalizeOptionalString(state.location)
    if (!normalizedLocation) {
      return undefined
    }

    const hierarchy = resolveLocationHierarchy(normalizedLocation)
    if (!hierarchy) {
      return undefined
    }

    if (hierarchy.country === 'Malaysia') {
      return 'MY'
    }

    if (hierarchy.country === '中国') {
      return 'CN'
    }

    return undefined
  }

  return getCollectionSourceMarket(explicitCollectionSource.type)
}

function buildRelatedExpContext(
  state: UrlSearchState,
  recentSearches: ResumeSearchRecentItem[],
): {
  roleFilterType?: string
  minRoleYears?: number
  market?: 'CN' | 'MY'
} | undefined {
  const roleFilterType = resolveEffectiveRoleFilterType(state)
  const minRoleYears = state.filters.minRoleYears
  const market = resolveRelatedExpMarket(state, recentSearches)

  if (!roleFilterType && typeof minRoleYears !== 'number' && !market) {
    return undefined
  }

  return {
    ...(roleFilterType ? { roleFilterType } : {}),
    ...(typeof minRoleYears === 'number' ? { minRoleYears } : {}),
    ...(market ? { market } : {}),
  }
}

function resolveScore(
  resume: ConvexResumeItem,
  jobDescriptionId: string | undefined,
  analysis: ConvexResumeItem['analysis'],
): number | undefined {
  if (
    typeof analysis?.score === 'number' &&
    Number.isFinite(analysis.score)
  ) {
    return analysis.score
  }

  const normalizedJobDescriptionId = normalizeOptionalString(jobDescriptionId)
  const ruleScores = resume.ingestData?.ruleScores ?? {}

  if (normalizedJobDescriptionId) {
    const candidateKeys = normalizedJobDescriptionId.startsWith('jd-')
      ? [normalizedJobDescriptionId, normalizedJobDescriptionId.slice(3)]
      : [normalizedJobDescriptionId, `jd-${normalizedJobDescriptionId}`]

    for (const key of candidateKeys) {
      const score = ruleScores[key]
      if (typeof score === 'number' && Number.isFinite(score)) {
        return score
      }
    }
  }

  if (
    typeof resume.primaryRuleScore === 'number' &&
    Number.isFinite(resume.primaryRuleScore)
  ) {
    return resume.primaryRuleScore
  }

  return undefined
}

function resolveSearchAnalysis(
  resume: ConvexResumeItem,
  jobDescriptionId: string | undefined,
  keywords: string[],
  location: string | undefined,
  currentPromptVersion: number,
): ConvexResumeItem['analysis'] {
  const matchedAnalysis = getAnalysisForJob(
    resume,
    jobDescriptionId,
    keywords,
    {
      location,
      promptVersion: currentPromptVersion,
      sourceKey: resolveResumeAnalysisSourceKey({
        source: resume.source,
      }),
    },
  )

  if (matchedAnalysis) {
    return matchedAnalysis
  }

  const fallbackAnalysis = resume.analysis
  if (!fallbackAnalysis) {
    return undefined
  }

  if (fallbackAnalysis.promptVersion !== currentPromptVersion) {
    return undefined
  }

  const ingestComputedAt = resume.ingestData?.computedAt
  if (
    typeof ingestComputedAt === 'number' &&
    typeof fallbackAnalysis.analyzedAt === 'number' &&
    ingestComputedAt > fallbackAnalysis.analyzedAt
  ) {
    return undefined
  }

  return fallbackAnalysis
}

function hasExplicitSearchContext(state: UrlSearchState): boolean {
  return Boolean(
    normalizeOptionalString(state.query) ||
    normalizeOptionalString(state.location) ||
    normalizeOptionalString(state.jobDescriptionId) ||
    state.requiredKeywords.length > 0 ||
    state.selectedTags.length > 0 ||
    state.selectedCompanies.length > 0 ||
    state.selectedSources.length > 0 ||
    state.selectedBrands.length > 0 ||
    state.selectedExperienceLevel ||
    (state.filters.education?.length ?? 0) > 0 ||
    (state.filters.status?.length ?? 0) > 0 ||
    typeof state.filters.minMatchScore === 'number' ||
    typeof state.filters.maxExperience === 'number' ||
    typeof state.filters.minRoleYears === 'number' ||
    typeof state.filters.minSalary === 'number' ||
    typeof state.filters.maxSalary === 'number' ||
    Boolean(normalizeOptionalString(state.filters.roleFilterType)) ||
    (state.filters.locations?.length ?? 0) > 0
  )
}

function resolveSortValue(filters: Partial<ResumeFilters>): SearchSortValue {
  if (filters.sortBy === 'experience') {
    return 'experience'
  }

  if (filters.sortBy === 'extractedAt') {
    return 'newest'
  }

  return 'score'
}

function buildUrlState(
  state: UrlSearchState,
  overrides: Partial<UrlSearchState>,
): UrlSearchState {
  return {
    shareSessionId:
      'shareSessionId' in overrides
        ? overrides.shareSessionId
        : state.shareSessionId,
    query: 'query' in overrides ? overrides.query : state.query,
    location: 'location' in overrides ? overrides.location : state.location,
    keywords: overrides.keywords ?? state.keywords,
    requiredKeywords: overrides.requiredKeywords ?? state.requiredKeywords,
    jobDescriptionId:
      'jobDescriptionId' in overrides
        ? overrides.jobDescriptionId
        : state.jobDescriptionId,
    selectedTags: overrides.selectedTags ?? state.selectedTags,
    selectedCompanies: overrides.selectedCompanies ?? state.selectedCompanies,
    selectedSources: overrides.selectedSources ?? state.selectedSources,
    selectedBrands: overrides.selectedBrands ?? state.selectedBrands,
    selectedExperienceLevel:
      'selectedExperienceLevel' in overrides
        ? overrides.selectedExperienceLevel
        : state.selectedExperienceLevel,
    filters: overrides.filters ?? state.filters,
  }
}

function clearSortFilters(
  filters: Partial<ResumeFilters>,
): Partial<ResumeFilters> {
  const nextFilters: Partial<ResumeFilters> = { ...filters }
  delete nextFilters.sortBy
  delete nextFilters.sortOrder
  return nextFilters
}

function buildSearchContextSignature(state: UrlSearchState): string {
  return JSON.stringify({
    query: normalizeOptionalString(state.query),
    location: normalizeOptionalString(state.location),
    keywords: normalizeStringList(state.keywords),
    requiredKeywords: normalizeStringList(state.requiredKeywords),
    jobDescriptionId: normalizeOptionalString(state.jobDescriptionId),
    selectedTags: normalizeStringList(state.selectedTags),
    selectedCompanies: normalizeStringList(state.selectedCompanies),
    selectedSources: normalizeStringList(state.selectedSources),
    selectedBrands: normalizeStringList(state.selectedBrands),
    selectedExperienceLevel: state.selectedExperienceLevel,
    filters: {
      education: normalizeStringList(state.filters.education ?? []),
      locations: normalizeStringList(state.filters.locations ?? []),
      maxAge: state.filters.maxAge,
      maxExperience: state.filters.maxExperience,
      minAge: state.filters.minAge,
      minMatchScore: state.filters.minMatchScore,
      minRoleYears: state.filters.minRoleYears,
      roleFilterType: normalizeOptionalString(state.filters.roleFilterType),
      status: normalizeStringList(state.filters.status ?? []),
      minSalary: state.filters.minSalary,
      maxSalary: state.filters.maxSalary,
    },
  })
}

function sortResults(
  results: ResumeSearchResultItem[],
  sortValue: SearchSortValue,
): ResumeSearchResultItem[] {
  if (sortValue === 'score') {
    return [...results].sort(
      (left, right) => (right.score ?? -1) - (left.score ?? -1),
    )
  }

  return [...results].sort((left, right) => {
    if (sortValue === 'newest') {
      const rightTimestamp = right.resume.extractedAt
        ? Date.parse(right.resume.extractedAt)
        : right.resume.crawledAt
      const leftTimestamp = left.resume.extractedAt
        ? Date.parse(left.resume.extractedAt)
        : left.resume.crawledAt
      return rightTimestamp - leftTimestamp
    }

    return (
      parseExperienceYears(right.resume.experience) -
      parseExperienceYears(left.resume.experience)
    )
  })
}

function buildSearchExportMatch(
  item: ResumeSearchResultItem,
): ResumeExportEntryMatch | undefined {
  if (typeof item.score !== 'number' || !Number.isFinite(item.score)) {
    return undefined
  }

  const analysis = item.analysis
  const usesAiScore = item.scoreSource === 'ai' && Boolean(analysis)

  return {
    score: item.score,
    recommendation: recommendationFromScore(item.score),
    scoreSource: usesAiScore ? 'ai' : 'rule',
    ...(usesAiScore && analysis?.summary
      ? { summary: analysis.summary }
      : {}),
    ...(usesAiScore && analysis?.breakdown
      ? { breakdown: analysis.breakdown }
      : {}),
  }
}

function buildSearchExportEntry(
  item: ResumeSearchResultItem,
  userRating?: number,
): ResumeExportRequestBody['entries'][number] {
  const match = buildSearchExportMatch(item)
  const userComment = normalizeOptionalString(item.statusMeta?.notes)

  return {
    resumeId: item.key,
    status: item.status,
    ...(match ? { match } : {}),
    ...(typeof item.resume.primaryRuleScore === 'number'
      ? { ruleScore: item.resume.primaryRuleScore }
      : {}),
    ...(userComment ? { userComment } : {}),
    ...(typeof userRating === 'number' ? { userRating } : {}),
  }
}

const DEFAULT_STATUS_WHEN_EMPTY: CandidateStatus = 'new'

const ACTION_TO_STATUS: Partial<Record<CandidateActionType, CandidateStatus>> = {
  shortlist: 'shortlisted',
  reject: 'rejected',
  star: 'new',
}

function isExtractedToday(extractedAt: string | undefined): boolean {
  if (!extractedAt) {
    return false
  }

  const timestamp = Date.parse(extractedAt)
  if (!Number.isFinite(timestamp)) {
    return false
  }

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(todayStart.getDate() + 1)

  return timestamp >= todayStart.getTime() && timestamp < tomorrowStart.getTime()
}

function matchesBlockVisibility(
  item: ResumeSearchResultItem,
  filters: Partial<ResumeFilters>,
): boolean {
  return filters.showBlocked === true || !item.blocked
}

function mergeServerStatusFacetCounts(
  facetCounts: FacetCounts,
  statusCounts: StatusCounts,
): FacetCounts {
  if (statusCounts.loading) {
    return facetCounts
  }

  const labelsByValue = new Map(
    facetCounts.statuses.map((item) => [item.value, item.label]),
  )
  const statuses = SERVER_STATUS_FACET_VALUES
    .map((value) => {
      const label = labelsByValue.get(value)
      return {
        value,
        count: statusCounts[value],
        ...(label ? { label } : {}),
      }
    })
    .filter((item) => item.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count
      }
      return left.value.localeCompare(right.value)
    })

  return {
    ...facetCounts,
    statuses,
  }
}

function matchesLocalFilters(
  item: ResumeSearchResultItem,
  state: UrlSearchState,
  selectedRawTags: string[],
  selectedClusterTags: string[],
  taxonomyResolver: TaxonomyClusterResolver,
): boolean {
  const normalizedSelectedTags = selectedRawTags.map((value) =>
    value.toLowerCase(),
  )
  const normalizedSelectedClusters = selectedClusterTags.map((value) =>
    value.toLowerCase(),
  )
  const normalizedSelectedCompanies = state.selectedCompanies.map((value) =>
    value.toLowerCase(),
  )
  const normalizedSelectedSources = state.selectedSources.map((value) =>
    value.toLowerCase(),
  )
  const normalizedSelectedBrands = state.selectedBrands.map((value) =>
    value.toLowerCase(),
  )
  const normalizedEducation = (state.filters.education ?? []).map((value) =>
    value.toLowerCase(),
  )
  const normalizedStatuses = state.filters.status ?? []
  const industryTags =
    item.resume.ingestData?.industryTags?.map((value) => value.toLowerCase()) ??
    []
  const matchedClusters = new Set(
    taxonomyResolver
      .resolveTagClusters(item.resume.ingestData?.industryTags)
      .map((cluster) => cluster.slug.toLowerCase()),
  )
  const companyHits =
    item.resume.ingestData?.companyHits?.map((value) => value.toLowerCase()) ??
    []
  const education = item.resume.education?.trim().toLowerCase() ?? ''
  const experienceLevel = normalizeExperienceLevel(item.resume.ingestData?.experienceLevel)
  const minScore = state.filters.minMatchScore

  if (!matchesBlockVisibility(item, state.filters)) {
    return false
  }

  if (
    normalizedSelectedTags.length > 0 &&
    !normalizedSelectedTags.every((tag) => industryTags.includes(tag))
  ) {
    return false
  }

  if (
    normalizedSelectedClusters.length > 0 &&
    !normalizedSelectedClusters.every((slug) => matchedClusters.has(slug))
  ) {
    return false
  }

  if (
    normalizedSelectedCompanies.length > 0 &&
    !normalizedSelectedCompanies.some((company) =>
      companyHits.includes(company),
    )
  ) {
    return false
  }

  if (
    normalizedSelectedSources.length > 0
  ) {
    const itemSourceLabel = getSourceLabelFromHostname(item.resume.source)?.toLowerCase()
    if (!itemSourceLabel || !normalizedSelectedSources.includes(itemSourceLabel)) {
      return false
    }
  }

  if (normalizedSelectedBrands.length > 0) {
    const brandNames =
      item.resume.ingestData?.brandHits
        ?.filter((hit) => hit.context !== 'employer')
        .map((hit) => hit.brand.toLowerCase()) ?? []
    if (!normalizedSelectedBrands.every((brand) => brandNames.includes(brand))) {
      return false
    }
  }

  if (
    state.selectedExperienceLevel &&
    experienceLevel !== state.selectedExperienceLevel
  ) {
    return false
  }

  if (
    normalizedEducation.length > 0 &&
    !normalizedEducation.includes(education)
  ) {
    return false
  }

  // Default: show only new (untriaged) resumes unless user explicitly filters for a status
  if (normalizedStatuses.length > 0) {
    const matchesSelectedStatus = normalizedStatuses.some((status) => item.status === status)
    if (!matchesSelectedStatus) {
      return false
    }
  } else if (item.status !== DEFAULT_STATUS_WHEN_EMPTY && !(state.filters.showRejected === true && item.status === 'rejected')) {
    return false
  }

  if (typeof minScore === 'number' && (item.score ?? 0) < minScore) {
    return false
  }

  // NOTE: roleFilterType, minRoleYears, minAge, maxAge, and salary range
  // are already filtered server-side by Convex/BFF. Only client-only filters
  // (status, idOrNameSearch, tags, brands, education, minScore) remain here.

  if (!matchesSalaryFilter(item.resume.expectedSalary, state.filters.minSalary, state.filters.maxSalary)) {
    return false
  }

  const idOrNameNeedle = state.filters.idOrNameSearch?.trim().toLowerCase()
  if (idOrNameNeedle) {
    const resumeIdStr = String(item.resume.resumeId).toLowerCase()
    const externalIdStr = (item.resume.externalId ?? '').toLowerCase()
    const identityKeyStr = (item.identityKey ?? item.resume.identityKey ?? '').toLowerCase()
    const nameStr = (item.resume.name ?? '').toLowerCase()
    if (
      !resumeIdStr.includes(idOrNameNeedle) &&
      !externalIdStr.includes(idOrNameNeedle) &&
      !identityKeyStr.includes(idOrNameNeedle) &&
      !nameStr.includes(idOrNameNeedle)
    ) {
      return false
    }
  }

  return true
}

function toRecentSearchItems(
  records: SearchHistoryRecord[] | undefined,
): ResumeSearchRecentItem[] {
  if (!records) {
    return []
  }

  return records.map((record) => ({
    id: record._id,
    sessionKey: record.sessionKey,
    title: record.title,
    location: record.location,
    keywords: record.keywords,
    jobDescriptionId: normalizeOptionalString(record.jobDescriptionId),
    collectionSource: resolveCollectionSource(
      record.collectionSource,
    ),
    filters: record.filters ?? {},
    selectedTags: normalizeStringList(record.selectedTags),
    selectedCompanies: normalizeStringList(record.selectedCompanies),
    selectedExperienceLevel: normalizeOptionalString(
      record.selectedExperienceLevel,
    ),
    collectionTaskId: normalizeOptionalString(record.collectionTaskId),
    analysisTaskId: normalizeOptionalString(record.analysisTaskId),
    notes: normalizeOptionalString(record.notes),
    industryDbV2Stats: toIndustryDbV2Stats(record.industryDbV2Stats),
    createdAt: record.createdAt,
    lastOpenedAt: record.lastOpenedAt,
  }))
}

function createSessionKey(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function ensureStoredSessionKey(storageKey: string): string {
  const stored = localStorage.getItem(storageKey)
  if (stored) {
    return stored
  }

  const nextKey = createSessionKey()
  localStorage.setItem(storageKey, nextKey)
  return nextKey
}

export function useResumeSearchState() {
  const { t } = useTranslation()
  const { isAuthenticated } = useAuth()
  const { slug, isPublicSurface } = useWorkspace()
  const { parsedState, syncToUrl } = useUrlSearchState()
  // The public resume surface is read-only: workspace-gated operational
  // endpoints (blocks, status, sessions) 401/403 for anonymous / non-member
  // viewers, so they are skipped there entirely.
  const canLoadOperationalState = isAuthenticated && !isPublicSurface
  const storageKey = `${SESSION_KEY_PREFIX}.${slug}`
  const [sessionKey, setSessionKey] = useState(() =>
    ensureStoredSessionKey(storageKey),
  )
  const [queryInput, setQueryInput] = useState(
    () => parsedState.query ?? formatKeywordQuery(parsedState.keywords),
  )
  const [aiModeEnabled, setAiModeEnabled] = useState(true)
  const [exportFormat, setExportFormat] = useState<ResumeExportFormat>('csv')
  const [exportingResults, setExportingResults] = useState(false)
  const [analyzingResults, setAnalyzingResults] = useState(false)
  const [autoAnalyzeSearchNonce, setAutoAnalyzeSearchNonce] = useState(0)
  const [isFilterPending, startFilterTransition] = useTransition()
  const [committedMinRoleYears, setCommittedMinRoleYears] = useState(parsedState.filters.minRoleYears)

  // Sync committed filter values when transition completes
  useEffect(() => {
    if (!isFilterPending) {
      setCommittedMinRoleYears(parsedState.filters.minRoleYears)
    }
  }, [isFilterPending, parsedState.filters.minRoleYears])
  const [pendingAutoAnalyzeContextSignature, setPendingAutoAnalyzeContextSignature] = useState('')
  const [resumeLimit, setResumeLimit] = useState(INITIAL_RESUME_LIMIT)
  const saveSearchHistory = useMutation(api.sessions.saveSearchHistory)
  const markSearchHistoryOpened = useMutation(
    api.sessions.markSearchHistoryOpened,
  )
  const { tasks: analysisTasks, dispatch: dispatchAnalysis } = useAnalysisTasks()
  const recentSearchHistoryRecords = useQuery(
    api.sessions.recentSearches,
    canLoadOperationalState
      ? {
        sessionKey,
        workspaceSlug: slug,
        limit: 10,
      }
      : 'skip',
  )
  const taxonomyClusterRecords = useStableQuery(api.taxonomy_clusters.list, {
    workspaceSlug: slug,
    status: 'active',
  })
  const { statusByIdentity, updateStatus: updateCandidateStatus } = useCandidateStatus(canLoadOperationalState)
  const { blocksByIdentity, blockCandidates, unblockCandidate } = useCandidateBlocks(canLoadOperationalState)
  const { actions: actionsByResume, ratingsByResume, commentsByResume, saveAction, getAiFeedback } = useCandidateActions(
    sessionKey,
    parsedState.jobDescriptionId,
    canLoadOperationalState,
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || '/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  useEffect(() => {
    setQueryInput(parsedState.query ?? formatKeywordQuery(parsedState.keywords))
  }, [parsedState.keywords, parsedState.query])

  useEffect(() => {
    setSessionKey(ensureStoredSessionKey(storageKey))
  }, [storageKey])

  useEffect(() => {
    setResumeLimit(INITIAL_RESUME_LIMIT)
  }, [
    parsedState.filters.education,
    parsedState.filters.locations,
    parsedState.filters.maxExperience,
    parsedState.filters.minMatchScore,
    parsedState.filters.minRoleYears,
    parsedState.filters.roleFilterType,
    parsedState.filters.status,
    parsedState.filters.minSalary,
    parsedState.filters.maxSalary,
    parsedState.filters.showBlocked,
    parsedState.jobDescriptionId,
    parsedState.location,
    parsedState.query,
    parsedState.requiredKeywords,
    parsedState.selectedCompanies,
    parsedState.selectedSources,
    parsedState.selectedBrands,
    parsedState.selectedExperienceLevel,
    parsedState.selectedTags,
  ])

  const isLanding = !hasExplicitSearchContext(parsedState)
  const activeQuery = normalizeOptionalString(parsedState.query)
  const currentSearchContextSignature = useMemo(
    () => buildSearchContextSignature(parsedState),
    [parsedState],
  )
  const effectiveRoleFilterType = useMemo(
    () => resolveEffectiveRoleFilterType(parsedState),
    [parsedState],
  )
  const currentPromptVersion = useMemo(() => getCurrentResumeAiPromptVersion(), [])
  const analysisKeywords = useMemo(
    () =>
      normalizeStringList([
        ...parsedState.keywords,
        ...parseKeywordQuery(activeQuery ?? '').keywords,
      ]),
    [activeQuery, parsedState.keywords],
  )
  const backendFilters = useMemo<ConvexResumeFilters>(
    () => ({
      maxExperience: parsedState.filters.maxExperience,
      minRoleYears: parsedState.filters.minRoleYears,
      roleFilterType: effectiveRoleFilterType,
      minAge: parsedState.filters.minAge,
      maxAge: parsedState.filters.maxAge,
      minSalary: parsedState.filters.minSalary,
      maxSalary: parsedState.filters.maxSalary,
      requiredKeywords: parsedState.requiredKeywords,
      keywords: parsedState.keywords.length > 0 ? parsedState.keywords : undefined,
      locations: parsedState.filters.locations,
      sources: parsedState.selectedSources.length > 0 ? parsedState.selectedSources : undefined,
    }),
    [
      effectiveRoleFilterType,
      parsedState.filters.locations,
      parsedState.filters.maxAge,
      parsedState.filters.maxExperience,
      parsedState.filters.maxSalary,
      parsedState.filters.minAge,
      parsedState.filters.minRoleYears,
      parsedState.filters.minSalary,
      parsedState.keywords,
      parsedState.requiredKeywords,
      parsedState.selectedSources,
    ],
  )
  const activeSort = resolveSortValue(parsedState.filters)
  const resumeQuery = useConvexResumes(
    resumeLimit,
    activeQuery,
    parsedState.jobDescriptionId,
    {
      enabled: !isLanding,
      filters: backendFilters,
      ...(activeSort === 'newest'
        ? { sortBy: 'extractedAt' as const, sortOrder: 'desc' as const }
        : {}),
      ...(activeSort === 'experience'
        ? { sortBy: 'experience' as const, sortOrder: 'desc' as const }
        : {}),
      showBlocked: parsedState.filters.showBlocked === true,
    },
  )

  const recentSearches = useMemo(
    () => toRecentSearchItems(recentSearchHistoryRecords),
    [recentSearchHistoryRecords],
  )
  const taxonomyClusters = useMemo<TaxonomyClusterInput[]>(
    () =>
      (taxonomyClusterRecords ?? []).map((cluster) => ({
        name: cluster.name,
        slug: cluster.slug,
        parentSlug: cluster.parentSlug,
        tags: cluster.tags,
      })),
    [taxonomyClusterRecords],
  )
  const taxonomyResolver = useMemo(
    () => createTaxonomyClusterResolver(taxonomyClusters),
    [taxonomyClusters],
  )
  const selectedClusterTags = useMemo(
    () =>
      normalizeStringList(
        parsedState.selectedTags
          .filter((value) => isClusterFilterToken(value))
          .map((value) => fromClusterFilterToken(value)),
      ),
    [parsedState.selectedTags],
  )
  const selectedRawTags = useMemo(
    () =>
      normalizeStringList(
        parsedState.selectedTags.filter(
          (value) => !isClusterFilterToken(value),
        ),
      ),
    [parsedState.selectedTags],
  )

  const results = useMemo<ResumeSearchResultItem[]>(() => {
    return resumeQuery.resumes.map((resume) => {
      const identityKey = resume.identityKey?.trim() || resume.externalId
      const statusRecord = statusByIdentity[identityKey]
      const analysisSourceKey = resolveResumeAnalysisSourceKey({
        source: resume.source,
      })
      const analysis = resolveSearchAnalysis(
        resume,
        parsedState.jobDescriptionId,
        analysisKeywords,
        parsedState.location,
        currentPromptVersion,
      )
      const refreshState = resolveResumeRefreshState({
        resume,
        analysisContext: {
          jobDescriptionId: parsedState.jobDescriptionId,
          keywords: analysisKeywords,
          location: parsedState.location,
          sourceKey: analysisSourceKey,
        },
        currentPromptVersion,
      })
      const hasBrandHits = (resume.ingestData?.brandHits ?? []).some((hit) => hit.context !== 'employer')
      const hasCompanyHits = (resume.ingestData?.companyHits?.length ?? 0) > 0
      const normalizedAnalysis = analysis
        ? overrideIndustryDbBreakdown(
          analysis,
          computeDirectIndustryDb(
            resume.ingestData?.industryDbV2Raw,
            hasBrandHits,
            hasCompanyHits,
          ),
          resume.ingestData?.market
            ?? deriveMarketFromSourceKey(
              resolveResumeAnalysisSourceKey({
                source: resume.source,
              }),
            ),
        )
        : undefined
      const score = resolveScore(
        resume,
        parsedState.jobDescriptionId,
        normalizedAnalysis,
      )
      return {
        key: `${resume.resumeId}`,
        identityKey,
        resume,
        blocked: Boolean(blocksByIdentity[identityKey]),
        analysis: normalizedAnalysis,
        score,
        scoreSource:
          typeof score === 'number'
            ? normalizedAnalysis && normalizedAnalysis.score === score
              ? 'ai'
              : 'rule'
            : undefined,
          status: statusRecord?.status ?? 'new',
          statusMeta: statusRecord,
          refreshState,
        }
      })
  }, [
    analysisKeywords,
    blocksByIdentity,
    currentPromptVersion,
    parsedState.jobDescriptionId,
    parsedState.location,
    resumeQuery.resumes,
    statusByIdentity,
  ])

  const blockVisibleResults = useMemo(
    () => results.filter((item) => matchesBlockVisibility(item, parsedState.filters)),
    [parsedState.filters, results],
  )

  const filteredResults = useMemo(
    () =>
      sortResults(
        blockVisibleResults.filter((item) =>
          matchesLocalFilters(
            item,
            {
              ...parsedState,
              filters: {
                ...parsedState.filters,
                roleFilterType: effectiveRoleFilterType,
              },
            },
            selectedRawTags,
            selectedClusterTags,
            taxonomyResolver,
          ),
        ),
        activeSort,
      ),
    [
      activeSort,
      blockVisibleResults,
      effectiveRoleFilterType,
      parsedState,
      selectedClusterTags,
      selectedRawTags,
      taxonomyResolver,
    ],
  )

  const deferredFilteredResults = useDeferredValue(filteredResults)

  const facetCounts: FacetCounts = useFacetCounts(blockVisibleResults, taxonomyClusters)
  const statusCounts = useStatusCounts({
    enabled: !isLanding && canLoadOperationalState,
    filters: {
      ...backendFilters,
      showBlocked: parsedState.filters.showBlocked === true,
    },
    workspaceSlug: slug,
    useAndModeBff: resumeQuery.isAndModeBff === true,
    bffStatusCounts: resumeQuery.bffStatusCounts,
  })
  const facetCountsWithServerStatuses: FacetCounts = mergeServerStatusFacetCounts(facetCounts, statusCounts)
  const loadedCollectedTodayCount = useMemo(
    () => blockVisibleResults.filter((item) => isExtractedToday(item.resume.extractedAt)).length,
    [blockVisibleResults],
  )
  const statusSummary = useMemo(() => {
    if (statusCounts.loading) {
      return undefined
    }

    return {
      new: statusCounts.new,
      shortlisted: statusCounts.shortlisted,
      rejected: statusCounts.rejected,
      total: statusCounts.total,
    }
  }, [
    statusCounts.loading,
    statusCounts.new,
    statusCounts.rejected,
    statusCounts.shortlisted,
    statusCounts.total,
  ])
  const hasMore = resumeQuery.hasMore
  const loading = !isLanding && resumeQuery.loading
  const loadingMore = resumeQuery.loadingMore
  const convexSearchFailed = resumeQuery.searchFailed === true
  const convexRetrySearch = resumeQuery.retrySearch
  const isFiltering = isFilterPending || (loading && results.length > 0)

  // Log search analytics (fire-and-forget, debounced by query change)
  const lastLoggedQueryRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeQuery && !loading && filteredResults.length >= 0 && lastLoggedQueryRef.current !== activeQuery) {
      lastLoggedQueryRef.current = activeQuery
      logSearchEvent({
        query: activeQuery,
        resultCount: filteredResults.length,
        topScore: filteredResults[0]?.score ?? undefined,
      })
    }
  }, [activeQuery, filteredResults, loading])
  const analysisCandidates = useMemo(
    () =>
      filteredResults
        .filter((item) => !item.analysis)
        .sort((left, right) => (right.score ?? -1) - (left.score ?? -1)),
    [filteredResults],
  )
  const analysisTopN = resolveAnalysisTopN(import.meta.env.VITE_ANALYSIS_TOP_N)
  const analysisCandidateResumeIds = useMemo(
    () => analysisCandidates.map((item) => item.resume.resumeId),
    [analysisCandidates],
  )
  const analysisDispatchBatchIds = useMemo(
    () => analysisCandidateResumeIds.slice(0, analysisTopN),
    [analysisCandidateResumeIds, analysisTopN],
  )
  const analysisCandidateSignature = useMemo(
    () =>
      [...analysisDispatchBatchIds]
        .sort((left, right) => left.localeCompare(right))
        .join('|'),
    [analysisDispatchBatchIds],
  )
  const autoAnalyzeSignature = useMemo(() => {
    if (autoAnalyzeSearchNonce === 0 || analysisCandidateSignature.length === 0) {
      return ''
    }

    return `${autoAnalyzeSearchNonce}:${analysisCandidateSignature}`
  }, [analysisCandidateSignature, autoAnalyzeSearchNonce])
  const autoAnalyzeDispatchSignatureRef = useRef('')
  const pendingForceAnalyzeRef = useRef(false)
  const aiModeStats = useMemo(() => {
    const analyzedResults = filteredResults.filter(
      (item) => typeof item.analysis?.score === 'number',
    )

    if (analyzedResults.length === 0) {
      return undefined
    }

    const avgScore = Number(
      (
        analyzedResults.reduce(
          (sum, item) => sum + (item.analysis?.score ?? 0),
          0,
        ) / analyzedResults.length
      ).toFixed(2),
    )

    return {
      avgScore,
      matched: analyzedResults.length,
      processed: filteredResults.length,
    }
  }, [filteredResults])
  const hasActiveAnalysisTask = useMemo(
    () =>
      (analysisTasks ?? []).some(
        (task) => task.status === 'pending' || task.status === 'processing',
      ),
    [analysisTasks],
  )
  const disableAnalyzeResults =
    !aiModeEnabled ||
    isLanding ||
    loading ||
    results.length === 0 ||
    analysisCandidateResumeIds.length === 0 ||
    analyzingResults ||
    hasActiveAnalysisTask ||
    !dispatchAnalysis ||
    (!parsedState.jobDescriptionId && analysisKeywords.length === 0)
  const filterCount =
    parsedState.selectedTags.length +
    parsedState.selectedCompanies.length +
    parsedState.selectedSources.length +
    parsedState.selectedBrands.length +
    (parsedState.selectedExperienceLevel ? 1 : 0) +
    (parsedState.filters.education?.length ?? 0) +
    (parsedState.filters.status?.length ?? 0) +
    (typeof parsedState.filters.minMatchScore === 'number' ? 1 : 0) +
    (typeof parsedState.filters.minSalary === 'number' || typeof parsedState.filters.maxSalary === 'number' ? 1 : 0)

  const lastSavedFingerprintRef = useRef<string>('')
  useEffect(() => {
    if (!canLoadOperationalState) {
      return
    }
    if (isLanding) {
      return
    }

    const normalizedKeywords = parseKeywordQuery(
      parsedState.query ?? formatKeywordQuery(parsedState.keywords),
    ).keywords
    if (normalizedKeywords.length === 0 && !parsedState.jobDescriptionId) {
      return
    }

    const fingerprint = JSON.stringify({
      query: parsedState.query,
      location: parsedState.location,
      jobDescriptionId: parsedState.jobDescriptionId,
      requiredKeywords: parsedState.requiredKeywords,
      selectedTags: parsedState.selectedTags,
      selectedCompanies: parsedState.selectedCompanies,
      selectedExperienceLevel: parsedState.selectedExperienceLevel,
      filters: parsedState.filters,
    })

    if (lastSavedFingerprintRef.current === fingerprint) {
      return
    }

    const timer = window.setTimeout(() => {
      lastSavedFingerprintRef.current = fingerprint
      void saveSearchHistory({
        sessionKey,
        workspaceSlug: slug,
        title: normalizeOptionalString(
          [
            normalizeOptionalString(parsedState.location),
            normalizeOptionalString(parsedState.query) ??
            formatKeywordQuery(normalizedKeywords),
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        location: parsedState.location ?? '',
        keywords: normalizedKeywords,
        jobDescriptionId: parsedState.jobDescriptionId,
        filters: parsedState.filters,
        selectedTags: parsedState.selectedTags,
        selectedCompanies: parsedState.selectedCompanies,
        selectedExperienceLevel: parsedState.selectedExperienceLevel,
        resumeIds: results
          .slice(0, 50)
          .map((item) => String(item.resume.resumeId)),
      })
    }, 800)

    return () => window.clearTimeout(timer)
  }, [canLoadOperationalState, isLanding, parsedState, results, saveSearchHistory, sessionKey, slug])

  useEffect(() => {
    if (aiModeEnabled) {
      return
    }

    pendingForceAnalyzeRef.current = false
    setPendingAutoAnalyzeContextSignature('')
  }, [aiModeEnabled])

  const armAutoAnalyze = useCallback((nextState: UrlSearchState) => {
    setPendingAutoAnalyzeContextSignature(
      buildSearchContextSignature(nextState),
    )
    setAutoAnalyzeSearchNonce((current) => current + 1)
  }, [])

  const submitSearch = useCallback(
    (
      nextQuery?: string,
      options?: {
        location?: string
        minRoleYears?: number
        roleFilterType?: string
        minAge?: number
        maxAge?: number
        minExperience?: number
      },
    ) => {
      const resolvedQuery = normalizeOptionalString(nextQuery ?? queryInput)
      const nextKeywords = parseKeywordQuery(resolvedQuery ?? '').keywords
      const clearedFilters = clearSortFilters(parsedState.filters)
      const nextState = buildUrlState(parsedState, {
        query: resolvedQuery,
        keywords: nextKeywords,
        location: options?.location ?? parsedState.location,
        filters: {
          ...clearedFilters,
          ...(typeof options?.minRoleYears === 'number' ? { minRoleYears: options.minRoleYears } : {}),
          ...(typeof options?.roleFilterType === 'string' && options.roleFilterType.trim().length > 0
            ? { roleFilterType: options.roleFilterType.trim() }
            : {}),
          ...(typeof options?.minAge === 'number' ? { minAge: options.minAge } : {}),
          ...(typeof options?.maxAge === 'number' ? { maxAge: options.maxAge } : {}),
          ...(typeof options?.minExperience === 'number' ? { minExperience: options.minExperience } : {}),
        },
      })

      setAiModeEnabled(true)
      pendingForceAnalyzeRef.current = true
      syncToUrl(nextState)
      armAutoAnalyze(nextState)
    },
    [armAutoAnalyze, parsedState, queryInput, syncToUrl],
  )

  const clearSearch = useCallback(() => {
    setQueryInput('')
    setPendingAutoAnalyzeContextSignature('')
    pendingForceAnalyzeRef.current = false
    syncToUrl(
      buildUrlState(parsedState, {
        query: undefined,
        keywords: [],
        requiredKeywords: [],
        jobDescriptionId: undefined,
        selectedTags: [],
        selectedCompanies: [],
        selectedSources: [],
        selectedBrands: [],
        selectedExperienceLevel: undefined,
        filters: {},
      }),
    )
  }, [parsedState, syncToUrl])

  const applyRecentSearch = useCallback(
    async (item: ResumeSearchRecentItem) => {
      await markSearchHistoryOpened({ id: item.id, workspaceSlug: slug })

      const query = formatKeywordQuery(item.keywords)
      setQueryInput(query)
      const nextState = {
        query,
        shareSessionId: undefined,
        location: normalizeOptionalString(item.location),
        keywords: item.keywords,
        requiredKeywords: [],
        jobDescriptionId: item.jobDescriptionId,
        selectedTags: item.selectedTags,
        selectedCompanies: item.selectedCompanies,
        selectedSources: [],
        selectedBrands: [],
        selectedExperienceLevel:
          (item.selectedExperienceLevel as ExperienceLevelFilter | undefined) ??
          undefined,
        filters: clearSortFilters(item.filters ?? {}),
      }

      setAiModeEnabled(true)
      pendingForceAnalyzeRef.current = true
      syncToUrl(nextState)
      armAutoAnalyze(nextState)
    },
    [armAutoAnalyze, markSearchHistoryOpened, slug, syncToUrl],
  )

  const setSelectedTags = useCallback(
    (selectedTags: string[]) => {
      syncToUrl(buildUrlState(parsedState, { selectedTags }))
    },
    [parsedState, syncToUrl],
  )

  const toggleTag = useCallback(
    (tag: string) => {
      const normalized = tag.trim()
      if (!normalized) {
        return
      }

      const nextTags = parsedState.selectedTags.some(
        (value) => value.toLowerCase() === normalized.toLowerCase(),
      )
        ? parsedState.selectedTags.filter(
          (value) => value.toLowerCase() !== normalized.toLowerCase(),
        )
        : [...parsedState.selectedTags, normalized]

      setSelectedTags(nextTags)
    },
    [parsedState.selectedTags, setSelectedTags],
  )

  const toggleCluster = useCallback(
    (clusterSlug: string) => {
      const normalized = clusterSlug.trim().toLowerCase()
      if (!normalized) {
        return
      }

      const token = toClusterFilterToken(normalized)
      const nextTags = parsedState.selectedTags.some(
        (value) => value.trim().toLowerCase() === token,
      )
        ? parsedState.selectedTags.filter(
          (value) => value.trim().toLowerCase() !== token,
        )
        : [...parsedState.selectedTags, token]

      setSelectedTags(nextTags)
    },
    [parsedState.selectedTags, setSelectedTags],
  )

  const setSelectedCompanies = useCallback(
    (selectedCompanies: string[]) => {
      syncToUrl(buildUrlState(parsedState, { selectedCompanies }))
    },
    [parsedState, syncToUrl],
  )

  const toggleCompany = useCallback(
    (company: string) => {
      const normalized = company.trim()
      if (!normalized) {
        return
      }

      const nextCompanies = parsedState.selectedCompanies.some(
        (value) => value.toLowerCase() === normalized.toLowerCase(),
      )
        ? parsedState.selectedCompanies.filter(
          (value) => value.toLowerCase() !== normalized.toLowerCase(),
        )
        : [...parsedState.selectedCompanies, normalized]

      setSelectedCompanies(nextCompanies)
    },
    [parsedState.selectedCompanies, setSelectedCompanies],
  )

  const setSelectedSources = useCallback(
    (selectedSources: string[]) => {
      syncToUrl(buildUrlState(parsedState, { selectedSources }))
    },
    [parsedState, syncToUrl],
  )

  const toggleSource = useCallback(
    (source: string) => {
      const normalized = source.trim()
      if (!normalized) {
        return
      }

      const nextSources = parsedState.selectedSources.some(
        (value) => value.toLowerCase() === normalized.toLowerCase(),
      )
        ? parsedState.selectedSources.filter(
          (value) => value.toLowerCase() !== normalized.toLowerCase(),
        )
        : [...parsedState.selectedSources, normalized]

      setSelectedSources(nextSources)
    },
    [parsedState.selectedSources, setSelectedSources],
  )

  const setSelectedBrands = useCallback(
    (selectedBrands: string[]) => {
      syncToUrl(buildUrlState(parsedState, { selectedBrands }))
    },
    [parsedState, syncToUrl],
  )

  const toggleBrand = useCallback(
    (brand: string) => {
      const normalized = brand.trim()
      if (!normalized) {
        return
      }

      const nextBrands = parsedState.selectedBrands.some(
        (value) => value.toLowerCase() === normalized.toLowerCase(),
      )
        ? parsedState.selectedBrands.filter(
          (value) => value.toLowerCase() !== normalized.toLowerCase(),
        )
        : [...parsedState.selectedBrands, normalized]

      setSelectedBrands(nextBrands)
    },
    [parsedState.selectedBrands, setSelectedBrands],
  )

  const setSelectedExperienceLevel = useCallback(
    (selectedExperienceLevel: ExperienceLevelFilter | undefined) => {
      syncToUrl(buildUrlState(parsedState, { selectedExperienceLevel }))
    },
    [parsedState, syncToUrl],
  )

  const setMinRoleYearsFilter = useCallback(
    (minRoleYears: number | undefined) => {
      setCommittedMinRoleYears(minRoleYears)
      startFilterTransition(() => {
        syncToUrl(
          buildUrlState(parsedState, {
            filters: {
              ...parsedState.filters,
              minRoleYears,
            },
          }),
        )
      })
    },
    [parsedState, syncToUrl],
  )

  const setAgeRangeFilter = useCallback(
    (minAge: number | undefined, maxAge: number | undefined) => {
      startFilterTransition(() => {
        syncToUrl(
          buildUrlState(parsedState, {
            filters: {
              ...parsedState.filters,
              minAge,
              maxAge,
            },
          }),
        )
      })
    },
    [parsedState, syncToUrl],
  )

  const setSalaryRangeFilter = useCallback(
    (minSalary: number | undefined, maxSalary: number | undefined) => {
      startFilterTransition(() => {
        syncToUrl(
          buildUrlState(parsedState, {
            filters: {
              ...parsedState.filters,
              minSalary,
              maxSalary,
            },
          }),
        )
      })
    },
    [parsedState, syncToUrl],
  )

  const setEducationFilters = useCallback(
    (education: string[]) => {
      startFilterTransition(() => {
        syncToUrl(
          buildUrlState(parsedState, {
            filters: {
              ...parsedState.filters,
              education,
            },
          }),
        )
      })
    },
    [parsedState, syncToUrl],
  )

  const toggleEducation = useCallback(
    (educationValue: string) => {
      const normalized = educationValue.trim()
      if (!normalized) {
        return
      }

      const current = parsedState.filters.education ?? []
      const nextEducation = current.some(
        (value) => value.toLowerCase() === normalized.toLowerCase(),
      )
        ? current.filter(
          (value) => value.toLowerCase() !== normalized.toLowerCase(),
        )
        : [...current, normalized]

      setEducationFilters(nextEducation)
    },
    [parsedState.filters.education, setEducationFilters],
  )

  const setStatusFilters = useCallback(
    (status: CandidateStatus[] | undefined) => {
      const normalizedStatus = status && status.length > 0 ? status : undefined
      startFilterTransition(() => {
        syncToUrl(
          buildUrlState(parsedState, {
            filters: {
              ...parsedState.filters,
              status: normalizedStatus,
            },
          }),
        )
      })
    },
    [parsedState, syncToUrl],
  )

  const toggleStatus = useCallback(
    (status: CandidateStatus) => {
      const current = parsedState.filters.status ?? []
      const nextStatus = current.includes(status)
        ? current.filter((value) => value !== status)
        : [...current, status]

      setStatusFilters(nextStatus)
    },
    [parsedState.filters.status, setStatusFilters],
  )

  const setMinScoreFilter = useCallback(
    (minMatchScore: number | undefined) => {
      startFilterTransition(() => {
        syncToUrl(
          buildUrlState(parsedState, {
            filters: {
              ...parsedState.filters,
              minMatchScore,
            },
          }),
        )
      })
    },
    [parsedState, syncToUrl],
  )

  const setIdOrNameSearchFilter = useCallback(
    (idOrNameSearch: string | undefined) => {
      startFilterTransition(() => {
        syncToUrl(
          buildUrlState(parsedState, {
            filters: {
              ...parsedState.filters,
              idOrNameSearch: idOrNameSearch?.trim() || undefined,
            },
          }),
        )
      })
    },
    [parsedState, syncToUrl],
  )

  const setSort = useCallback(
    (sortValue: SearchSortValue) => {
      const nextFilters: Partial<ResumeFilters> = {
        ...parsedState.filters,
        sortBy:
          sortValue === 'newest'
            ? 'extractedAt'
            : sortValue === 'experience'
              ? 'experience'
              : undefined,
        sortOrder: sortValue === 'score' ? undefined : 'desc',
      }

      syncToUrl(buildUrlState(parsedState, { filters: nextFilters }))
    },
    [parsedState, syncToUrl],
  )

  const clearFacetFilters = useCallback(() => {
    syncToUrl(
      buildUrlState(parsedState, {
        selectedTags: [],
        selectedCompanies: [],
        selectedSources: [],
        selectedBrands: [],
        selectedExperienceLevel: undefined,
        filters: {
          ...parsedState.filters,
          education: undefined,
          minMatchScore: undefined,
          minRoleYears: undefined,
          roleFilterType: undefined,
          maxExperience: undefined,
          minAge: undefined,
          maxAge: undefined,
          minSalary: undefined,
          maxSalary: undefined,
          status: undefined,
          idOrNameSearch: undefined,
        },
      }),
    )
  }, [parsedState, syncToUrl])

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) {
      return
    }

    setResumeLimit((current) => current + RESUME_PAGE_INCREMENT)
  }, [hasMore, loadingMore])

  const exportResults = useCallback(async (selectedIds?: Set<string>) => {
    const exportCandidates = selectedIds && selectedIds.size > 0
      ? filteredResults.filter((item) => selectedIds.has(item.key))
      : filteredResults
    if (exportCandidates.length === 0) {
      return
    }

    setExportingResults(true)
    try {
      const normalizedJobDescriptionId = normalizeOptionalString(parsedState.jobDescriptionId)
      const exportRequest: ResumeExportRequestBody = {
        format: exportFormat,
        source: 'convex',
        sessionId: sessionKey,
        ...(normalizedJobDescriptionId ? { jobDescriptionId: normalizedJobDescriptionId } : {}),
        entries: exportCandidates.map((item) =>
          buildSearchExportEntry(item, ratingsByResume[item.resume.resumeId])
        ),
      }

      await submitResumeExportDownload(apiBaseUrl, exportRequest)
      toast.info(`Started export for ${exportCandidates.length} resumes`)
    } catch (error) {
      console.error('Failed to export search results', error)
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Export failed. Please try again.'
      toast.error(message)
    } finally {
      setExportingResults(false)
    }
  }, [apiBaseUrl, exportFormat, filteredResults, parsedState.jobDescriptionId, ratingsByResume, sessionKey]) // selectedIds excluded on purpose — export uses snapshot at call time

  const analyzeResults = useCallback(async () => {
    if (!dispatchAnalysis) {
      toast.error('AI analysis is unavailable for this account.')
      return
    }

    if (analysisDispatchBatchIds.length === 0) {
      toast.info('No new candidates to analyze among loaded results.')
      return
    }

    if (hasActiveAnalysisTask) {
      toast.info('Please wait for current analysis to complete.')
      return
    }

    setAnalyzingResults(true)
    try {
      const normalizedLocation = normalizeOptionalString(parsedState.location)
      const keywords =
        analysisKeywords.length > 0 ? analysisKeywords : undefined
      const relatedExpContext = buildRelatedExpContext(parsedState, recentSearches)
      let jobDescriptionTitle: string | undefined
      let jobDescriptionContent: string | undefined

      if (parsedState.jobDescriptionId) {
        try {
          const { data } = await rawApiClient.GET<JobDescriptionApiResponse>(
            `/api/job-descriptions/${parsedState.jobDescriptionId}`,
          )
          if (data?.success) {
            jobDescriptionTitle = normalizeOptionalString(data.item?.title)
            jobDescriptionContent = normalizeOptionalString(data.content)
          }
        } catch (error) {
          console.error('Failed to fetch JD content for analysis dispatch', error)
        }
      }

      await dispatchAnalysis({
        ...(parsedState.jobDescriptionId
          ? { jobDescriptionId: parsedState.jobDescriptionId }
          : {}),
        ...(jobDescriptionTitle ? { jobDescriptionTitle } : {}),
        ...(jobDescriptionContent ? { jobDescriptionContent } : {}),
        ...(keywords ? { keywords } : {}),
        ...(normalizedLocation ? { location: normalizedLocation } : {}),
        ...(relatedExpContext ? { relatedExpContext } : {}),
        promptVersion: currentPromptVersion,
        resumeIds: analysisDispatchBatchIds,
      })

      const remaining = analysisCandidateResumeIds.length - analysisDispatchBatchIds.length
      toast.success(
        remaining > 0
          ? `Analyzing batch of ${analysisDispatchBatchIds.length} resumes (${remaining} more pending)...`
          : `Analyzing ${analysisDispatchBatchIds.length} resumes...`,
      )
    } catch (error) {
      console.error('Failed to dispatch search analysis task', error)
      toast.error('Failed to start AI analysis. Please try again.')
    } finally {
      setAnalyzingResults(false)
    }
  }, [
    analysisCandidateResumeIds,
    analysisDispatchBatchIds,
    analysisKeywords,
    currentPromptVersion,
    dispatchAnalysis,
    hasActiveAnalysisTask,
    parsedState,
    recentSearches,
  ])

  useEffect(() => {
    if (
      !aiModeEnabled ||
      isLanding ||
      loading ||
      analyzingResults ||
      hasActiveAnalysisTask ||
      pendingAutoAnalyzeContextSignature.length === 0 ||
      pendingAutoAnalyzeContextSignature !== currentSearchContextSignature ||
      autoAnalyzeSearchNonce === 0 ||
      analysisCandidateResumeIds.length === 0 ||
      autoAnalyzeSignature === '' ||
      autoAnalyzeDispatchSignatureRef.current === autoAnalyzeSignature
    ) {
      return
    }

    autoAnalyzeDispatchSignatureRef.current = autoAnalyzeSignature
    pendingForceAnalyzeRef.current = false
    void analyzeResults()
  }, [
    analyzeResults,
    aiModeEnabled,
    analysisCandidateResumeIds.length,
    autoAnalyzeSearchNonce,
    autoAnalyzeSignature,
    analyzingResults,
    hasActiveAnalysisTask,
    isLanding,
    loading,
    currentSearchContextSignature,
    pendingAutoAnalyzeContextSignature,
  ])

  // Force-analyze fallback: guarantees quickstart / recent search triggers analysis
  // even when the signature-based auto-analyze effect misses due to timing or
  // round-trip normalization differences.
  useEffect(() => {
    if (
      !pendingForceAnalyzeRef.current ||
      isLanding ||
      loading ||
      analyzingResults ||
      hasActiveAnalysisTask ||
      analysisCandidateResumeIds.length === 0
    ) {
      return
    }

    pendingForceAnalyzeRef.current = false
    autoAnalyzeDispatchSignatureRef.current = autoAnalyzeSignature
    void analyzeResults()
  }, [
    analyzeResults,
    analysisCandidateResumeIds.length,
    autoAnalyzeSignature,
    analyzingResults,
    hasActiveAnalysisTask,
    isLanding,
    loading,
  ])

  const toggleSelectItem = useCallback((key: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(deferredFilteredResults.map((item) => item.key)))
  }, [deferredFilteredResults])

  const selectHighScore = useCallback((minScore = 80) => {
    setSelectedIds(
      new Set(
        deferredFilteredResults
          .filter((item) => typeof item.score === 'number' && item.score >= minScore)
          .map((item) => item.key),
      ),
    )
  }, [deferredFilteredResults])

  /** Replace selection with an explicit key set (e.g. policy-visible universe). */
  const replaceSelection = useCallback((keys: Iterable<string>) => {
    setSelectedIds(new Set(keys))
  }, [])

  /** Drop keys that are no longer in the allowed universe (hide filter, etc.). */
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

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const highScoreCount = useMemo(
    () => filteredResults.filter((item) => typeof item.score === 'number' && item.score >= 80).length,
    [filteredResults],
  )

  const handleCandidateAction = useCallback(
    async (resumeId: string, actionType: CandidateActionType) => {
      await saveAction({ resumeId, actionType })

      const targetItem = filteredResults.find((item) => item.resume.resumeId === resumeId)
      const nextStatus = ACTION_TO_STATUS[actionType]

      if (targetItem && nextStatus) {
        const currentStatus = statusByIdentity[targetItem.identityKey]?.status
        const isToggleBack = currentStatus === nextStatus
        const finalStatus: CandidateStatus = isToggleBack ? 'new' : nextStatus
        await updateCandidateStatus(targetItem.identityKey, finalStatus)
      }
    },
    [filteredResults, saveAction, statusByIdentity, updateCandidateStatus],
  )

  const handleRating = useCallback(
    async (resumeId: string, rating: number) => {
      await saveAction({ resumeId, actionType: 'rating', actionData: { rating } })
    },
    [saveAction],
  )

  const handleRatingComment = useCallback(
    (resumeId: string, comment: string) => {
      const trimmed = comment.trim()
      if (!trimmed) {
        return
      }

      const targetItem = filteredResults.find(
        (item) => item.resume.resumeId === resumeId || item.key === resumeId,
      )
      if (!targetItem?.identityKey) {
        toast.error('备注保存失败')
        return
      }

      const currentStatus =
        statusByIdentity[targetItem.identityKey]?.status
        ?? targetItem.status
        ?? 'new'

      void updateCandidateStatus(targetItem.identityKey, currentStatus, trimmed)
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
    [filteredResults, statusByIdentity, updateCandidateStatus],
  )

  const handleCandidateStatusChange = useCallback(
    async (identityKey: string, status: CandidateStatus, notes?: string) => {
      await updateCandidateStatus(identityKey, status, notes)
    },
    [updateCandidateStatus],
  )

  const handleToggleBlock = useCallback(
    async (identityKey: string, blocked: boolean, reason?: string) => {
      if (blocked) {
        await unblockCandidate(identityKey)
      } else {
        await blockCandidates([identityKey], reason)
      }
    },
    [blockCandidates, unblockCandidate],
  )

  const handleBulkAction = useCallback(
    async (action: 'shortlist' | 'reject' | 'star' | 'block' | 'export') => {
      if (action === 'export') {
        await exportResults(selectedIds)
        return
      }

      // Prefer currently rendered/deferred list membership for bulk scope.
      let selectedItems = deferredFilteredResults.filter((item) => selectedIds.has(item.key))
      if (selectedItems.length === 0) {
        return
      }

      if (action === 'shortlist' || action === 'star') {
        const allowed = selectedItems.filter((item) => {
          const hits = matchResumeCompanyPolicyCached({
            workHistory: item.resume.workHistory,
            companyHits: item.resume.ingestData?.companyHits,
          })
          return !isCompanyWorkflowBlocked(hits)
        })
        const skipped = selectedItems.length - allowed.length
        if (skipped > 0) {
          toast.message(
            t('settings.policies.runtime.bulkSkipped', {
              defaultValue: 'Skipped {{count}} no-hire company-policy row(s)',
              count: skipped,
            }),
          )
        }
        selectedItems = allowed
        if (selectedItems.length === 0) {
          return
        }
      }

      if (action === 'block') {
        const identityKeys = selectedItems.map((item) => item.identityKey)
        await blockCandidates(identityKeys)
      } else {
        const actionType: CandidateActionType = action
        await Promise.all(
          selectedItems.map((item) =>
            saveAction({ resumeId: item.resume.resumeId, actionType }),
          ),
        )

        // Sync Convex candidate_status for shortlist/reject
        const convexStatus = ACTION_TO_STATUS[action]
        if (convexStatus) {
          await Promise.all(
            selectedItems.map((item) =>
              updateCandidateStatus(item.identityKey, convexStatus),
            ),
          )
        }
      }

      clearSelection()
    },
    [
      blockCandidates,
      clearSelection,
      deferredFilteredResults,
      exportResults,
      saveAction,
      selectedIds,
      t,
      updateCandidateStatus,
    ],
  )

  return {
    activeQuery,
    activeSort,
    analysisCandidateCount: analysisCandidates.length,
    analyzeResults,
    aiModeEnabled,
    aiModeStats,
    applyRecentSearch,
    analyzingResults,
    clearFacetFilters,
    clearSearch,
    disableAnalyzeResults,
    exportFormat,
    exportingResults,
    exportResults,
    facetCounts: facetCountsWithServerStatuses,
    filterCount,
    filteredResults: deferredFilteredResults,
    hasMore,
    loadedCollectedTodayCount,
    hasActiveAnalysisTask,
    isLanding,
    loading,
    loadingMore,
    convexSearchFailed,
    convexRetrySearch,
    isFiltering,
    parsedState,
    queryInput,
    recentSearches,
    results,
    sessionKey,
    selectedClusterTags,
    selectedRawTags,
    searchHistoryLoading: canLoadOperationalState && recentSearchHistoryRecords === undefined,
    isFilterPending,
    committedMinRoleYears,
    setMinRoleYearsFilter,
    setAgeRangeFilter,
    setSalaryRangeFilter,
    setMinScoreFilter,
    setIdOrNameSearchFilter,
    setAiModeEnabled,
    setExportFormat,
    setQueryInput,
    setSelectedCompanies,
    setSelectedExperienceLevel,
    setSelectedTags,
    setSort,
    setStatusFilters,
    statusSummary,
    submitSearch,
    taxonomyClusters,
    toggleCompany,
    toggleCluster,
    toggleEducation,
    toggleBrand,
    toggleSource,
    toggleStatus,
    toggleTag,
    loadMore,
    // Candidate management
    actionsByResume,
    ratingsByResume,
    commentsByResume,
    getAiFeedback,
    handleBulkAction,
    handleCandidateAction,
    handleRating,
    handleRatingComment,
    handleCandidateStatusChange,
    handleToggleBlock,
    highScoreCount,
    selectedIds,
    selectAll,
    selectHighScore,
    replaceSelection,
    pruneSelection,
    clearSelection,
    toggleSelectItem,
  }
}
