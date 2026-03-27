import type { ComponentProps, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileFilterSheet } from '@/components/search/MobileFilterSheet'
import type { FacetSidebarProps } from '@/components/search/FacetSidebar'
import type { FacetCounts } from '@/components/search/search-types'

const { facetSidebarMock } = vi.hoisted(() => ({
  facetSidebarMock: vi.fn(),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    onOpenChange,
    open,
  }: {
    children: ReactNode
    onOpenChange: (open: boolean) => void
    open: boolean
  }) => (
    <div data-testid="dialog-root" data-open={String(open)}>
      <button type="button" onClick={() => onOpenChange(true)}>
        Open dialog
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        Close dialog
      </button>
      {children}
    </div>
  ),
  DialogContent: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/search/FacetSidebar', () => ({
  FacetSidebar: (props: FacetSidebarProps) => {
    facetSidebarMock(props)
    return <div>FacetSidebar embedded:{String(props.embedded)} tags:{props.selectedTags.join('|')}</div>
  },
}))

function buildFacetCounts(): FacetCounts {
  return {
    clusters: [],
    tags: [],
    companies: [],
    experienceLevels: [],
    education: [],
    statuses: [],
    minScoreOptions: [],
  }
}

function buildProps(overrides: Partial<ComponentProps<typeof MobileFilterSheet>> = {}): ComponentProps<typeof MobileFilterSheet> {
  return {
    open: true,
    onOpenChange: vi.fn(),
    facetCounts: buildFacetCounts(),
    selectedClusters: [],
    selectedCompanies: [],
    selectedEducation: [],
    selectedStatuses: [],
    selectedTags: ['Machine Tools'],
    onClearAll: vi.fn(),
    onSetExperienceLevel: vi.fn(),
    onSetMinScore: vi.fn(),
    onToggleCluster: vi.fn(),
    onToggleCompany: vi.fn(),
    onToggleEducation: vi.fn(),
    onToggleStatus: vi.fn(),
    onToggleTag: vi.fn(),
    ...overrides,
  }
}

describe('MobileFilterSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the mobile filter copy and always embeds the sidebar', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <MobileFilterSheet
        {...buildProps({
          embedded: false,
          onOpenChange,
        })}
      />
    )

    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(screen.getByText('Narrow the current search without leaving the result list.')).toBeInTheDocument()
    expect(screen.getByText('FacetSidebar embedded:true tags:Machine Tools')).toBeInTheDocument()
    expect(facetSidebarMock).toHaveBeenCalledWith(expect.objectContaining({
      embedded: true,
      selectedTags: ['Machine Tools'],
    }))

    await user.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('forwards the dialog open state and both open-change directions', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <MobileFilterSheet
        {...buildProps({
          open: false,
          onOpenChange,
          selectedClusters: ['manufacturing-systems'],
        })}
      />
    )

    expect(screen.getByTestId('dialog-root')).toHaveAttribute('data-open', 'false')
    expect(facetSidebarMock).toHaveBeenCalledWith(expect.objectContaining({
      embedded: true,
      selectedClusters: ['manufacturing-systems'],
      selectedTags: ['Machine Tools'],
    }))

    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(onOpenChange).toHaveBeenNthCalledWith(1, true)
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false)
  })
})
