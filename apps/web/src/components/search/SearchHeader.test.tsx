import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchHeader } from '@/components/search/SearchHeader'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') {
        return options
      }

      const defaultValue =
        options && typeof options === 'object' && typeof options.defaultValue === 'string'
          ? options.defaultValue
          : key
      return defaultValue.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
        const value = options && typeof options === 'object' ? options[token] : undefined
        return value === undefined || value === null ? '' : String(value)
      })
    },
  }),
}))

vi.mock('@/components/search/GoogleSearchBar', () => ({
  GoogleSearchBar: ({
    onApplyExtractedKeywords,
    onChange,
    onClear,
    compact,
    loading,
    onSubmit,
    recentSearches,
    value,
  }: {
    onApplyExtractedKeywords: (keywords: string[]) => void
    onChange: (value: string) => void
    onClear: () => void
    compact?: boolean
    loading?: boolean
    onSubmit: (value?: string) => void
    recentSearches: ResumeSearchRecentItem[]
    value: string
  }) => (
    <div>
      <div>
        Search Header Bar {compact ? 'compact' : 'full'} {value} {loading ? 'loading' : 'idle'} {recentSearches.length}
      </div>
      <button type="button" onClick={() => onChange('changed from header bar')}>
        Change from header bar
      </button>
      <button type="button" onClick={onClear}>
        Clear from header bar
      </button>
      <button type="button" onClick={() => onApplyExtractedKeywords(['servo', 'automation'])}>
        Extract from header bar
      </button>
      <button type="button" onClick={() => onSubmit('submitted from header')}>
        Submit from header bar
      </button>
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

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort results' }),
      'experience',
    )

    expect(onSortChange).toHaveBeenCalledWith('experience')
  })

  it('omits the quoted query suffix when no active query is set', () => {
    render(
      <SearchHeader
        activeResultCount={3}
        queryInput=""
        recentSearches={[]}
        sortValue="score"
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

  it('forwards header search-bar callbacks to the parent handlers', async () => {
    const user = userEvent.setup()
    const onApplyExtractedKeywords = vi.fn()
    const onChangeQuery = vi.fn()
    const onClearQuery = vi.fn()
    const onSubmitQuery = vi.fn()

    render(
      <SearchHeader
        activeResultCount={42}
        loading
        queryInput="servo automation"
        recentSearches={[buildRecentSearch()]}
        sortValue="score"
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={onApplyExtractedKeywords}
        onChangeQuery={onChangeQuery}
        onClearQuery={onClearQuery}
        onSubmitQuery={onSubmitQuery}
        onSortChange={vi.fn()}
      />
    )

    expect(screen.getByText('Search Header Bar compact servo automation loading 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Change from header bar' }))
    await user.click(screen.getByRole('button', { name: 'Clear from header bar' }))
    await user.click(screen.getByRole('button', { name: 'Extract from header bar' }))
    await user.click(screen.getByRole('button', { name: 'Submit from header bar' }))

    expect(onChangeQuery).toHaveBeenCalledWith('changed from header bar')
    expect(onClearQuery).toHaveBeenCalledTimes(1)
    expect(onApplyExtractedKeywords).toHaveBeenCalledWith(['servo', 'automation'])
    expect(onSubmitQuery).toHaveBeenCalledWith('submitted from header')
  })

  it('omits the location and job description badges when that metadata is absent', () => {
    render(
      <SearchHeader
        activeQuery="machine tools"
        activeResultCount={7}
        queryInput="machine tools"
        recentSearches={[]}
        sortValue="score"
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={vi.fn()}
        onChangeQuery={vi.fn()}
        onClearQuery={vi.fn()}
        onSubmitQuery={vi.fn()}
        onSortChange={vi.fn()}
      />
    )

    expect(screen.getByText('7 results for "machine tools"')).toBeInTheDocument()
    expect(screen.queryByText('Malaysia')).not.toBeInTheDocument()
    expect(screen.queryByText(/JD /)).not.toBeInTheDocument()
  })
})
