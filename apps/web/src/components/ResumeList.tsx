import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { RefreshCw, FileText, AlertTriangle, History, Upload } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import type { ResumeItem } from '@/hooks/useResumes'
import { useConvexResumeDetail, type ConvexResumeItem } from '@/hooks/useConvexResumes'
import { ResumeCard, ResumeCardSkeleton } from '@/components/ResumeCard'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FilterPanel } from '@/components/FilterPanel'
import { QuickStartPanel } from '@/components/QuickStartPanel'
import { BulkActionBar } from '@/components/BulkActionBar'
import { AnalysisTaskMonitor } from '@/components/AnalysisTaskMonitor'
import { CollectResumesButton } from '@/components/CollectResumesButton'
import { ShareLinkButton } from '@/components/ShareLinkButton'
import { useResumeListState } from '@/hooks/useResumeListState'
import { useSyncNotifications } from '@/hooks/useSyncNotifications'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { buildResumeKey, hasIngestData } from '@/lib/resume-scoring'
import { useBrandDisplayMap } from '@/hooks/useBrandDisplayMap'
import { shouldPreloadOnPointerDown } from '@/lib/pointer-preload'

const loadResumeDetail = () => import('@/components/ResumeDetail')
const loadSearchHistoryDialog = () => import('@/components/SearchHistoryDialog')
const loadManualResumeImportDialog = () => import('@/components/ManualResumeImportDialog')

const ResumeDetail = lazy(async () => {
  const module = await loadResumeDetail()
  return { default: module.ResumeDetail }
})

const SearchHistoryDialog = lazy(async () => {
  const module = await loadSearchHistoryDialog()
  return { default: module.SearchHistoryDialog }
})

const ManualResumeImportDialog = lazy(async () => {
  const module = await loadManualResumeImportDialog()
  return { default: module.ManualResumeImportDialog }
})

function isConvexResumeEntry(resume: ResumeItem | ConvexResumeItem): resume is ConvexResumeItem {
  return 'source' in resume && 'crawledAt' in resume
}

