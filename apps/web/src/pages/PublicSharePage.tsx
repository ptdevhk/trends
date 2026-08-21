import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, Clock, RefreshCw, Search } from 'lucide-react'
import { useQuery } from 'convex/react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { formatKeywordQuery, parseKeywordQuery, type WorkspaceSlug } from '@trends/shared'

import { BulkActionBar } from '@/components/BulkActionBar'
import { FacetBadge } from '@/components/search/FacetBadge'
import { FacetSidebar } from '@/components/search/FacetSidebar'
import { MobileFilterSheet } from '@/components/search/MobileFilterSheet'
import { ModeToggle } from '@/components/ModeToggle'
import { SearchHeader } from '@/components/search/SearchHeader'
import { SearchResultsList } from '@/components/search/SearchResultsList'
import { ShareLinkButton } from '@/components/ShareLinkButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { WorkspaceProvider } from '@/contexts/WorkspaceContext'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { useCandidateBlocks } from '@/hooks/useCandidateBlocks'
import { useCandidateStatus } from '@/hooks/useCandidateStatus'
import { mapResumeDoc } from '@/hooks/useConvexResumes'
import { useFacetCounts } from '@/hooks/useFacetCounts'
import { apiBaseUrl } from '@/lib/api-client'
import { rawApiClient } from '@/lib/api-helpers'
import { resolveResumeAnalysisSourceKey } from '@/lib/analysis-utils'
import {
  getRoleYears,
  matchesEducationFilter,
  matchesSalaryFilter,
  normalizeFilterToken,
  toExperienceLevel,
} from '@/hooks/resume-filter-helpers'
import {
  submitResumeExportDownload,
  type ResumeExportRequestBody,
} from '@/lib/resume-export'
import { getResumeAge, parseExperienceYears } from '@/lib/resume-filtering'
import { resolveResumeRefreshState } from '@/lib/resume-freshness'
import { recommendationFromScore } from '@/lib/resume-scoring'
import { getSourceLabelFromHostname } from '@/lib/search-profile-sources'
import { normalizeOptionalString, normalizeStringList } from '@/lib/taxonomy'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ExperienceLevelFilter } from '@/hooks/useUrlSearchState'
import {
  CANDIDATE_STATUS_VALUES,
  type CandidateActionType,
  type CandidateStatus,
  type ResumeExportFormat,
} from '@/types/resume'
import { api } from '../../../../packages/convex/convex/_generated/api'

type PublicShareResult = {
  resumeKey: string
  displayName?: string
  headline?: string
  location?: string
  summary?: string
  score?: number
  recommendation?: string
  highlights?: string[]
  concerns?: string[]
  skills?: string[]
}

type PublicShareResponse = {
  success: boolean
  share?: {
    id: string
    title?: string
    description?: string
    createdAt: string
    expiresAt?: string
    snapshot: {
      id: string
      scoringMode: string
      promptVersion: string
      skillConfigVersion: string
      modelProvider: string
      modelName: string
      payload: {
        title?: string
        search?: {
          query?: string
          filters?: Record<string, unknown>
        }
        results: PublicShareResult[]
      }
    }
    member?: {
      workspaceSlug: string
      canReview: boolean
      searchRun: {
        id: string
        resumeKeys: string[]
        query: Record<string, unknown>
        filters: Record<string, unknown>
      }
    }
  }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; share: NonNullable<PublicShareResponse['share']> }
  | { status: 'unavailable' }
  | { status: 'not-found' }
  | { status: 'error' }

type SearchSessionResponse = {
  success: boolean
  session?: {
    id?: string
  }
}

type ResumeExportEntryMatch =
  NonNullable<ResumeExportRequestBody['entries'][number]['match']>

const ALL_CANDIDATE_STATUSES = [...CANDIDATE_STATUS_VALUES]

