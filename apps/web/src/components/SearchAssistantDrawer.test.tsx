import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchAssistantDrawer } from './SearchAssistantDrawer'
import type { SearchHistoryItem } from '@/hooks/useSession'

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} {...props}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => <div className={className}>{children}</div>,
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
    filters: {},
    selectedTags: ['STAR'],
    selectedCompanies: [],
    selectedExperienceLevel: 'mid',
    createdAt: Date.UTC(2026, 2, 26, 10, 0, 0),
    lastOpenedAt: Date.UTC(2026, 2, 26, 11, 0, 0),
    ...overrides,
  }
}

describe('SearchAssistantDrawer', () => {
  it('renders the current draft and applies a workflow suggestion', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onApplyWorkflow = vi.fn()

    render(
      <SearchAssistantDrawer
        open
        onOpenChange={onOpenChange}
        location="Dongguan"
        keywords={['CNC', 'Sales']}
        jobDescriptionId="lathe-sales"
        workflows={[
          {
            id: 'workflow-1',
            label: 'Dongguan CNC Sales',
            location: 'Dongguan',
            keywords: ['CNC', 'Sales'],
          },
        ]}
        onApplyWorkflow={onApplyWorkflow}
      />
    )

    expect(screen.getByTestId('search-assistant-drawer').className).toContain('right-0')
    expect(screen.getAllByText('Dongguan').length).toBeGreaterThan(0)
    expect(screen.getByText('lathe-sales')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use workflow' }))

    expect(onApplyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      id: 'workflow-1',
      label: 'Dongguan CNC Sales',
    }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('applies matched profiles and recent history through explicit actions', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onUseMatchedProfile = vi.fn()
    const onApplyHistoryItem = vi.fn(async () => {})

    render(
      <SearchAssistantDrawer
        open
        onOpenChange={onOpenChange}
        workflows={[]}
        onApplyWorkflow={vi.fn()}
        matchedProfile={{
          name: 'SEEK Malaysia CNC Sales',
          confidence: 0.91,
          jobDescriptionId: 'seek-malaysia-sales',
          matchedKeywords: ['cnc', 'sales'],
          filterSummary: '2+ yrs | Age <=45',
        }}
        onUseMatchedProfile={onUseMatchedProfile}
        historyItems={[buildItem()]}
        onApplyHistoryItem={onApplyHistoryItem}
      />
    )

    expect(screen.getByText('SEEK Malaysia CNC Sales')).toBeInTheDocument()
    expect(screen.getByText('2+ yrs | Age <=45')).toBeInTheDocument()
    expect(screen.getByText('东莞 · CNC 销售')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use matched profile' }))
    expect(onUseMatchedProfile).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'Open search' }))
    expect(onApplyHistoryItem).toHaveBeenCalledWith(expect.objectContaining({
      id: 'history-1',
      title: '东莞 · CNC 销售',
    }))
  })
})
