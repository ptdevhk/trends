import { formatKeywordQuery, parseKeywordQuery } from '@trends/shared'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useCandidateBlocks } from '@/hooks/useCandidateBlocks'
import { useCandidateStatus } from '@/hooks/useCandidateStatus'
import { useConvexResumes, type ConvexResumeFilters, type ConvexResumeItem } from '@/hooks/useConvexResumes'
import { useFacetCounts } from '@/hooks/useFacetCounts'
import {
  useUrlSearchState,
  type ExperienceLevelFilter,
  type UrlSearchState,
} from '@/hooks/useUrlSearchState'
import {
  createTaxonomyClusterResolver,
  fromClusterFilterToken,
  isClusterFilterToken,
  toClusterFilterToken,
  type TaxonomyClusterInput,
  type TaxonomyClusterResolver,
} from '@/lib/taxonomy'
import { toIndustryDbV2Stats } from '@/lib/resume-scoring'
import { resolveCollectionSource } from '@/lib/search-profile-sources'
import type { SearchHistoryItem } from '@/hooks/useSession'
import type { CandidateStatus, ResumeFilters } from '@/types/resume'
import type {
  FacetCounts,
  ResumeSearchRecentItem,
  ResumeSearchResultItem,
  SearchSortValue,
} from '@/components/search/search-types'

const INITIAL_RESUME_LIMIT = 200
const RESUME_PAGE_INCREMENT = 200
const SESSION_KEY_PREFIX = 'trends.resume.search.sessionKey'