function formatDate(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

function formatFilterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(', ')
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

function formatSnapshotResultCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'result' : 'results'}`
}

function getSnapshotFilterTestId(key: string): string {
  const normalized = key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  return `public-snapshot-filter-${normalized || 'value'}`
}

function getSnapshotFilterEntries(filters: Record<string, unknown> | undefined) {
  return Object.entries(filters ?? {})
    .map(([key, value]) => ({
      key,
      label: formatFilterValue(value),
    }))
    .filter((entry) => entry.label.length > 0)
}

function normalizeFilterStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeStringList(value.filter((entry): entry is string => typeof entry === 'string'))
  }

  return typeof value === 'string' ? normalizeStringList([value]) : []
}

function resolveReviewSessionLocation(filters: Record<string, unknown>): string | undefined {
  const locations = normalizeFilterStringList(filters.locations)
  return locations.length > 0 ? locations.join(',') : undefined
}

function resolveReviewSessionJobDescriptionId(query: Record<string, unknown>): string | undefined {
  const value = query.jobDescriptionId
  return typeof value === 'string' ? normalizeOptionalString(value) : undefined
}

function buildReviewSessionBody(params: {
  member: NonNullable<NonNullable<PublicShareResponse['share']>['member']>
  searchQuery?: string
  shareTitle?: string
  token: string
}) {
  const filters = params.member.searchRun.filters
  const keywords = normalizeStringList(parseKeywordQuery(params.searchQuery ?? '').keywords)
  const jobDescriptionId = resolveReviewSessionJobDescriptionId(params.member.searchRun.query)

  return {
    jobDescriptionId,
    filters,
    shareTitle: normalizeOptionalString(params.shareTitle),
    searchState: {
      location: resolveReviewSessionLocation(filters),
      keywords,
      filters,
      referenceNote: `Shared snapshot ${params.token}`,
    },
  }
}

function getReviewSessionStorageKey(params: {
  token: string
  userId: string
  workspaceSlug: string
}): string {
  return `trends.publicShare.reviewSessionId.${params.workspaceSlug}.${params.userId}.${params.token}`
}

function useMemberReviewSession(params: {
  enabled: boolean
  member: NonNullable<NonNullable<PublicShareResponse['share']>['member']>
  searchQuery?: string
  shareTitle?: string
  token: string
}): string | undefined {
  const auth = useAuth()
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)

  const storageKey = useMemo(() => {
    const userId = auth.user?.id
    if (!userId) {
      return undefined
    }

    return getReviewSessionStorageKey({
      token: params.token,
      userId,
      workspaceSlug: params.member.workspaceSlug,
    })
  }, [auth.user?.id, params.member.workspaceSlug, params.token])

  useEffect(() => {
    if (!storageKey) {
      setSessionId(undefined)
      return
    }

    setSessionId(normalizeOptionalString(localStorage.getItem(storageKey) ?? undefined))
  }, [storageKey])

  useEffect(() => {
    if (!params.enabled || auth.isLoading || !auth.user?.id || !storageKey) {
      return
    }

    let active = true
    const resolvedStorageKey = storageKey
    const body = buildReviewSessionBody({
      member: params.member,
      searchQuery: params.searchQuery,
      shareTitle: params.shareTitle,
      token: params.token,
    })

    async function ensureReviewSession() {
      const storedSessionId = normalizeOptionalString(localStorage.getItem(resolvedStorageKey) ?? undefined)
      if (storedSessionId) {
        const { data, error } = await rawApiClient.PATCH<SearchSessionResponse>(
          `/api/sessions/${storedSessionId}`,
          { body },
        )
        const updatedSessionId = normalizeOptionalString(data?.session?.id)
        if (!error && data?.success && updatedSessionId) {
          localStorage.setItem(resolvedStorageKey, updatedSessionId)
          if (active) {
            setSessionId(updatedSessionId)
          }
          return
        }

        localStorage.removeItem(resolvedStorageKey)
      }

      const { data, error } = await rawApiClient.POST<SearchSessionResponse>('/api/sessions', {
        body,
      })
      const createdSessionId = normalizeOptionalString(data?.session?.id)
      if (error || !data?.success || !createdSessionId) {
        console.error('Failed to create public share review session', error ?? data)
        if (active) {
          setSessionId(undefined)
        }
        return
      }

      localStorage.setItem(resolvedStorageKey, createdSessionId)
      if (active) {
        setSessionId(createdSessionId)
      }
    }

    void ensureReviewSession()

    return () => {
      active = false
    }
  }, [
    auth.isLoading,
    auth.user?.id,
    params.enabled,
    params.member,
    params.searchQuery,
    params.shareTitle,
    params.token,
    storageKey,
  ])

  return params.enabled ? sessionId : undefined
}

function EmptyPublicShareState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <section className="mx-auto flex min-h-[55vh] max-w-xl flex-col justify-center gap-6 py-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
        <AlertTriangle className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="flex gap-2">{action}</div> : null}
    </section>
  )
}

function buildSnapshotAnalysis(result: PublicShareResult | undefined): ResumeSearchResultItem['analysis'] {
  if (!result) {
    return undefined
  }

  if (
    typeof result.score !== 'number'
    && !result.summary
    && !result.recommendation
    && !result.highlights?.length
    && !result.concerns?.length
  ) {
    return undefined
  }

  return {
    score: result.score ?? 0,
    summary: result.summary ?? '',
    highlights: result.highlights ?? [],
    recommendation: result.recommendation ?? '',
    concerns: result.concerns,
  }
}

function buildSharedExportMatch(
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

function buildSharedExportEntry(
  item: ResumeSearchResultItem,
  userRating?: number,
): ResumeExportRequestBody['entries'][number] {
  const match = buildSharedExportMatch(item)
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

function isHighScoreResult(item: ResumeSearchResultItem): boolean {
  return typeof item.score === 'number' && item.score >= 80
}

function getSnapshotFilterString(filters: Record<string, unknown>, key: string): string | undefined {
  const value = filters[key]
  return typeof value === 'string' ? normalizeOptionalString(value) : undefined
}

function countActiveSnapshotFilters(params: {
  idOrNameSearch?: string
  maxAge?: number
  maxSalary?: number
  minAge?: number
  minRoleYears?: number
  minSalary?: number
  minScore?: number
  selectedBrands: string[]
  selectedCompanies: string[]
  selectedEducation: string[]
  selectedExperienceLevel?: ExperienceLevelFilter
  selectedSources: string[]
  selectedStatuses: CandidateStatus[]
  selectedTags: string[]
}): number {
  let count = 0
  if (params.idOrNameSearch) count += 1
  if (typeof params.minScore === 'number') count += 1
  if (typeof params.minRoleYears === 'number') count += 1
  if (typeof params.minAge === 'number' || typeof params.maxAge === 'number') count += 1
  if (typeof params.minSalary === 'number' || typeof params.maxSalary === 'number') count += 1
  if (params.selectedBrands.length > 0) count += 1
  if (params.selectedCompanies.length > 0) count += 1
  if (params.selectedEducation.length > 0) count += 1
  if (params.selectedExperienceLevel) count += 1
  if (params.selectedSources.length > 0) count += 1
  if (params.selectedTags.length > 0) count += 1
  if (params.selectedStatuses.length !== ALL_CANDIDATE_STATUSES.length) count += 1
  return count
}

function matchesSelectedValues(values: string[] | undefined, selected: string[]): boolean {
  if (selected.length === 0) {
    return true
  }

  const normalizedValues = new Set((values ?? []).map(normalizeFilterToken).filter(Boolean))
  return selected.some((value) => normalizedValues.has(normalizeFilterToken(value)))
}

function toggleStringValue(values: string[], value: string): string[] {
  const normalized = value.trim()
  if (!normalized) {
    return values
  }

  return values.some((item) => normalizeFilterToken(item) === normalizeFilterToken(normalized))
    ? values.filter((item) => normalizeFilterToken(item) !== normalizeFilterToken(normalized))
    : [...values, normalized]
}

function toggleStatusValue(values: CandidateStatus[], value: CandidateStatus): CandidateStatus[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

function getSharedResultSearchText(item: ResumeSearchResultItem): string {
  const resume = item.resume
  return [
    item.key,
    item.identityKey,
    String(resume.resumeId),
    resume.externalId,
    resume.name,
    resume.location,
    resume.jobIntention,
    resume.experience,
    resume.education,
    resume.expectedSalary,
    resume.selfIntro,
    ...(resume.tags ?? []),
    ...(resume.ingestData?.industryTags ?? []),
    ...(resume.ingestData?.companyHits ?? []),
    ...(resume.ingestData?.brandHits?.map((hit) => hit.brand) ?? []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function sortSharedResults(
  left: ResumeSearchResultItem,
  right: ResumeSearchResultItem,
  sortValue: 'score' | 'newest' | 'experience',
): number {
  if (sortValue === 'newest') {
    return (right.resume.crawledAt ?? 0) - (left.resume.crawledAt ?? 0)
  }

  if (sortValue === 'experience') {
    return parseExperienceYears(right.resume.experience) - parseExperienceYears(left.resume.experience)
  }

  return (right.score ?? 0) - (left.score ?? 0)
}

function getStatusFacetCounts(items: ResumeSearchResultItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1
    return counts
  }, {})
}

function getStatusSummary(items: ResumeSearchResultItem[]) {
  return {
    new: items.filter((item) => item.status === 'new').length,
    shortlisted: items.filter((item) => item.status === 'shortlisted').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
    total: items.length,
  }
}

function PublicSnapshotSearchShell({
  createdAt,
  expiresAt,
  filters,
  query,
  resultCount,
}: {
  createdAt: string | null
  expiresAt: string | null
  filters: Record<string, unknown> | undefined
  query?: string
  resultCount: number
}) {
  const { t } = useTranslation()
  const filterEntries = getSnapshotFilterEntries(filters)
  const displayQuery = normalizeOptionalString(query) ?? t('publicShare.queryDefault', { defaultValue: 'Shared snapshot' })

  return (
    <section className="space-y-4" data-testid="public-snapshot-search-shell">
      <div className="mx-auto max-w-5xl">
        <div className="relative flex min-h-14 items-center gap-3 overflow-hidden rounded-full border bg-background/95 px-5 shadow-[0_12px_40px_-28px_rgba(15,23,42,0.85)]">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div
            aria-label={t('publicShare.queryAria', { defaultValue: 'Shared snapshot query' })}
            className="min-w-0 flex-1 truncate text-base font-medium text-slate-900"
            data-testid="public-snapshot-query"
          >
            {displayQuery}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[1.5rem] border bg-white/80 px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="text-sm font-medium text-slate-900">
            <span data-testid="public-snapshot-result-count">
              {formatSnapshotResultCount(resultCount)}
            </span>
            <span className="text-muted-foreground">{t('publicShare.inThisSnapshot', { defaultValue: ' in this public snapshot' })}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t('publicShare.snapshotBadge', { defaultValue: 'Snapshot' })}</Badge>
            {createdAt ? (
              <Badge variant="outline" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {createdAt}
              </Badge>
            ) : null}
            {expiresAt ? (
              <Badge variant="outline">
                Expires {expiresAt}
              </Badge>
            ) : null}
            {filterEntries.map((entry) => (
              <Badge
                key={entry.key}
                variant="outline"
                data-testid={getSnapshotFilterTestId(entry.key)}
              >
                {entry.key}: {entry.label}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function StaticPublicShareResults({ results }: { results: PublicShareResult[] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground">
          Results
        </div>
        <div className="text-xs text-muted-foreground">
          {formatSnapshotResultCount(results.length)}
        </div>
      </div>
      {results.length === 0 ? (
        <div className="rounded-[1.5rem] border bg-white/80 p-6 text-sm text-muted-foreground shadow-sm">
          No public results are included in this snapshot.
        </div>
      ) : (
        <div className="space-y-4">
          {results.map((result, index) => (
            <article
              key={result.resumeKey}
              className="rounded-[1.5rem] border bg-white/80 p-4 shadow-sm"
              data-result-index={index}
            >
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 space-y-3">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-foreground">
                      {result.displayName ?? result.resumeKey}
                    </h2>
                    {result.headline && <p className="text-sm text-muted-foreground">{result.headline}</p>}
                    {result.location && <p className="text-xs text-muted-foreground">{result.location}</p>}
                  </div>
                  {result.summary && <p className="text-sm leading-6 text-foreground">{result.summary}</p>}
                  {result.highlights && result.highlights.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {result.highlights.map((highlight) => (
                        <span key={highlight} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {highlight}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {result.skills && result.skills.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {result.skills.slice(0, 8).map((skill) => (
                        <span key={skill} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {typeof result.score === 'number' && (
                  <div className="min-w-20 rounded-2xl border bg-background px-3 py-2 text-left md:text-center">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Score
                    </div>
                    <div className="text-2xl font-semibold text-foreground">{result.score}</div>
                    {result.recommendation && (
                      <div className="text-xs text-muted-foreground">{result.recommendation}</div>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function MemberPublicShareResults({
  member,
  results,
  searchQuery,
  shareTitle,
  token,
}: {
  member: NonNullable<NonNullable<PublicShareResponse['share']>['member']>
  results: PublicShareResult[]
  searchQuery?: string
  shareTitle?: string
  token: string
}) {
  const { t } = useTranslation()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [exportFormat, setExportFormat] = useState<ResumeExportFormat>('csv')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [queryInput, setQueryInput] = useState(searchQuery ?? '')
  const [sortValue, setSortValue] = useState<'score' | 'newest' | 'experience'>('score')
  const [idOrNameSearch, setIdOrNameSearch] = useState<string | undefined>(undefined)
  const [minScore, setMinScore] = useState<number | undefined>(undefined)
  const [minRoleYears, setMinRoleYears] = useState<number | undefined>(undefined)
  const [minAge, setMinAge] = useState<number | undefined>(undefined)
  const [maxAge, setMaxAge] = useState<number | undefined>(undefined)
  const [minSalary, setMinSalary] = useState<number | undefined>(undefined)
  const [maxSalary, setMaxSalary] = useState<number | undefined>(undefined)
  const [selectedBrands, setSelectedBrands] = useState<string[]>([])
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [selectedEducation, setSelectedEducation] = useState<string[]>([])
  const [selectedExperienceLevel, setSelectedExperienceLevel] = useState<ExperienceLevelFilter | undefined>(undefined)
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<CandidateStatus[]>(ALL_CANDIDATE_STATUSES)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const selectedClusters: string[] = []
  const location = resolveReviewSessionLocation(member.searchRun.filters)
  const roleFilterType = getSnapshotFilterString(member.searchRun.filters, 'roleFilterType')
  const jobDescriptionId = resolveReviewSessionJobDescriptionId(member.searchRun.query)
  const analysisKeywords = useMemo(
    () => normalizeStringList(parseKeywordQuery(searchQuery ?? '').keywords),
    [searchQuery],
  )
  const reviewSessionId = useMemberReviewSession({
    enabled: member.canReview,
    member,
    searchQuery,
    shareTitle,
    token,
  })
  const canReview = member.canReview && Boolean(reviewSessionId)
  const docs = useQuery(api.resumes.getResumeDocsByIdentityKeys, {
    identityKeys: member.searchRun.resumeKeys,
  })
  const { statusByIdentity, updateStatus } = useCandidateStatus(canReview)
  const { actionsByResume, ratingsByResume, commentsByResume, saveAction } = useCandidateActions(
    reviewSessionId,
    undefined,
    canReview,
  )
  const { blocksByIdentity, blockCandidates, unblockCandidate } = useCandidateBlocks(canReview)
  const snapshotByKey = useMemo(() => {
    const map = new Map<string, PublicShareResult>()
    results.forEach((result) => {
      map.set(result.resumeKey, result)
    })
    return map
  }, [results])

  const items = useMemo<ResumeSearchResultItem[]>(() => {
    if (!docs) {
      return []
    }

    return docs.map((doc) => {
      const resume = mapResumeDoc(doc)
      const identityKey = resume.identityKey?.trim() || String(resume.resumeId)
      const snapshot = snapshotByKey.get(identityKey) ?? snapshotByKey.get(String(resume.resumeId))
      const statusMeta = statusByIdentity[identityKey]
      const block = blocksByIdentity[identityKey]
      const analysis = buildSnapshotAnalysis(snapshot) ?? resume.analysis
      const refreshState = resolveResumeRefreshState({
        resume,
        analysisContext: {
          jobDescriptionId,
          keywords: analysisKeywords,
          location,
          sourceKey: resolveResumeAnalysisSourceKey({
            source: resume.source,
          }),
        },
      })
      const score = typeof snapshot?.score === 'number'
        ? snapshot.score
        : typeof analysis?.score === 'number'
          ? analysis.score
          : resume.primaryRuleScore

      return {
        key: identityKey,
        identityKey,
        resume,
        blocked: Boolean(block),
        analysis,
        score,
        scoreSource: typeof snapshot?.score === 'number' || analysis ? 'ai' : 'rule',
        status: statusMeta?.status ?? 'new',
        statusMeta,
        refreshState,
      }
    })
  }, [analysisKeywords, blocksByIdentity, docs, jobDescriptionId, location, snapshotByKey, statusByIdentity])
  const facetCounts = useFacetCounts(items)
  const statusFacetCounts = useMemo(() => getStatusFacetCounts(items), [items])
  const statusSummary = useMemo(() => getStatusSummary(items), [items])
  const displayItems = useMemo(() => {
    const normalizedIdOrName = normalizeFilterToken(idOrNameSearch ?? '')
    return items
      .filter((item) => {
        if (!selectedStatuses.includes(item.status)) {
          return false
        }
        if (typeof minScore === 'number' && (item.score ?? 0) < minScore) {
          return false
        }
        if (typeof minRoleYears === 'number' && getRoleYears(item.resume, roleFilterType ?? '') < minRoleYears) {
          return false
        }

        const age = getResumeAge(item.resume)
        if (typeof minAge === 'number' && (age === null || age < minAge)) {
          return false
        }
        if (typeof maxAge === 'number' && (age === null || age > maxAge)) {
          return false
        }
        if (!matchesSalaryFilter(item.resume.expectedSalary, minSalary, maxSalary)) {
          return false
        }
        if (!matchesSelectedValues(item.resume.ingestData?.industryTags, selectedTags)) {
          return false
        }
        if (!matchesSelectedValues(
          item.resume.ingestData?.brandHits
            ?.filter((hit) => hit.context !== 'employer')
            .map((hit) => hit.brand),
          selectedBrands,
        )) {
          return false
        }
        if (!matchesSelectedValues(item.resume.ingestData?.companyHits, selectedCompanies)) {
          return false
        }
        if (!matchesEducationFilter(item.resume.education, selectedEducation)) {
          return false
        }
        if (selectedExperienceLevel && toExperienceLevel(item.resume.ingestData?.experienceLevel) !== selectedExperienceLevel) {
          return false
        }
        if (selectedSources.length > 0) {
          const sourceLabel = getSourceLabelFromHostname(item.resume.source)
          if (!sourceLabel || !matchesSelectedValues([sourceLabel], selectedSources)) {
            return false
          }
        }
        if (normalizedIdOrName && !getSharedResultSearchText(item).includes(normalizedIdOrName)) {
          return false
        }
        return true
      })
      .sort((left, right) => sortSharedResults(left, right, sortValue))
  }, [
    idOrNameSearch,
    items,
    maxAge,
    maxSalary,
    minAge,
    minRoleYears,
    minSalary,
    minScore,
    roleFilterType,
    selectedBrands,
    selectedCompanies,
    selectedEducation,
    selectedExperienceLevel,
    selectedSources,
    selectedStatuses,
    selectedTags,
    sortValue,
  ])
  const highScoreCount = useMemo(
    () => displayItems.filter(isHighScoreResult).length,
    [displayItems],
  )
  const filterCount = useMemo(
    () => countActiveSnapshotFilters({
      idOrNameSearch,
      maxAge,
      maxSalary,
      minAge,
      minRoleYears,
      minSalary,
      minScore,
      selectedBrands,
      selectedCompanies,
      selectedEducation,
      selectedExperienceLevel,
      selectedSources,
      selectedStatuses,
      selectedTags,
    }),
    [
      idOrNameSearch,
      maxAge,
      maxSalary,
      minAge,
      minRoleYears,
      minSalary,
      minScore,
      selectedBrands,
      selectedCompanies,
      selectedEducation,
      selectedExperienceLevel,
      selectedSources,
      selectedStatuses,
      selectedTags,
    ],
  )
  const shareState = useMemo(() => ({
    location,
    keywords: parseKeywordQuery(searchQuery ?? '').keywords,
    filters: member.searchRun.filters,
    jobDescriptionId,
  }), [jobDescriptionId, location, member.searchRun.filters, searchQuery])
  const analysisTitle = t('resumes.searchPage.analysis.title', {
    defaultValue: 'Resume AI analysis',
  })
  const analysisDescription = t('resumes.searchPage.analysis.description', {
    defaultValue: 'Generate per-resume AI summaries and breakdowns for the loaded search results.',
  })
  const analyzeLoadedLabel = t('resumes.searchPage.analysis.analyzeLoaded', {
    count: displayItems.length,
    defaultValue: 'Analyze loaded {{count}}',
  })

  const handleToggleExpanded = useCallback((key: string) => {
    setExpandedIds((current) => {
      if (current.has(key)) {
        return new Set()
      }

      return new Set([key])
    })
  }, [])

  const handleToggleSelect = useCallback((key: string) => {
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

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(displayItems.map((item) => item.key)))
  }, [displayItems])

  const handleSelectHighScore = useCallback(() => {
    setSelectedIds(new Set(
      displayItems
        .filter(isHighScoreResult)
        .map((item) => item.key),
    ))
  }, [displayItems])

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleAction = useCallback(
    (resumeId: string, actionType: CandidateActionType) => {
      void saveAction({ resumeId, actionType })
    },
    [saveAction],
  )

  const handleRating = useCallback(
    (resumeId: string, rating: number) => {
      void saveAction({ resumeId, actionType: 'rating', actionData: { rating } })
    },
    [saveAction],
  )

  const handleCandidateStatusChange = useCallback(
    (identityKey: string, status: CandidateStatus, notes?: string) => {
      void updateStatus(identityKey, status, notes)
    },
    [updateStatus],
  )

  const handleToggleBlock = useCallback(
    (identityKey: string, blocked: boolean, reason?: string) => {
      if (blocked) {
        void unblockCandidate(identityKey)
        return
      }

      void blockCandidates([identityKey], reason)
    },
    [blockCandidates, unblockCandidate],
  )

  const handleSetAgeRange = useCallback((nextMinAge: number | undefined, nextMaxAge: number | undefined) => {
    setMinAge(nextMinAge)
    setMaxAge(nextMaxAge)
  }, [])

  const handleSetSalaryRange = useCallback((nextMinSalary: number | undefined, nextMaxSalary: number | undefined) => {
    setMinSalary(nextMinSalary)
    setMaxSalary(nextMaxSalary)
  }, [])

  const handleClearFilters = useCallback(() => {
    setIdOrNameSearch(undefined)
    setMinScore(undefined)
    setMinRoleYears(undefined)
    setMinAge(undefined)
    setMaxAge(undefined)
    setMinSalary(undefined)
    setMaxSalary(undefined)
    setSelectedBrands([])
    setSelectedCompanies([])
    setSelectedEducation([])
    setSelectedExperienceLevel(undefined)
    setSelectedSources([])
    setSelectedStatuses(ALL_CANDIDATE_STATUSES)
    setSelectedTags([])
  }, [])

  const handleStatusFilterChange = useCallback((statuses: CandidateStatus[] | undefined) => {
    setSelectedStatuses(statuses && statuses.length > 0 ? statuses : ALL_CANDIDATE_STATUSES)
  }, [])

  const toggleStatus = useCallback((status: CandidateStatus) => {
    setSelectedStatuses((current) => toggleStatusValue(current, status))
  }, [])

  const ensureShareSession = useCallback(async () => reviewSessionId, [reviewSessionId])

  const applyExtractedKeywords = useCallback((keywords: string[]) => {
    setQueryInput(formatKeywordQuery(keywords))
  }, [])

  const handleBulkAction = useCallback(
    async (action: 'shortlist' | 'reject' | 'block' | 'export', format?: ResumeExportFormat) => {
      if (!canReview || selectedIds.size === 0) {
        return
      }

      const selectedItems = displayItems.filter((item) => selectedIds.has(item.key))
      if (selectedItems.length === 0) {
        return
      }

      if (action === 'export') {
        if (!reviewSessionId) {
          return
        }

        const jobDescriptionId = resolveReviewSessionJobDescriptionId(member.searchRun.query)
        const exportRequest: ResumeExportRequestBody = {
          format: format ?? exportFormat,
          source: 'convex',
          sessionId: reviewSessionId,
          ...(jobDescriptionId ? { jobDescriptionId } : {}),
          entries: selectedItems.map((item) =>
            buildSharedExportEntry(item, ratingsByResume[item.resume.resumeId])
          ),
        }

        try {
          await submitResumeExportDownload(apiBaseUrl, exportRequest)
          toast.info(`Started export for ${selectedItems.length} resumes`)
        } catch (error) {
          console.error('Failed to export shared snapshot results', error)
          const message =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Export failed. Please try again.'
          toast.error(message)
        }
        return
      }

      if (action === 'block') {
        const blocked = await blockCandidates(
          selectedItems.map((item) => item.identityKey),
          'bulk_block',
        )
        if (blocked) {
          handleClearSelection()
        }
        return
      }

      const nextStatus: CandidateStatus = action === 'shortlist' ? 'shortlisted' : 'rejected'
      await Promise.all(
        selectedItems.map((item) =>
          saveAction({ resumeId: item.resume.resumeId, actionType: action }),
        ),
      )
      await Promise.all(
        selectedItems.map((item) =>
          updateStatus(item.identityKey, nextStatus),
        ),
      )
      handleClearSelection()
    },
    [
      blockCandidates,
      canReview,
      displayItems,
      exportFormat,
      handleClearSelection,
      member.searchRun.query,
      ratingsByResume,
      reviewSessionId,
      saveAction,
      selectedIds,
      updateStatus,
    ],
  )

  const facetSidebarProps = {
    facetCounts,
    minAge,
    maxAge,
    minScore,
    minRoleYears,
    minSalary,
    maxSalary,
    selectedBrands,
    selectedClusters,
    selectedCompanies,
    selectedEducation,
    selectedExperienceLevel,
    selectedSources,
    selectedStatuses,
    selectedTags,
    onClearAll: handleClearFilters,
    onSetAgeRange: handleSetAgeRange,
    onSetExperienceLevel: setSelectedExperienceLevel,
    onSetMinRoleYears: setMinRoleYears,
    onSetMinScore: setMinScore,
    onSetSalaryRange: handleSetSalaryRange,
    onToggleBrand: (value: string) => setSelectedBrands((current) => toggleStringValue(current, value)),
    onToggleCompany: (value: string) => setSelectedCompanies((current) => toggleStringValue(current, value)),
    onToggleCluster: () => {},
    onToggleEducation: (value: string) => setSelectedEducation((current) => toggleStringValue(current, value)),
    onToggleSource: (value: string) => setSelectedSources((current) => toggleStringValue(current, value)),
    onToggleStatus: toggleStatus,
    onToggleTag: (value: string) => setSelectedTags((current) => toggleStringValue(current, value)),
    idOrNameSearch,
    onSetIdOrNameSearch: setIdOrNameSearch,
    loadedCount: items.length,
  }

  return (
    <div className="space-y-6">
      <h1 className="sr-only">{shareTitle ?? 'Shared resume search'}</h1>
      <SearchHeader
        activeQuery={queryInput}
        activeResultCount={displayItems.length}
        activeResultCountIsLowerBound={false}
        jobDescriptionId={jobDescriptionId}
        loading={docs === undefined}
        location={location}
        prefetchSearch={false}
        queryInput={queryInput}
        recentSearches={[]}
        sortValue={sortValue}
        statusSummary={statusSummary}
        onApplyRecentSearch={() => {}}
        onApplyExtractedKeywords={applyExtractedKeywords}
        onChangeQuery={setQueryInput}
        onClearQuery={() => setQueryInput('')}
        onSubmitQuery={(value) => {
          if (typeof value === 'string') {
            setQueryInput(value)
          }
        }}
        onSortChange={setSortValue}
      />

      <div className="flex gap-6">
        <div className="hidden w-72 shrink-0 min-[1440px]:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-4">
            <FacetSidebar {...facetSidebarProps} />
          </div>
        </div>

        <div className="hidden shrink-0 md:block min-[1440px]:hidden">
          <div className="sticky top-24">
            <FacetBadge
              activeCount={filterCount}
              onClick={() => setFiltersOpen(true)}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border bg-white/80 px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900">
                {analysisTitle}
              </div>
              <p className="text-sm text-slate-600">
                {analysisDescription}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ModeToggle
                mode="ai"
                onModeChange={() => {}}
                disabled
              />
              <Button
                type="button"
                size="sm"
                data-testid="resume-analyze-button"
                className="h-10 gap-2 rounded-full px-4"
                disabled
              >
                <RefreshCw className="h-4 w-4" />
                {analyzeLoadedLabel}
              </Button>
              <ShareLinkButton
                shareTitle={shareTitle ?? 'Shared resume search'}
                state={shareState}
                ensureApiSession={ensureShareSession}
              />
            </div>
          </div>

          <div className="sticky top-14 z-20 -mx-1 bg-background/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <BulkActionBar
              totalCount={displayItems.length}
              selectedCount={selectedIds.size}
              highScoreCount={highScoreCount}
              exportFormat={exportFormat}
              disabled={!canReview || docs === undefined}
              onExportFormatChange={setExportFormat}
              onSelectAll={handleSelectAll}
              onSelectHighScore={handleSelectHighScore}
              onClearSelection={handleClearSelection}
              onBulkAction={handleBulkAction}
              statusFilter={selectedStatuses}
              onStatusFilterChange={handleStatusFilterChange}
              onStatusToggle={toggleStatus}
              statusFacetCounts={statusFacetCounts}
            />
          </div>

          <SearchResultsList
            expandedIds={expandedIds}
            hasMore={false}
            items={displayItems}
            loading={docs === undefined}
            onLoadMore={() => {}}
            onToggleExpanded={handleToggleExpanded}
            selectedIds={selectedIds}
            actionsByResume={actionsByResume}
            ratingsByResume={ratingsByResume}
            commentsByResume={commentsByResume}
            onToggleSelect={canReview ? handleToggleSelect : undefined}
            onAction={canReview ? handleAction : undefined}
            onRating={canReview ? handleRating : undefined}
            onCandidateStatusChange={canReview ? handleCandidateStatusChange : undefined}
            onToggleBlock={canReview ? handleToggleBlock : undefined}
            searchQuery={queryInput}
            showAiScore
          />
        </div>
      </div>

      <div className="fixed bottom-5 right-5 z-30 md:hidden">
        <FacetBadge
          floating
          activeCount={filterCount}
          onClick={() => setFiltersOpen(true)}
        />
      </div>

      <MobileFilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        {...facetSidebarProps}
      />
    </div>
  )
}

function PublicShareReady({
  share,
  token,
}: {
  share: NonNullable<PublicShareResponse['share']>
  token: string
}) {
  const createdAt = formatDate(share.createdAt)
  const expiresAt = formatDate(share.expiresAt)
  const payload = share.snapshot.payload
  const results = payload.results

  if (share.member) {
    return (
      <MemberPublicShareResults
        member={share.member}
        results={results}
        searchQuery={payload.search?.query}
        shareTitle={share.title ?? payload.title}
        token={token}
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {share.title ?? payload.title ?? 'Public resume snapshot'}
        </h1>
        {share.description && (
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{share.description}</p>
        )}
      </header>

      <PublicSnapshotSearchShell
        createdAt={createdAt}
        expiresAt={expiresAt}
        filters={payload.search?.filters}
        query={payload.search?.query}
        resultCount={results.length}
      />

      <StaticPublicShareResults results={results} />

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        {share.snapshot.scoringMode} · {share.snapshot.promptVersion} · {share.snapshot.skillConfigVersion}
      </footer>
    </div>
  )
}

export function PublicSharePage() {
  const { t } = useTranslation()
  const { token } = useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!token) {
      setState({ status: 'not-found' })
      return
    }

    const publicToken = token
    let active = true

    async function loadPublicShare() {
      setState({ status: 'loading' })
      const { data, error, response } = await rawApiClient.GET<PublicShareResponse>(
        `/api/public-shares/${encodeURIComponent(publicToken)}`
      )
      if (!active) {
        return
      }
      if (data?.success && data.share) {
        setState({ status: 'ready', share: data.share })
        return
      }
      if (response?.status === 410) {
        setState({ status: 'unavailable' })
        return
      }
      if (response?.status === 404) {
        setState({ status: 'not-found' })
        return
      }
      if (error) {
        setState({ status: 'error' })
        return
      }
      setState({ status: 'not-found' })
    }

    void loadPublicShare()

    return () => {
      active = false
    }
  }, [reloadKey, token])

  if (state.status === 'loading') {
    return <div className="py-6 text-sm text-muted-foreground">{t('resumes.loading', { defaultValue: 'Loading...' })}</div>
  }

  if (state.status === 'unavailable') {
    return (
      <EmptyPublicShareState
        title={t('publicShare.unavailableTitle', { defaultValue: 'Public share unavailable' })}
        description={t('publicShare.expiredDescription', { defaultValue: 'This snapshot link has expired or was revoked.' })}
        action={
          <Button type="button" variant="outline" data-testid="public-share-back" asChild>
            <Link to="/">
              {t('publicShare.backToApp', { defaultValue: 'Back to Trends' })}
            </Link>
          </Button>
        }
      />
    )
  }

  if (state.status === 'error') {
    return (
      <EmptyPublicShareState
        title={t('publicShare.unavailableTitle', { defaultValue: 'Public share unavailable' })}
        description={t('publicShare.errorDescription', { defaultValue: 'The snapshot could not be loaded.' })}
        action={
          <Button
            type="button"
            variant="outline"
            data-testid="public-share-retry"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            {t('common.retry', { defaultValue: 'Retry' })}
          </Button>
        }
      />
    )
  }

  if (state.status === 'not-found') {
    return (
      <EmptyPublicShareState
        title={t('publicShare.notFoundTitle', { defaultValue: 'Public share not found' })}
        description={t('publicShare.notFoundDescription', { defaultValue: 'The snapshot link does not exist.' })}
        action={
          <Button type="button" variant="outline" data-testid="public-share-back" asChild>
            <Link to="/">
              {t('publicShare.backToApp', { defaultValue: 'Back to Trends' })}
            </Link>
          </Button>
        }
      />
    )
  }

  const { share } = state

  if (share.member) {
    return (
      <WorkspaceProvider workspaceSlug={share.member.workspaceSlug as WorkspaceSlug} surface="workspace">
        <PublicShareReady share={share} token={token ?? ''} />
      </WorkspaceProvider>
    )
  }

  return <PublicShareReady share={share} token={token ?? ''} />
}
