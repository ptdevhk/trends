import React from 'react'
import { formatKeywordQuery } from '@trends/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeSearchPage } from './ResumeSearchPage'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { AuthUser, WorkspaceMembership, WorkspaceRole } from '@/lib/auth'
import type { UrlSearchState } from '@/hooks/useUrlSearchState'

type AuthMockValue = {
  user: AuthUser | null
  workspaceRole: WorkspaceRole | null
  memberships?: WorkspaceMembership[]
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const mockT = (key: string, options?: string | Record<string, unknown>) => {
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
    'resumes.searchPage.readOnly.loginRequired': 'Sign in to rate, update status, add notes, block, export, or run bulk actions.',
  }
  const text = englishTexts[key] ?? key
  return text.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
    const value = options && typeof options === 'object' ? options[token] : undefined
    return value === undefined || value === null ? '' : String(value)
  })
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

const {
  apiGetMock,
  apiPostMock,
  shareLinkButtonPropsMock,
  useIndustryKeywordsMock,
  useAiSearchSummaryMock,
  useResumeSearchStateMock,
} = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  shareLinkButtonPropsMock: vi.fn(),
  useIndustryKeywordsMock: vi.fn(),
  useAiSearchSummaryMock: vi.fn(),
  useResumeSearchStateMock: vi.fn(),
}))

const featureFlagsMock = vi.hoisted(() => ({
  resumeAiSummaryEnabled: false,
  industryEvidenceTargetedQueueEnabled: false,
  reviewPacketsEnabled: false,
}))

const routeMock = vi.hoisted(() => ({
  search: '',
  params: {} as { resumeId?: string },
  navigate: vi.fn(),
  workspaceSlug: 'dev',
  isPublicSurface: false,
}))

const authMock = vi.hoisted((): { value: AuthMockValue } => ({
  value: {
    user: { id: 'user-1', displayName: 'Tester', status: 'active' },
    workspaceRole: 'user',
    memberships: [],
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(async () => true),
    logout: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  },
}))

vi.mock('@/lib/feature-flags', () => ({
  isResumeAiSummaryEnabled: () => featureFlagsMock.resumeAiSummaryEnabled,
  isIndustryEvidenceTargetedQueueEnabled: () => featureFlagsMock.industryEvidenceTargetedQueueEnabled,
  isReviewPacketsEnabled: () => featureFlagsMock.reviewPacketsEnabled,
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authMock.value,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    slug: routeMock.workspaceSlug,
    isPublicSurface: routeMock.isPublicSurface,
  }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => apiGetMock(...args),
    POST: (...args: unknown[]) => apiPostMock(...args),
  },
}))