type SearchHistoryRecord = {
  _id: SearchHistoryItem['id']
  sessionKey: string
  title: string
  location: string
  keywords: string[]
  jobDescriptionId?: string
  collectionSource?: SearchHistoryItem['collectionSource']
  collectUrl?: string
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

function normalizeOptionalString(value: string | undefined): string | undefined {
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

function resolveScore(resume: ConvexResumeItem, jobDescriptionId: string | undefined): number | undefined {
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

  if (typeof resume.primaryRuleScore === 'number' && Number.isFinite(resume.primaryRuleScore)) {
    return resume.primaryRuleScore
  }

  if (typeof resume.analysis?.score === 'number' && Number.isFinite(resume.analysis.score)) {
    return resume.analysis.score
  }

  return undefined
}

function hasExplicitSearchContext(state: UrlSearchState): boolean {
  return Boolean(
    normalizeOptionalString(state.query)
    || normalizeOptionalString(state.location)
    || normalizeOptionalString(state.jobDescriptionId)
    || state.requiredKeywords.length > 0
    || state.selectedTags.length > 0
    || state.selectedCompanies.length > 0
    || state.selectedExperienceLevel
    || (state.filters.education?.length ?? 0) > 0
    || (state.filters.status?.length ?? 0) > 0
    || typeof state.filters.minMatchScore === 'number'
    || typeof state.filters.minExperience === 'number'
    || typeof state.filters.maxExperience === 'number'
    || (state.filters.locations?.length ?? 0) > 0
  )
}

function resolveSortValue(filters: Partial<ResumeFilters>): SearchSortValue {
  if (filters.sortBy === 'experience') {
    return 'experience'
  }

  if (filters.sortBy === 'extractedAt') {
    return 'newest'
  }

  return 'relevance'
}

function buildUrlState(
  state: UrlSearchState,
  overrides: Partial<UrlSearchState>,
): UrlSearchState {
  return {
    shareSessionId: overrides.shareSessionId ?? state.shareSessionId,
    query: overrides.query ?? state.query,
    location: overrides.location ?? state.location,
    keywords: overrides.keywords ?? state.keywords,
    requiredKeywords: overrides.requiredKeywords ?? state.requiredKeywords,
    jobDescriptionId: overrides.jobDescriptionId ?? state.jobDescriptionId,
    selectedTags: overrides.selectedTags ?? state.selectedTags,
    selectedCompanies: overrides.selectedCompanies ?? state.selectedCompanies,
    selectedExperienceLevel: overrides.selectedExperienceLevel ?? state.selectedExperienceLevel,
    filters: overrides.filters ?? state.filters,
  }
}

function sortResults(results: ResumeSearchResultItem[], sortValue: SearchSortValue): ResumeSearchResultItem[] {
  if (sortValue === 'relevance') {
    return results
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

    return parseExperienceYears(right.resume.experience) - parseExperienceYears(left.resume.experience)
  })
}

function matchesLocalFilters(
  item: ResumeSearchResultItem,
  state: UrlSearchState,
  selectedRawTags: string[],
  selectedClusterTags: string[],
  taxonomyResolver: TaxonomyClusterResolver,
): boolean {
  const normalizedSelectedTags = selectedRawTags.map((value) => value.toLowerCase())
  const normalizedSelectedClusters = selectedClusterTags.map((value) => value.toLowerCase())
  const normalizedSelectedCompanies = state.selectedCompanies.map((value) => value.toLowerCase())
  const normalizedEducation = (state.filters.education ?? []).map((value) => value.toLowerCase())
  const normalizedStatuses = state.filters.status ?? []
  const industryTags = item.resume.ingestData?.industryTags?.map((value) => value.toLowerCase()) ?? []
  const matchedClusters = new Set(
    taxonomyResolver.resolveTagClusters(item.resume.ingestData?.industryTags).map((cluster) => cluster.slug.toLowerCase()),
  )
  const companyHits = item.resume.ingestData?.companyHits?.map((value) => value.toLowerCase()) ?? []
  const education = item.resume.education?.trim().toLowerCase() ?? ''
  const experienceLevel = item.resume.ingestData?.experienceLevel?.trim().toLowerCase()
  const minScore = state.filters.minMatchScore

  if (normalizedSelectedTags.length > 0 && !normalizedSelectedTags.every((tag) => industryTags.includes(tag))) {
    return false
  }

  if (normalizedSelectedClusters.length > 0 && !normalizedSelectedClusters.every((slug) => matchedClusters.has(slug))) {
    return false
  }

  if (normalizedSelectedCompanies.length > 0 && !normalizedSelectedCompanies.some((company) => companyHits.includes(company))) {
    return false
  }

  if (state.selectedExperienceLevel && experienceLevel !== state.selectedExperienceLevel) {
    return false
  }

  if (normalizedEducation.length > 0 && !normalizedEducation.includes(education)) {
    return false
  }

  if (normalizedStatuses.length > 0 && !normalizedStatuses.includes(item.status)) {
    return false
  }

  if (typeof minScore === 'number' && (item.score ?? 0) < minScore) {
    return false
  }

  return true
}

function toRecentSearchItems(records: SearchHistoryRecord[] | undefined): ResumeSearchRecentItem[] {
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
      record.collectUrl,
    ),
    collectUrl: normalizeOptionalString(record.collectUrl),
    filters: record.filters ?? {},
    selectedTags: normalizeStringList(record.selectedTags),
    selectedCompanies: normalizeStringList(record.selectedCompanies),
    selectedExperienceLevel: normalizeOptionalString(record.selectedExperienceLevel),
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
  const [sessionKey, setSessionKey] = useState(() => ensureStoredSessionKey(storageKey))
  const [queryInput, setQueryInput] = useState(() => parsedState.query ?? formatKeywordQuery(parsedState.keywords))
  const [resumeLimit, setResumeLimit] = useState(INITIAL_RESUME_LIMIT)
  const saveSearchHistory = useMutation(api.sessions.saveSearchHistory)
  const markSearchHistoryOpened = useMutation(api.sessions.markSearchHistoryOpened)
  const recentSearchHistoryRecords = useQuery(api.sessions.recentSearches, {
    sessionKey,
    workspaceSlug: slug,
    limit: 10,
  })
  const taxonomyClusterRecords = useQuery(api.taxonomy_clusters.list, {
    workspaceSlug: slug,
    status: 'active',
  })
  const { statusByIdentity } = useCandidateStatus(true)
  const { blocksByIdentity } = useCandidateBlocks(true)

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
    parsedState.filters.status,
    parsedState.jobDescriptionId,
    parsedState.location,
    parsedState.query,
    parsedState.requiredKeywords,
    parsedState.selectedCompanies,
    parsedState.selectedExperienceLevel,
    parsedState.selectedTags,
  ])

  const isLanding = !hasExplicitSearchContext(parsedState)
  const activeQuery = normalizeOptionalString(parsedState.query)
  const backendFilters = useMemo<ConvexResumeFilters>(() => ({
    minExperience: parsedState.filters.minExperience,
    maxExperience: parsedState.filters.maxExperience,
    requiredKeywords: parsedState.requiredKeywords,
    locations: parsedState.filters.locations,
  }), [
    parsedState.filters.locations,
    parsedState.filters.maxExperience,
    parsedState.filters.minExperience,
    parsedState.requiredKeywords,
  ])
  const activeSort = resolveSortValue(parsedState.filters)
  const resumeQuery = useConvexResumes(
    resumeLimit,
    activeQuery,
    parsedState.jobDescriptionId,
    {
      enabled: !isLanding,
      filters: backendFilters,
      ...(activeSort === 'newest' ? { sortBy: 'extractedAt' as const, sortOrder: 'desc' as const } : {}),
      ...(activeSort === 'experience' ? { sortBy: 'experience' as const, sortOrder: 'desc' as const } : {}),
    }
  )

  const recentSearches = useMemo(
    () => toRecentSearchItems(recentSearchHistoryRecords),
    [recentSearchHistoryRecords]
  )
  const taxonomyClusters = useMemo<TaxonomyClusterInput[]>(
    () => (taxonomyClusterRecords ?? []).map((cluster) => ({
      name: cluster.name,
      slug: cluster.slug,
      parentSlug: cluster.parentSlug,
      tags: cluster.tags,
    })),
    [taxonomyClusterRecords]
  )
  const taxonomyResolver = useMemo(
    () => createTaxonomyClusterResolver(taxonomyClusters),
    [taxonomyClusters]
  )
  const selectedClusterTags = useMemo(
    () => normalizeStringList(
      parsedState.selectedTags
        .filter((value) => isClusterFilterToken(value))
        .map((value) => fromClusterFilterToken(value))
    ),
    [parsedState.selectedTags]
  )
  const selectedRawTags = useMemo(
    () => normalizeStringList(parsedState.selectedTags.filter((value) => !isClusterFilterToken(value))),
    [parsedState.selectedTags]
  )

  const results = useMemo<ResumeSearchResultItem[]>(() => {
    return resumeQuery.resumes.map((resume) => {
      const identityKey = resume.identityKey?.trim() || resume.externalId
      const statusRecord = statusByIdentity[identityKey]
      return {
        key: `${resume.resumeId}`,
        identityKey,
        resume,
        blocked: Boolean(blocksByIdentity[identityKey]),
        score: resolveScore(resume, parsedState.jobDescriptionId),
        status: statusRecord?.status ?? 'new',
        statusMeta: statusRecord,
      }
    })
  }, [blocksByIdentity, parsedState.jobDescriptionId, resumeQuery.resumes, statusByIdentity])

  const filteredResults = useMemo(
    () => sortResults(
      results.filter((item) => matchesLocalFilters(
        item,
        parsedState,
        selectedRawTags,
        selectedClusterTags,
        taxonomyResolver,
      )),
      activeSort
    ),
    [activeSort, parsedState, results, selectedClusterTags, selectedRawTags, taxonomyResolver]
  )

  const facetCounts: FacetCounts = useFacetCounts(results, taxonomyClusters)
  const hasMore = resumeQuery.hasMore
  const loading = !isLanding && resumeQuery.loading
  const loadingMore = resumeQuery.loadingMore
  const filterCount = parsedState.selectedTags.length
    + parsedState.selectedCompanies.length
    + (parsedState.selectedExperienceLevel ? 1 : 0)
    + (parsedState.filters.education?.length ?? 0)
    + (parsedState.filters.status?.length ?? 0)
    + (typeof parsedState.filters.minMatchScore === 'number' ? 1 : 0)

  const lastSavedFingerprintRef = useRef<string>('')
  useEffect(() => {
    if (isLanding) {
      return
    }

    const normalizedKeywords = parseKeywordQuery(parsedState.query ?? formatKeywordQuery(parsedState.keywords)).keywords
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
        title: normalizeOptionalString([
          normalizeOptionalString(parsedState.location),
          normalizeOptionalString(parsedState.query) ?? formatKeywordQuery(normalizedKeywords),
        ].filter(Boolean).join(' · ')),
        location: parsedState.location ?? '',
        keywords: normalizedKeywords,
        jobDescriptionId: parsedState.jobDescriptionId,
        filters: parsedState.filters,
        selectedTags: parsedState.selectedTags,
        selectedCompanies: parsedState.selectedCompanies,
        selectedExperienceLevel: parsedState.selectedExperienceLevel,
        resumeIds: results.slice(0, 50).map((item) => String(item.resume.resumeId)),
      })
    }, 800)

    return () => window.clearTimeout(timer)
  }, [isLanding, parsedState, results, saveSearchHistory, sessionKey, slug])

  const submitSearch = useCallback((nextQuery?: string) => {
    const resolvedQuery = normalizeOptionalString(nextQuery ?? queryInput)
    const nextKeywords = parseKeywordQuery(resolvedQuery ?? '').keywords

    syncToUrl(buildUrlState(parsedState, {
      query: resolvedQuery,
      keywords: nextKeywords,
    }))
  }, [parsedState, queryInput, syncToUrl])

  const clearSearch = useCallback(() => {
    setQueryInput('')
    syncToUrl(buildUrlState(parsedState, {
      query: undefined,
      keywords: [],
      requiredKeywords: [],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
      filters: {},
    }))
  }, [parsedState, syncToUrl])

  const applyRecentSearch = useCallback(async (item: ResumeSearchRecentItem) => {
    await markSearchHistoryOpened({ id: item.id, workspaceSlug: slug })

    const query = formatKeywordQuery(item.keywords)
    setQueryInput(query)
    syncToUrl({
      query,
      shareSessionId: undefined,
      location: normalizeOptionalString(item.location),
      keywords: item.keywords,
      requiredKeywords: [],
      jobDescriptionId: item.jobDescriptionId,
      selectedTags: item.selectedTags,
      selectedCompanies: item.selectedCompanies,
      selectedExperienceLevel: (item.selectedExperienceLevel as ExperienceLevelFilter | undefined) ?? undefined,
      filters: item.filters ?? {},
    })
  }, [markSearchHistoryOpened, slug, syncToUrl])

  const setSelectedTags = useCallback((selectedTags: string[]) => {
    syncToUrl(buildUrlState(parsedState, { selectedTags }))
  }, [parsedState, syncToUrl])

  const toggleTag = useCallback((tag: string) => {
    const normalized = tag.trim()
    if (!normalized) {
      return
    }

    const nextTags = parsedState.selectedTags.some((value) => value.toLowerCase() === normalized.toLowerCase())
      ? parsedState.selectedTags.filter((value) => value.toLowerCase() !== normalized.toLowerCase())
      : [...parsedState.selectedTags, normalized]

    setSelectedTags(nextTags)
  }, [parsedState.selectedTags, setSelectedTags])

  const toggleCluster = useCallback((clusterSlug: string) => {
    const normalized = clusterSlug.trim().toLowerCase()
    if (!normalized) {
      return
    }

    const token = toClusterFilterToken(normalized)
    const nextTags = parsedState.selectedTags.some((value) => value.trim().toLowerCase() === token)
      ? parsedState.selectedTags.filter((value) => value.trim().toLowerCase() !== token)
      : [...parsedState.selectedTags, token]

    setSelectedTags(nextTags)
  }, [parsedState.selectedTags, setSelectedTags])

  const setSelectedCompanies = useCallback((selectedCompanies: string[]) => {
    syncToUrl(buildUrlState(parsedState, { selectedCompanies }))
  }, [parsedState, syncToUrl])

  const toggleCompany = useCallback((company: string) => {
    const normalized = company.trim()
    if (!normalized) {
      return
    }

    const nextCompanies = parsedState.selectedCompanies.some((value) => value.toLowerCase() === normalized.toLowerCase())
      ? parsedState.selectedCompanies.filter((value) => value.toLowerCase() !== normalized.toLowerCase())
      : [...parsedState.selectedCompanies, normalized]

    setSelectedCompanies(nextCompanies)
  }, [parsedState.selectedCompanies, setSelectedCompanies])

  const setSelectedExperienceLevel = useCallback((selectedExperienceLevel: ExperienceLevelFilter | undefined) => {
    syncToUrl(buildUrlState(parsedState, { selectedExperienceLevel }))
  }, [parsedState, syncToUrl])

  const setEducationFilters = useCallback((education: string[]) => {
    syncToUrl(buildUrlState(parsedState, {
      filters: {
        ...parsedState.filters,
        education,
      },
    }))
  }, [parsedState, syncToUrl])

  const toggleEducation = useCallback((educationValue: string) => {
    const normalized = educationValue.trim()
    if (!normalized) {
      return
    }

    const current = parsedState.filters.education ?? []
    const nextEducation = current.some((value) => value.toLowerCase() === normalized.toLowerCase())
      ? current.filter((value) => value.toLowerCase() !== normalized.toLowerCase())
      : [...current, normalized]

    setEducationFilters(nextEducation)
  }, [parsedState.filters.education, setEducationFilters])

  const setStatusFilters = useCallback((status: CandidateStatus[]) => {
    syncToUrl(buildUrlState(parsedState, {
      filters: {
        ...parsedState.filters,
        status,
      },
    }))
  }, [parsedState, syncToUrl])

  const toggleStatus = useCallback((status: CandidateStatus) => {
    const current = parsedState.filters.status ?? []
    const nextStatus = current.includes(status)
      ? current.filter((value) => value !== status)
      : [...current, status]

    setStatusFilters(nextStatus)
  }, [parsedState.filters.status, setStatusFilters])

  const setMinScoreFilter = useCallback((minMatchScore: number | undefined) => {
    syncToUrl(buildUrlState(parsedState, {
      filters: {
        ...parsedState.filters,
        minMatchScore,
      },
    }))
  }, [parsedState, syncToUrl])

  const setSort = useCallback((sortValue: SearchSortValue) => {
    const nextFilters: Partial<ResumeFilters> = {
      ...parsedState.filters,
      sortBy:
        sortValue === 'newest'
          ? 'extractedAt'
          : sortValue === 'experience'
            ? 'experience'
            : undefined,
      sortOrder:
        sortValue === 'relevance'
          ? undefined
          : 'desc',
    }

    syncToUrl(buildUrlState(parsedState, { filters: nextFilters }))
  }, [parsedState, syncToUrl])

  const clearFacetFilters = useCallback(() => {
    syncToUrl(buildUrlState(parsedState, {
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
      filters: {
        ...parsedState.filters,
        education: undefined,
        status: undefined,
        minMatchScore: undefined,
      },
    }))
  }, [parsedState, syncToUrl])

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) {
      return
    }

    setResumeLimit((current) => current + RESUME_PAGE_INCREMENT)
  }, [hasMore, loadingMore])

  return {
    activeQuery,
    activeSort,
    applyRecentSearch,
    clearFacetFilters,
    clearSearch,
    facetCounts,
    filterCount,
    filteredResults,
    hasMore,
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
    toggleStatus,
    toggleTag,
    loadMore,
  }
}
