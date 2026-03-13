import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, FileText, AlertTriangle, History } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import type { ResumeItem } from '@/hooks/useResumes'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import { ResumeCard, ResumeCardSkeleton } from '@/components/ResumeCard'
import { ResumeDetail } from '@/components/ResumeDetail'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FilterPanel } from '@/components/FilterPanel'
import { QuickStartPanel } from '@/components/QuickStartPanel'
import { BulkActionBar } from '@/components/BulkActionBar'
import { AnalysisTaskMonitor } from '@/components/AnalysisTaskMonitor'
import { CollectResumesButton } from '@/components/CollectResumesButton'
import { ShareLinkButton } from '@/components/ShareLinkButton'
import { SearchHistoryDialog } from '@/components/SearchHistoryDialog'
import { useResumeListState } from '@/hooks/useResumeListState'
import { useSyncNotifications } from '@/hooks/useSyncNotifications'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { buildResumeKey, hasIngestData } from '@/lib/resume-scoring'
import { useBrandDisplayMap } from '@/hooks/useBrandDisplayMap'

export function ResumeList() {
  const { t } = useTranslation()
  const [historyRequested, setHistoryRequested] = useState(false)
  const {
    sessionLocation,
    sessionKeywords,
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
    selectedExperienceLevel,
    activeTagFilters,
    activeCompanyFilters,
    highScoreCount,
    blockedCount,
    bulkExportFormat,
    displayedResumes,
    searchHistory,
    searchHistoryLoading,
    setBulkExportFormat,
    handleAnalyzeAll,
    handleRefresh,
    handleQuickStartApply,
    handleQuickConstraintApply,
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
    handleAiFeedback,
    getAiFeedback,
  } = useResumeListState(historyRequested)
  useSyncNotifications()
  const { slug: workspaceSlug } = useWorkspace()
  const { resolve: brandDisplayResolve } = useBrandDisplayMap()

  const [detailResume, setDetailResume] = useState<ResumeItem | ConvexResumeItem | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const detailKey = useMemo(() => {
    if (!detailResume) return undefined
    return buildResumeKey(detailResume, 0)
  }, [detailResume])

  const detailMatch = useMemo(() => {
    if (!detailKey) return undefined
    return displayedResumes.find((entry) => entry.key === detailKey)?.match
  }, [detailKey, displayedResumes])

  return (
    <div className="flex flex-col gap-4">
      <QuickStartPanel
        onApplyConfig={handleQuickStartApply}
        jobDescriptionId={jobDescriptionId}
        onJobChange={handleJobChange}
        defaultLocation={sessionLocation}
        defaultKeywords={sessionKeywords}
        quickFilters={{
          minRoleYears: filters.minRoleYears ?? filters.minSalesYears,
          roleFilterType:
            filters.roleFilterType ?? (typeof filters.minSalesYears === 'number' ? 'sales' : undefined),
          maxAge: filters.maxAge,
        }}
        onApplyQuickFilters={handleQuickConstraintApply}
        extraActions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                setHistoryRequested(true)
                setHistoryOpen(true)
              }}
            >
              <History className="h-4 w-4" />
              {t('quickStart.history.button', 'History')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                void handleSaveCurrentSearch()
              }}
            >
              <History className="h-4 w-4" />
              {t('quickStart.history.save', 'Save search')}
            </Button>
            <CollectResumesButton
              location={sessionLocation}
              keywords={sessionKeywords}
              minAge={filters.minAge}
              maxAge={filters.maxAge}
            />
            {!selectedIds.size && (
              <Button
                onClick={handleAnalyzeAll}
                disabled={disableAnalyzeButton}
                size="sm"
                className="gap-2"
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
        }
        onResetAll={handleResetAll}
      />

      <FilterPanel
        filters={filters}
        onFiltersChange={handleFiltersChange}
        className=""
        defaultCollapsed={true}
        headerAction={
          <div className="flex items-center gap-2">
            <ShareLinkButton />
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleRefresh} disabled={activeLoading}>
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
          displayedResumes.map((entry) => {
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
                blocked={entry.blocked}
                candidateStatus={entry.status}
                candidateStatusMeta={entry.statusMeta ? {
                  notes: entry.statusMeta.notes,
                  updatedAt: entry.statusMeta.updatedAt,
                } : undefined}
                onToggleBlock={(reason) => handleToggleBlock(entry.identityKey, entry.blocked, reason)}
                onCandidateStatusChange={(status, notes) => handleCandidateStatusChange(entry.identityKey, status, notes)}
                onViewDetails={() => {
                  setDetailResume(entry.resume)
                  trackReviewedResume(entry.key)
                }}
                selected={selectedIds.has(entry.key)}
                onSelect={() => handleToggleSelect(entry.key)}
                isReviewed={reviewedIdsSet.has(entry.key)}
                aiScoreFeedback={getAiFeedback(entry.key, 'ai_score')}
                onAiFeedback={(target, sentiment) => handleAiFeedback(entry.key, target, sentiment)}
              />
            )
          })
        )}
      </div>

      <ResumeDetail
        resume={detailResume}
        matchResult={detailMatch}
        open={Boolean(detailResume)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailResume(null)
          }
        }}
        aiScoreFeedback={detailKey ? getAiFeedback(detailKey, 'ai_score') : undefined}
        aiSummaryFeedback={detailKey ? getAiFeedback(detailKey, 'ai_summary') : undefined}
        onAiFeedback={detailKey ? (target, sentiment) => handleAiFeedback(detailKey, target, sentiment) : undefined}
      />

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
    </div>
  )
}
