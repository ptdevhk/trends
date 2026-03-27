import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchHero } from '@/components/search/SearchHero'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

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
        Search Bar {value} {loading ? 'loading' : 'idle'} {recentSearches.length}
      </div>
      <button type="button" onClick={() => onChange('changed from hero bar')}>
        Change from hero bar
      </button>
      <button type="button" onClick={onClear}>
        Clear from hero bar
      </button>
      <button type="button" onClick={() => onApplyExtractedKeywords(['lathe', 'cnc'])}>
        Extract from hero bar
      </button>
      <button type="button" onClick={() => onSubmit('submitted')}>
        Submit from hero bar
      </button>
    </div>
  ),
}))

function buildRecentSearch(overrides: Partial<ResumeSearchRecentItem> = {}): ResumeSearchRecentItem {
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

describe('SearchHero', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the loading state while recent searches are loading', () => {
    render(
      <SearchHero
        queryInput="machine tools"
        recentSearches={[]}
        recentSearchesLoading
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={vi.fn()}
        onChangeQuery={vi.fn()}
        onClearQuery={vi.fn()}
        onSubmitQuery={vi.fn()}
      />
    )

    expect(screen.getByText('Loading recent searches...')).toBeInTheDocument()
    expect(screen.getByText('Search Bar machine tools idle 0')).toBeInTheDocument()
  })

  it('shows the empty state when there are no recent searches', () => {
    render(
      <SearchHero
        queryInput=""
        recentSearches={[]}
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={vi.fn()}
        onChangeQuery={vi.fn()}
        onClearQuery={vi.fn()}
        onSubmitQuery={vi.fn()}
      />
    )

    expect(screen.getByText('No saved searches yet. Recent searches will appear here after you start exploring.')).toBeInTheDocument()
  })

  it('renders recent-search cards and forwards click selection', async () => {
    const user = userEvent.setup()
    const onApplyRecentSearch = vi.fn()

    render(
      <SearchHero
        queryInput=""
        recentSearches={[
          buildRecentSearch(),
          buildRecentSearch({
            id: 'history-2' as ResumeSearchRecentItem['id'],
            title: 'Lathe follow-up',
            keywords: [],
            jobDescriptionId: 'lathe-sales',
          }),
        ]}
        onApplyRecentSearch={onApplyRecentSearch}
        onApplyExtractedKeywords={vi.fn()}
        onChangeQuery={vi.fn()}
        onClearQuery={vi.fn()}
        onSubmitQuery={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Machine Tools Sales/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lathe follow-up/i })).toBeInTheDocument()
    expect(screen.getByText('Malaysia · lathe-sales')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Lathe follow-up/i }))

    expect(onApplyRecentSearch).toHaveBeenCalledWith(expect.objectContaining({
      id: 'history-2',
      title: 'Lathe follow-up',
      jobDescriptionId: 'lathe-sales',
    }))
  })

  it('forwards hero search-bar callbacks to the parent handlers', async () => {
    const user = userEvent.setup()
    const onApplyExtractedKeywords = vi.fn()
    const onChangeQuery = vi.fn()
    const onClearQuery = vi.fn()
    const onSubmitQuery = vi.fn()

    render(
      <SearchHero
        loading
        queryInput="lathe sales"
        recentSearches={[buildRecentSearch()]}
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={onApplyExtractedKeywords}
        onChangeQuery={onChangeQuery}
        onClearQuery={onClearQuery}
        onSubmitQuery={onSubmitQuery}
      />
    )

    expect(screen.getByText('Search Bar lathe sales loading 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Change from hero bar' }))
    await user.click(screen.getByRole('button', { name: 'Clear from hero bar' }))
    await user.click(screen.getByRole('button', { name: 'Extract from hero bar' }))
    await user.click(screen.getByRole('button', { name: 'Submit from hero bar' }))

    expect(onChangeQuery).toHaveBeenCalledWith('changed from hero bar')
    expect(onClearQuery).toHaveBeenCalledTimes(1)
    expect(onApplyExtractedKeywords).toHaveBeenCalledWith(['lathe', 'cnc'])
    expect(onSubmitQuery).toHaveBeenCalledWith('submitted')
  })

  it('falls back to the title when a recent search has no location or job description id', () => {
    render(
      <SearchHero
        queryInput=""
        recentSearches={[
          buildRecentSearch({
            id: 'history-3' as ResumeSearchRecentItem['id'],
            title: 'Distributor focus',
            location: '',
            keywords: [],
            jobDescriptionId: undefined,
          }),
        ]}
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={vi.fn()}
        onChangeQuery={vi.fn()}
        onClearQuery={vi.fn()}
        onSubmitQuery={vi.fn()}
      />
    )

    expect(screen.getAllByText('Distributor focus')).toHaveLength(2)
  })
})
