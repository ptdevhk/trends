import React from 'react'
import { formatKeywordQuery } from '@trends/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeSearchPage } from './ResumeSearchPage'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { UrlSearchState } from '@/hooks/useUrlSearchState'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') {
        return options
      }
      // Return English text for keys used by ResumeSearchPage
      const englishTexts: Record<string, string> = {
        'bulkActions.selected': 'selected',
        'bulkActions.blocked': 'blocked',
        'bulkActions.manageBlocked': 'manage',
        'resumes.searchPage.header.resultsWithQuery': 'Results for "{{query}}": {{count}}',
        'resumes.searchPage.header.results': 'Found {{count}} results',
        'resumes.searchPage.header.sort': 'Sort',
        'resumes.searchPage.header.sortResults': 'Sort results',
        'resumes.searchPage.header.sortOptions.aiScore': 'AI Score',
        'resumes.searchPage.header.sortOptions.newest': 'Most Recent',
        'resumes.searchPage.header.sortOptions.experience': 'Experience',
        'resumes.searchPage.analysis.title': 'Resume AI analysis',
        'resumes.searchPage.analysis.description': 'Generate AI summary and detailed score breakdown for the loaded search results.',
        'resumes.searchPage.analysis.analyzeLoaded': 'Analyze loaded {{count}}',
        'resumes.searchPage.analysis.analyzeLoadedResults': 'Analyze loaded results',
        'resumes.searchPage.analysis.analyzing': 'Analyzing...',
      }
      const text = englishTexts[key] ?? key
      return text.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
        const value = options && typeof options === 'object' ? options[token] : undefined
        return value === undefined || value === null ? '' : String(value)
      })
    },
  }),
}))

const {
  useIndustryKeywordsMock,
  useAiSearchSummaryMock,
  useResumeSearchStateMock,
} = vi.hoisted(() => ({
  useIndustryKeywordsMock: vi.fn(),
  useAiSearchSummaryMock: vi.fn(),
  useResumeSearchStateMock: vi.fn(),
}))

const featureFlagsMock = vi.hoisted(() => ({
  resumeAiSummaryEnabled: false,
}))

vi.mock('@/lib/feature-flags', () => ({
  isResumeAiSummaryEnabled: () => featureFlagsMock.resumeAiSummaryEnabled,
}))

vi.mock('@/hooks/useAiSearchSummary', () => ({
  useAiSearchSummary: (...args: unknown[]) => useAiSearchSummaryMock(...args),
}))

vi.mock('@/hooks/useResumeSearchState', () => ({
  useResumeSearchState: () => useResumeSearchStateMock(),
}))

vi.mock('@/hooks/useIndustryKeywords', () => ({
  useIndustryKeywords: () => useIndustryKeywordsMock(),
}))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/components/search/SearchHero', () => ({
  SearchHero: ({
    aiModeEnabled,
    aiModeStats,
    hotKeywords,
    onApplyQuickStart,
    onAiModeChange,
    onToggleHotKeyword,
    queryInput,
    onApplyExtractedKeywords,
    quickStarts,
  }: {
    aiModeEnabled: boolean
    aiModeStats?: { avgScore: number; matched: number; processed?: number }
    hotKeywords?: Array<{ keyword: string }>
    onApplyQuickStart?: (seed: {
      keywords: string[]
      location: string
      minRoleYears?: number
      roleFilterType?: string
      minAge?: number
      maxAge?: number
    }) => void
    onAiModeChange: (enabled: boolean) => void
    onToggleHotKeyword?: (keyword: string) => void
    queryInput: string
    onApplyExtractedKeywords: (keywords: string[]) => void
    quickStarts?: Array<{ label: string }>
  }) => (
    <div>
      <div>Landing Hero {queryInput}</div>
      <div>
        Landing Hero Seeds {quickStarts?.length ?? 0} Hot{' '}
        {hotKeywords?.length ?? 0}
      </div>
      <button
        type="button"
        onClick={() =>
          onApplyExtractedKeywords(['Machine Tools', 'Business Development'])
        }
      >
        Apply Hero JD
      </button>
      <button
        type="button"
        onClick={() =>
          onApplyQuickStart?.({
            keywords: ['CNC', 'Sales'],
            location: 'Kuala Lumpur MY',
          })
        }
      >
        Apply Hero Quick Start
      </button>
      <button
        type="button"
        onClick={() =>
          onApplyQuickStart?.({
            keywords: ['CNC', 'Sales'],
            location: 'Kuala Lumpur MY',
            minRoleYears: 3,
            roleFilterType: 'sales',
            minAge: 25,
            maxAge: 40,
          })
        }
      >
        Apply Hero Quick Start Role Years
      </button>
      <button type="button" onClick={() => onToggleHotKeyword?.('CNC')}>
        Toggle Hero Hot Keyword
      </button>
      <button
        type="button"
        role="switch"
        aria-label="AI Mode"
        aria-checked={aiModeEnabled}
        onClick={() => onAiModeChange(!aiModeEnabled)}
      >
        {aiModeEnabled ? 'On' : 'Off'}
      </button>
      <span>AI Mode</span>
      {aiModeEnabled && aiModeStats ? <span>{aiModeStats.matched}</span> : null}
    </div>
  ),
}))

