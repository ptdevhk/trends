import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LegacyIndustryEvidenceNotice } from '@/components/industry-evidence/LegacyIndustryEvidenceNotice'
import {
  getVerifiedIndustryEvidenceSummaries,
  hasLegacyIndustryEvidenceInSignals,
} from '@/components/industry-evidence/industry-evidence'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useConvexResumeDetail, type ConvexResumeItem } from '@/hooks/useConvexResumes'
import { getResumeIdentityKey } from '@/hooks/resume-filter-helpers'
import { recommendationFromScore, toDisplayMatchBreakdown } from '@/lib/resume-scoring'
import { hasSystemAdminAccess, hasWorkspaceIndustryReviewAccess, SYSTEM_ROUTE_PREFIX } from '@/lib/workspace-access'
import { ExternalLink, SearchCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SnippetCard } from '@/components/search/SnippetCard'
import type { CandidatePolicyOverride } from '@trends/shared'
import { Skeleton } from '@/components/ui/skeleton'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { CandidateActionType, CandidateStatus, AiFeedbackSentiment, AiFeedbackTarget } from '@/types/resume'

const loadResumeDetail = () => import('@/components/ResumeDetail')
const MAX_INDUSTRY_RESEARCH_BATCH = 20

const ResumeDetail = lazy(async () => {
  const module = await loadResumeDetail()
  return { default: module.ResumeDetail }
})

function CardErrorFallback() {
  return (
    <div className="rounded-[1.5rem] border bg-white/60 p-4 text-center text-sm text-muted-foreground">
      Failed to load resume card.
    </div>
  )
}

export type VerifiedOnlyNotice = {
  minRoleYears?: number
  roleFilterType?: string | null
  verifiedEmployerCount?: number
  /** How resume-side evidence is resolved: strict-reviewed (revision-backed)
   * or legacy-seed (inferred from old industry-verified booleans). Undefined
   * when the endpoint did not report a mode (older API). */
  evidenceMode?: 'legacy-seed' | 'strict-reviewed'
}

type SearchResultsListProps = {
  detailResumeId?: string
  expandedIds: Set<string>
  hasMore: boolean
  items: ResumeSearchResultItem[]
  loading?: boolean
  loadingMore?: boolean
  searchFailed?: boolean
  onRetrySearch?: () => void
  showAiScore?: boolean
  onLoadMore: () => void
  onOpenDetail?: (item: ResumeSearchResultItem) => void
  onCloseDetail?: () => void
  onToggleExpanded: (key: string) => void
  // Candidate management props
  selectedIds?: Set<string>
  actionsByResume?: Record<string, CandidateActionType>
  ratingsByResume?: Record<string, number>
  commentsByResume?: Record<string, string>
  onToggleSelect?: (key: string) => void
  onAction?: (resumeId: string, actionType: CandidateActionType) => void
  onRating?: (resumeId: string, rating: number) => void
  onRatingComment?: (resumeId: string, comment: string) => void
  onCandidateStatusChange?: (identityKey: string, status: CandidateStatus, notes?: string) => void
  onToggleBlock?: (identityKey: string, blocked: boolean, reason?: string) => void
  policyOverrides?: CandidatePolicyOverride[]
  onSetOverride?: (resumeId: string, resumeIdentity: string, companyKey: string, reason: string) => Promise<boolean>
  onRemoveOverride?: (resumeIdentity: string, companyKey: string) => Promise<boolean>
  onAiFeedback?: (target: AiFeedbackTarget, sentiment: AiFeedbackSentiment) => void
  getAiFeedback?: (resumeId: string, target: AiFeedbackTarget) => AiFeedbackSentiment | undefined
  /** Raw search query text for highlighting matches in result cards */
  searchQuery?: string
  /** Admin-only exact resume target orchestration for the loaded result page. */
  onQueueIndustryResearch?: (resumeIds: string[]) => Promise<void>
  industryResearchQueueEnabled?: boolean
  /**
   * Gate-legibility notice: when a role gate (minRoleYears / roleFilterType)
   * is active and the verified-employer catalog count is known, the results
   * list explains that results are limited to industry-verified employers.
   */
  verifiedOnlyNotice?: VerifiedOnlyNotice
  /**
   * Workspace-scoped review inbox href. Only set when the active workspace
   * user may attend the industry evidence queue (workspace admin or
   * reviewer); when set, the verified-only notice gains a review link.
   */
  verifiedOnlyReviewHref?: string
  /** Show a quick-action button to clear the search query. */
  onClearQuery?: () => void
  /** Show a quick-action button to clear all facet filters. */
  onClearFilters?: () => void
}

function SearchResultsSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-[1.5rem] border bg-white p-5 shadow-sm">
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SearchResultsList({
  detailResumeId,
  expandedIds,
  hasMore,
  items,
  loading = false,
  loadingMore = false,
  searchFailed = false,
  onRetrySearch,
  showAiScore = false,
  onLoadMore,
  onOpenDetail,
  onCloseDetail,
  onToggleExpanded,
  selectedIds,
  actionsByResume,
  ratingsByResume,
  commentsByResume,
  onToggleSelect,
  onAction,
  onRating,
  onRatingComment,
  onCandidateStatusChange,
  onToggleBlock,
  policyOverrides,
  onSetOverride,
  onRemoveOverride,
  searchQuery,
  onQueueIndustryResearch,
  industryResearchQueueEnabled = false,
  verifiedOnlyNotice,
  verifiedOnlyReviewHref,
  onClearQuery,
  onClearFilters,
}: SearchResultsListProps) {
  const { t } = useTranslation()
  const { memberships } = useAuth()
  const listRef = useRef<HTMLDivElement | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [localDetailItem, setLocalDetailItem] = useState<ResumeSearchResultItem | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [queueingIndustryResearch, setQueueingIndustryResearch] = useState(false)
  const [highlightedResumeId, setHighlightedResumeId] = useState<string | null>(null)
  const [hashVersion, setHashVersion] = useState(0)
  const handledHashRef = useRef<string | null>(null)
  const hasAiSummaries = items.some((item) => Boolean((item.analysis ?? item.resume.analysis)?.summary))
  const { slug: workspaceSlug } = useWorkspace()
  const isSystemAdmin = hasSystemAdminAccess(memberships)
  const showIndustryEvidenceReviewGuidance = isSystemAdmin || hasWorkspaceIndustryReviewAccess(memberships, workspaceSlug)
  const legacyReviewBasePath = isSystemAdmin
    ? `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`
    : `/${workspaceSlug}/system/settings/industry-verification`
  const hasLegacyIndustryEvidence = useMemo(() =>
    showIndustryEvidenceReviewGuidance && items.some((item) => {
      const summaries = getVerifiedIndustryEvidenceSummaries(item.resume)
      return hasLegacyIndustryEvidenceInSignals(
        item.resume.ingestData?.roleSignals,
        summaries,
      )
    }),
  [items, showIndustryEvidenceReviewGuidance])
  const shouldVirtualize = items.length > 40 && expandedIds.size === 0 && !hasAiSummaries
  const expandedKey = expandedIds.values().next().value
  const expandedSourceItem = items.find((item) => item.key === expandedKey) ?? null
  const expandedResumeId = expandedSourceItem?.resume?.resumeId ?? null
  const { resume: expandedResumeFromConvex } = useConvexResumeDetail(expandedResumeId)
  const queueableIndustryResearchItems = items.slice(0, MAX_INDUSTRY_RESEARCH_BATCH)
  const queueIndustryResearch = useCallback(async () => {
    if (!onQueueIndustryResearch || queueableIndustryResearchItems.length === 0 || queueingIndustryResearch) return
    setQueueingIndustryResearch(true)
    try {
      await onQueueIndustryResearch(
        queueableIndustryResearchItems.map((item) => String(item.resume.resumeId)).filter(Boolean),
      )
    } finally {
      setQueueingIndustryResearch(false)
    }
  }, [onQueueIndustryResearch, queueableIndustryResearchItems, queueingIndustryResearch])
  const routeDetailItem = useMemo(() => {
    if (!detailResumeId) {
      return null
    }
    return items.find((item) => String(item.resume.resumeId) === detailResumeId) ?? null
  }, [detailResumeId, items])
  const detailQueryId = detailResumeId
    ? detailResumeId as ConvexResumeItem['resumeId']
    : localDetailItem?.resume?.resumeId ?? null
  const { resume: detailResumeFromConvex, loading: detailResumeLoading } = useConvexResumeDetail(detailQueryId)
  const directDetailItem = useMemo<ResumeSearchResultItem | null>(() => {
    if (!detailResumeId || routeDetailItem || !detailResumeFromConvex) {
      return null
    }
    const analysis = detailResumeFromConvex.analysis
    return {
      key: String(detailResumeFromConvex.resumeId),
      identityKey: getResumeIdentityKey(detailResumeFromConvex, String(detailResumeFromConvex.resumeId)),
      resume: detailResumeFromConvex,
      blocked: false,
      status: 'new' as const,
      analysis,
      match: analysis
        ? {
          resumeId: String(detailResumeFromConvex.resumeId),
          score: analysis.score,
          summary: analysis.summary,
          highlights: analysis.highlights,
          recommendation: recommendationFromScore(analysis.score),
          concerns: analysis.concerns ?? [],
          breakdown: toDisplayMatchBreakdown(analysis.breakdown),
          scoreSource: 'ai',
          matchedAt: new Date().toISOString(),
          jobDescriptionId: analysis.jobDescriptionId,
          promptVersion: analysis.promptVersion,
          locale: analysis.locale,
          screeningChecklist: analysis.screeningChecklist,
        }
        : undefined,
    }
  }, [detailResumeFromConvex, detailResumeId, routeDetailItem])
  const detailItem = routeDetailItem ?? localDetailItem ?? directDetailItem
  const detailIndex = detailItem ? items.findIndex((item) => item.key === detailItem.key) : -1
  const resolvedDetailResume = detailResumeFromConvex ?? detailItem?.resume ?? null

  const rowVirtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 182,
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 6,
    scrollMargin,
  })

  const detailSourceIndexRef = useRef<number | null>(null)

  const handleViewDetails = useCallback((item: ResumeSearchResultItem) => {
    detailSourceIndexRef.current = items.findIndex((candidate) => candidate.key === item.key)
    if (onOpenDetail) {
      onOpenDetail(item)
      return
    }

    setLocalDetailItem(item)
  }, [items, onOpenDetail])

  const handleCloseDetails = useCallback(() => {
    const restoreIndex = detailSourceIndexRef.current
    if (onCloseDetail) {
      onCloseDetail()
    } else {
      setLocalDetailItem(null)
    }
    // Restore focus to the card the dialog was opened from (after paint)
    if (restoreIndex !== null) {
      requestAnimationFrame(() => {
        const card = document.querySelector<HTMLElement>(`[data-result-index="${restoreIndex}"]`)
        card?.focus({ preventScroll: true })
      })
    }
  }, [onCloseDetail])

  function scrollCardIntoView(index: number) {
    const card = listRef.current?.querySelector(`[data-result-index="${index}"]`)
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  const navigateToDetail = useCallback((index: number) => {
    const nextItem = items[index]
    if (!nextItem) {
      return
    }
    handleViewDetails(nextItem)
    if (shouldVirtualize) {
      rowVirtualizer.scrollToIndex(index, { align: 'start' })
    } else {
      scrollCardIntoView(index)
    }
  }, [items, handleViewDetails, shouldVirtualize, rowVirtualizer])

  const detailDialog = detailItem ? (
    <Suspense fallback={null}>
      <ResumeDetail
        resume={resolvedDetailResume}
        matchResult={detailItem.match}
        refreshState={detailItem.refreshState}
        open
        onOpenChange={(open) => {
          if (!open) {
            handleCloseDetails()
          }
        }}
        loading={detailResumeLoading}
        policyOverrides={policyOverrides}
        resumeIdentity={detailItem.identityKey}
        positionLabel={detailIndex >= 0 ? `${detailIndex + 1} / ${items.length}` : undefined}
        onNavigatePrev={detailIndex > 0 ? () => navigateToDetail(detailIndex - 1) : undefined}
        onNavigateNext={detailIndex >= 0 && detailIndex < items.length - 1 ? () => navigateToDetail(detailIndex + 1) : undefined}
        onSetOverride={onSetOverride}
        onRemoveOverride={onRemoveOverride}
        userRating={ratingsByResume?.[detailItem.resume.resumeId]}
        initialComment={detailItem.statusMeta?.notes ?? commentsByResume?.[detailItem.resume.resumeId]}
        onRating={onRating ? (rating) => onRating(detailItem.resume.resumeId, rating) : undefined}
        onRatingComment={onRatingComment ? (comment) => onRatingComment(detailItem.resume.resumeId, comment) : undefined}
      />
    </Suspense>
  ) : null

  useEffect(() => {
    const updateScrollMargin = () => {
      setScrollMargin(listRef.current?.offsetTop ?? 0)
    }

    updateScrollMargin()
    const parent = listRef.current?.parentElement
    let resizeObserver: ResizeObserver | undefined
    if (parent && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateScrollMargin)
      resizeObserver.observe(parent)
    }

    window.addEventListener('resize', updateScrollMargin)
    return () => {
      window.removeEventListener('resize', updateScrollMargin)
      resizeObserver?.disconnect()
    }
  }, [items.length])

  useEffect(() => {
    if (!shouldVirtualize) {
      return
    }

    rowVirtualizer.measure()
  }, [items, rowVirtualizer, shouldVirtualize])

  useEffect(() => {
    if (loading || items.length === 0 || !hasMore || loadingMore) {
      return
    }

    const target = loadMoreRef.current
    if (!target) {
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onLoadMore()
      }
    }, { rootMargin: '500px 0px' })

    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, items.length, loading, loadingMore, onLoadMore])

  // Keyboard navigation: J/K to move, Enter to expand, O to open detail, S to star, A to archive
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      // Detail dialog is open: background keyboard shortcuts (S/A/O/J/K) must not act on the list behind it
      if (detailItem) return
      if (items.length === 0) return

      switch (event.key) {
        case 'j':
        case 'J':
          event.preventDefault()
          setFocusedIndex((prev) => {
            const next = prev === null ? 0 : Math.min(prev + 1, items.length - 1)
            scrollCardIntoView(next)
            return next
          })
          break
        case 'k':
        case 'K':
          event.preventDefault()
          setFocusedIndex((prev) => {
            const next = prev === null ? 0 : Math.max(prev - 1, 0)
            scrollCardIntoView(next)
            return next
          })
          break
        case 'Enter':
          if (focusedIndex !== null && items[focusedIndex]) {
            event.preventDefault()
            onToggleExpanded(items[focusedIndex].key)
          }
          break
        case 'o':
        case 'O':
          if (focusedIndex !== null && items[focusedIndex]) {
            event.preventDefault()
            handleViewDetails(items[focusedIndex])
          }
          break
        case 's':
        case 'S':
          if (focusedIndex !== null && items[focusedIndex] && onAction) {
            event.preventDefault()
            const resumeId = items[focusedIndex].resume?.resumeId
            if (resumeId) onAction(resumeId, 'star')
          }
          break
        case 'a':
        case 'A':
          if (focusedIndex !== null && items[focusedIndex] && onAction) {
            event.preventDefault()
            const resumeId = items[focusedIndex].resume?.resumeId
            if (resumeId) onAction(resumeId, 'archive')
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, focusedIndex, onToggleExpanded, onAction, handleViewDetails, detailItem])

  // Deep-link support: `#resume-<id>` scrolls to the matching card and flashes
  // a highlight ring. Re-arms on hashchange (back/forward, manual hash edit).
  useEffect(() => {
    const handleHashChange = () => {
      handledHashRef.current = null
      setHashVersion((version) => version + 1)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const rawHash = window.location.hash.replace(/^#/, '')
    if (!rawHash.startsWith('resume-') || rawHash === handledHashRef.current) {
      return
    }

    const targetIndex = items.findIndex(
      (item) => item.resume.resumeId != null && `resume-${item.resume.resumeId}` === rawHash,
    )
    if (targetIndex === -1) {
      // Target resume is not part of the loaded result set; keep the hash so it
      // resolves once the card is present.
      return
    }

    handledHashRef.current = rawHash
    if (shouldVirtualize) {
      rowVirtualizer.scrollToIndex(targetIndex, { align: 'start' })
    }
    const scrollTimer = window.setTimeout(() => {
      document.getElementById(rawHash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
    setHighlightedResumeId(rawHash)
    return () => window.clearTimeout(scrollTimer)
  }, [items, shouldVirtualize, rowVirtualizer, hashVersion])

  useEffect(() => {
    if (!highlightedResumeId) {
      return
    }
    const clearTimer = window.setTimeout(() => setHighlightedResumeId(null), 3500)
    return () => window.clearTimeout(clearTimer)
  }, [highlightedResumeId])

  const virtualItems = rowVirtualizer.getVirtualItems()

  if (loading) {
    return (
      <>
        <SearchResultsSkeleton />
        {detailDialog}
      </>
    )
  }

  if (items.length === 0 && searchFailed) {
    return (
      <>
        <div
          data-testid="resume-search-failed-panel"
          className="flex flex-col items-center gap-3 rounded-[1.5rem] border border-destructive/40 bg-destructive/5 px-6 py-10 text-center"
        >
          <SearchCheck className="h-8 w-8 text-destructive/70" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t('resumes.searchPage.results.failedTitle', {
                defaultValue: '搜索失败，请重试',
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('resumes.searchPage.results.failedDescription', {
                defaultValue: '搜索请求没有完成。结果可能仍然存在，请重试或刷新页面。',
              })}
            </p>
          </div>
          {onRetrySearch ? (
            <Button size="sm" variant="outline" onClick={onRetrySearch}>
              {t('common.retry', { defaultValue: '重试' })}
            </Button>
          ) : null}
        </div>
        {detailDialog}
      </>
    )
  }

  if (items.length === 0) {
    const resetActions = [
      onClearQuery ? (
        <Button key="clear-query" size="sm" variant="outline" onClick={onClearQuery}>
          {t('resumes.searchPage.searchBar.clearSearch', { defaultValue: '清除搜索' })}
        </Button>
      ) : null,
      onClearFilters ? (
        <Button key="clear-filters" size="sm" variant="outline" onClick={onClearFilters}>
          {t('resumes.searchPage.results.clearFilters', { defaultValue: '清除筛选' })}
        </Button>
      ) : null,
    ].filter(Boolean)

    return (
      <>
        <EmptyState
          title={t('resumes.searchPage.results.emptyTitle', {
            defaultValue: '没有符合该搜索条件的简历',
          })}
          description={t('resumes.searchPage.results.emptyDescription', {
            defaultValue: '请尝试放宽搜索词或移除一些筛选项以扩大结果范围。',
          })}
          action={resetActions.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {resetActions}
            </div>
          ) : undefined}
        />
        {detailDialog}
      </>
    )
  }

  const cardProps = (item: ResumeSearchResultItem) => ({
    selected: selectedIds?.has(item.key),
    onSelect: onToggleSelect ? () => onToggleSelect(item.key) : undefined,
    actionType: actionsByResume?.[item.resume.resumeId],
    onAction,
    userRating: ratingsByResume?.[item.resume.resumeId],
    // User Comment SoT is candidate_status.notes (not session action notes).
    initialComment: item.statusMeta?.notes ?? commentsByResume?.[item.resume.resumeId],
    onRating,
    onRatingComment,
    onCandidateStatusChange,
    onToggleBlock,
    policyOverrides,
    resumeIdentity: item.identityKey,
  })
  const isHighlighted = (item: ResumeSearchResultItem) =>
    item.resume.resumeId != null && highlightedResumeId === `resume-${item.resume.resumeId}`

  return (
    <div ref={listRef} className="space-y-4">
      {items.length > 0 ? (
        <div
          className="flex items-center justify-end px-1 text-xs text-muted-foreground"
          data-testid="resume-keyboard-hint"
        >
          {t('resumes.searchPage.results.keyboardHint', {
            defaultValue: 'J/K move · Enter expand · O detail · S star · A archive',
          })}
        </div>
      ) : null}
      {onClearQuery || onClearFilters ? (
        <div
          className="flex flex-wrap items-center gap-2 px-1"
          data-testid="resume-active-filter-chips"
        >
          {onClearQuery ? (
            <button
              type="button"
              onClick={onClearQuery}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid="resume-clear-query-chip"
            >
              {t('resumes.searchPage.searchBar.clearSearch', { defaultValue: '清除搜索' })}
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
          {onClearFilters ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid="resume-clear-filters-chip"
            >
              {t('resumes.searchPage.results.clearFilters', { defaultValue: '清除筛选' })}
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
      {onQueueIndustryResearch && industryResearchQueueEnabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="resume-industry-research-bulk-control">
          <div>
            <p className="font-medium">{t('resumes.searchPage.results.industryQueue.title', { defaultValue: 'Verify employer evidence for these results' })}</p>
            <p className="text-xs text-muted-foreground">
              {t('resumes.searchPage.results.industryQueue.description', {
                defaultValue: 'Queues exact resume identity targets only; {{detail}}',
                detail: items.length > MAX_INDUSTRY_RESEARCH_BATCH
                  ? t('resumes.searchPage.results.industryQueue.batchedDetail', { defaultValue: 'the first {{count}} loaded results are queued per batch limit.', count: MAX_INDUSTRY_RESEARCH_BATCH })
                  : hasMore
                    ? t('resumes.searchPage.results.industryQueue.loadingDetail', { defaultValue: 'more results are still loading.' })
                    : t('resumes.searchPage.results.industryQueue.allVisibleDetail', { defaultValue: 'all loaded results are visible.' }),
              })}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void queueIndustryResearch()}
            disabled={loading || loadingMore || queueingIndustryResearch || queueableIndustryResearchItems.length === 0}
          >
            <SearchCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            {queueingIndustryResearch
              ? t('resumes.searchPage.results.industryQueue.queueing', { defaultValue: 'Queueing…' })
              : t('resumes.searchPage.results.industryQueue.queueButton', { defaultValue: 'Queue {{count}} exact targets', count: queueableIndustryResearchItems.length })}
          </Button>
        </div>
      ) : null}
      {hasLegacyIndustryEvidence && showIndustryEvidenceReviewGuidance ? (
        <LegacyIndustryEvidenceNotice showReviewAction reviewBasePath={legacyReviewBasePath} />
      ) : null}
      {verifiedOnlyNotice
      && typeof verifiedOnlyNotice.verifiedEmployerCount === 'number'
      && verifiedOnlyNotice.verifiedEmployerCount > 0
      && ((verifiedOnlyNotice.minRoleYears ?? 0) > 0 || Boolean(verifiedOnlyNotice.roleFilterType)) ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
          data-testid="resume-verified-only-notice"
          role="status"
        >
          {t('industryEvidence.searchVerifiedOnlyNotice', {
            defaultValue: 'Results limited to industry-verified employers · {{count}} verified employers in catalog',
            count: verifiedOnlyNotice.verifiedEmployerCount,
          })}
          {verifiedOnlyNotice.evidenceMode === 'legacy-seed' ? (
            <span
              className="ml-1 inline-flex items-center gap-1 font-medium text-muted-foreground"
              data-testid="verified-only-legacy-suffix"
            >
              {t('industryEvidence.searchVerifiedOnlyLegacySuffix', {
                defaultValue: '· Legacy catalog evidence (no revision-backed stamps on resumes yet)',
              })}
            </span>
          ) : null}
          {verifiedOnlyReviewHref ? (
            <a
              className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              href={verifiedOnlyReviewHref}
            >
              {t('industryEvidence.verifiedOnlyReviewAction', {
                defaultValue: 'Review industry evidence',
              })}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
      {shouldVirtualize ? (
        <div
          className="relative"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {virtualItems.map((virtualRow) => {
            const item = items[virtualRow.index]
            return (
              <div
                key={item.key}
                data-index={virtualRow.index}
                data-result-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                tabIndex={-1}
                className={`absolute left-0 top-0 w-full pb-4 ${focusedIndex === virtualRow.index ? 'rounded-[1.5rem] ring-2 ring-primary/30' : ''}`}
                style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
              >
                <ErrorBoundary fallback={<CardErrorFallback />}>
                  <SnippetCard
                    item={item}
                    itemKey={item.key}
                    expanded={false}
                    showAiScore={showAiScore}
                    highlighted={isHighlighted(item)}
                    onToggleExpanded={onToggleExpanded}
                    onViewDetails={handleViewDetails}
                    searchQuery={searchQuery}
                    {...cardProps(item)}
                  />
                </ErrorBoundary>
              </div>
            )
          })}
        </div>
      ) : (
        items.map((item, index) => {
          const presentationItem =
            item.key === expandedKey && expandedResumeFromConvex
              ? {
                ...item,
                resume: expandedResumeFromConvex,
              }
              : item

          return (
            <div
              key={item.key}
              data-result-index={index}
              tabIndex={-1}
              className={focusedIndex === index ? 'rounded-[1.5rem] ring-2 ring-primary/30' : undefined}
            >
              <ErrorBoundary fallback={<CardErrorFallback />}>
                <SnippetCard
                  item={presentationItem}
                  itemKey={item.key}
                  expanded={expandedIds.has(item.key)}
                  showAiScore={showAiScore}
                  highlighted={isHighlighted(presentationItem)}
                  onToggleExpanded={onToggleExpanded}
                  onViewDetails={handleViewDetails}
                  searchQuery={searchQuery}
                  {...cardProps(presentationItem)}
                />
              </ErrorBoundary>
            </div>
          )
        })
      )}

      <div ref={loadMoreRef} role="status" aria-live="polite" className="py-2 text-center text-sm text-muted-foreground">
        {loadingMore
          ? t('resumes.searchPage.results.loadingMore', {
            defaultValue: '正在加载更多简历...',
          })
          : hasMore
            ? t('resumes.searchPage.results.scrollForMore', {
              defaultValue: '向下滑动查看更多',
            })
            : t('resumes.searchPage.results.endOfResults', {
              defaultValue: '已到底部',
            })}
      </div>

      {detailDialog}
    </div>
  )
}
