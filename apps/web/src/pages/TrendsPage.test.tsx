import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const mockUseTrends = vi.hoisted(() => vi.fn())
const mockUseSearch = vi.hoisted(() => vi.fn())
const mockSearch = vi.hoisted(() => vi.fn())
const mockClearSearch = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useTrends', () => ({
  useTrends: (...args: unknown[]) => mockUseTrends(...args),
  useSearch: (...args: unknown[]) => mockUseSearch(...args),
}))

vi.mock('@/components/TrendList', () => ({
  TrendList: ({ title }: { title?: string }) => <div data-testid="trend-list">{title}</div>,
}))

vi.mock('@/components/PlatformFilter', () => ({
  PlatformFilter: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select data-testid="platform-filter" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All</option>
    </select>
  ),
}))

vi.mock('@/components/SearchBar', () => ({
  SearchBar: ({ onSearch, onClear, loading }: { onSearch: (v: string) => void; onClear: () => void; loading?: boolean }) => (
    <div data-testid="search-bar">
      <input data-testid="search-input" onChange={(e) => onSearch(e.target.value)} />
      <button data-testid="search-clear" onClick={onClear}>Clear</button>
      {loading && <span>Loading...</span>}
    </div>
  ),
}))

vi.mock('@/components/TrendItem', () => ({
  TrendItem: ({ item }: { item: { title: string } }) => <div data-testid="trend-item">{item.title}</div>,
}))

import { TrendsPage } from './TrendsPage'

function setupDefaultMocks() {
  mockUseTrends.mockReturnValue({
    news: [{ id: '1', title: 'News 1', platform_id: 'zhihu' }],
    loading: false,
    error: null,
    lastUpdated: Date.now(),
    refresh: mockRefresh,
  })
  mockUseSearch.mockReturnValue({
    results: [],
    loading: false,
    error: null,
    search: mockSearch,
    clear: mockClearSearch,
  })
}

describe('TrendsPage', () => {
  it('renders SearchBar and PlatformFilter', () => {
    setupDefaultMocks()
    render(<TrendsPage />)
    expect(screen.getByTestId('search-bar')).toBeInTheDocument()
    expect(screen.getByTestId('platform-filter')).toBeInTheDocument()
  })

  it('shows TrendList by default when not searching', () => {
    setupDefaultMocks()
    render(<TrendsPage />)
    expect(screen.getByTestId('trend-list')).toBeInTheDocument()
  })

  it('shows search loading state', () => {
    mockUseTrends.mockReturnValue({
      news: [], loading: false, error: null, lastUpdated: Date.now(), refresh: mockRefresh,
    })
    mockUseSearch.mockReturnValue({
      results: [], loading: true, error: null, search: mockSearch, clear: mockClearSearch,
    })
    render(<TrendsPage />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows search results', () => {
    mockUseTrends.mockReturnValue({
      news: [], loading: false, error: null, lastUpdated: Date.now(), refresh: mockRefresh,
    })
    mockUseSearch.mockReturnValue({
      results: [{ id: '1', title: 'Search Result 1', platform_id: 'weibo' }],
      loading: false, error: null, search: mockSearch, clear: mockClearSearch,
    })
    render(<TrendsPage />)
    expect(screen.getByText('Search Result 1')).toBeInTheDocument()
  })

  it('shows search error state when results exist', () => {
    mockUseTrends.mockReturnValue({
      news: [], loading: false, error: null, lastUpdated: Date.now(), refresh: mockRefresh,
    })
    mockUseSearch.mockReturnValue({
      results: [{ id: '1', title: 'Test', platform_id: 'weibo' }],
      loading: false, error: 'API timeout', search: mockSearch, clear: mockClearSearch,
    })
    render(<TrendsPage />)
    // Error takes precedence over results rendering when both exist
    expect(screen.getByText(/API timeout/)).toBeInTheDocument()
    expect(screen.queryByText('Test')).not.toBeInTheDocument()
  })
})