export function ResumeList() {
  const { t } = useTranslation()
  const [urlSearchParams] = useSearchParams()
  const initialCollectLimit = useMemo(() => {
    const raw = urlSearchParams.get('tr_limit')
    if (!raw) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }, [urlSearchParams])
  const initialMaxPages = useMemo(() => {
    const raw = urlSearchParams.get('tr_max_pages')
    if (!raw) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }, [urlSearchParams])
  const [historyRequested, setHistoryRequested] = useState(false)
  const [hasCompletedInitialListLoad, setHasCompletedInitialListLoad] = useState(false)
  const {
    sessionLocation,
    sessionKeywords,
    sessionCollectionSource,
    jobDescriptionId,
    filters,
    reviewedIdsSet,
    trackReviewedResume,
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
    handleSelectAll,
    handleSelectHighScore,
    handleClearSelection,
    handleToggleSelect,
    handleBulkAction,
    handleCardAction,
    handleToggleBlock,
    handleCandidateStatusChange,
    handleResetAll,
    ensureApiSession,
    handleShareSessionCopied,
    handleAiFeedback,
    handleRating,
    getAiFeedback,
    ratingsByResume,
  } = useResumeListState(historyRequested)
  useEffect(() => {
    if (!activeLoading) {
      setHasCompletedInitialListLoad(true)
    }
  }, [activeLoading])

  const backgroundEnhancementsEnabled = hasCompletedInitialListLoad
  useSyncNotifications(backgroundEnhancementsEnabled)
  const { slug: workspaceSlug } = useWorkspace()
  const { resolve: brandDisplayResolve } = useBrandDisplayMap(backgroundEnhancementsEnabled)

  const [detailResume, setDetailResume] = useState<ResumeItem | ConvexResumeItem | null>(null)
  const [detailResumeId, setDetailResumeId] = useState<ConvexResumeItem['resumeId'] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [manualImportOpen, setManualImportOpen] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [listScrollMargin, setListScrollMargin] = useState(0)

  const detailKey = useMemo(() => {
    if (!detailResume) return undefined
    return buildResumeKey(detailResume, 0)
  }, [detailResume])

  const detailMatch = useMemo(() => {
    if (!detailKey) return undefined
    return displayedResumes.find((entry) => entry.key === detailKey)?.match
  }, [detailKey, displayedResumes])
  const { resume: detailResumeFromConvex, loading: detailResumeLoading } = useConvexResumeDetail(detailResumeId)
  const resolvedDetailResume = detailResumeFromConvex ?? detailResume
  const shouldVirtualize = displayedResumes.length > 40
  const rowVirtualizer = useWindowVirtualizer({
    count: displayedResumes.length,
    estimateSize: () => 360,
    overscan: 6,
    scrollMargin: listScrollMargin,
  })

  useEffect(() => {
    const updateScrollMargin = () => {
      setListScrollMargin(listRef.current?.offsetTop ?? 0)
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
  }, [displayedResumes.length, shouldVirtualize])

  useEffect(() => {
    if (!canLoadMoreResumes || convexLoadingMore) {
      return
    }

    const target = loadMoreRef.current
    if (!target) {
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return
      }

      handleLoadMoreResumes()
    }, {
      rootMargin: '600px 0px',
    })

    observer.observe(target)
    return () => observer.disconnect()
  }, [canLoadMoreResumes, convexLoadingMore, displayedResumes.length, handleLoadMoreResumes])

  useEffect(() => {
    if (activeLoading || displayedResumes.length === 0) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadResumeDetail()
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [activeLoading, displayedResumes.length])

  const preloadHistoryDialog = () => {
    void loadSearchHistoryDialog()
  }
  const preloadManualImportDialog = () => {
    void loadManualResumeImportDialog()
  }

  const renderResumeCard = (entry: (typeof displayedResumes)[number]) => {
    const ingestData = hasIngestData(entry.resume) ? entry.resume.ingestData : undefined

    return (
      <ResumeCard
        key={entry.key}
        resume={entry.resume}
        matchResult={entry.match}
        ruleScore={entry.ruleScore}
        industryTags={ingestData?.industryTags}
        companyHits={ingestData?.companyHits}
        brandHits={ingestData?.brandHits}
        roleSignals={ingestData?.roleSignals}
        brandDisplayResolve={brandDisplayResolve}
        roleTypes={ingestData?.roleSignals?.map((signal) => signal.type) ?? []}
        experienceLevel={ingestData?.experienceLevel}
        onTagClick={handleToggleTag}
        onCompanyClick={handleToggleCompany}
        onExperienceLevelClick={handleToggleExperienceLevel}
        activeTagFilters={activeTagFilters}
        activeCompanyFilters={activeCompanyFilters}
        activeExperienceLevelFilter={selectedExperienceLevel}
        showAiScore={entry.match?.scoreSource === 'ai'}
        actionType={entry.action}
        onAction={(action) => handleCardAction(entry.key, action)}
        userRating={entry.userRating}
        onRating={(rating) => handleRating(entry.key, rating)}
        blocked={entry.blocked}
        candidateStatus={entry.status}
        candidateStatusMeta={entry.statusMeta ? {
          notes: entry.statusMeta.notes,
          updatedAt: entry.statusMeta.updatedAt,
        } : undefined}
        onToggleBlock={(reason) => handleToggleBlock(entry.identityKey, entry.blocked, reason)}
        onCandidateStatusChange={(status, notes) => handleCandidateStatusChange(entry.identityKey, status, notes)}
        onViewDetails={() => {
          void loadResumeDetail()
          setDetailResume(entry.resume)
          setDetailResumeId(isConvexResumeEntry(entry.resume) ? entry.resume.resumeId : null)
          trackReviewedResume(entry.key)
        }}
        selected={selectedIds.has(entry.key)}
        onSelect={() => handleToggleSelect(entry.key)}
        isReviewed={reviewedIdsSet.has(entry.key)}
        aiScoreFeedback={getAiFeedback(entry.key, 'ai_score')}
        onAiFeedback={(target, sentiment) => handleAiFeedback(entry.key, target, sentiment)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <QuickStartPanel
        onApplyConfig={handleQuickStartApply}
        jobDescriptionId={jobDescriptionId}
        onJobChange={handleJobChange}
        defaultLocation={sessionLocation}
        defaultKeywords={sessionKeywords}
        defaultCollectionSource={sessionCollectionSource}
        quickFilters={{
          minRoleYears: filters.minRoleYears,
          roleFilterType: filters.roleFilterType,
          maxAge: filters.maxAge,
        }}
        onApplyQuickFilters={handleQuickConstraintApply}
        assistantHistory={searchHistory}
        assistantHistoryLoading={historyRequested && searchHistoryLoading}
        onApplyAssistantHistory={handleApplySearchHistory}
        onAssistantOpen={() => {
          setHistoryRequested(true)
        }}
        onRequestHistory={() => {
          setHistoryRequested(true)
        }}
        activeSessionTitle={activeSessionTitle}
        activeSessionLabel={activeSessionLabel}
        activeSessionDescription={activeSessionDescription}
        activeSessionNote={activeSessionNote}
        activeSessionId={activeSessionId}
        extraActions={
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-2 rounded-full border border-border/70 bg-background/90 p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 gap-2 rounded-full px-3"
                  onPointerEnter={() => {
                    preloadHistoryDialog()
                  }}
                  onFocus={() => {
                    preloadHistoryDialog()
                  }}
                  onPointerDown={(event) => {
                    if (shouldPreloadOnPointerDown(event.pointerType)) {
                      preloadHistoryDialog()
                    }
                  }}
                  onClick={() => {
                    preloadHistoryDialog()
                    setHistoryRequested(true)
                    setHistoryOpen(true)
                  }}
                >
                  <History className="h-4 w-4" />
                  {t('quickStart.history.button', 'History')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 gap-2 rounded-full px-3"
                  onClick={() => {
                    void handleSaveCurrentSearch()
                  }}
                >
                  <History className="h-4 w-4" />
                  {t('quickStart.history.save', 'Save search')}
                </Button>
              </div>

              <CollectResumesButton
                location={sessionLocation}
                keywords={sessionKeywords}
                collectionSource={sessionCollectionSource}
                onCollectionSourceChange={handleCollectionSourceChange}
                minAge={filters.minAge}
                maxAge={filters.maxAge}
                initialCollectLimit={initialCollectLimit}
                initialMaxPages={initialMaxPages}
              />

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 gap-2 px-3"
                onPointerEnter={() => {
                  preloadManualImportDialog()
                }}
                onFocus={() => {
                  preloadManualImportDialog()
                }}
                onPointerDown={(event) => {
                  if (shouldPreloadOnPointerDown(event.pointerType)) {
                    preloadManualImportDialog()
                  }
                }}
                onClick={() => {
                  preloadManualImportDialog()
                  setManualImportOpen(true)
                }}
              >
                <Upload className="h-4 w-4" />
                {t('manualResumeImport.title', 'Import resumes')}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!selectedIds.size && (
                <Button
                  onClick={handleAnalyzeAll}
                  disabled={disableAnalyzeButton}
                  size="sm"
                  className="h-10 gap-2 px-4"
                >
                  {analyzing || hasActiveTask ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      {t('aiTasks.analyzing', 'Analyzing...')}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      {t('resumes.analyzeAll')}
                    </>
                  )}
                </Button>
              )}
              <AnalysisTaskMonitor />
            </div>
          </div>
        }
        onResetAll={handleResetAll}
      />

      <FilterPanel
        filters={filters}
        onFiltersChange={handleFiltersChange}
        className=""
        defaultCollapsed={true}
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            <ShareLinkButton
              shareTitle={shareTitle}
              state={shareState}
              ensureApiSession={ensureApiSession}
              onCopyState={({ sessionId, usedSessionLink }) => {
                if (usedSessionLink) {
                  handleShareSessionCopied(sessionId)
                }
              }}
            />
            <Button size="sm" variant="ghost" className="h-10 w-10 p-0" onClick={handleRefresh} disabled={activeLoading}>
              <RefreshCw className={cn('h-3.5 w-3.5', activeLoading && 'animate-spin')} />
            </Button>
          </div>
        }
      />

      <div className="space-y-4">
        <div className="flex items-center justify-between py-2">
          <BulkActionBar
            totalCount={displayedResumes.length}
            selectedCount={selectedIds.size}
            highScoreCount={highScoreCount}
            exportFormat={bulkExportFormat}
            onExportFormatChange={setBulkExportFormat}
            onSelectAll={handleSelectAll}
            onSelectHighScore={handleSelectHighScore}
            onClearSelection={handleClearSelection}
            onBulkAction={handleBulkAction}
            blockedCount={blockedCount}
            blocksSettingsPath={`/${workspaceSlug}/settings/blocks`}
          />
        </div>
      </div>

      <div className="grid gap-4">
        {error ? (
          <EmptyState
            icon={AlertTriangle}
            title={t('resumes.loadError', 'Failed to load resumes')}
            description={t('resumes.loadErrorDesc', 'There was a problem connecting to the server. Please try again.')}
            action={
              <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                {t('common.retry', 'Retry')}
              </Button>
            }
          />
        ) : activeLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <ResumeCardSkeleton key={index} />
          ))
        ) : displayedResumes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t('resumes.noResumes', 'No resumes found')}
            description={t('resumes.noResumesDesc', 'Try adjusting your filters or search keywords.')}
          />
        ) : (
          <>
            {shouldVirtualize ? (
              <div ref={listRef}>
                <div
                  className="relative w-full"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const entry = displayedResumes[virtualRow.index]
                    if (!entry) {
                      return null
                    }

                    return (
                      <div
                        key={entry.key}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        className="absolute left-0 top-0 w-full pb-4"
                        style={{ transform: `translateY(${virtualRow.start - listScrollMargin}px)` }}
                      >
                        {renderResumeCard(entry)}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div ref={listRef} className="grid gap-4">
                {displayedResumes.map((entry) => renderResumeCard(entry))}
              </div>
            )}

            {(canLoadMoreResumes || convexLoadingMore) && (
              <div ref={loadMoreRef} className="flex flex-col items-center gap-2 py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={handleLoadMoreResumes}
                  disabled={convexLoadingMore}
                >
                  <RefreshCw className={cn('h-4 w-4', convexLoadingMore && 'animate-spin')} />
                  {convexLoadingMore
                    ? t('resumes.loadingMore', 'Loading more...')
                    : t('debugIngest.loadMore', 'Load More')}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t('resumes.loadedCount', {
                    defaultValue: 'Loaded {{loaded}} resumes so far',
                    loaded: loadedConvexResumeCount,
                  })}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {detailResume ? (
        <Suspense fallback={null}>
          <ResumeDetail
            resume={resolvedDetailResume}
            matchResult={detailMatch}
            open={Boolean(detailResume)}
            onOpenChange={(open) => {
              if (!open) {
                setDetailResume(null)
                setDetailResumeId(null)
              }
            }}
            loading={detailResumeLoading}
            aiScoreFeedback={detailKey ? getAiFeedback(detailKey, 'ai_score') : undefined}
            aiSummaryFeedback={detailKey ? getAiFeedback(detailKey, 'ai_summary') : undefined}
            onAiFeedback={detailKey ? (target, sentiment) => handleAiFeedback(detailKey, target, sentiment) : undefined}
            userRating={detailKey ? ratingsByResume[detailKey] : undefined}
            onRating={detailKey ? (rating) => handleRating(detailKey, rating) : undefined}
          />
        </Suspense>
      ) : null}

      {historyOpen ? (
        <Suspense fallback={null}>
          <SearchHistoryDialog
            open={historyOpen}
            onOpenChange={(open) => {
              if (open) {
                setHistoryRequested(true)
              }
              setHistoryOpen(open)
            }}
            items={searchHistory}
            loading={searchHistoryLoading}
            onApply={handleApplySearchHistory}
          />
        </Suspense>
      ) : null}

      {manualImportOpen ? (
        <Suspense fallback={null}>
          <ManualResumeImportDialog
            open={manualImportOpen}
            onOpenChange={setManualImportOpen}
            location={sessionLocation}
            keywords={sessionKeywords}
            onImported={handleRefresh}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
