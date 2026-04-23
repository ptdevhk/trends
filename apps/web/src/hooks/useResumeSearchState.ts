import { formatKeywordQuery, getVerifiedRoleSignalYears, isSalesRequiredContext, parseKeywordQuery } from '@trends/shared'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { useCandidateBlocks } from '@/hooks/useCandidateBlocks'
import { useCandidateStatus } from '@/hooks/useCandidateStatus'
import {
  useConvexResumes,
  type ConvexResumeFilters,
  type ConvexResumeItem,
} from '@/hooks/useConvexResumes'
import { useFacetCounts } from '@/hooks/useFacetCounts'
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
  overrideIndustryDbBreakdown,
  recommendationFromScore,
  toIndustryDbV2Stats,
} from '@/lib/resume-scoring'
import {
  getCurrentResumeAiPromptVersion,
  resolveAnalysisTopN,
  resolveResumeAnalysisSourceKey,
} from '@/lib/analysis-utils'
import { getResumeAge, parseExperienceYears } from '@/lib/resume-filtering'
import { resolveCollectionSource, getSourceLabelFromHostname } from '@/lib/search-profile-sources'
import type { SearchHistoryItem } from '@/hooks/useSession'
import type {
  CandidateActionType,
  CandidateStatus,
  ResumeExportFormat,
  ResumeFilters,
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
    state.selectedExperienceLevel ||
    (state.filters.education?.length ?? 0) > 0 ||
    (state.filters.status?.length ?? 0) > 0 ||
    typeof state.filters.minMatchScore === 'number' ||
    typeof state.filters.minExperience === 'number' ||
    typeof state.filters.maxExperience === 'number' ||
    typeof state.filters.minRoleYears === 'number' ||
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
    selectedExperienceLevel: state.selectedExperienceLevel,
    filters: {
      education: normalizeStringList(state.filters.education ?? []),
      locations: normalizeStringList(state.filters.locations ?? []),
      maxAge: state.filters.maxAge,
      maxExperience: state.filters.maxExperience,
      minAge: state.filters.minAge,
      minExperience: state.filters.minExperience,
      minMatchScore: state.filters.minMatchScore,
      minRoleYears: state.filters.minRoleYears,
      roleFilterType: normalizeOptionalString(state.filters.roleFilterType),
      status: normalizeStringList(state.filters.status ?? []),
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
  }
}

