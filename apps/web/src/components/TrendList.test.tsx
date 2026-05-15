import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TrendList } from '@/components/TrendList'
import type { NewsItem } from '@/lib/types'

vi.mock('@/lib/timezone', () => ({
  formatInAppTimezone: () => 'Apr 15, 2026, 10:00 AM',
}))

describe('TrendList', () => {
  const defaultProps = {
    news: [] as NewsItem[],
    loading: false,
    error: null as string | null,
    lastUpdated: null as Date | null,
    onRefresh: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const sampleNews: NewsItem[] = [
    {
      id: '1',
      title: 'Tech News Today',
      platform_id: 'test',
      rank: 1,
      url: 'https://example.com/1',
    },
    {
      id: '2',
      title: 'AI Breakthrough',
      platform_id: 'test',
      rank: 2,
      url: 'https://example.com/2',
    },
  ]

  it('renders loading skeleton when loading with no news', () => {
    render(<TrendList {...defaultProps} loading={true} />)
    // Should show skeleton placeholders, not empty state
    expect(screen.queryByText('trends.empty')).not.toBeInTheDocument()
    // Skeleton renders divs with rounded-full class
    const card = screen.getByText('trends.latest').closest('div')
    expect(card).toBeInTheDocument()
  })

  it('renders error state with retry button', async () => {
    const onRefresh = vi.fn()
    const user = userEvent.setup()
    render(
      <TrendList
        {...defaultProps}
        error="Network error"
        onRefresh={onRefresh}
      />
    )

    expect(screen.getByText('trends.error')).toBeInTheDocument()
    expect(screen.getByText('Network error')).toBeInTheDocument()

    await user.click(screen.getByText('trends.retry'))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('renders empty state when no news and not loading', () => {
    render(<TrendList {...defaultProps} news={[]} />)
    expect(screen.getByText('trends.empty')).toBeInTheDocument()
  })

  it('renders news items list', () => {
    render(<TrendList {...defaultProps} news={sampleNews} />)
    expect(screen.getByText('Tech News Today')).toBeInTheDocument()
    expect(screen.getByText('AI Breakthrough')).toBeInTheDocument()
  })

  it('displays lastUpdated time when provided', () => {
    render(
      <TrendList
        {...defaultProps}
        news={sampleNews}
        lastUpdated={new Date('2026-04-15T10:00:00Z')}
      />
    )
    expect(screen.getByText(/Apr 15, 2026/)).toBeInTheDocument()
  })

  it('does not display lastUpdated when not provided', () => {
    render(<TrendList {...defaultProps} news={sampleNews} />)
    expect(screen.queryByText(/trends\.lastUpdated/)).not.toBeInTheDocument()
  })

  it('calls onRefresh when refresh button clicked', async () => {
    const onRefresh = vi.fn()
    const user = userEvent.setup()
    render(
      <TrendList
        {...defaultProps}
        news={sampleNews}
        onRefresh={onRefresh}
      />
    )

    const refreshBtn = screen.getByRole('button')
    expect(refreshBtn).toBeInTheDocument()
    await user.click(refreshBtn)
    expect(onRefresh).toHaveBeenCalled()
  })

  it('disables refresh button when loading', () => {
    render(
      <TrendList
        {...defaultProps}
        loading={true}
        news={sampleNews}
      />
    )

    const refreshBtn = screen.getByRole('button')
    expect(refreshBtn).toBeDisabled()
  })

  it('renders custom title', () => {
    render(<TrendList {...defaultProps} title="Custom Title" />)
    expect(screen.getByText('Custom Title')).toBeInTheDocument()
  })
})
