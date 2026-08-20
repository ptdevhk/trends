import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchResultsList } from '@/components/search/SearchResultsList'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import { useConvexResumeDetail } from '@/hooks/useConvexResumes'

const useAuthMock = vi.hoisted(() => vi.fn())
const useWorkspaceMock = vi.hoisted(() => vi.fn())

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

let virtualRows: Array<{ index: number; start: number }> = [{ index: 0, start: 0 }]
const observeMock = vi.fn()
const disconnectMock = vi.fn()
const virtualizer = {
  getTotalSize: () => 480,
  getVirtualItems: () => virtualRows,
  measureElement: vi.fn(),
  measure: vi.fn(),
  scrollToIndex: vi.fn(),
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
    highlighted,
    onViewDetails,
  }: {
    expanded: boolean
    item: ResumeSearchResultItem
    highlighted?: boolean
    onViewDetails?: (item: ResumeSearchResultItem) => void
  }) => (
    <div
      id={`resume-${item.resume.resumeId}`}
      data-highlighted={highlighted ? 'true' : 'false'}
    >
      <div>{`${item.key}:${expanded ? 'expanded' : 'collapsed'}`}</div>
      <button type="button" onClick={() => onViewDetails?.(item)}>view-details-{item.key}</button>
    </div>
  ),
}))

vi.mock('@/hooks/useConvexResumes', () => ({
  useConvexResumeDetail: vi.fn(() => ({
    resume: null,
    loading: false,
  })),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => useWorkspaceMock(),
}))

vi.mock('@/components/ResumeDetail', () => ({
  ResumeDetail: ({
    open,
    resume,
    onOpenChange,
  }: {
    open: boolean
    resume: { name?: string } | null
    onOpenChange: (open: boolean) => void
  }) => (
    open ? (
      <div>
        <div>resume-detail:{resume?.name ?? 'unknown'}</div>
        <button type="button" onClick={() => onOpenChange(false)}>close-detail</button>
      </div>
    ) : null
  ),
}))