vi.mock('@/components/search/SearchHeader', () => ({
  SearchHeader: ({
    activeQuery,
    activeResultCount,
    exportFormat,
    exportingResults,
    onApplyExtractedKeywords,
    onExportFormatChange,
    onExportResults,
  }: {
    activeQuery?: string
    activeResultCount: number
    exportFormat?: string
    exportingResults?: boolean
    onApplyExtractedKeywords: (keywords: string[]) => void
    onExportFormatChange?: (format: string) => void
    onExportResults?: () => void
  }) => (
    <div>
      <div>
        Header {activeQuery} {activeResultCount} export:{exportFormat} exporting:
        {String(exportingResults)}
      </div>
      <button
        type="button"
        onClick={() =>
          onApplyExtractedKeywords(['Machine Tools', 'Business Development'])
        }
      >
        Apply Header JD
      </button>
      {onExportFormatChange && (
        <button type="button" onClick={() => onExportFormatChange('xlsx')}>
          Change Header Export Format
        </button>
      )}
      {onExportResults && (
        <button type="button" onClick={onExportResults}>
          Export Header Results
        </button>
      )}
    </div>
  ),
}))

vi.mock('@/components/search/FacetSidebar', () => ({
  FacetSidebar: ({
    selectedClusters,
    selectedTags,
  }: {
    selectedClusters: string[]
    selectedTags: string[]
  }) => (
    <div>
      Sidebar clusters:{selectedClusters.join('|')} tags:
      {selectedTags.join('|')}
    </div>
  ),
}))

vi.mock('@/components/search/FacetBadge', () => ({
  FacetBadge: ({
    activeCount,
    floating,
    onClick,
  }: {
    activeCount: number
    floating?: boolean
    onClick: () => void
  }) => (
    <button type="button" onClick={onClick}>
      Facet badge {activeCount} {floating ? 'floating' : 'inline'}
    </button>
  ),
}))

vi.mock('@/components/search/MobileFilterSheet', () => ({
  MobileFilterSheet: ({
    open,
    selectedClusters,
    selectedTags,
  }: {
    open: boolean
    selectedClusters: string[]
    selectedTags: string[]
  }) => (
    <div>
      Mobile Filter Sheet {open ? 'open' : 'closed'} clusters:
      {selectedClusters.join('|')} tags:{selectedTags.join('|')}
    </div>
  ),
}))

vi.mock('@/components/search/AiSummaryPanel', () => ({
  AiSummaryPanel: ({
    generatedAt,
    loading,
    summary,
  }: {
    generatedAt?: number
    loading?: boolean
    summary?: string
  }) => (
    <div>
      AI Summary {summary ?? 'none'} generated:{generatedAt ?? 'none'} loading:
      {String(loading)}
    </div>
  ),
}))

vi.mock('@/components/search/SearchResultsList', () => ({
  SearchResultsList: ({
    expandedIds,
    hasMore,
    items,
    loading,
    loadingMore,
    showAiScore,
    onLoadMore,
    onToggleExpanded,
  }: {
    expandedIds: Set<string>
    hasMore: boolean
    items: ResumeSearchResultItem[]
    loading?: boolean
    loadingMore?: boolean
    showAiScore?: boolean
    onLoadMore: () => void
    onToggleExpanded: (key: string) => void
  }) => (
    <div>
      <div>
        Results List {items.length} hasMore:{String(hasMore)} loading:
        {String(loading)} loadingMore:{String(loadingMore)} showAiScore:
        {String(showAiScore)} expanded:{Array.from(expandedIds).join('|') || 'none'}
      </div>
      {items[0] ? (
        <button type="button" onClick={() => onToggleExpanded(items[0].key)}>
          Toggle first result
        </button>
      ) : null}
      {items[1] ? (
        <button type="button" onClick={() => onToggleExpanded(items[1].key)}>
          Toggle second result
        </button>
      ) : null}
      <button type="button" onClick={onLoadMore}>
        Load more results
      </button>
    </div>
  ),
}))

