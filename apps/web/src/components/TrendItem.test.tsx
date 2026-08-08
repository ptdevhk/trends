import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TrendItem } from '@/components/TrendItem'
import type { NewsItem } from '@/lib/types'

const mockT = (key: string, options?: string | { defaultValue?: string }) => {
  if (typeof options === 'string') return options
  if (options?.defaultValue) return options.defaultValue
  return key
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

const baseItem: NewsItem = {
  id: '1',
  title: 'AI is transforming software development',
  platform_id: 'zhihu',
  platform_name: 'Zhihu',
  rank: 1,
  url: 'https://example.com/article',
}

describe('TrendItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the title', () => {
    render(<TrendItem item={baseItem} />)
    expect(screen.getByText('AI is transforming software development')).toBeInTheDocument()
  })

  it('renders rank when showRank is true', () => {
    render(<TrendItem item={baseItem} showRank={true} />)
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('hides rank when showRank is false', () => {
    render(<TrendItem item={baseItem} showRank={false} />)
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('renders platform badge', () => {
    render(<TrendItem item={baseItem} />)
    expect(screen.getByText('Zhihu')).toBeInTheDocument()
  })

  it('renders title as link when url is provided', () => {
    render(<TrendItem item={baseItem} />)
    const link = screen.getByRole('link', { name: /AI is transforming/ })
    expect(link).toHaveAttribute('href', 'https://example.com/article')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders title as plain text when url is absent', () => {
    const itemNoUrl = { ...baseItem, url: undefined }
    render(<TrendItem item={itemNoUrl} />)
    expect(screen.getByText('AI is transforming software development')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('falls back to platform_id when platform_name is absent', () => {
    const item = { ...baseItem, platform_name: undefined }
    render(<TrendItem item={item} />)
    expect(screen.getByText('zhihu')).toBeInTheDocument()
  })
})
