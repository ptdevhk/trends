import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { useConvexResumeDetail } from '@/hooks/useConvexResumes'
import { SnippetCard } from '@/components/search/SnippetCard'
import { Skeleton } from '@/components/ui/skeleton'
import type { ResumeSearchResultItem } from '@/components/search/search-types'

const loadResumeDetail = () => import('@/components/ResumeDetail')

const ResumeDetail = lazy(async () => {
  const module = await loadResumeDetail()
  return { default: module.ResumeDetail }
})

type SearchResultsListProps = {
  expandedIds: Set<string>
  hasMore: boolean
  items: ResumeSearchResultItem[]
  loading?: boolean
  loadingMore?: boolean
  showAiScore?: boolean
  onLoadMore: () => void
  onToggleExpanded: (key: string) => void
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
  expandedIds,
  hasMore,
  items,
  loading = false,
  loadingMore = false,
  showAiScore = false,
  onLoadMore,
  onToggleExpanded,
}: SearchResultsListProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [detailItem, setDetailItem] = useState<ResumeSearchResultItem | null>(null)
  const hasAiSummaries = items.some((item) => Boolean((item.analysis ?? item.resume.analysis)?.summary))
  const shouldVirtualize = items.length > 40 && expandedIds.size === 0 && !hasAiSummaries
  const expandedKey = expandedIds.values().next().value
  const expandedSourceItem = items.find((item) => item.key === expandedKey) ?? null
  const expandedResumeId = expandedSourceItem?.resume.resumeId ?? null
  const { resume: expandedResumeFromConvex } = useConvexResumeDetail(expandedResumeId)
  const detailResumeId = detailItem?.resume.resumeId ?? null
  const { resume: detailResumeFromConvex, loading: detailResumeLoading } = useConvexResumeDetail(detailResumeId)
  const resolvedDetailResume = detailResumeFromConvex ?? detailItem?.resume ?? null

  const rowVirtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 182,
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 6,
    scrollMargin,
  })

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
    if (!hasMore || loadingMore) {
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
  }, [hasMore, loadingMore, onLoadMore])

  const virtualItems = rowVirtualizer.getVirtualItems()

  if (loading) {
    return <SearchResultsSkeleton />
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={t('resumes.searchPage.results.emptyTitle', {
          defaultValue: 'No resumes matched this search',
        })}
        description={t('resumes.searchPage.results.emptyDescription', {
          defaultValue: 'Try broader keywords or remove a few facet filters to widen the result set.',
        })}
      />
    )
  }

  return (
    <div ref={listRef} className="space-y-4">
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
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 top-0 w-full pb-4"
                style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
              >
                <SnippetCard
                  item={item}
                  expanded={false}
                  showAiScore={showAiScore}
                  onToggleExpanded={() => onToggleExpanded(item.key)}
                  onViewDetails={() => setDetailItem(item)}
                />
              </div>
            )
          })}
        </div>
      ) : (
        items.map((item) => {
          const presentationItem =
            item.key === expandedKey && expandedResumeFromConvex
              ? {
                  ...item,
                  resume: expandedResumeFromConvex,
                }
              : item

          return (
            <SnippetCard
              key={item.key}
              item={presentationItem}
              expanded={expandedIds.has(item.key)}
              showAiScore={showAiScore}
              onToggleExpanded={() => onToggleExpanded(item.key)}
              onViewDetails={() => setDetailItem(presentationItem)}
            />
          )
        })
      )}

      <div ref={loadMoreRef} className="py-2 text-center text-sm text-muted-foreground">
        {loadingMore
          ? t('resumes.searchPage.results.loadingMore', {
            defaultValue: 'Loading more resumes...',
          })
          : hasMore
            ? t('resumes.searchPage.results.scrollForMore', {
              defaultValue: 'Scroll for more',
            })
            : t('resumes.searchPage.results.endOfResults', {
              defaultValue: 'End of results',
            })}
      </div>

      {detailItem ? (
        <Suspense fallback={null}>
          <ResumeDetail
            resume={resolvedDetailResume}
            open={Boolean(detailItem)}
            onOpenChange={(open) => {
              if (!open) {
                setDetailItem(null)
              }
            }}
            loading={detailResumeLoading}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