vi.mock('@/components/AnalysisTaskMonitor', () => ({
  AnalysisTaskMonitor: () => <div>Analysis Task Monitor</div>,
}))

vi.mock('@/components/ModeToggle', () => ({
  ModeToggle: ({
    aiStats,
    mode,
    onModeChange,
  }: {
    aiStats?: { avgScore: number; matched: number; processed?: number }
    mode: 'ai' | 'original'
    onModeChange: (mode: 'ai' | 'original') => void
  }) => (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-label="AI Mode"
        aria-checked={mode === 'ai'}
        onClick={() => onModeChange(mode === 'ai' ? 'original' : 'ai')}
      >
        {mode === 'ai' ? 'On' : 'Off'}
      </button>
      <span>AI Mode</span>
      {mode === 'ai' && aiStats ? <span>{aiStats.matched}</span> : null}
    </div>
  ),
}))

vi.mock('@/components/BulkActionBar', () => ({
  BulkActionBar: ({
    onExportFormatChange,
    onBulkAction,
    exportFormat,
    highScoreCount,
    selectedCount,
    totalCount,
  }: {
    onExportFormatChange?: (format: string) => void
    onBulkAction?: (action: string, format?: string) => void
    exportFormat?: string
    highScoreCount?: number
    selectedCount?: number
    totalCount?: number
  }) => (
    <div>
      <div>BulkActionBar {selectedCount}/{totalCount} high:{highScoreCount} fmt:{exportFormat}</div>
      {onExportFormatChange && (
        <button type="button" onClick={() => onExportFormatChange('xlsx')}>
          Change Export Format
        </button>
      )}
      {onBulkAction && (
        <button type="button" onClick={() => onBulkAction('export', exportFormat)}>
          Bulk Export
        </button>
      )}
    </div>
  ),
}))

function createResume(index: number): ConvexResumeItem {
  return {
    resumeId: `resume-${index}` as ConvexResumeItem['resumeId'],
    externalId: `resume-${index}`,
    name: `Candidate ${index}`,
    profileUrl: '',
    activityStatus: '',
    age: '',
    ageNumber: 30,
    experience: '5 years',
    education: 'Bachelor',
    location: 'Kuala Lumpur',
    extractedAt: new Date().toISOString(),
    expectedSalary: '',
    jobIntention: '',
    selfIntro: '',
    skills: [],
    workHistory: [],
    source: 'seek',
    crawledAt: Date.now(),
    tags: [],
    ingestData: {
      industryTags: ['Machine Tools'],
      synonymHits: [],
      brandHits: [],
      companyHits: ['FANUC'],
      ruleScores: {},
      experienceLevel: 'senior',
      computedAt: Date.now(),
      skillsVersion: 1,
    },
  }
}

function createResult(index: number): ResumeSearchResultItem {
  return {
    key: `resume-${index}`,
    identityKey: `identity-${index}`,
    blocked: false,
    score: 80 + index,
    status: 'new',
    resume: createResume(index),
  }
}

function createParsedState(
  overrides: Partial<UrlSearchState> = {},
): UrlSearchState {
  return {
    query: undefined,
    location: undefined,
    keywords: [],
    requiredKeywords: [],
    jobDescriptionId: undefined,
    selectedTags: [],
    selectedCompanies: [],
    selectedSources: [],
    selectedBrands: [],
    selectedExperienceLevel: undefined,
    filters: {},
    ...overrides,
  }
}