describe('SearchResultsList', () => {
  beforeEach(() => {
    virtualRows = [{ index: 0, start: 0 }]
    vi.clearAllMocks()
    useAuthMock.mockReturnValue({ memberships: [] })
    Element.prototype.scrollIntoView = vi.fn()
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    useWorkspaceMock.mockReturnValue({ slug: 'hr', isPublicSurface: false })

    observeMock.mockImplementation(() => { })
    disconnectMock.mockImplementation(() => { })
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) { }

      observe(target: Element) {
        observeMock(target)
        this.callback([{ isIntersecting: true }])
      }

      disconnect() {
        disconnectMock()
      }
    })
    vi.stubGlobal('ResizeObserver', class {
      observe() { }
      unobserve() { }
      disconnect() { }
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

    expect(screen.getByText('没有符合该搜索条件的简历')).toBeInTheDocument()
  })

  it('renders empty-state quick reset actions that clear the query and filters', () => {
    const onClearQuery = vi.fn()
    const onClearFilters = vi.fn()
    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={[]}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
        onClearQuery={onClearQuery}
        onClearFilters={onClearFilters}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /清除搜索|Clear search/i }))
    expect(onClearQuery).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /清除筛选|Clear filters/i }))
    expect(onClearFilters).toHaveBeenCalledTimes(1)
  })

  it('omits the empty-state quick reset actions when no handlers are provided', () => {
    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={[]}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /清除搜索|Clear search/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /清除筛选|Clear filters/i })).not.toBeInTheDocument()
  })

  it('renders an explicit search-failure panel with retry instead of the empty state', () => {
    const onRetrySearch = vi.fn()
    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={[]}
        searchFailed
        onRetrySearch={onRetrySearch}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.queryByText('没有符合该搜索条件的简历')).not.toBeInTheDocument()
    expect(screen.getByTestId('resume-search-failed-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重试|Retry|retry/i }))
    expect(onRetrySearch).toHaveBeenCalledTimes(1)
  })

  it('falls back to the empty state when searchFailed but results exist', () => {
    const { container } = render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={[createItem(0)]}
        searchFailed
        onRetrySearch={vi.fn()}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.queryByTestId('resume-search-failed-panel')).not.toBeInTheDocument()
    expect(container.querySelector('[data-result-index="0"]')).not.toBeNull()
  })

  it('guides a system admin to attended evidence review when results contain legacy rules signals', () => {
    useAuthMock.mockReturnValue({
      memberships: [{ workspaceSlug: 'dev', role: 'admin' }],
    })
    const item = createItem(0)
    item.resume.ingestData = {
      evidenceText: '',
      industryTags: ['cnc'],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      industryDbV2Raw: 0,
      experienceLevel: 'mid',
      computedAt: 1,
      skillsVersion: 1,
      ruleScores: {},
      roleSignals: [{
        type: 'sales',
        matchedSignals: ['CNC Sales'],
        signalCount: 1,
        occurrences: 1,
        years: 3,
        industryVerifiedYears: 3,
        verifyIn: 'workHistory',
        matchedWorkEntries: [{
          companyName: 'Vision Machine Tools',
          jobTitle: 'Sales Engineer',
          years: 3,
          industryVerified: true,
          matchedSignals: ['CNC Sales'],
        }],
      }],
    }

    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={[item]}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(screen.getByText('Industry evidence needs human review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review industry evidence' }))
      .toHaveAttribute('href', '/admin/system/settings/industry-verification?status=ready_for_review')
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
      expect(content.parentElement?.parentElement).toHaveStyle({ transform: 'translateY(40px)' })
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
    expect(screen.getByText('向下滑动查看更多')).toBeInTheDocument()
  })

  it('attaches the load-more observer when results mount after hasMore is already true', () => {
    const onLoadMore = vi.fn()
    const { rerender } = render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore
        items={[]}
        onLoadMore={onLoadMore}
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(observeMock).not.toHaveBeenCalled()

    rerender(
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
    expect(screen.getByText('已到底部')).toBeInTheDocument()
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
    expect(screen.getByText('已到底部')).toBeInTheDocument()
  })

  it('opens the internal resume detail modal from a search result card', async () => {
    const item = createItem(0)
    vi.mocked(useConvexResumeDetail).mockReturnValue({
      resume: item.resume as unknown as ReturnType<typeof useConvexResumeDetail>['resume'],
      loading: false,
    })

    render(
      <SearchResultsList
        expandedIds={new Set(['resume-0'])}
        hasMore={false}
        items={[item]}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'view-details-resume-0' }))
    await waitFor(() => {
      expect(screen.getByText('resume-detail:Candidate 0')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'close-detail' }))
    await waitFor(() => {
      expect(screen.queryByText('resume-detail:Candidate 0')).not.toBeInTheDocument()
    })
  })

  it('opens a URL-selected result and delegates close back to the parent route', async () => {
    const item = createItem(0)
    const onCloseDetail = vi.fn()
    vi.mocked(useConvexResumeDetail).mockReturnValue({
      resume: item.resume as unknown as ReturnType<typeof useConvexResumeDetail>['resume'],
      loading: false,
    })

    render(
      <SearchResultsList
        detailResumeId="resume-0"
        expandedIds={new Set()}
        hasMore={false}
        items={[item]}
        onCloseDetail={onCloseDetail}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(screen.getByText('resume-detail:Candidate 0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'close-detail' }))
    expect(onCloseDetail).toHaveBeenCalledTimes(1)
  })

  describe('verified-only search notice', () => {
    it('renders the notice when minRoleYears is set and the employer count is known', () => {
      render(
        <SearchResultsList
          expandedIds={new Set()}
          hasMore={false}
          items={[createItem(0)]}
          onLoadMore={vi.fn()}
          onToggleExpanded={vi.fn()}
          verifiedOnlyNotice={{ minRoleYears: 3, roleFilterType: null, verifiedEmployerCount: 128 }}
        />,
      )

      const notice = screen.getByTestId('resume-verified-only-notice')
      expect(notice).toHaveTextContent('Results limited to industry-verified employers')
      expect(notice).toHaveTextContent('128')
    })

    it('renders the notice when roleFilterType is set and the employer count is known', () => {
      render(
        <SearchResultsList
          expandedIds={new Set()}
          hasMore={false}
          items={[createItem(0)]}
          onLoadMore={vi.fn()}
          onToggleExpanded={vi.fn()}
          verifiedOnlyNotice={{ minRoleYears: 0, roleFilterType: 'sales', verifiedEmployerCount: 42 }}
        />,
      )

      const notice = screen.getByTestId('resume-verified-only-notice')
      expect(notice).toHaveTextContent('42')
    })

    it('renders a review inbox link when the workspace user may attend the evidence queue', () => {
      render(
        <SearchResultsList
          expandedIds={new Set()}
          hasMore={false}
          items={[createItem(0)]}
          onLoadMore={vi.fn()}
          onToggleExpanded={vi.fn()}
          verifiedOnlyNotice={{ minRoleYears: 3, roleFilterType: null, verifiedEmployerCount: 128 }}
          verifiedOnlyReviewHref="/hr/system/settings/industry-verification?status=ready_for_review"
        />,
      )

      const notice = screen.getByTestId('resume-verified-only-notice')
      const link = within(notice).getByRole('link', { name: 'Review industry evidence' })
      expect(link).toHaveAttribute(
        'href',
        '/hr/system/settings/industry-verification?status=ready_for_review',
      )
    })

    it('renders no review link when no review href is passed', () => {
      render(
        <SearchResultsList
          expandedIds={new Set()}
          hasMore={false}
          items={[createItem(0)]}
          onLoadMore={vi.fn()}
          onToggleExpanded={vi.fn()}
          verifiedOnlyNotice={{ minRoleYears: 3, roleFilterType: null, verifiedEmployerCount: 128 }}
        />,
      )

      const notice = screen.getByTestId('resume-verified-only-notice')
      expect(within(notice).queryByRole('link')).not.toBeInTheDocument()
    })

    it('does not render the notice when no verifiedOnlyNotice prop is passed', () => {
      render(
        <SearchResultsList
          expandedIds={new Set()}
          hasMore={false}
          items={[createItem(0)]}
          onLoadMore={vi.fn()}
          onToggleExpanded={vi.fn()}
        />,
      )

      expect(screen.queryByTestId('resume-verified-only-notice')).not.toBeInTheDocument()
    })

    it('does not render the notice when the employer count is undefined', () => {
      render(
        <SearchResultsList
          expandedIds={new Set()}
          hasMore={false}
          items={[createItem(0)]}
          onLoadMore={vi.fn()}
          onToggleExpanded={vi.fn()}
          verifiedOnlyNotice={{ minRoleYears: 3, verifiedEmployerCount: undefined }}
        />,
      )

      expect(screen.queryByTestId('resume-verified-only-notice')).not.toBeInTheDocument()
    })

    it('does not render the notice when the employer count is zero', () => {
      render(
        <SearchResultsList
          expandedIds={new Set()}
          hasMore={false}
          items={[createItem(0)]}
          onLoadMore={vi.fn()}
          onToggleExpanded={vi.fn()}
          verifiedOnlyNotice={{ minRoleYears: 3, roleFilterType: null, verifiedEmployerCount: 0 }}
        />,
      )

      expect(screen.queryByTestId('resume-verified-only-notice')).not.toBeInTheDocument()
    })

    it('does not render the notice when no role gate is active', () => {
      render(
        <SearchResultsList
          expandedIds={new Set()}
          hasMore={false}
          items={[createItem(0)]}
          onLoadMore={vi.fn()}
          onToggleExpanded={vi.fn()}
          verifiedOnlyNotice={{ minRoleYears: 0, roleFilterType: null, verifiedEmployerCount: 128 }}
        />,
      )

      expect(screen.queryByTestId('resume-verified-only-notice')).not.toBeInTheDocument()
    })
  })

  it('loads a directly routed resume when it is not in the current result list', async () => {
    const resume = createItem(0).resume
    vi.mocked(useConvexResumeDetail).mockReturnValue({
      resume: resume as unknown as ReturnType<typeof useConvexResumeDetail>['resume'],
      loading: false,
    })

    render(
      <SearchResultsList
        detailResumeId="resume-0"
        expandedIds={new Set()}
        hasMore={false}
        items={[]}
        onCloseDetail={vi.fn()}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('resume-detail:Candidate 0')).toBeInTheDocument()
    })
    expect(screen.getByText('没有符合该搜索条件的简历')).toBeInTheDocument()
  })

  it('scrolls to a card and highlights it when the URL hash matches a loaded resume', async () => {
    const scrollIntoViewMock = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    window.location.hash = '#resume-resume-0'

    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={[createItem(0)]}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth', block: 'start' }),
      )
    })
    expect(screen.getByText('resume-0:collapsed').parentElement)
      .toHaveAttribute('data-highlighted', 'true')
  })

  it('scrolls a virtualized list to a card when the URL hash matches a loaded resume', () => {
    window.location.hash = '#resume-resume-44'

    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={Array.from({ length: 45 }, (_, index) => createItem(index))}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(44, { align: 'start' })
  })

  it('guides an active-workspace reviewer to the workspace review inbox for legacy signals', () => {
    useWorkspaceMock.mockReturnValue({ slug: 'hr', isPublicSurface: false })
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'reviewer' }],
    })
    const item = createItem(0)
    item.resume.ingestData = {
      evidenceText: '',
      industryTags: ['cnc'],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      industryDbV2Raw: 0,
      experienceLevel: 'mid',
      computedAt: 1,
      skillsVersion: 1,
      ruleScores: {},
      roleSignals: [{
        type: 'sales',
        matchedSignals: ['CNC Sales'],
        signalCount: 1,
        occurrences: 1,
        years: 3,
        industryVerifiedYears: 3,
        verifyIn: 'workHistory',
        matchedWorkEntries: [{
          companyName: 'Vision Machine Tools',
          jobTitle: 'Sales Engineer',
          years: 3,
          industryVerified: true,
          matchedSignals: ['CNC Sales'],
        }],
      }],
    }

    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={[item]}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(screen.getByText('Industry evidence needs human review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review industry evidence' }))
      .toHaveAttribute('href', '/hr/system/settings/industry-verification?status=ready_for_review')
  })

  it('hides legacy review guidance from plain members', () => {
    useWorkspaceMock.mockReturnValue({ slug: 'hr', isPublicSurface: false })
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'user' }],
    })
    const item = createItem(0)
    item.resume.ingestData = {
      evidenceText: '',
      industryTags: ['cnc'],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      industryDbV2Raw: 0,
      experienceLevel: 'mid',
      computedAt: 1,
      skillsVersion: 1,
      ruleScores: {},
      roleSignals: [{
        type: 'sales',
        matchedSignals: ['CNC Sales'],
        signalCount: 1,
        occurrences: 1,
        years: 3,
        industryVerifiedYears: 3,
        verifyIn: 'workHistory',
        matchedWorkEntries: [{
          companyName: 'Vision Machine Tools',
          jobTitle: 'Sales Engineer',
          years: 3,
          industryVerified: true,
          matchedSignals: ['CNC Sales'],
        }],
      }],
    }

    render(
      <SearchResultsList
        expandedIds={new Set()}
        hasMore={false}
        items={[item]}
        onLoadMore={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(screen.queryByText('Industry evidence needs human review')).not.toBeInTheDocument()
  })
})