vi.mock('@/components/ShareLinkButton', () => ({
  ShareLinkButton: (props: {
    shareTitle: string
    state: unknown
    createPublicShare?: (options: {
      shareTitle: string
      searchState: unknown
    }) => Promise<unknown>
  }) => {
    shareLinkButtonPropsMock(props)
    return (
      <button
        type="button"
        onClick={() => {
          void props.createPublicShare?.({
            shareTitle: props.shareTitle,
            searchState: props.state,
          })
        }}
      >
        Create public share
      </button>
    )
  },
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
  useLocation: () => ({ search: routeMock.search }),
  useNavigate: () => routeMock.navigate,
  useParams: () => routeMock.params,
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
    activeResultCountIsLowerBound,
    exportFormat,
    exportingResults,
    onApplyExtractedKeywords,
    onExportFormatChange,
    onExportResults,
  }: {
    activeQuery?: string
    activeResultCount: number
    activeResultCountIsLowerBound?: boolean
    exportFormat?: string
    exportingResults?: boolean
    onApplyExtractedKeywords: (keywords: string[]) => void
    onExportFormatChange?: (format: string) => void
    onExportResults?: () => void
  }) => (
    <div>
      <div>
        Header {activeQuery} {activeResultCount}{activeResultCountIsLowerBound ? '+' : ''} export:{exportFormat} exporting:
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
    detailResumeId,
    expandedIds,
    hasMore,
    items,
    loading,
    loadingMore,
    showAiScore,
    verifiedOnlyNotice,
    verifiedOnlyReviewHref,
    onAction,
    onCandidateStatusChange,
    onCloseDetail,
    onLoadMore,
    onOpenDetail,
    onRating,
    onToggleExpanded,
    onToggleSelect,
    onToggleBlock,
  }: {
    expandedIds: Set<string>
    hasMore: boolean
    items: ResumeSearchResultItem[]
    loading?: boolean
    loadingMore?: boolean
    showAiScore?: boolean
    detailResumeId?: string
    verifiedOnlyNotice?: {
      minRoleYears?: number
      roleFilterType?: string | null
      verifiedEmployerCount?: number
      evidenceMode?: 'legacy-seed' | 'strict-reviewed'
    }
    verifiedOnlyReviewHref?: string
    onAction?: () => void
    onCandidateStatusChange?: () => void
    onCloseDetail?: () => void
    onLoadMore: () => void
    onOpenDetail?: (item: ResumeSearchResultItem) => void
    onRating?: () => void
    onToggleExpanded: (key: string) => void
    onToggleSelect?: () => void
    onToggleBlock?: () => void
  }) => (
    <div>
      <div>
        Results List {items.length} hasMore:{String(hasMore)} loading:
        {String(loading)} loadingMore:{String(loadingMore)} showAiScore:
        {String(showAiScore)} expanded:{Array.from(expandedIds).join('|') || 'none'}
      </div>
      <div>VerifiedOnlyNotice: {JSON.stringify(verifiedOnlyNotice ?? null)}</div>
      <div>VerifiedOnlyReviewHref: {verifiedOnlyReviewHref ?? 'none'}</div>
      <div>Detail route: {detailResumeId ?? 'none'}</div>
      <div>Detail routing: {String(Boolean(onOpenDetail && onCloseDetail))}</div>
      <div>
        Result controls action:{String(Boolean(onAction))} rating:
        {String(Boolean(onRating))} status:
        {String(Boolean(onCandidateStatusChange))} block:
        {String(Boolean(onToggleBlock))} select:
        {String(Boolean(onToggleSelect))}
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
      {items[0] && onOpenDetail ? (
        <button type="button" onClick={() => onOpenDetail(items[0])}>
          Open first detail
        </button>
      ) : null}
      {detailResumeId && onCloseDetail ? (
        <button type="button" onClick={onCloseDetail}>
          Close routed detail
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
    disabled,
    selectedCount,
    totalCount,
    totalCountIsLowerBound,
  }: {
    onExportFormatChange?: (format: string) => void
    onBulkAction?: (action: string, format?: string) => void
    exportFormat?: string
    highScoreCount?: number
    disabled?: boolean
    selectedCount?: number
    totalCount?: number
    totalCountIsLowerBound?: boolean
  }) => (
    <div>
      <div>BulkActionBar {selectedCount}/{totalCount}{totalCountIsLowerBound ? '+' : ''} high:{highScoreCount} fmt:{exportFormat} disabled:{String(Boolean(disabled))}</div>
      {onExportFormatChange && (
        <button type="button" disabled={disabled} onClick={() => onExportFormatChange('xlsx')}>
          Change Export Format
        </button>
      )}
      {onBulkAction && (
        <button type="button" disabled={disabled} onClick={() => onBulkAction('export', exportFormat)}>
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
    analysisKeywords: [],
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
    sessionKey: 'search-session-1',
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
    replaceSelection: vi.fn(),
    pruneSelection: vi.fn(),
    clearSelection: vi.fn(),
    toggleSelectItem: vi.fn(),
    actionsByResume: {},
    ratingsByResume: {},
    commentsByResume: {},
    overridesByKey: {},
    setOverride: vi.fn(async () => true),
    removeOverride: vi.fn(async () => true),
    getAiFeedback: vi.fn(),
    handleBulkAction: vi.fn(),
    handleCandidateAction: vi.fn(),
    handleRating: vi.fn(),
    handleRatingComment: vi.fn(),
    handleCandidateStatusChange: vi.fn(),
    handleToggleBlock: vi.fn(),
    highScoreCount: 0,
    ...overrides,
  }
}

describe('ResumeSearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiPostMock.mockResolvedValue({
      data: {
        success: true,
        share: {
          publicPath: '/s/public-token-1',
        },
      },
    })
    apiGetMock.mockResolvedValue({
      data: { success: true, count: 128, evidenceMode: 'legacy-seed' },
      response: { status: 200 },
    })
    featureFlagsMock.resumeAiSummaryEnabled = false
    routeMock.search = ''
    routeMock.params = {}
    routeMock.navigate.mockReset()
    routeMock.workspaceSlug = 'dev'
    routeMock.isPublicSurface = false
    authMock.value = {
      user: { id: 'user-1', displayName: 'Tester', status: 'active' },
      workspaceRole: 'user',
      memberships: [],
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(async () => true),
      logout: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    }
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

  it('navigates from a search result to a routed resume detail while preserving the search query', async () => {
    const user = userEvent.setup()
    routeMock.search = '?location=Malaysia&q=CNC'
    routeMock.workspaceSlug = 'hr'
    const state = createResumeSearchState({
      activeQuery: 'CNC',
      filteredResults: [createResult(1)],
      isLanding: false,
      parsedState: createParsedState({ location: 'Malaysia', query: 'CNC' }),
      queryInput: 'CNC',
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    await user.click(screen.getByRole('button', { name: 'Open first detail' }))

    expect(routeMock.navigate).toHaveBeenCalledWith({
      pathname: '/hr/resumes/resume-1',
      search: '?location=Malaysia&q=CNC',
    })
  })

  it('closes a routed resume detail back to the parent search URL', async () => {
    const user = userEvent.setup()
    routeMock.search = '?location=Malaysia&q=CNC'
    routeMock.params = { resumeId: 'resume-1' }
    useResumeSearchStateMock.mockReturnValue(createResumeSearchState({
      activeQuery: 'CNC',
      filteredResults: [createResult(1)],
      isLanding: false,
      parsedState: createParsedState({ location: 'Malaysia', query: 'CNC' }),
      queryInput: 'CNC',
    }))

    render(<ResumeSearchPage />)

    expect(screen.getByText('Detail route: resume-1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close routed detail' }))

    expect(routeMock.navigate).toHaveBeenCalledWith(
      { pathname: '/dev/resumes', search: '?location=Malaysia&q=CNC' },
      { replace: true },
    )
  })

  it('keeps the public resumes surface on local detail behavior', () => {
    routeMock.search = '?location=Malaysia&q=CNC'
    routeMock.params = {}
    routeMock.isPublicSurface = true
    useResumeSearchStateMock.mockReturnValue(createResumeSearchState({
      activeQuery: 'CNC',
      filteredResults: [createResult(1)],
      isLanding: false,
      parsedState: createParsedState({ location: 'Malaysia', query: 'CNC' }),
      queryInput: 'CNC',
    }))

    render(<ResumeSearchPage />)

    expect(screen.getByText('Detail routing: false')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open first detail' })).not.toBeInTheDocument()
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

  it('marks the active result count as a lower bound when more search pages exist', () => {
    useResumeSearchStateMock.mockReturnValue(createResumeSearchState({
      activeQuery: 'machine tools',
      filteredResults: [createResult(1), createResult(2)],
      hasMore: true,
      isLanding: false,
      parsedState: createParsedState(),
      queryInput: 'machine tools',
    }))

    render(<ResumeSearchPage />)

    expect(screen.getByText(/Header machine tools 2\+/)).toBeInTheDocument()
    expect(screen.getByText(/BulkActionBar 0\/2\+/)).toBeInTheDocument()
  })

  it('keeps the sticky bulk bar below the app header', () => {
    const { container } = render(<ResumeSearchPage />)

    expect(container.querySelector('.sticky.top-14')).toBeInTheDocument()
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

  it('keeps anonymous search results read-only and blocks bulk/export candidate operations', async () => {
    const user = userEvent.setup()
    authMock.value = {
      user: null,
      workspaceRole: null,
      memberships: [],
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(async () => false),
      logout: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    }
    const state = createResumeSearchState({
      activeQuery: 'CNC Sales',
      analysisCandidateCount: 1,
      disableAnalyzeResults: false,
      filteredResults: [createResult(1)],
      highScoreCount: 1,
      isLanding: false,
      selectedIds: new Set<string>(['resume-1']),
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    expect(
      screen.getByRole('status', {
        name: 'Sign in to rate, update status, add notes, block, export, or run bulk actions.',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Result controls action:false rating:false status:false block:false select:false',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/BulkActionBar 1\/1 high:1 fmt:csv disabled:true/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Change Export Format' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bulk Export' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /Analyze loaded 1/i }),
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Bulk Export' }))
    await user.click(screen.getByRole('button', { name: /Analyze loaded 1/i }))

    expect(state.setExportFormat).not.toHaveBeenCalled()
    expect(state.handleBulkAction).not.toHaveBeenCalled()
    expect(state.analyzeResults).not.toHaveBeenCalled()
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

  it('creates a public share from all loaded filtered search results', async () => {
    const user = userEvent.setup()
    const filteredResults = Array.from({ length: 101 }, (_, index) => createResult(index + 1))
    const state = createResumeSearchState({
      activeQuery: 'CNC 销售',
      filteredResults,
      isLanding: false,
      parsedState: createParsedState({
        query: 'CNC 销售',
        location: 'China',
        keywords: ['CNC', '销售'],
        filters: {
          minRoleYears: 1,
          roleFilterType: 'sales',
          minAge: 25,
          maxAge: 40,
        },
      }),
      queryInput: 'CNC 销售',
      sessionKey: 'session-china-cnc',
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    expect(shareLinkButtonPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shareTitle: 'China · CNC 销售',
        state: expect.objectContaining({
          location: 'China',
          keywords: ['CNC', '销售'],
          filters: expect.objectContaining({
            minRoleYears: 1,
            roleFilterType: 'sales',
            minAge: 25,
            maxAge: 40,
          }),
        }),
        createPublicShare: expect.any(Function),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Create public share' }))

    expect(apiPostMock).toHaveBeenCalledWith('/api/public-shares', {
      body: expect.objectContaining({
        title: 'China · CNC 销售',
        sessionId: 'session-china-cnc',
        search: {
          query: 'CNC 销售 China',
          filters: {
            locations: ['China'],
            minRoleYears: 1,
            roleFilterType: 'sales',
            minAge: 25,
            maxAge: 40,
          },
        },
        results: expect.any(Array),
      }),
    })
    const request = apiPostMock.mock.calls[0]?.[1] as { body: { results: Array<Record<string, unknown>> } } | undefined
    expect(request?.body.results).toHaveLength(101)
    expect(request?.body.results[0]).toMatchObject({
      resumeKey: 'identity-1',
      displayName: 'Candidate 1',
    })
    expect(request?.body.results[100]).toMatchObject({
      resumeKey: 'identity-101',
      displayName: 'Candidate 101',
    })
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

  it('passes the verified-only notice props when a role gate filter is active and the count loads', async () => {
    const state = createResumeSearchState({
      activeQuery: 'CNC Sales',
      filteredResults: [createResult(1)],
      isLanding: false,
      parsedState: createParsedState({
        filters: {
          minRoleYears: 3,
          roleFilterType: 'sales',
        },
      }),
      queryInput: 'CNC Sales',
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    // The count may come from the hook's 60s module cache (populated by an
    // earlier test in this file) or from this mount's fetch — either way the
    // notice props must carry the loaded count.
    await waitFor(() => {
      const notice = screen.getByText(/VerifiedOnlyNotice/)
      expect(notice).toHaveTextContent('"minRoleYears":3')
      expect(notice).toHaveTextContent('"roleFilterType":"sales"')
      expect(notice).toHaveTextContent('"verifiedEmployerCount":128')
      expect(notice).toHaveTextContent('"evidenceMode":"legacy-seed"')
    })
  })

  it('passes no verified-only notice on the public share surface', async () => {
    routeMock.isPublicSurface = true
    const state = createResumeSearchState({
      activeQuery: 'CNC Sales',
      filteredResults: [createResult(1)],
      isLanding: false,
      parsedState: createParsedState({
        filters: { minRoleYears: 3 },
      }),
      queryInput: 'CNC Sales',
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    await waitFor(() => {
      expect(screen.getByText(/VerifiedOnlyNotice/)).toHaveTextContent('null')
    })
    expect(apiGetMock).not.toHaveBeenCalledWith('/api/company-industry-verified-employer-count')
  })

  it('passes the review inbox href for a workspace reviewer', async () => {
    authMock.value = {
      user: { id: 'user-1', displayName: 'Tester', status: 'active' },
      workspaceRole: 'reviewer',
      memberships: [{ userId: 'user-1', workspaceSlug: 'dev', role: 'reviewer' }],
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(async () => true),
      logout: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    }
    const state = createResumeSearchState({
      filteredResults: [createResult(1)],
      isLanding: false,
      parsedState: createParsedState({
        filters: { minRoleYears: 3 },
      }),
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    await waitFor(() => {
      expect(screen.getByText(/VerifiedOnlyReviewHref/)).toHaveTextContent(
        '/dev/system/settings/industry-verification?status=ready_for_review',
      )
    })
  })

  it('passes the review inbox href for a workspace admin', async () => {
    authMock.value = {
      user: { id: 'user-1', displayName: 'Tester', status: 'active' },
      workspaceRole: 'admin',
      memberships: [{ userId: 'user-1', workspaceSlug: 'dev', role: 'admin' }],
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(async () => true),
      logout: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    }
    const state = createResumeSearchState({
      filteredResults: [createResult(1)],
      isLanding: false,
      parsedState: createParsedState({
        filters: { minRoleYears: 3 },
      }),
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    await waitFor(() => {
      expect(screen.getByText(/VerifiedOnlyReviewHref/)).toHaveTextContent(
        '/dev/system/settings/industry-verification?status=ready_for_review',
      )
    })
  })

  it('omits the review inbox href for a plain workspace member', async () => {
    const state = createResumeSearchState({
      filteredResults: [createResult(1)],
      isLanding: false,
      parsedState: createParsedState({
        filters: { minRoleYears: 3 },
      }),
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    await waitFor(() => {
      expect(screen.getByText(/VerifiedOnlyReviewHref/)).toHaveTextContent('none')
    })
  })

  it('omits the review inbox href on the public share surface even for a reviewer', async () => {
    routeMock.isPublicSurface = true
    authMock.value = {
      user: { id: 'user-1', displayName: 'Tester', status: 'active' },
      workspaceRole: 'reviewer',
      memberships: [{ userId: 'user-1', workspaceSlug: 'dev', role: 'reviewer' }],
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(async () => true),
      logout: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    }
    const state = createResumeSearchState({
      filteredResults: [createResult(1)],
      isLanding: false,
      parsedState: createParsedState({
        filters: { minRoleYears: 3 },
      }),
    })
    useResumeSearchStateMock.mockReturnValue(state)

    render(<ResumeSearchPage />)

    await waitFor(() => {
      expect(screen.getByText(/VerifiedOnlyReviewHref/)).toHaveTextContent('none')
    })
  })
})
