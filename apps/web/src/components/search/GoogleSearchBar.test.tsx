import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleSearchBar } from '@/components/search/GoogleSearchBar'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
}))

const mockT = (key: string, options?: string | Record<string, unknown>) => {
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
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('@/components/search/JdPastePopover', () => ({
  JdPastePopover: ({ onClose }: { onClose: () => void }) => (
    <div>
      <div>JD Popover</div>
      <button type="button" onClick={onClose}>Close JD Popover</button>
    </div>
  ),
}))

function buildRecentSearch(overrides: Partial<ResumeSearchRecentItem> = {}): ResumeSearchRecentItem {
  return {
    id: 'history-1' as ResumeSearchRecentItem['id'],
    sessionKey: 'session-1',
    title: 'Machine tools',
    location: 'Kuala Lumpur',
    keywords: ['Machine Tools'],
    selectedTags: [],
    selectedCompanies: [],
    filters: {},
    createdAt: Date.now(),
    ...overrides,
  }
}

function renderSearchBar({
  compact,
  loading,
  onApplyExtractedKeywords,
  onApplyRecentSearch = vi.fn(),
  onChange = vi.fn(),
  onClear = vi.fn(),
  onSubmit = vi.fn(),
  placeholder,
  recentSearches = [buildRecentSearch()],
  value = '',
}: Partial<ComponentProps<typeof GoogleSearchBar>> = {}) {
  render(
    <GoogleSearchBar
      compact={compact}
      loading={loading}
      recentSearches={recentSearches}
      value={value}
      onApplyRecentSearch={onApplyRecentSearch}
      onApplyExtractedKeywords={onApplyExtractedKeywords}
      onChange={onChange}
      onClear={onClear}
      onSubmit={onSubmit}
      placeholder={placeholder}
    />
  )

  return {
    onApplyRecentSearch,
    onChange,
    onClear,
    onSubmit,
  }
}

describe('GoogleSearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes the JD popover on escape before clearing the query', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()

    render(
      <GoogleSearchBar
        value="machine tools"
        recentSearches={[buildRecentSearch()]}
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={vi.fn()}
        onChange={vi.fn()}
        onClear={onClear}
        onSubmit={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Paste job description' }))
    expect(screen.getByText('JD Popover')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('Search resumes by keywords, brands, roles, or locations')
    await user.click(input)
    await user.keyboard('{Escape}')

    expect(screen.queryByText('JD Popover')).not.toBeInTheDocument()
    expect(onClear).not.toHaveBeenCalled()
  })

  it('submits the trimmed query from the search button', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderSearchBar({
      value: '  machine tools  ',
    })

    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit).toHaveBeenCalledWith('machine tools')
  })

  it('shows the first six recent searches for an empty query and filters them by query text', async () => {
    const user = userEvent.setup()
    const recentSearches = [
      buildRecentSearch({
        id: 'history-1' as ResumeSearchRecentItem['id'],
        title: 'Machine tools',
        keywords: ['Machine Tools'],
        location: 'Kuala Lumpur',
      }),
      buildRecentSearch({
        id: 'history-2' as ResumeSearchRecentItem['id'],
        title: 'CNC sales',
        keywords: ['CNC Sales'],
        location: 'Shenzhen',
      }),
      buildRecentSearch({
        id: 'history-3' as ResumeSearchRecentItem['id'],
        title: 'Account manager',
        keywords: ['Account Manager'],
        location: 'Singapore',
      }),
      buildRecentSearch({
        id: 'history-4' as ResumeSearchRecentItem['id'],
        title: 'Industrial automation',
        keywords: ['Industrial Automation'],
        location: 'Penang',
      }),
      buildRecentSearch({
        id: 'history-5' as ResumeSearchRecentItem['id'],
        title: 'Factory GM',
        keywords: ['Factory GM'],
        location: 'Johor Bahru',
      }),
      buildRecentSearch({
        id: 'history-6' as ResumeSearchRecentItem['id'],
        title: 'Regional director',
        keywords: ['Regional Director'],
        location: 'Bangkok',
      }),
      buildRecentSearch({
        id: 'history-7' as ResumeSearchRecentItem['id'],
        title: 'Rust backend',
        keywords: ['Rust Backend'],
        location: 'Tokyo',
      }),
    ]

    const { rerender } = render(
      <GoogleSearchBar
        recentSearches={recentSearches}
        value=""
        onApplyRecentSearch={vi.fn()}
        onChange={vi.fn()}
        onClear={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('Search resumes by keywords, brands, roles, or locations')
    await user.click(input)

    expect(screen.getByText('Recent searches')).toBeInTheDocument()
    expect(screen.getByText('Machine Tools')).toBeInTheDocument()
    expect(screen.getByText('Regional Director')).toBeInTheDocument()
    expect(screen.queryByText('Rust Backend')).not.toBeInTheDocument()

    rerender(
      <GoogleSearchBar
        recentSearches={recentSearches}
        value="sing"
        onApplyRecentSearch={vi.fn()}
        onChange={vi.fn()}
        onClear={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    await user.click(screen.getByDisplayValue('sing'))

    expect(screen.getByText('Account Manager')).toBeInTheDocument()
    expect(screen.queryByText('Machine Tools')).not.toBeInTheDocument()
    expect(screen.queryByText('CNC Sales')).not.toBeInTheDocument()
  })

  it('applies a recent search selection from the dropdown', async () => {
    const user = userEvent.setup()
    const recentItem = buildRecentSearch({
      id: 'history-apply' as ResumeSearchRecentItem['id'],
      title: 'CNC sales',
      keywords: ['CNC Sales'],
      location: 'Shenzhen',
    })
    const onApplyRecentSearch = vi.fn()

    renderSearchBar({
      recentSearches: [recentItem],
      onApplyRecentSearch,
    })

    await user.click(screen.getByPlaceholderText('Search resumes by keywords, brands, roles, or locations'))
    await user.click(screen.getByRole('option', { name: /CNC Sales/i }))

    expect(onApplyRecentSearch).toHaveBeenCalledWith(recentItem)
  })

  it('clears the query on escape when the JD popover is closed', async () => {
    const user = userEvent.setup()
    const { onClear } = renderSearchBar({
      value: 'machine tools',
      onApplyExtractedKeywords: vi.fn(),
    })

    await user.click(screen.getByPlaceholderText('Search resumes by keywords, brands, roles, or locations'))
    await user.keyboard('{Escape}')

    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('forwards the clear button click when the query is present', async () => {
    const user = userEvent.setup()
    const { onClear } = renderSearchBar({
      value: 'machine tools',
    })

    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
