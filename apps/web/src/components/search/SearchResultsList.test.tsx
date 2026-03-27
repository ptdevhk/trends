import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchResultsList } from '@/components/search/SearchResultsList'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'

let virtualRows: Array<{ index: number; start: number }> = [{ index: 0, start: 0 }]
const virtualizer = {
  getTotalSize: () => 480,
  getVirtualItems: () => virtualRows,
}

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: () => virtualizer,
}))

vi.mock('@/components/search/SnippetCard', () => ({
  SnippetCard: ({ item }: { item: ResumeSearchResultItem }) => <div>{item.key}</div>,
}))

describe('SearchResultsList', () => {
  beforeEach(() => {
    virtualRows = [{ index: 0, start: 0 }]
    vi.clearAllMocks()

    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
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

    expect(screen.getByText('resume-0')).toBeInTheDocument()

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

    expect(screen.getByText('resume-1')).toBeInTheDocument()
    expect(screen.queryByText('resume-0')).not.toBeInTheDocument()
  })
})