function createResumeSearchState(overrides: Record<string, unknown> = {}) {
  return {
    activeQuery: undefined,
    activeSort: 'score',
    analysisCandidateCount: 0,
    analyzeResults: vi.fn(),
    aiModeEnabled: true,
    aiModeStats: undefined,
    analyzingResults: false,
    applyRecentSearch: vi.fn(),
    clearFacetFilters: vi.fn(),
    clearSearch: vi.fn(),
    disableAnalyzeResults: true,
    exportFormat: 'csv',
    exportingResults: false,
    exportResults: vi.fn(),
    facetCounts: {
      clusters: [],
      tags: [],
      companies: [],
      experienceLevels: [],
      education: [],
      statuses: [],
      minScoreOptions: [],
      sources: [],
    },
    filterCount: 0,
    filteredResults: [] as ResumeSearchResultItem[],
    hasMore: false,
    hasActiveAnalysisTask: false,
    isLanding: true,
    loading: false,
    loadingMore: false,
    loadMore: vi.fn(),
    parsedState: createParsedState(),
    queryInput: '',
    recentSearches: [],
    searchHistoryLoading: false,
    selectedClusterTags: [] as string[],
    selectedRawTags: [] as string[],
    setAiModeEnabled: vi.fn(),
    setExportFormat: vi.fn(),
    setMinScoreFilter: vi.fn(),
    setMinRoleYearsFilter: vi.fn(),
    setQueryInput: vi.fn(),
    setSelectedExperienceLevel: vi.fn(),
    setSort: vi.fn(),
    submitSearch: vi.fn(),
    taxonomyClusters: [] as Array<{
      name: string
      slug: string
      tags: string[]
      parentSlug?: string
    }>,
    toggleCompany: vi.fn(),
    toggleCluster: vi.fn(),
    toggleEducation: vi.fn(),
    toggleStatus: vi.fn(),
    toggleTag: vi.fn(),
    setSelectedCompanies: vi.fn(),
    setSelectedTags: vi.fn(),
    selectedIds: new Set<string>(),
    selectAll: vi.fn(),
    selectHighScore: vi.fn(),
    clearSelection: vi.fn(),
    toggleSelectItem: vi.fn(),
    actionsByResume: {},
    getAiFeedback: vi.fn(),
    handleBulkAction: vi.fn(),
    handleCandidateAction: vi.fn(),
    handleCandidateStatusChange: vi.fn(),
    handleToggleBlock: vi.fn(),
    highScoreCount: 0,
    ...overrides,
  }
}

