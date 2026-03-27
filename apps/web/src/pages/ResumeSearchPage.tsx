import { formatKeywordQuery, parseKeywordQuery } from '@trends/shared'
import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AnalysisTaskMonitor } from '@/components/AnalysisTaskMonitor'
import { AiSummaryPanel } from '@/components/search/AiSummaryPanel'
import { FacetBadge } from '@/components/search/FacetBadge'
import { FacetSidebar } from '@/components/search/FacetSidebar'
import { MigrationBanner } from '@/components/search/MigrationBanner'
import { MobileFilterSheet } from '@/components/search/MobileFilterSheet'
import { SearchHeader } from '@/components/search/SearchHeader'
import { SearchHero } from '@/components/search/SearchHero'
import { SearchResultsList } from '@/components/search/SearchResultsList'
import { Button } from '@/components/ui/button'
import { useAiSearchSummary } from '@/hooks/useAiSearchSummary'
import { useIndustryKeywords } from '@/hooks/useIndustryKeywords'
import { useResumeSearchState } from '@/hooks/useResumeSearchState'

export function ResumeSearchPage() {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { hotKeywords, workflowSeeds } = useIndustryKeywords()
  const {
    activeQuery,
    activeSort,
    analysisCandidateCount,
    analyzeResults,
    analyzingResults,
    applyRecentSearch,
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
    loadMore,
    parsedState,
    queryInput,
    recentSearches,
    searchHistoryLoading,
    selectedClusterTags,
    selectedRawTags,
    setExportFormat,
    setMinScoreFilter,
    setQueryInput,
    setSelectedExperienceLevel,
    setSort,
    submitSearch,
    taxonomyClusters,
    toggleCompany,
    toggleCluster,
    toggleEducation,
    toggleStatus,
    toggleTag,
  } = useResumeSearchState()
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
    query: activeQuery,
    location: parsedState.location,
    jobDescriptionId: parsedState.jobDescriptionId,
    selectedTags: selectedSummaryTags,
    selectedCompanies: parsedState.selectedCompanies,
    selectedExperienceLevel: parsedState.selectedExperienceLevel,
    results: filteredResults,
  })
  const applyExtractedKeywords = (keywords: string[]) => {
    const query = formatKeywordQuery(keywords)
    setQueryInput(query)
    submitSearch(query)
  }

  const applyWorkflowSeed = (seed: {
    keywords: string[]
    location: string
  }) => {
    const query = formatKeywordQuery(seed.keywords)
    setQueryInput(query)
    submitSearch(query, { location: seed.location })
  }

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
      selectedClusters: selectedClusterTags,
      selectedTags: selectedRawTags,
      selectedCompanies: parsedState.selectedCompanies,
      selectedExperienceLevel: parsedState.selectedExperienceLevel,
      selectedEducation: parsedState.filters.education ?? [],
      selectedStatuses: parsedState.filters.status ?? [],
      onToggleCluster: toggleCluster,
      onToggleTag: toggleTag,
      onToggleCompany: toggleCompany,
      onSetExperienceLevel: setSelectedExperienceLevel,
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
      parsedState.filters.status,
      parsedState.selectedCompanies,
      parsedState.selectedExperienceLevel,
      setMinScoreFilter,
      setSelectedExperienceLevel,
      selectedClusterTags,
      selectedRawTags,
      toggleCompany,
      toggleCluster,
      toggleEducation,
      toggleStatus,
      toggleTag,
    ],
  )

  return (
    <div className="space-y-6">
      <MigrationBanner />

      {isLanding ? (
        <SearchHero
          loading={loading}
          queryInput={queryInput}
          recentSearches={recentSearches}
          recentSearchesLoading={searchHistoryLoading}
          workflowSeeds={workflowSeeds}
          hotKeywords={hotKeywords}
          onApplyRecentSearch={applyRecentSearch}
          onApplyExtractedKeywords={applyExtractedKeywords}
          onApplyWorkflowSeed={applyWorkflowSeed}
          onToggleHotKeyword={toggleHotKeyword}
          onChangeQuery={setQueryInput}
          onClearQuery={clearSearch}
          onSubmitQuery={submitSearch}
        />
      ) : (
        <>
          <SearchHeader
            activeQuery={activeQuery}
            activeResultCount={filteredResults.length}
            exportFormat={exportFormat}
            exportingResults={exportingResults}
            jobDescriptionId={parsedState.jobDescriptionId}
            loading={loading}
            location={parsedState.location}
            queryInput={queryInput}
            recentSearches={recentSearches}
            sortValue={activeSort}
            onApplyRecentSearch={applyRecentSearch}
            onApplyExtractedKeywords={applyExtractedKeywords}
            onChangeQuery={setQueryInput}
            onClearQuery={clearSearch}
            onExportFormatChange={setExportFormat}
            onExportResults={exportResults}
            onSubmitQuery={submitSearch}
            onSortChange={setSort}
          />

          <div className="flex gap-6">
            <div className="hidden w-72 shrink-0 min-[1440px]:block">
              <div className="sticky top-24">
                <FacetSidebar {...mobileFilterProps} />
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
                    Resume AI analysis
                  </div>
                  <p className="text-sm text-slate-600">
                    Generate per-resume AI summaries and breakdowns for the top visible matches.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-10 gap-2 rounded-full px-4"
                    disabled={disableAnalyzeResults}
                    onClick={() => {
                      void analyzeResults()
                    }}
                  >
                    {analyzingResults || hasActiveAnalysisTask ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        {analysisCandidateCount > 0
                          ? `Analyze top ${analysisCandidateCount}`
                          : 'Analyze top results'}
                      </>
                    )}
                  </Button>
                  <AnalysisTaskMonitor />
                </div>
              </div>

              <AiSummaryPanel
                generatedAt={aiSummary.generatedAt}
                loading={aiSummary.loading}
                summary={aiSummary.summary}
              />

              <SearchResultsList
                expandedIds={expandedIds}
                hasMore={hasMore}
                items={filteredResults}
                loading={loading}
                loadingMore={loadingMore}
                onLoadMore={loadMore}
                onToggleExpanded={(key) => {
                  setExpandedIds((current) => {
                    const next = new Set(current)
                    if (next.has(key)) {
                      next.delete(key)
                    } else {
                      next.add(key)
                    }
                    return next
                  })
                }}
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
            {...mobileFilterProps}
          />
        </>
      )}
    </div>
  )
}
