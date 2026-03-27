import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchHero } from '@/components/search/SearchHero'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

type SearchHeroProps = Parameters<typeof SearchHero>[0]

vi.mock('@/components/search/GoogleSearchBar', () => ({
  GoogleSearchBar: ({
    onApplyExtractedKeywords,
    onChange,
    onClear,
    loading,
    onSubmit,
    recentSearches,
    value,
  }: {
    onApplyExtractedKeywords: (keywords: string[]) => void
    onChange: (value: string) => void
    onClear: () => void
    loading?: boolean
    onSubmit: (value?: string) => void
    recentSearches: ResumeSearchRecentItem[]
    value: string
  }) => (
    <div>
      <div>
        Search Bar {value} {loading ? 'loading' : 'idle'}{' '}
        {recentSearches.length}
      </div>
      <button type="button" onClick={() => onChange('changed from hero bar')}>
        Change from hero bar
      </button>
      <button type="button" onClick={onClear}>
        Clear from hero bar
      </button>
      <button
        type="button"
        onClick={() => onApplyExtractedKeywords(['lathe', 'cnc'])}
      >
        Extract from hero bar
      </button>
      <button type="button" onClick={() => onSubmit('submitted')}>
        Submit from hero bar
      </button>
    </div>
  ),
}))

function buildRecentSearch(
  overrides: Partial<ResumeSearchRecentItem> = {},
): ResumeSearchRecentItem {
  return {
    id: 'history-1' as ResumeSearchRecentItem['id'],
    sessionKey: 'session-1',
    title: 'Saved search',
    location: 'Malaysia',
    keywords: ['Machine Tools', 'Sales'],
    selectedTags: [],
    selectedCompanies: [],
    filters: {},
    createdAt: Date.now(),
    ...overrides,
  }
}

function buildWorkflowSeed(
  overrides: Partial<
    NonNullable<SearchHeroProps['workflowSeeds']>[number]
  > = {},
) {
  return {
    id: 'workflow-1',
    label: 'China · Job5156 · CNC 销售',
    market: 'CN',
    location: 'China',
    keywords: ['CNC', '销售'],
    ...overrides,
  }
}

function buildHotKeyword(
  overrides: Partial<NonNullable<SearchHeroProps['hotKeywords']>[number]> = {},
) {
  return {
    id: 'hot-1',
    keyword: 'CNC',
    english: 'CNC',
    ...overrides,
  }
}

function renderSearchHero(overrides: Partial<SearchHeroProps> = {}) {
  const props: SearchHeroProps = {
    loading: false,
    queryInput: '',
    recentSearches: [],
    recentSearchesLoading: false,
    workflowSeeds: undefined,
    hotKeywords: undefined,
    onApplyRecentSearch: vi.fn(),
    onApplyExtractedKeywords: vi.fn(),
    onApplyWorkflowSeed: undefined,
    onToggleHotKeyword: undefined,
    onChangeQuery: vi.fn(),
    onClearQuery: vi.fn(),
    onSubmitQuery: vi.fn(),
    ...overrides,
  }

  return {
    ...render(<SearchHero {...props} />),
    props,
  }
}