describe('ResumeSearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    featureFlagsMock.resumeAiSummaryEnabled = false
    useIndustryKeywordsMock.mockReturnValue({
      hotKeywords: [],
      quickStartProfiles: [],
    })
    useAiSearchSummaryMock.mockReturnValue({
      generatedAt: undefined,
      loading: false,
      summary: undefined,
    })
  })

  it('renders the landing hero and routes extracted JD keywords into canonical search state', async () => {
    const user = userEvent.setup()
    const state = createResumeSearchState({
      queryInput: 'machine tools',
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    expect(screen.getByText('Landing Hero machine tools')).toBeInTheDocument()
    expect(screen.getByText('Landing Hero Seeds 0 Hot 0')).toBeInTheDocument()
    expect(screen.getByText('AI Mode')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'AI Mode' })).toBeChecked()
    expect(screen.queryByText(/Header /)).not.toBeInTheDocument()
    expect(screen.queryByText(/Results List/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply Hero JD' }))

    const expectedQuery = formatKeywordQuery([
      'Machine Tools',
      'Business Development',
    ])
    expect(state.setQueryInput).toHaveBeenCalledWith(expectedQuery)
    expect(state.submitSearch).toHaveBeenCalledWith(expectedQuery)

    await user.click(screen.getByRole('switch', { name: 'AI Mode' }))
    expect(state.setAiModeEnabled).toHaveBeenCalledWith(false)
  })

  it('wires profile quick-start and hot keyword handlers into the landing hero', async () => {
    const user = userEvent.setup()
    const state = createResumeSearchState({
      queryInput: 'machine tools',
    })
    useResumeSearchStateMock.mockReturnValue(state)
    useIndustryKeywordsMock.mockReturnValue({
      hotKeywords: [{ id: 'hot-1', keyword: 'CNC' }],
      quickStartProfiles: [
        {
          id: 'profile-1',
          label: 'Malaysia · SEEK · CNC Sales',
          market: 'MY',
          location: 'Kuala Lumpur MY',
          keywords: ['CNC', 'Sales'],
          quickStart: {
            enabled: true,
          },
        },
      ],
    })

    render(<ResumeSearchPage />)

    expect(screen.getByText('Landing Hero Seeds 1 Hot 1')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Apply Hero Quick Start' }),
    )
    expect(state.setQueryInput).toHaveBeenCalledWith(
      formatKeywordQuery(['CNC', 'Sales']),
    )
    expect(state.submitSearch).toHaveBeenCalledWith(
      formatKeywordQuery(['CNC', 'Sales']),
      { location: 'Kuala Lumpur MY' },
    )

    await user.click(
      screen.getByRole('button', { name: 'Toggle Hero Hot Keyword' }),
    )
    expect(state.setQueryInput).toHaveBeenCalledWith(
      formatKeywordQuery(['machine', 'tools', 'CNC']),
    )
  })

  it('forwards quick-start role-year constraints into submitSearch', async () => {
    const user = userEvent.setup()
    const state = createResumeSearchState({
      queryInput: 'machine tools',
    })
    useResumeSearchStateMock.mockReturnValue(state)
    useIndustryKeywordsMock.mockReturnValue({
      hotKeywords: [],
      quickStartProfiles: [
        {
          id: 'profile-1',
          label: 'Malaysia · SEEK · CNC Sales',
          market: 'MY',
          location: 'Kuala Lumpur MY',
          keywords: ['CNC', 'Sales'],
          quickStart: {
            enabled: true,
          },
        },
      ],
    })

    render(<ResumeSearchPage />)

    await user.click(
      screen.getByRole('button', { name: 'Apply Hero Quick Start Role Years' }),
    )

    expect(state.submitSearch).toHaveBeenCalledWith(
      formatKeywordQuery(['CNC', 'Sales']),
      {
        location: 'Kuala Lumpur MY',
        minRoleYears: 3,
        roleFilterType: 'sales',
        minAge: 25,
        maxAge: 40,
      },
    )
  })

  it('renders the active results shell, maps cluster names for AI summary, and opens the mobile filter sheet from the badge', async () => {
    const user = userEvent.setup()
    featureFlagsMock.resumeAiSummaryEnabled = true
    const state = createResumeSearchState({
      activeQuery: 'machine tools',
      aiModeStats: {
        avgScore: 88.5,
        matched: 1,
        processed: 2,
      },
      filterCount: 3,
      filteredResults: [createResult(1), createResult(2)],
      isLanding: false,
      parsedState: createParsedState({
        jobDescriptionId: 'jd-1',
        location: 'Kuala Lumpur',
        selectedCompanies: ['FANUC'],
        selectedExperienceLevel: 'senior',
        selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
        filters: {
          education: ['Bachelor'],
          minMatchScore: 80,
          status: ['contacted'],
        },
      }),
      queryInput: 'machine tools',
      selectedClusterTags: ['manufacturing-systems'],
      selectedRawTags: ['Machine Tools'],
      taxonomyClusters: [
        {
          name: 'Manufacturing Systems',
          slug: 'manufacturing-systems',
          tags: ['Machine Tools'],
        },
      ],
    })
    useResumeSearchStateMock.mockReturnValue(state)
    useAiSearchSummaryMock.mockReturnValue({
      generatedAt: 123,
      loading: false,
      summary: 'Summary text',
    })

    render(<ResumeSearchPage />)

    expect(screen.queryByText(/Landing Hero/)).not.toBeInTheDocument()
    expect(
      screen.getByText(/Header machine tools 2/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Results List 2 hasMore:false loading:false loadingMore:false showAiScore:true expanded:none',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Sidebar clusters:manufacturing-systems tags:Machine Tools',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Mobile Filter Sheet closed clusters:manufacturing-systems tags:Machine Tools',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('AI Summary Summary text generated:123 loading:false'),
    ).toBeInTheDocument()
    expect(screen.getByText('Resume AI analysis')).toBeInTheDocument()
    expect(screen.getByText('AI Mode')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'AI Mode' })).toBeChecked()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Analysis Task Monitor')).toBeInTheDocument()

    expect(useAiSearchSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'machine tools',
        location: 'Kuala Lumpur',
        jobDescriptionId: 'jd-1',
        selectedCompanies: ['FANUC'],
        selectedExperienceLevel: 'senior',
        selectedTags: ['Machine Tools', 'Manufacturing Systems'],
        results: state.filteredResults,
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Apply Header JD' }))
    const expectedQuery = formatKeywordQuery([
      'Machine Tools',
      'Business Development',
    ])
    expect(state.setQueryInput).toHaveBeenCalledWith(expectedQuery)
    expect(state.submitSearch).toHaveBeenCalledWith(expectedQuery)

    await user.click(
      screen.getByRole('button', { name: 'Facet badge 3 inline' }),
    )
    expect(
      screen.getByText(
        'Mobile Filter Sheet open clusters:manufacturing-systems tags:Machine Tools',
      ),
    ).toBeInTheDocument()
  })

  it('falls back to cluster slugs for AI summary tags and preserves local result-shell state interactions', async () => {
    const user = userEvent.setup()
    featureFlagsMock.resumeAiSummaryEnabled = true
    const state = createResumeSearchState({
      activeQuery: 'servo automation',
      filteredResults: [createResult(1), createResult(2)],
      hasMore: true,
      isLanding: false,
      loadingMore: true,
      loadMore: vi.fn(),
      parsedState: createParsedState({
        selectedTags: ['Machine Tools', 'cluster:unknown-cluster'],
      }),
      queryInput: 'servo automation',
      selectedClusterTags: ['unknown-cluster'],
      selectedRawTags: ['Machine Tools'],
      taxonomyClusters: [],
    })
    useResumeSearchStateMock.mockReturnValue(state)
    useAiSearchSummaryMock.mockReturnValue({
      generatedAt: undefined,
      loading: true,
      summary: undefined,
    })

    render(<ResumeSearchPage />)

    expect(
      screen.getByText('AI Summary none generated:none loading:true'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Results List 2 hasMore:true loading:false loadingMore:true showAiScore:true expanded:none',
      ),
    ).toBeInTheDocument()
    expect(useAiSearchSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'servo automation',
        selectedTags: ['Machine Tools', 'unknown-cluster'],
        results: state.filteredResults,
      }),
    )

    await user.click(
      screen.getByRole('button', { name: 'Toggle first result' }),
    )
    expect(
      screen.getByText(
        'Results List 2 hasMore:true loading:false loadingMore:true showAiScore:true expanded:resume-1',
      ),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Toggle second result' }),
    )
    expect(
      screen.getByText(
        'Results List 2 hasMore:true loading:false loadingMore:true showAiScore:true expanded:resume-2',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply Header JD' }))
    expect(
      screen.getByText(
        'Results List 2 hasMore:true loading:false loadingMore:true showAiScore:true expanded:none',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load more results' }))
    expect(state.loadMore).toHaveBeenCalledTimes(1)
  })

  it('hides the AI summary panel when the dedicated summary feature flag is off', () => {
    const state = createResumeSearchState({
      activeQuery: 'CNC Sales',
      filteredResults: [createResult(1)],
      isLanding: false,
    })
    useResumeSearchStateMock.mockReturnValue(state)
    useAiSearchSummaryMock.mockReturnValue({
      generatedAt: 123,
      loading: false,
      summary: 'Summary text',
    })

    render(<ResumeSearchPage />)

    expect(
      screen.queryByText('AI Summary Summary text generated:123 loading:false'),
    ).not.toBeInTheDocument()
  })

  it('wires header export controls into the search-state actions', async () => {
    const user = userEvent.setup()
    const state = createResumeSearchState({
      activeQuery: 'CNC Sales',
      filteredResults: [createResult(1)],
      isLanding: false,
      selectedIds: new Set<string>(['resume-1']),
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    await user.click(
      screen.getByRole('button', { name: 'Change Export Format' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Bulk Export' }),
    )

    expect(state.setExportFormat).toHaveBeenCalledWith('xlsx')
    expect(state.handleBulkAction).toHaveBeenCalledWith('export', 'csv')
  })

  it('wires the search-first analyze action into the page controls', async () => {
    const user = userEvent.setup()
    const state = createResumeSearchState({
      activeQuery: 'CNC Sales',
      analysisCandidateCount: 2,
      analyzeResults: vi.fn(),
      disableAnalyzeResults: false,
      filteredResults: [createResult(1)],
      hasActiveAnalysisTask: false,
      isLanding: false,
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    await user.click(screen.getByRole('button', { name: /Analyze loaded 2/i }))

    expect(state.analyzeResults).toHaveBeenCalledTimes(1)
  })

  it('wires the AI mode toggle and keeps the analyze button disabled while original mode is selected', async () => {
    const user = userEvent.setup()
    const state = createResumeSearchState({
      activeQuery: 'CNC Sales',
      analysisCandidateCount: 2,
      aiModeEnabled: false,
      aiModeStats: {
        avgScore: 90,
        matched: 2,
        processed: 4,
      },
      disableAnalyzeResults: false,
      filteredResults: [createResult(1)],
      isLanding: false,
      setAiModeEnabled: vi.fn(),
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    expect(
      screen.getByText('AI Mode'),
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'AI Mode' })).not.toBeChecked()

    const analyzeButton = screen.getByRole('button', {
      name: /Analyze loaded 2/i,
    })
    expect(analyzeButton).toBeDisabled()

    await user.click(screen.getByRole('switch', { name: 'AI Mode' }))

    expect(state.setAiModeEnabled).toHaveBeenCalledWith(true)
    expect(state.analyzeResults).not.toHaveBeenCalled()
  })
})
