import { formatKeywordQuery, parseKeywordQuery } from '@trends/shared'
import { RefreshCw } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisTaskMonitor } from '@/components/AnalysisTaskMonitor'
import { BulkActionBar } from '@/components/BulkActionBar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { InlineErrorFallback } from '@/components/InlineErrorFallback'
import { ModeToggle } from '@/components/ModeToggle'
import { AiSummaryPanel } from '@/components/search/AiSummaryPanel'
import { FacetBadge } from '@/components/search/FacetBadge'
import { FacetSidebar } from '@/components/search/FacetSidebar'
import { MobileFilterSheet } from '@/components/search/MobileFilterSheet'
import { SearchHeader } from '@/components/search/SearchHeader'
import { SearchHero } from '@/components/search/SearchHero'
import { SearchResultsList } from '@/components/search/SearchResultsList'
import { Button } from '@/components/ui/button'
import { useAiSearchSummary } from '@/hooks/useAiSearchSummary'
import { useIndustryKeywords } from '@/hooks/useIndustryKeywords'
import { useResumeSearchState } from '@/hooks/useResumeSearchState'
import { isResumeAiSummaryEnabled } from '@/lib/feature-flags'

export function ResumeSearchPage() {
  const { t } = useTranslation()
  const resumeAiSummaryEnabled = isResumeAiSummaryEnabled()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { hotKeywords, quickStartProfiles } = useIndustryKeywords()
  const {
    activeQuery,
    activeSort,
    analysisCandidateCount,
    analyzeResults,
    aiModeEnabled,
    aiModeStats,
    analyzingResults,
    applyRecentSearch,
    clearFacetFilters,
    clearSearch,
    disableAnalyzeResults,
    exportFormat,
    facetCounts,
    filterCount,
    filteredResults,
    hasMore,
    hasActiveAnalysisTask,
    isLanding,
    loading,
    loadingMore,
    loadMore,
    parsedState,
    queryInput,
    recentSearches,
    searchHistoryLoading,
    selectedClusterTags,
    selectedRawTags,
    setAiModeEnabled,
    setExportFormat,
    setMinRoleYearsFilter,
    setAgeRangeFilter,
    setSalaryRangeFilter,
    setMinScoreFilter,
    setQueryInput,
    setSelectedExperienceLevel,
    setSort,
    submitSearch,
    taxonomyClusters,
    toggleCompany,
    toggleCluster,
    toggleEducation,
    toggleSource,
    toggleBrand,
    toggleStatus,
    toggleTag,
    // Candidate management
    actionsByResume,
    ratingsByResume,
    handleBulkAction,
    handleCandidateAction,
    handleRating,
    handleCandidateStatusChange,
    handleToggleBlock,
    highScoreCount,
    selectedIds,
    selectAll,
    selectHighScore,
    clearSelection,
    toggleSelectItem,
  } = useResumeSearchState()
  const collapseExpandedCards = useCallback(() => {
    setExpandedIds(new Set())
  }, [])
  const selectedSummaryTags = useMemo(() => {
    const clusterNamesBySlug = new Map(
      taxonomyClusters.map((cluster) => [
        cluster.slug.trim().toLowerCase(),
        cluster.name,
      ]),
    )

    return [
      ...selectedRawTags,
      ...selectedClusterTags.map(
        (slug) => clusterNamesBySlug.get(slug.trim().toLowerCase()) ?? slug,
      ),
    ]
  }, [selectedClusterTags, selectedRawTags, taxonomyClusters])
  const aiSummary = useAiSearchSummary({
    enabled: resumeAiSummaryEnabled,
    query: activeQuery,
    location: parsedState.location,
    jobDescriptionId: parsedState.jobDescriptionId,
    selectedTags: selectedSummaryTags,
    selectedCompanies: parsedState.selectedCompanies,
    selectedExperienceLevel: parsedState.selectedExperienceLevel,
    results: filteredResults,
  })
  const applyExtractedKeywords = (keywords: string[]) => {
    collapseExpandedCards()
    const query = formatKeywordQuery(keywords)
    setQueryInput(query)
    submitSearch(query)
  }

  const applyQuickStart = (seed: {
    keywords: string[]
    location: string
    minRoleYears?: number
    roleFilterType?: string
    minAge?: number
    maxAge?: number
    minExperience?: number
  }) => {
    collapseExpandedCards()
    const query = formatKeywordQuery(seed.keywords)
    setQueryInput(query)
    submitSearch(query, {
      location: seed.location,
      minRoleYears: seed.minRoleYears,
      roleFilterType: seed.roleFilterType,
      minAge: seed.minAge,
      maxAge: seed.maxAge,
      minExperience: seed.minExperience,
    })
  }

  const handleApplyRecentSearch = useCallback(
    async (item: Parameters<typeof applyRecentSearch>[0]) => {
      collapseExpandedCards()
      await applyRecentSearch(item)
    },
    [applyRecentSearch, collapseExpandedCards],
  )

  const handleSubmitQuery = useCallback(
    (value?: string) => {
      collapseExpandedCards()
      submitSearch(value)
    },
    [collapseExpandedCards, submitSearch],
  )

  const handleClearQuery = useCallback(() => {
    collapseExpandedCards()
    clearSearch()
  }, [clearSearch, collapseExpandedCards])

  const handleToggleExpanded = useCallback((key: string) => {
    setExpandedIds((current) => {
      if (current.has(key)) {
        return new Set()
      }

      return new Set([key])
    })
  }, [])

  const toggleHotKeyword = (keyword: string) => {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) {
      return
    }

    const parsedQuery = parseKeywordQuery(queryInput)
    const nextKeywords = parsedQuery.keywords.some(
      (item) => item.toLowerCase() === normalizedKeyword.toLowerCase(),
    )
      ? parsedQuery.keywords
      : [...parsedQuery.keywords, normalizedKeyword]
    const nextQuery = formatKeywordQuery(nextKeywords, parsedQuery.mode)

    setQueryInput(nextQuery)
  }

  const mobileFilterProps = useMemo(
    () => ({
      facetCounts,
      minScore: parsedState.filters.minMatchScore,
      minRoleYears: parsedState.filters.minRoleYears,
      minAge: parsedState.filters.minAge,
      maxAge: parsedState.filters.maxAge,
      minSalary: parsedState.filters.minSalary,
      maxSalary: parsedState.filters.maxSalary,
      selectedClusters: selectedClusterTags,
      selectedTags: selectedRawTags,
      selectedCompanies: parsedState.selectedCompanies,
      selectedSources: parsedState.selectedSources,
      selectedBrands: parsedState.selectedBrands,
      selectedExperienceLevel: parsedState.selectedExperienceLevel,
      selectedEducation: parsedState.filters.education ?? [],
      selectedStatuses: parsedState.filters.status ?? [],
      onToggleCluster: toggleCluster,
      onToggleTag: toggleTag,
      onToggleCompany: toggleCompany,
      onToggleSource: toggleSource,
      onToggleBrand: toggleBrand,
      onSetExperienceLevel: setSelectedExperienceLevel,
      onSetMinRoleYears: setMinRoleYearsFilter,
      onSetAgeRange: setAgeRangeFilter,
      onSetSalaryRange: setSalaryRangeFilter,
      onToggleEducation: toggleEducation,
      onToggleStatus: toggleStatus,
      onSetMinScore: setMinScoreFilter,
      onClearAll: clearFacetFilters,
    }),
    [
      clearFacetFilters,
      facetCounts,
      parsedState.filters.education,
      parsedState.filters.minMatchScore,
      parsedState.filters.minRoleYears,
      parsedState.filters.minAge,
      parsedState.filters.maxAge,
      parsedState.filters.minSalary,
      parsedState.filters.maxSalary,
      parsedState.filters.status,
      parsedState.selectedCompanies,
      parsedState.selectedSources,
      parsedState.selectedBrands,
      parsedState.selectedExperienceLevel,
      setMinRoleYearsFilter,
      setAgeRangeFilter,
      setSalaryRangeFilter,
      setMinScoreFilter,
      setSelectedExperienceLevel,
      selectedClusterTags,
      selectedRawTags,
      toggleCompany,
      toggleCluster,
      toggleEducation,
      toggleBrand,
      toggleSource,
      toggleStatus,
      toggleTag,
    ],
  )
  const analysisTitle = t('resumes.searchPage.analysis.title', {
    defaultValue: '简历 AI 测算',
  })
  const analysisDescription = t('resumes.searchPage.analysis.description', {
    defaultValue: '为加载的搜索结果生成 AI 摘要和详细分数拆解。',
  })
  const analyzingLabel = t('resumes.searchPage.analysis.analyzing', {
    defaultValue: '分析中...',
  })
  const analyzeLoadedLabel = t('resumes.searchPage.analysis.analyzeLoaded', {
    count: analysisCandidateCount,
    defaultValue: '测算 {{count}} 份简历',
  })
  const analyzeLoadedResultsLabel = t('resumes.searchPage.analysis.analyzeLoadedResults', {
    defaultValue: '测算当前结果',
  })
  const errorSearchBarLabel = t('resumes.searchPage.error.searchBar', {
    defaultValue: 'Search bar failed to load.',
  })
  const errorFiltersLabel = t('resumes.searchPage.error.filters', {
    defaultValue: 'Filters failed to load.',
  })
  const errorAiSummaryLabel = t('resumes.searchPage.error.aiSummary', {
    defaultValue: 'AI summary failed to load.',
  })
  const errorResultsLabel = t('resumes.searchPage.error.results', {
    defaultValue: 'Search results failed to load.',
  })
  const reloadPageLabel = t('resumes.searchPage.error.reloadPage', {
    defaultValue: 'Reload page',
  })

  return (
    <div className="space-y-6">
      {isLanding ? (
        <SearchHero
          aiModeEnabled={aiModeEnabled}
          aiModeStats={aiModeStats}
          loading={loading}
          queryInput={queryInput}
          recentSearches={recentSearches}
          recentSearchesLoading={searchHistoryLoading}
          quickStarts={quickStartProfiles.map((profile) => ({
            ...profile,
            profileId: profile.id,
          }))}
          hotKeywords={hotKeywords}
          onApplyRecentSearch={handleApplyRecentSearch}
          onApplyExtractedKeywords={applyExtractedKeywords}
          onApplyQuickStart={applyQuickStart}
          onToggleHotKeyword={toggleHotKeyword}
          onAiModeChange={setAiModeEnabled}
          onChangeQuery={setQueryInput}
          onClearQuery={handleClearQuery}
          onSubmitQuery={handleSubmitQuery}
        />
      ) : (
        <>
          <ErrorBoundary fallback={<InlineErrorFallback message={errorSearchBarLabel} retryLabel={reloadPageLabel} onRetry={() => window.location.reload()} />}>
            <SearchHeader
              activeQuery={activeQuery}
              activeResultCount={filteredResults.length}
              jobDescriptionId={parsedState.jobDescriptionId}
              loading={loading}
              location={parsedState.location}
              queryInput={queryInput}
              recentSearches={recentSearches}
              sortValue={activeSort}
              onApplyRecentSearch={handleApplyRecentSearch}
              onApplyExtractedKeywords={applyExtractedKeywords}
              onChangeQuery={setQueryInput}
              onClearQuery={handleClearQuery}
              onSubmitQuery={handleSubmitQuery}
              onSortChange={setSort}
            />
          </ErrorBoundary>

          <div className="flex gap-6">
            <div className="hidden w-72 shrink-0 min-[1440px]:block">
              <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-4">
                <ErrorBoundary fallback={<InlineErrorFallback message={errorFiltersLabel} />}>
                  <FacetSidebar {...mobileFilterProps} />
                </ErrorBoundary>
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
                    mode={aiModeEnabled ? 'ai' : 'original'}
                    onModeChange={(mode) => setAiModeEnabled(mode === 'ai')}
                    aiStats={aiModeStats}
                  />
                  <Button
                    type="button"
                    size="sm"
                    data-testid="resume-analyze-button"
                    className="h-10 gap-2 rounded-full px-4"
                    disabled={disableAnalyzeResults || !aiModeEnabled}
                    onClick={() => {
                      void analyzeResults()
                    }}
                  >
                    {analyzingResults || hasActiveAnalysisTask ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        {analyzingLabel}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        {analysisCandidateCount > 0
                          ? analyzeLoadedLabel
                          : analyzeLoadedResultsLabel}
                      </>
                    )}
                  </Button>
                  <AnalysisTaskMonitor />
                </div>
              </div>

              {resumeAiSummaryEnabled && (
                <ErrorBoundary fallback={<InlineErrorFallback message={errorAiSummaryLabel} />}>
                  <AiSummaryPanel
                    generatedAt={aiSummary.generatedAt}
                    loading={aiSummary.loading}
                    summary={aiSummary.summary}
                  />
                </ErrorBoundary>
              )}

              <BulkActionBar
                totalCount={filteredResults.length}
                selectedCount={selectedIds.size}
                highScoreCount={highScoreCount}
                exportFormat={exportFormat}
                onExportFormatChange={setExportFormat}
                onSelectAll={selectAll}
                onSelectHighScore={() => selectHighScore()}
                onClearSelection={clearSelection}
                onBulkAction={handleBulkAction}
                statusFilter={parsedState.filters.status}
                onStatusToggle={toggleStatus}
                statusFacetCounts={facetCounts?.statuses?.reduce((acc, { value, count }) => ({ ...acc, [value]: count }), {} as Record<string, number>)}
              />

              <ErrorBoundary fallback={<InlineErrorFallback message={errorResultsLabel} retryLabel={reloadPageLabel} onRetry={() => window.location.reload()} />}>
                <SearchResultsList
                  expandedIds={expandedIds}
                  hasMore={hasMore}
                  items={filteredResults}
                  loading={loading}
                  loadingMore={loadingMore}
                  showAiScore={aiModeEnabled}
                  onLoadMore={loadMore}
                  onToggleExpanded={handleToggleExpanded}
                  selectedIds={selectedIds}
                  actionsByResume={actionsByResume}
                  ratingsByResume={ratingsByResume}
                  onToggleSelect={toggleSelectItem}
                  onAction={handleCandidateAction}
                  onRating={handleRating}
                  onCandidateStatusChange={handleCandidateStatusChange}
                  onToggleBlock={handleToggleBlock}
                  searchQuery={queryInput}
                />
              </ErrorBoundary>
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
            {...mobileFilterProps}
          />
        </>
      )}
    </div>
  )
}
