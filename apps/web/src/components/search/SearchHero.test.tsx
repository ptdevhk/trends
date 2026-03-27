import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchHero } from '@/components/search/SearchHero'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

vi.mock('@/components/search/GoogleSearchBar', () => ({
  GoogleSearchBar: ({
    loading,
    onSubmit,
    recentSearches,
    value,
  }: {
    loading?: boolean
    onSubmit: (value?: string) => void
    recentSearches: ResumeSearchRecentItem[]
    value: string
  }) => (
    <div>
      <div>
        Search Bar {value} {loading ? 'loading' : 'idle'} {recentSearches.length}
      </div>
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
})
