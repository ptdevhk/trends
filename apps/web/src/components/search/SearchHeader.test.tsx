import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchHeader } from '@/components/search/SearchHeader'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

vi.mock('@/components/search/GoogleSearchBar', () => ({
  GoogleSearchBar: ({
    compact,
    loading,
    recentSearches,
    value,
  }: {
    compact?: boolean
    loading?: boolean
    recentSearches: ResumeSearchRecentItem[]
    value: string
  }) => (
    <div>
      <div>
        Search Header Bar {compact ? 'compact' : 'full'} {value} {loading ? 'loading' : 'idle'} {recentSearches.length}
      </div>
    </div>
  ),
}))

function buildRecentSearch(): ResumeSearchRecentItem {
  return {
    id: 'history-1' as ResumeSearchRecentItem['id'],
    sessionKey: 'session-1',
    title: 'Machine tools',
    location: 'Malaysia',
    keywords: ['Machine Tools'],
    selectedTags: [],
    selectedCompanies: [],
    filters: {},
    createdAt: Date.now(),
  }
}

describe('SearchHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders summary badges and forwards sort changes', async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()

    render(
      <SearchHeader
        activeQuery="machine tools"
        activeResultCount={1250}
        jobDescriptionId="lathe-sales"
        location="Malaysia"
        queryInput="machine tools"
        recentSearches={[buildRecentSearch()]}
        sortValue="newest"
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={vi.fn()}
        onChangeQuery={vi.fn()}
        onClearQuery={vi.fn()}
        onSubmitQuery={vi.fn()}
        onSortChange={onSortChange}
      />
    )

    expect(screen.getByText('Search Header Bar compact machine tools idle 1')).toBeInTheDocument()
    expect(screen.getByText('1,250 results for "machine tools"')).toBeInTheDocument()
    expect(screen.getByText('Malaysia')).toBeInTheDocument()
    expect(screen.getByText('JD lathe-sales')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox'), 'experience')

    expect(onSortChange).toHaveBeenCalledWith('experience')
  })

  it('omits the quoted query suffix when no active query is set', () => {
    render(
      <SearchHeader
        activeResultCount={3}
        queryInput=""
        recentSearches={[]}
        sortValue="relevance"
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={vi.fn()}
        onChangeQuery={vi.fn()}
        onClearQuery={vi.fn()}
        onSubmitQuery={vi.fn()}
        onSortChange={vi.fn()}
      />
    )

    expect(screen.getByText('3 results')).toBeInTheDocument()
  })
})
