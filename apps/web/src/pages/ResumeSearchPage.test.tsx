import { formatKeywordQuery } from '@trends/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeSearchPage } from './ResumeSearchPage'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { UrlSearchState } from '@/hooks/useUrlSearchState'

const {
  useIndustryKeywordsMock,
  useAiSearchSummaryMock,
  useResumeSearchStateMock,
} = vi.hoisted(() => ({
  useIndustryKeywordsMock: vi.fn(),
  useAiSearchSummaryMock: vi.fn(),
  useResumeSearchStateMock: vi.fn(),
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

vi.mock('@/components/search/MigrationBanner', () => ({
  MigrationBanner: () => <div>Migration Banner</div>,
}))

vi.mock('@/components/search/SearchHero', () => ({
  SearchHero: ({
    hotKeywords,
    onApplyWorkflowSeed,
    onToggleHotKeyword,
    queryInput,
    onApplyExtractedKeywords,
    workflowSeeds,
  }: {
    hotKeywords?: Array<{ keyword: string }>
    onApplyWorkflowSeed?: (seed: {
      keywords: string[]
      location: string
    }) => void
    onToggleHotKeyword?: (keyword: string) => void
    queryInput: string
    onApplyExtractedKeywords: (keywords: string[]) => void
    workflowSeeds?: Array<{ label: string }>
  }) => (
    <div>
      <div>Landing Hero {queryInput}</div>
      <div>
        Landing Hero Seeds {workflowSeeds?.length ?? 0} Hot{' '}
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
          onApplyWorkflowSeed?.({
            keywords: ['CNC', 'Sales'],
            location: 'Kuala Lumpur MY',
          })
        }
      >
        Apply Hero Workflow Seed
      </button>
      <button type="button" onClick={() => onToggleHotKeyword?.('CNC')}>
        Toggle Hero Hot Keyword
      </button>
    </div>
  ),
}))

vi.mock('@/components/search/SearchHeader', () => ({
  SearchHeader: ({
    activeQuery,
    activeResultCount,
    onApplyExtractedKeywords,
  }: {
    activeQuery?: string
    activeResultCount: number
    onApplyExtractedKeywords: (keywords: string[]) => void
  }) => (
    <div>
      <div>
        Header {activeQuery} {activeResultCount}
      </div>
      <button
        type="button"
        onClick={() =>
          onApplyExtractedKeywords(['Machine Tools', 'Business Development'])
        }
      >
        Apply Header JD
      </button>
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
    onLoadMore,
    onToggleExpanded,
  }: {
    expandedIds: Set<string>
    hasMore: boolean
    items: ResumeSearchResultItem[]
    loading?: boolean
    loadingMore?: boolean
    onLoadMore: () => void
    onToggleExpanded: (key: string) => void
  }) => (
    <div>
      <div>
        Results List {items.length} hasMore:{String(hasMore)} loading:
        {String(loading)} loadingMore:{String(loadingMore)} expanded:
        {Array.from(expandedIds).join('|') || 'none'}
      </div>
      {items[0] ? (
        <button type="button" onClick={() => onToggleExpanded(items[0].key)}>
          Toggle first result
        </button>
      ) : null}
      <button type="button" onClick={onLoadMore}>
        Load more results
      </button>
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
    selectedExperienceLevel: undefined,
    filters: {},
    ...overrides,
  }
}

function createResumeSearchState(overrides: Record<string, unknown> = {}) {
  return {
    activeQuery: undefined,
    activeSort: 'relevance',
    applyRecentSearch: vi.fn(),
    clearFacetFilters: vi.fn(),
    clearSearch: vi.fn(),
    facetCounts: {
      clusters: [],
      tags: [],
      companies: [],
      experienceLevels: [],
      education: [],
      statuses: [],
      minScoreOptions: [],
    },
    filterCount: 0,
    filteredResults: [] as ResumeSearchResultItem[],
    hasMore: false,
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
    setMinScoreFilter: vi.fn(),
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
    ...overrides,
  }
}

describe('ResumeSearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useIndustryKeywordsMock.mockReturnValue({
      hotKeywords: [],
      workflowSeeds: [],
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

    expect(screen.getByText('Migration Banner')).toBeInTheDocument()
    expect(screen.getByText('Landing Hero machine tools')).toBeInTheDocument()
    expect(screen.getByText('Landing Hero Seeds 0 Hot 0')).toBeInTheDocument()
    expect(screen.queryByText(/Header /)).not.toBeInTheDocument()
    expect(screen.queryByText(/Results List/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply Hero JD' }))

    const expectedQuery = formatKeywordQuery([
      'Machine Tools',
      'Business Development',
    ])
    expect(state.setQueryInput).toHaveBeenCalledWith(expectedQuery)
    expect(state.submitSearch).toHaveBeenCalledWith(expectedQuery)
  })

  it('wires workflow seed and hot keyword handlers into the landing hero', async () => {
    const user = userEvent.setup()
    const state = createResumeSearchState({
      queryInput: 'machine tools',
    })
    useResumeSearchStateMock.mockReturnValue(state)
    useIndustryKeywordsMock.mockReturnValue({
      hotKeywords: [{ id: 'hot-1', keyword: 'CNC' }],
      workflowSeeds: [
        {
          id: 'workflow-1',
          label: 'Malaysia · SEEK · CNC Sales',
          market: 'MY',
          location: 'Kuala Lumpur MY',
          keywords: ['CNC', 'Sales'],
        },
      ],
    })

    render(<ResumeSearchPage />)

    expect(screen.getByText('Landing Hero Seeds 1 Hot 1')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Apply Hero Workflow Seed' }),
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

  it('renders the active results shell, maps cluster names for AI summary, and opens the mobile filter sheet from the badge', async () => {
    const user = userEvent.setup()
    const state = createResumeSearchState({
      activeQuery: 'machine tools',
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
    expect(screen.getByText('Header machine tools 2')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Results List 2 hasMore:false loading:false loadingMore:false expanded:none',
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
    const state = createResumeSearchState({
      activeQuery: 'servo automation',
      filteredResults: [createResult(1)],
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
        'Results List 1 hasMore:true loading:false loadingMore:true expanded:none',
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
        'Results List 1 hasMore:true loading:false loadingMore:true expanded:resume-1',
      ),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Toggle first result' }),
    )
    expect(
      screen.getByText(
        'Results List 1 hasMore:true loading:false loadingMore:true expanded:none',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load more results' }))
    expect(state.loadMore).toHaveBeenCalledTimes(1)
  })
})
