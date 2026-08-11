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
import { useConvexResumeDetail, type ConvexResumeItem } from '@/hooks/useConvexResumes'
import { getResumeIdentityKey } from '@/hooks/resume-filter-helpers'
import { hasSystemAdminAccess } from '@/lib/workspace-access'
import { SearchCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SnippetCard } from '@/components/search/SnippetCard'
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
}

type SearchResultsListProps = {
  detailResumeId?: string
  expandedIds: Set<string>
  hasMore: boolean
  items: ResumeSearchResultItem[]
  loading?: boolean
  loadingMore?: boolean
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
  searchQuery,
  onQueueIndustryResearch,
  industryResearchQueueEnabled = false,
  verifiedOnlyNotice,
}: SearchResultsListProps) {
  const { t } = useTranslation()
  const { memberships } = useAuth()
  const listRef = useRef<HTMLDivElement | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [localDetailItem, setLocalDetailItem] = useState<ResumeSearchResultItem | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [queueingIndustryResearch, setQueueingIndustryResearch] = useState(false)
  const hasAiSummaries = items.some((item) => Boolean((item.analysis ?? item.resume.analysis)?.summary))
  const showIndustryEvidenceReviewGuidance = hasSystemAdminAccess(memberships)
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
    return {
      key: String(detailResumeFromConvex.resumeId),
      identityKey: getResumeIdentityKey(detailResumeFromConvex, String(detailResumeFromConvex.resumeId)),
      resume: detailResumeFromConvex,
      blocked: false,
      status: 'new' as const,
    }
  }, [detailResumeFromConvex, detailResumeId, routeDetailItem])
  const detailItem = routeDetailItem ?? localDetailItem ?? directDetailItem
  const resolvedDetailResume = detailResumeFromConvex ?? detailItem?.resume ?? null

  const rowVirtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 182,
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 6,
    scrollMargin,
  })

  const handleViewDetails = useCallback((item: ResumeSearchResultItem) => {
    if (onOpenDetail) {
      onOpenDetail(item)
      return
    }

    setLocalDetailItem(item)
  }, [onOpenDetail])

  const handleCloseDetails = useCallback(() => {
    if (onCloseDetail) {
      onCloseDetail()
      return
    }

    setLocalDetailItem(null)
  }, [onCloseDetail])

  const detailDialog = detailItem ? (
    <Suspense fallback={null}>
      <ResumeDetail
        resume={resolvedDetailResume}
        refreshState={detailItem.refreshState}
        open
        onOpenChange={(open) => {
          if (!open) {
            handleCloseDetails()
          }
        }}
        loading={detailResumeLoading}
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

  // Keyboard navigation: J/K to move, Enter to expand, S to star, A to archive
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
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
  }, [items, focusedIndex, onToggleExpanded, onAction])

  function scrollCardIntoView(index: number) {
    const card = listRef.current?.querySelector(`[data-result-index="${index}"]`)
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  const virtualItems = rowVirtualizer.getVirtualItems()

  if (loading) {
    return (
      <>
        <SearchResultsSkeleton />
        {detailDialog}
      </>
    )
  }

  if (items.length === 0) {
    return (
      <>
        <EmptyState
          title={t('resumes.searchPage.results.emptyTitle', {
            defaultValue: '没有符合该搜索条件的简历',
          })}
          description={t('resumes.searchPage.results.emptyDescription', {
            defaultValue: '请尝试放宽搜索词或移除一些筛选项以扩大结果范围。',
          })}
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
  })

  return (
    <div ref={listRef} className="space-y-4">
      {onQueueIndustryResearch && industryResearchQueueEnabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="resume-industry-research-bulk-control">
          <div>
            <p className="font-medium">Verify employer evidence for these results</p>
            <p className="text-xs text-muted-foreground">
              Queues exact resume identity targets only; {items.length > MAX_INDUSTRY_RESEARCH_BATCH
                ? `the first ${MAX_INDUSTRY_RESEARCH_BATCH} loaded results are queued per batch limit.`
                : hasMore
                  ? 'more results are still loading.'
                  : 'all loaded results are visible.'}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void queueIndustryResearch()}
            disabled={loading || loadingMore || queueingIndustryResearch || queueableIndustryResearchItems.length === 0}
          >
            <SearchCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            {queueingIndustryResearch ? 'Queueing…' : `Queue ${queueableIndustryResearchItems.length} exact targets`}
          </Button>
        </div>
      ) : null}
      {hasLegacyIndustryEvidence && showIndustryEvidenceReviewGuidance ? (
        <LegacyIndustryEvidenceNotice showReviewAction />
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
                className={`absolute left-0 top-0 w-full pb-4 ${focusedIndex === virtualRow.index ? 'rounded-[1.5rem] ring-2 ring-primary/30' : ''}`}
                style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
              >
                <ErrorBoundary fallback={<CardErrorFallback />}>
                  <SnippetCard
                    item={item}
                    itemKey={item.key}
                    expanded={false}
                    showAiScore={showAiScore}
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
              className={focusedIndex === index ? 'rounded-[1.5rem] ring-2 ring-primary/30' : undefined}
            >
              <ErrorBoundary fallback={<CardErrorFallback />}>
                <SnippetCard
                  item={presentationItem}
                  itemKey={item.key}
                  expanded={expandedIds.has(item.key)}
                  showAiScore={showAiScore}
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
