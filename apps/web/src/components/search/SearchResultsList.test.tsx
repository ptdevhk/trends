import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchResultsList } from '@/components/search/SearchResultsList'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'

let virtualRows: Array<{ index: number; start: number }> = [{ index: 0, start: 0 }]
const observeMock = vi.fn()
const disconnectMock = vi.fn()
const virtualizer = {
  getTotalSize: () => 480,
  getVirtualItems: () => virtualRows,
  measureElement: vi.fn(),
  measure: vi.fn(),
}
const useWindowVirtualizerMock = vi.fn((options: unknown) => {
  void options
  return virtualizer
})

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: (options: unknown) => useWindowVirtualizerMock(options),
}))

vi.mock('@/components/search/SnippetCard', () => ({
  SnippetCard: ({
    expanded,
    item,
  }: {
    expanded: boolean
    item: ResumeSearchResultItem
  }) => <div>{`${item.key}:${expanded ? 'expanded' : 'collapsed'}`}</div>,
}))

describe('SearchResultsList', () => {
  beforeEach(() => {
    virtualRows = [{ index: 0, start: 0 }]
    vi.clearAllMocks()

    observeMock.mockImplementation(() => {})
    disconnectMock.mockImplementation(() => {})
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}

      observe(target: Element) {
        observeMock(target)
        this.callback([{ isIntersecting: true }])
      }

      disconnect() {
        disconnectMock()
      }
    })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
  })

  function createItem(index: number): ResumeSearchResultItem {
    return {
      key: `resume-${index}`,
      identityKey: `identity-${index}`,
      blocked: false,
      status: 'new',
      resume: {
        resumeId: `resume-${index}` as ConvexResumeItem['resumeId'],
        externalId: `resume-${index}`,
        name: `Candidate ${index}`,
        profileUrl: '',
        activityStatus: '',
        age: '',
        ageNumber: 30,
        experience: '5 years',
        education: 'Bachelor',
        location: 'Kuala Lumpur',
        extractedAt: new Date().toISOString(),
        expectedSalary: '',
        jobIntention: '',
        selfIntro: '',
        skills: [],
        workHistory: [],
        source: 'seek',
        crawledAt: Date.now(),
        tags: [],
        ingestData: undefined,
      },
    }
  }

  it('renders the empty state when there are no search results', () => {
    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={[]}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText('No resumes matched this search')).toBeInTheDocument()
  })

  it('recomputes virtual rows on rerender instead of keeping stale memoized rows', () => {
    const items = Array.from({ length: 45 }, (_, index) => createItem(index))
    const { rerender } = render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={items}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText('resume-0:collapsed')).toBeInTheDocument()

    virtualRows = [{ index: 1, start: 120 }]
    rerender(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={items}
        loadingMore
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText('resume-1:collapsed')).toBeInTheDocument()
    expect(screen.queryByText('resume-0:collapsed')).not.toBeInTheDocument()
  })

  it('uses stable item keys and remeasures when virtualized items change', () => {
    const items = Array.from({ length: 45 }, (_, index) => createItem(index))
    const { rerender } = render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={items}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    expect(useWindowVirtualizerMock).toHaveBeenCalled()
    const firstCall = useWindowVirtualizerMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const firstCallOptions = firstCall?.[0] as unknown as { getItemKey: (index: number) => string | number }
    expect(firstCallOptions.getItemKey(1)).toBe('resume-1')

    virtualizer.measure.mockClear()
    const reversedItems = [...items].reverse()
    rerender(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={reversedItems}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    const latestCall = useWindowVirtualizerMock.mock.lastCall
    expect(latestCall).toBeDefined()
    const latestCallOptions = latestCall?.[0] as unknown as { getItemKey: (index: number) => string | number }
    expect(latestCallOptions.getItemKey(0)).toBe('resume-44')
    expect(virtualizer.measure).toHaveBeenCalledTimes(1)
  })

  it('subtracts the measured scroll margin from virtual row placement', async () => {
    virtualRows = [{ index: 0, start: 120 }]
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(80)

    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={Array.from({ length: 45 }, (_, index) => createItem(index))}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    const content = await screen.findByText('resume-0:collapsed')
    await waitFor(() => {
      expect(content.parentElement).toHaveStyle({ transform: 'translateY(40px)' })
    })
  })

  it('triggers load more when the sentinel intersects and more results are available', () => {
    const onLoadMore = vi.fn()

    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore
        items={Array.from({ length: 2 }, (_, index) => createItem(index))}
        onLoadMore={onLoadMore}
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(observeMock).toHaveBeenCalledTimes(1)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Scroll for more')).toBeInTheDocument()
  })

  it('renders the full non-virtualized list when any result is expanded', () => {
    const items = Array.from({ length: 45 }, (_, index) => createItem(index))

    render(
      <SearchResultsList
        expandedIds={new Set(['resume-1'])}
        hasMore={false}
        items={items}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(screen.getByText('resume-0:collapsed')).toBeInTheDocument()
    expect(screen.getByText('resume-1:expanded')).toBeInTheDocument()
    expect(screen.getByText('resume-44:collapsed')).toBeInTheDocument()
    expect(screen.getByText('End of results')).toBeInTheDocument()
  })

  it('renders the full non-virtualized list when AI summaries are present', () => {
    const items = Array.from({ length: 45 }, (_, index) => ({
      ...createItem(index),
      analysis: {
        analyzedAt: Date.now(),
        highlights: [],
        recommendation: 'match',
        score: 90,
        summary: `AI summary ${index}`,
      },
    }))

    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={items}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(screen.getByText('resume-0:collapsed')).toBeInTheDocument()
    expect(screen.getByText('resume-44:collapsed')).toBeInTheDocument()
    expect(screen.getByText('End of results')).toBeInTheDocument()
  })
})
