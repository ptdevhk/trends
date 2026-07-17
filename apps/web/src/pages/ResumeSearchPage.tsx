import { formatKeywordQuery, parseKeywordQuery } from '@trends/shared'
import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnalysisTaskMonitor } from '@/components/AnalysisTaskMonitor'
import { BulkActionBar } from '@/components/BulkActionBar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { HrFeedbackImportDialog } from '@/components/HrFeedbackImportDialog'
import { InlineErrorFallback } from '@/components/InlineErrorFallback'
import { ModeToggle } from '@/components/ModeToggle'
import { AiSummaryPanel } from '@/components/search/AiSummaryPanel'
import { FacetBadge } from '@/components/search/FacetBadge'
import { FacetSidebar } from '@/components/search/FacetSidebar'
import { MobileFilterSheet } from '@/components/search/MobileFilterSheet'
import { SearchHeader } from '@/components/search/SearchHeader'
import { SearchHero } from '@/components/search/SearchHero'
import { SearchResultsList } from '@/components/search/SearchResultsList'
import {
  ShareLinkButton,
  type CreatePublicShareOptions,
  type PublicShareCreateResult,
} from '@/components/ShareLinkButton'
import { Button } from '@/components/ui/button'
import { useAiSearchSummary } from '@/hooks/useAiSearchSummary'
import { useIndustryKeywords } from '@/hooks/useIndustryKeywords'
import { useResumeSearchState } from '@/hooks/useResumeSearchState'
import { useCompanyPolicyListFilter } from '@/hooks/useCompanyPolicyListFilter'
import { useAuth } from '@/contexts/AuthContext'
import { rawApiClient } from '@/lib/api-helpers'
import { isResumeAiSummaryEnabled } from '@/lib/feature-flags'

type PublicShareCreateResponse = {
  success: boolean
  share?: {
    publicPath?: string
  }
}

