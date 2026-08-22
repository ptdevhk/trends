import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchHistoryDialog } from './SearchHistoryDialog'
import type { SearchHistoryItem } from '@/hooks/useSession'

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const mockT = (_key: string, fallback?: string) => fallback ?? _key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

function buildItem(overrides: Partial<SearchHistoryItem> = {}): SearchHistoryItem {
  return {
    id: 'history-1' as SearchHistoryItem['id'],
    sessionKey: 'session-1',
    title: '东莞 · CNC 销售',
    location: '东莞',
    keywords: ['CNC', '销售'],
    jobDescriptionId: 'lathe-sales',
    filters: { minAge: 25 },
    selectedTags: ['STAR'],
    selectedCompanies: ['Acme'],
    selectedExperienceLevel: 'mid',
    collectionTaskId: undefined,
    analysisTaskId: undefined,
    notes: undefined,
    createdAt: Date.UTC(2026, 2, 9, 8, 0, 0),
    lastOpenedAt: Date.UTC(2026, 2, 9, 9, 0, 0),
    ...overrides,
  }
}

describe('SearchHistoryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders saved search entries in the provided order', () => {
    render(
      <SearchHistoryDialog
        open
        onOpenChange={vi.fn()}
        onApply={vi.fn()}
        items={[
          buildItem({
            id: 'history-newer' as SearchHistoryItem['id'],
            title: '较新搜索',
            lastOpenedAt: Date.UTC(2026, 2, 9, 10, 0, 0),
          }),
          buildItem({
            id: 'history-older' as SearchHistoryItem['id'],
            title: '较早搜索',
            lastOpenedAt: Date.UTC(2026, 2, 9, 8, 30, 0),
          }),
        ]}
      />
    )

    const titles = screen.getAllByText(/搜索$/).map((node) => node.textContent)
    expect(titles).toEqual(['较新搜索', '较早搜索'])
  })

  it('shows an empty state when no saved searches exist', () => {
    render(
      <SearchHistoryDialog
        open
        onOpenChange={vi.fn()}
        onApply={vi.fn()}
        items={[]}
      />
    )

    expect(screen.getByText('No saved searches yet.')).toBeInTheDocument()
  })

  it('applies the selected history item and closes the dialog', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <SearchHistoryDialog
        open
        onOpenChange={onOpenChange}
        onApply={onApply}
        items={[buildItem()]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      id: 'history-1',
      title: '东莞 · CNC 销售',
      keywords: ['CNC', '销售'],
    }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows a loading state while search history is being fetched', () => {
    render(
      <SearchHistoryDialog
        open
        onOpenChange={vi.fn()}
        onApply={vi.fn()}
        items={[]}
        loading
      />
    )

    expect(screen.getByText('Loading history...')).toBeInTheDocument()
  })

  it('filters saved searches as the user types in the filter input', async () => {
    const user = userEvent.setup()
    render(
      <SearchHistoryDialog
        open
        onOpenChange={vi.fn()}
        onApply={vi.fn()}
        items={[
          buildItem({ id: 'history-1' as SearchHistoryItem['id'], title: 'CNC 销售' }),
          buildItem({ id: 'history-2' as SearchHistoryItem['id'], title: '注塑机操作', keywords: ['注塑'] }),
        ]}
      />
    )

    await user.type(screen.getByTestId('search-history-filter-input'), 'cnc')

    expect(screen.getByText('CNC 销售')).toBeInTheDocument()
    expect(screen.queryByText('注塑机操作')).not.toBeInTheDocument()
  })

  it('shows an empty filter state with a clear action when no search matches', async () => {
    const user = userEvent.setup()
    render(
      <SearchHistoryDialog
        open
        onOpenChange={vi.fn()}
        onApply={vi.fn()}
        items={[buildItem()]}
      />
    )

    await user.type(screen.getByTestId('search-history-filter-input'), 'nobody')

    expect(screen.getByTestId('search-history-empty-filter')).toBeInTheDocument()

    await user.click(screen.getByTestId('search-history-clear-filter-empty'))

    expect(screen.getByText('东莞 · CNC 销售')).toBeInTheDocument()
    expect(screen.queryByTestId('search-history-empty-filter')).not.toBeInTheDocument()
  })

  it('clears the filter with the inline clear button', async () => {
    const user = userEvent.setup()
    render(
      <SearchHistoryDialog
        open
        onOpenChange={vi.fn()}
        onApply={vi.fn()}
        items={[buildItem()]}
      />
    )

    await user.type(screen.getByTestId('search-history-filter-input'), 'cnc')
    expect(screen.queryByText('东莞 · CNC 销售')).toBeInTheDocument()

    await user.click(screen.getByTestId('search-history-clear-search'))

    expect(screen.getByTestId('search-history-filter-input')).toHaveValue('')
  })
})