function getRoleYears(
  resume: ConvexResumeItem,
  roleType: string | undefined,
): number {
  const roleSignals = resume.ingestData?.roleSignals
  if (!Array.isArray(roleSignals) || roleSignals.length === 0) {
    return 0
  }

  return getVerifiedRoleSignalYears(
    roleSignals,
    normalizeOptionalString(roleType)?.toLowerCase() ?? '',
  )
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
  const experienceLevel = item.resume.ingestData?.experienceLevel
    ?.trim()
    .toLowerCase()
  const minScore = state.filters.minMatchScore
  const resumeAge =
    typeof state.filters.minAge === 'number' || typeof state.filters.maxAge === 'number'
      ? getResumeAge(item.resume)
      : null

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

  if (
    normalizedStatuses.length > 0 &&
    !normalizedStatuses.includes(item.status)
  ) {
    return false
  }

  if (typeof minScore === 'number' && (item.score ?? 0) < minScore) {
    return false
  }

  if (typeof state.filters.minRoleYears === 'number') {
    const roleYears = getRoleYears(item.resume, state.filters.roleFilterType)
    if (roleYears < state.filters.minRoleYears) {
      return false
    }
  }

  if (typeof state.filters.minAge === 'number') {
    if (resumeAge !== null && resumeAge < state.filters.minAge) {
      return false
    }
  }

  if (typeof state.filters.maxAge === 'number') {
    if (resumeAge !== null && resumeAge > state.filters.maxAge) {
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
  const { slug } = useWorkspace()
  const { parsedState, syncToUrl } = useUrlSearchState()
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
  const [pendingAutoAnalyzeContextSignature, setPendingAutoAnalyzeContextSignature] = useState('')
  const [resumeLimit, setResumeLimit] = useState(INITIAL_RESUME_LIMIT)
  const saveSearchHistory = useMutation(api.sessions.saveSearchHistory)
  const markSearchHistoryOpened = useMutation(
    api.sessions.markSearchHistoryOpened,
  )
  const dispatchAnalysis = useMutation(api.analysis_tasks.dispatch)
  const analysisTasks = useQuery(api.analysis_tasks.list)
  const recentSearchHistoryRecords = useQuery(api.sessions.recentSearches, {
    sessionKey,
    workspaceSlug: slug,
    limit: 10,
  })
  const taxonomyClusterRecords = useQuery(api.taxonomy_clusters.list, {
    workspaceSlug: slug,
    status: 'active',
  })
  const { statusByIdentity, updateStatus: updateCandidateStatus } = useCandidateStatus(true)
  const { blocksByIdentity, blockCandidates, unblockCandidate } = useCandidateBlocks(true)
  const { actions: actionsByResume, saveAction, getAiFeedback } = useCandidateActions(sessionKey, parsedState.jobDescriptionId)
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
    parsedState.filters.minExperience,
    parsedState.filters.minMatchScore,
    parsedState.filters.minRoleYears,
    parsedState.filters.roleFilterType,
    parsedState.filters.status,
    parsedState.jobDescriptionId,
    parsedState.location,
    parsedState.query,
    parsedState.requiredKeywords,
    parsedState.selectedCompanies,
    parsedState.selectedSources,
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
      minExperience: parsedState.filters.minExperience,
      maxExperience: parsedState.filters.maxExperience,
      minRoleYears: parsedState.filters.minRoleYears,
      roleFilterType: effectiveRoleFilterType,
      minAge: parsedState.filters.minAge,
      maxAge: parsedState.filters.maxAge,
      requiredKeywords: parsedState.requiredKeywords,
      locations: parsedState.filters.locations,
      sources: parsedState.selectedSources.length > 0 ? parsedState.selectedSources : undefined,
    }),
    [
      effectiveRoleFilterType,
      parsedState.filters.locations,
      parsedState.filters.maxAge,
      parsedState.filters.maxExperience,
      parsedState.filters.minAge,
      parsedState.filters.minExperience,
      parsedState.filters.minRoleYears,
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
      const analysis = resolveSearchAnalysis(
        resume,
        parsedState.jobDescriptionId,
        analysisKeywords,
        parsedState.location,
        currentPromptVersion,
      )
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

  const filteredResults = useMemo(
    () =>
      sortResults(
        results.filter((item) =>
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
      effectiveRoleFilterType,
      parsedState,
      results,
      selectedClusterTags,
      selectedRawTags,
      taxonomyResolver,
    ],
  )

  const facetCounts: FacetCounts = useFacetCounts(results, taxonomyClusters)
  const hasMore = resumeQuery.hasMore
  const loading = !isLanding && resumeQuery.loading
  const loadingMore = resumeQuery.loadingMore
  const analysisCandidates = useMemo(
    () =>
      filteredResults
        .filter((item) => !item.analysis)
        .sort((left, right) => (right.score ?? -1) - (left.score ?? -1)),
    [filteredResults],
  )
  const analysisCandidateResumeIds = useMemo(
    () =>
      analysisCandidates
        .slice(0, resolveAnalysisTopN(import.meta.env.VITE_ANALYSIS_TOP_N))
        .map((item) => item.resume.resumeId),
    [analysisCandidates],
  )
  const analysisCandidateSignature = useMemo(
    () =>
      [...analysisCandidateResumeIds]
        .sort((left, right) => left.localeCompare(right))
        .join('|'),
    [analysisCandidateResumeIds],
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
    (!parsedState.jobDescriptionId && analysisKeywords.length === 0)
  const filterCount =
    parsedState.selectedTags.length +
    parsedState.selectedCompanies.length +
    parsedState.selectedSources.length +
    (parsedState.selectedExperienceLevel ? 1 : 0) +
    (parsedState.filters.education?.length ?? 0) +
    (parsedState.filters.status?.length ?? 0) +
    (typeof parsedState.filters.minMatchScore === 'number' ? 1 : 0)

  const lastSavedFingerprintRef = useRef<string>('')
  useEffect(() => {
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
  }, [isLanding, parsedState, results, saveSearchHistory, sessionKey, slug])

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

  const setSelectedExperienceLevel = useCallback(
    (selectedExperienceLevel: ExperienceLevelFilter | undefined) => {
      syncToUrl(buildUrlState(parsedState, { selectedExperienceLevel }))
    },
    [parsedState, syncToUrl],
  )

  const setEducationFilters = useCallback(
    (education: string[]) => {
      syncToUrl(
        buildUrlState(parsedState, {
          filters: {
            ...parsedState.filters,
            education,
          },
        }),
      )
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
    (status: CandidateStatus[]) => {
      syncToUrl(
        buildUrlState(parsedState, {
          filters: {
            ...parsedState.filters,
            status,
          },
        }),
      )
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
      syncToUrl(
        buildUrlState(parsedState, {
          filters: {
            ...parsedState.filters,
            minMatchScore,
          },
        }),
      )
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
        selectedExperienceLevel: undefined,
        filters: {
          ...parsedState.filters,
          education: undefined,
          status: undefined,
          minMatchScore: undefined,
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

  const exportResults = useCallback(async () => {
    if (filteredResults.length === 0) {
      return
    }

    setExportingResults(true)
    try {
      const exportRequest: ResumeExportRequestBody = {
        format: exportFormat,
        source: 'convex',
        entries: filteredResults.map(buildSearchExportEntry),
      }

      await submitResumeExportDownload(apiBaseUrl, exportRequest)
      toast.info(`Started export for ${filteredResults.length} resumes`)
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
  }, [apiBaseUrl, exportFormat, filteredResults])

  const analyzeResults = useCallback(async () => {
    if (analysisCandidateResumeIds.length === 0) {
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
        promptVersion: currentPromptVersion,
        resumeIds: analysisCandidateResumeIds,
      })

      toast.success(
        `Analyzing loaded ${analysisCandidateResumeIds.length} resumes...`,
      )
    } catch (error) {
      console.error('Failed to dispatch search analysis task', error)
      toast.error('Failed to start AI analysis. Please try again.')
    } finally {
      setAnalyzingResults(false)
    }
  }, [
    analysisCandidateResumeIds,
    analysisKeywords,
    currentPromptVersion,
    dispatchAnalysis,
    hasActiveAnalysisTask,
    parsedState.jobDescriptionId,
    parsedState.location,
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
    setSelectedIds(new Set(filteredResults.map((item) => item.key)))
  }, [filteredResults])

  const selectHighScore = useCallback((minScore = 80) => {
    setSelectedIds(
      new Set(
        filteredResults
          .filter((item) => typeof item.score === 'number' && item.score >= minScore)
          .map((item) => item.key),
      ),
    )
  }, [filteredResults])

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
    },
    [saveAction],
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
        await exportResults()
        return
      }

      const selectedItems = filteredResults.filter((item) => selectedIds.has(item.key))
      if (selectedItems.length === 0) {
        return
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
      }

      clearSelection()
    },
    [blockCandidates, clearSelection, exportResults, filteredResults, saveAction, selectedIds],
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
    facetCounts,
    filterCount,
    filteredResults,
    hasMore,
    hasActiveAnalysisTask,
    isLanding,
    loading,
    loadingMore,
    parsedState,
    queryInput,
    recentSearches,
    results,
    selectedClusterTags,
    selectedRawTags,
    searchHistoryLoading: recentSearchHistoryRecords === undefined,
    setMinScoreFilter,
    setAiModeEnabled,
    setExportFormat,
    setQueryInput,
    setSelectedCompanies,
    setSelectedExperienceLevel,
    setSelectedTags,
    setSort,
    submitSearch,
    taxonomyClusters,
    toggleCompany,
    toggleCluster,
    toggleEducation,
    toggleSource,
    toggleStatus,
    toggleTag,
    loadMore,
    // Candidate management
    actionsByResume,
    getAiFeedback,
    handleBulkAction,
    handleCandidateAction,
    handleCandidateStatusChange,
    handleToggleBlock,
    highScoreCount,
    selectedIds,
    selectAll,
    selectHighScore,
    clearSelection,
    toggleSelectItem,
  }
}