export function ResumeSearchPage() {
  const { t } = useTranslation()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const resumeAiSummaryEnabled = isResumeAiSummaryEnabled()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { hotKeywords, quickStartProfiles } = useIndustryKeywords()
  const resolveSearchResumeEmployers = useCallback(
    (item: { resume: { workHistory?: unknown; ingestData?: { companyHits?: string[] } } }) => ({
      workHistory: item.resume.workHistory as Array<{ companyName?: string; raw?: string }> | undefined,
      companyHits: item.resume.ingestData?.companyHits,
    }),
    [],
  )
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
    loadedCollectedTodayCount,
    hasActiveAnalysisTask,
    isLanding,
    loading,
    loadingMore,
    loadMore,
    parsedState,
    queryInput,
    recentSearches,
    sessionKey,
    searchHistoryLoading,
    selectedClusterTags,
    selectedRawTags,
    setAiModeEnabled,
    setExportFormat,
    setIdOrNameSearchFilter,
    setMinRoleYearsFilter,
    setAgeRangeFilter,
    setSalaryRangeFilter,
    setMinScoreFilter,
    setQueryInput,
    setSelectedExperienceLevel,
    setSort,
    setStatusFilters,
    statusSummary,
    submitSearch,
    taxonomyClusters,
    toggleCompany,
    toggleCluster,
    toggleEducation,
    toggleSource,
    toggleBrand,
    toggleStatus,
    toggleTag,
    isFilterPending,
    committedMinRoleYears,
    // Candidate management
    actionsByResume,
    ratingsByResume,
    commentsByResume,
    handleBulkAction,
    handleCandidateAction,
    handleRating,
    handleRatingComment,
    handleCandidateStatusChange,
    handleToggleBlock,
    selectedIds,
    replaceSelection,
    pruneSelection,
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
  const {
    visibleItems: policyVisibleResults,
    hiddenCount: companyPolicyHiddenCount,
    showHidden: showCompanyPolicyHidden,
    setShowHidden: setShowCompanyPolicyHidden,
  } = useCompanyPolicyListFilter(filteredResults, resolveSearchResumeEmployers)

  // Selection + counts must use the same universe as the list (policy-visible).
  const policyVisibleKeys = useMemo(
    () => new Set(policyVisibleResults.map((item) => item.key)),
    [policyVisibleResults],
  )
  const selectedVisibleCount = useMemo(() => {
    let count = 0
    for (const key of selectedIds) {
      if (policyVisibleKeys.has(key)) {
        count += 1
      }
    }
    return count
  }, [policyVisibleKeys, selectedIds])
  const policyVisibleHighScoreCount = useMemo(
    () =>
      policyVisibleResults.filter(
        (item) => typeof item.score === 'number' && item.score >= 80,
      ).length,
    [policyVisibleResults],
  )
  const selectAllVisible = useCallback(() => {
    replaceSelection(policyVisibleResults.map((item) => item.key))
  }, [policyVisibleResults, replaceSelection])
  const selectHighScoreVisible = useCallback(() => {
    replaceSelection(
      policyVisibleResults
        .filter((item) => typeof item.score === 'number' && item.score >= 80)
        .map((item) => item.key),
    )
  }, [policyVisibleResults, replaceSelection])

  // Drop selections that disappeared behind company-policy hide.
  useEffect(() => {
    pruneSelection(policyVisibleKeys)
  }, [policyVisibleKeys, pruneSelection])
  const aiSummary = useAiSearchSummary({
    enabled: resumeAiSummaryEnabled,
    query: activeQuery,
    location: parsedState.location,
    jobDescriptionId: parsedState.jobDescriptionId,
    selectedTags: selectedSummaryTags,
    selectedCompanies: parsedState.selectedCompanies,
    selectedExperienceLevel: parsedState.selectedExperienceLevel,
    results: policyVisibleResults,
  })
  const shareState = useMemo(() => ({
    location: parsedState.location,
    keywords: parsedState.keywords,
    requiredKeywords: parsedState.requiredKeywords,
    filters: parsedState.filters,
    selectedTags: parsedState.selectedTags,
    selectedCompanies: parsedState.selectedCompanies,
    selectedExperienceLevel: parsedState.selectedExperienceLevel,
    jobDescriptionId: parsedState.jobDescriptionId,
  }), [parsedState])
  const shareTitle = useMemo(() => {
    const normalizedLocation = parsedState.location?.trim()
    const normalizedQuery = (activeQuery ?? queryInput).trim()
    const title = [normalizedLocation, normalizedQuery]
      .filter((value): value is string => Boolean(value))
      .join(' · ')
    return title || 'Resume search snapshot'
  }, [activeQuery, parsedState.location, queryInput])
  const ensureShareSession = useCallback(async () => undefined, [])
  const createPublicShare = useCallback(async (
    options: CreatePublicShareOptions,
  ): Promise<PublicShareCreateResult | undefined> => {
    if (filteredResults.length === 0) {
      return undefined
    }

    const filters = {
      ...(options.searchState.filters ?? {}),
      ...(options.searchState.location
        ? { locations: [options.searchState.location] }
        : {}),
    }
    const query = [
      ...(options.searchState.keywords ?? []),
      ...(options.searchState.requiredKeywords ?? []),
      options.searchState.location,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')

    const results = filteredResults.map((item) => {
      const analysis = item.analysis ?? item.resume.analysis
      return {
        resumeKey: item.identityKey || item.key || String(item.resume.resumeId),
        displayName: item.resume.name,
        headline: item.resume.jobIntention || item.resume.experience,
        location: item.resume.location,
        summary: analysis?.summary || item.resume.selfIntro,
        score: item.score ?? analysis?.score,
        recommendation: analysis?.recommendation,
        highlights: analysis?.highlights ?? [],
        concerns: analysis?.concerns ?? [],
        skills: item.resume.skills ?? item.resume.tags ?? [],
      }
    })

    const { data, error } = await rawApiClient.POST<PublicShareCreateResponse>('/api/public-shares', {
      body: {
        title: options.shareTitle,
        sessionId: sessionKey,
        search: {
          query,
          filters,
        },
        analysis: {
          scoringMode: aiModeEnabled ? 'hybrid' : 'rules_only',
          promptVersion: 'current',
          skillConfigVersion: 'current',
          modelProvider: 'trends',
          modelName: 'workspace-analysis',
        },
        results,
      },
    })

    if (error || !data?.success || !data.share?.publicPath) {
      console.error('Failed to create public share', error ?? data)
      return undefined
    }

    return { publicPath: data.share.publicPath }
  }, [aiModeEnabled, filteredResults, sessionKey])
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

  const handleBulkActionWithScroll = useCallback(
    (...args: Parameters<typeof handleBulkAction>) => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return handleBulkAction(...args)
    },
    [handleBulkAction],
  )

  const mobileFilterProps = useMemo(
    () => ({
      facetCounts,
      minScore: parsedState.filters.minMatchScore,
      minRoleYears: committedMinRoleYears,
      isFilterTransitionPending: isFilterPending,
      loadedCount: policyVisibleResults.length,
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
      idOrNameSearch: parsedState.filters.idOrNameSearch,
      onSetIdOrNameSearch: setIdOrNameSearchFilter,
    }),
    [
      clearFacetFilters,
      committedMinRoleYears,
      facetCounts,
      policyVisibleResults.length,
      isFilterPending,
      parsedState.filters.idOrNameSearch,
      setIdOrNameSearchFilter,
      parsedState.filters.education,
      parsedState.filters.minMatchScore,
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
    defaultValue: 'Resume AI analysis',
  })
  const analysisDescription = t('resumes.searchPage.analysis.description', {
    defaultValue: 'Generate AI summary and detailed score breakdown for the loaded search results.',
  })
  const analyzingLabel = t('resumes.searchPage.analysis.analyzing', {
    defaultValue: 'Analyzing...',
  })
  const analyzeLoadedLabel = t('resumes.searchPage.analysis.analyzeLoaded', {
    count: analysisCandidateCount,
    defaultValue: 'Analyze loaded {{count}}',
  })
  const analyzeLoadedResultsLabel = t('resumes.searchPage.analysis.analyzeLoadedResults', {
    defaultValue: 'Analyze loaded results',
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
  const readOnlyLoginRequiredLabel = t('resumes.searchPage.readOnly.loginRequired', {
    defaultValue: 'Sign in to rate, update status, add notes, block, export, or run bulk actions.',
  })
  const canManageCandidateData = isAuthenticated
  const showReadOnlyLoginRequired = !authLoading && !canManageCandidateData

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
              activeResultCount={policyVisibleResults.length}
              activeResultCountIsLowerBound={hasMore}
              collectedTodayCount={loadedCollectedTodayCount}
              jobDescriptionId={parsedState.jobDescriptionId}
              loading={loading}
              location={parsedState.location}
              queryInput={queryInput}
              recentSearches={recentSearches}
              sortValue={activeSort}
              statusSummary={statusSummary}
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
                    disabled={disableAnalyzeResults || !aiModeEnabled || !canManageCandidateData}
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
                  <ShareLinkButton
                    shareTitle={shareTitle}
                    state={shareState}
                    ensureApiSession={ensureShareSession}
                    createPublicShare={canManageCandidateData ? createPublicShare : undefined}
                  />
                  <HrFeedbackImportDialog disabled={!canManageCandidateData} />
                </div>
              </div>

              {showReadOnlyLoginRequired ? (
                <div
                  role="status"
                  aria-label={readOnlyLoginRequiredLabel}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                >
                  {readOnlyLoginRequiredLabel}
                </div>
              ) : null}

              {resumeAiSummaryEnabled && (
                <ErrorBoundary fallback={<InlineErrorFallback message={errorAiSummaryLabel} />}>
                  <AiSummaryPanel
                    generatedAt={aiSummary.generatedAt}
                    loading={aiSummary.loading}
                    summary={aiSummary.summary}
                  />
                </ErrorBoundary>
              )}

              <div className="sticky top-14 z-20 -mx-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-1 py-1">
                <BulkActionBar
                  totalCount={policyVisibleResults.length}
                  totalCountIsLowerBound={hasMore}
                  selectedCount={selectedVisibleCount}
                  highScoreCount={policyVisibleHighScoreCount}
                  exportFormat={exportFormat}
                  disabled={!canManageCandidateData}
                  onExportFormatChange={setExportFormat}
                  onSelectAll={selectAllVisible}
                  onSelectHighScore={selectHighScoreVisible}
                  onClearSelection={clearSelection}
                  onBulkAction={handleBulkActionWithScroll}
                  statusFilter={parsedState.filters.status}
                  onStatusFilterChange={setStatusFilters}
                  onStatusToggle={toggleStatus}
                  statusFacetCounts={facetCounts?.statuses?.reduce((acc, { value, count }) => ({ ...acc, [value]: count }), {} as Record<string, number>)}
                  companyPolicyHiddenCount={companyPolicyHiddenCount}
                  showCompanyPolicyHidden={showCompanyPolicyHidden}
                  onShowCompanyPolicyHiddenChange={setShowCompanyPolicyHidden}
                />
              </div>

              <ErrorBoundary fallback={<InlineErrorFallback message={errorResultsLabel} retryLabel={reloadPageLabel} onRetry={() => window.location.reload()} />}>
                <SearchResultsList
                  expandedIds={expandedIds}
                  hasMore={hasMore}
                  items={policyVisibleResults}
                  loading={loading}
                  loadingMore={loadingMore}
                  showAiScore={aiModeEnabled}
                  onLoadMore={loadMore}
                  onToggleExpanded={handleToggleExpanded}
                  selectedIds={selectedIds}
                  actionsByResume={actionsByResume}
                  ratingsByResume={ratingsByResume}
                  commentsByResume={commentsByResume}
                  onToggleSelect={canManageCandidateData ? toggleSelectItem : undefined}
                  onAction={canManageCandidateData ? handleCandidateAction : undefined}
                  onRating={canManageCandidateData ? handleRating : undefined}
                  onRatingComment={canManageCandidateData ? handleRatingComment : undefined}
                  onCandidateStatusChange={canManageCandidateData ? handleCandidateStatusChange : undefined}
                  onToggleBlock={canManageCandidateData ? handleToggleBlock : undefined}
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