describe('SearchHero', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the loading state while recent searches are loading', () => {
    renderSearchHero({
      queryInput: 'machine tools',
      recentSearchesLoading: true,
    })

    expect(screen.getByText('Loading recent searches...')).toBeInTheDocument()
    expect(
      screen.getByText('Search Bar machine tools idle 0'),
    ).toBeInTheDocument()
  })

  it('shows the empty state when there are no recent searches', () => {
    renderSearchHero()

    expect(
      screen.getByText(
        'No saved searches yet. Recent searches will appear here after you start exploring.',
      ),
    ).toBeInTheDocument()
  })

  it('renders recent-search cards and forwards click selection', async () => {
    const user = userEvent.setup()
    const onApplyRecentSearch = vi.fn()

    renderSearchHero({
      recentSearches: [
        buildRecentSearch(),
        buildRecentSearch({
          id: 'history-2' as ResumeSearchRecentItem['id'],
          title: 'Lathe follow-up',
          keywords: [],
          jobDescriptionId: 'lathe-sales',
        }),
      ],
      onApplyRecentSearch,
    })

    expect(
      screen.getByRole('button', { name: /Machine Tools Sales/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Lathe follow-up/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Malaysia · lathe-sales')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Lathe follow-up/i }))

    expect(onApplyRecentSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'history-2',
        title: 'Lathe follow-up',
        jobDescriptionId: 'lathe-sales',
      }),
    )
  })

  it('forwards hero search-bar callbacks to the parent handlers', async () => {
    const user = userEvent.setup()
    const onApplyExtractedKeywords = vi.fn()
    const onChangeQuery = vi.fn()
    const onClearQuery = vi.fn()
    const onSubmitQuery = vi.fn()

    renderSearchHero({
      loading: true,
      queryInput: 'lathe sales',
      recentSearches: [buildRecentSearch()],
      onApplyExtractedKeywords,
      onChangeQuery,
      onClearQuery,
      onSubmitQuery,
    })

    expect(
      screen.getByText('Search Bar lathe sales loading 1'),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Change from hero bar' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Clear from hero bar' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Extract from hero bar' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Submit from hero bar' }),
    )

    expect(onChangeQuery).toHaveBeenCalledWith('changed from hero bar')
    expect(onClearQuery).toHaveBeenCalledTimes(1)
    expect(onApplyExtractedKeywords).toHaveBeenCalledWith(['lathe', 'cnc'])
    expect(onSubmitQuery).toHaveBeenCalledWith('submitted')
  })

  it('renders quick-start cards from workflowSeeds', () => {
    renderSearchHero({
      workflowSeeds: [
        buildWorkflowSeed(),
        buildWorkflowSeed({
          id: 'workflow-2',
          label: 'Malaysia · SEEK · CNC Sales',
          market: 'MY',
          location: 'Kuala Lumpur MY',
          keywords: ['CNC', 'Sales'],
        }),
      ],
    })

    expect(screen.getByText('Quick Start')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /China · Job5156 · CNC 销售/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Malaysia · SEEK · CNC Sales/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('CNC, 销售 · China')).toBeInTheDocument()
    expect(screen.getByText('CNC, Sales · Kuala Lumpur MY')).toBeInTheDocument()
  })

  it('renders hot keyword chips from hotKeywords', () => {
    renderSearchHero({
      hotKeywords: [
        buildHotKeyword(),
        buildHotKeyword({
          id: 'hot-2',
          keyword: 'China',
        }),
      ],
    })

    expect(screen.getByText('Hot Tags')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CNC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'China' })).toBeInTheDocument()
  })

  it('clicking a quick-start card calls onApplyWorkflowSeed', async () => {
    const user = userEvent.setup()
    const onApplyWorkflowSeed = vi.fn()

    renderSearchHero({
      workflowSeeds: [buildWorkflowSeed()],
      onApplyWorkflowSeed,
    })

    await user.click(
      screen.getByRole('button', { name: /China · Job5156 · CNC 销售/i }),
    )

    expect(onApplyWorkflowSeed).toHaveBeenCalledWith({
      keywords: ['CNC', '销售'],
      location: 'China',
    })
  })

  it('clicking a hot keyword chip calls onToggleHotKeyword', async () => {
    const user = userEvent.setup()
    const onToggleHotKeyword = vi.fn()

    renderSearchHero({
      hotKeywords: [buildHotKeyword()],
      onToggleHotKeyword,
    })

    await user.click(screen.getByRole('button', { name: 'CNC' }))

    expect(onToggleHotKeyword).toHaveBeenCalledWith('CNC')
  })

  it('renders duplicate hot keywords only once', () => {
    renderSearchHero({
      hotKeywords: [
        buildHotKeyword({
          id: 'hot-1',
          keyword: '销售',
        }),
        buildHotKeyword({
          id: 'hot-2',
          keyword: '销售',
          english: 'Sales',
        }),
      ],
    })

    expect(screen.getAllByRole('button', { name: '销售' })).toHaveLength(1)
  })

  it('falls back to the title when a recent search has no location or job description id', () => {
    renderSearchHero({
      recentSearches: [
        buildRecentSearch({
          id: 'history-3' as ResumeSearchRecentItem['id'],
          title: 'Distributor focus',
          location: '',
          keywords: [],
          jobDescriptionId: undefined,
        }),
      ],
    })

    expect(screen.getAllByText('Distributor focus')).toHaveLength(2)
  })
})
