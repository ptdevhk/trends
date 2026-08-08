import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeList } from './ResumeList'

const { apiPostMock } = vi.hoisted(() => ({
  apiPostMock: vi.fn(),
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

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams()],
  useNavigate: () => vi.fn(),
}))

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: () => ({
    getTotalSize: () => 1000,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
  }),
}))

vi.mock('@/hooks/useResumeListState', () => ({
  useResumeListState: () => mockResumeListState,
}))

vi.mock('@/hooks/useSyncNotifications', () => ({
  useSyncNotifications: () => {},
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'test-workspace' }),
}))

vi.mock('@/hooks/useBrandDisplayMap', () => ({
  useBrandDisplayMap: () => ({ resolve: (id: string) => id.toUpperCase() }),
}))

vi.mock('@/hooks/useConvexResumes', () => ({
  useConvexResumeDetail: () => ({ resume: null, loading: false }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: (...args: unknown[]) => apiPostMock(...args),
  },
}))

vi.mock('@/lib/resume-scoring', () => ({
  buildResumeKey: (_resume: Record<string, unknown>, idx: number) => `key-${idx}`,
  hasIngestData: () => false,
}))

vi.mock('@/lib/pointer-preload', () => ({
  shouldPreloadOnPointerDown: () => false,
}))

// Mock IntersectionObserver for load-more behavior
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

// Mock heavy child components that use Convex
vi.mock('@/components/QuickStartPanel', () => ({
  QuickStartPanel: ({ onResetAll, extraActions }: { onResetAll: () => void; extraActions: React.ReactNode }) => (
    <div data-testid="quick-start-panel">
      <button onClick={onResetAll}>Reset</button>
      {extraActions}
    </div>
  ),
}))

vi.mock('@/components/FilterPanel', () => ({
  FilterPanel: ({ headerAction }: { headerAction: React.ReactNode }) => (
    <div data-testid="filter-panel">{headerAction}</div>
  ),
}))

vi.mock('@/components/BulkActionBar', () => ({
  BulkActionBar: () => <div data-testid="bulk-action-bar" />,
}))

vi.mock('@/components/AnalysisTaskMonitor', () => ({
  AnalysisTaskMonitor: () => <div data-testid="analysis-task-monitor" />,
}))

vi.mock('@/components/CollectResumesButton', () => ({
  CollectResumesButton: () => <div data-testid="collect-resumes-button" />,
}))

vi.mock('@/components/ShareLinkButton', () => ({
  ShareLinkButton: (props: {
    shareTitle: string
    state: unknown
    createPublicShare?: (options: {
      shareTitle: string
      searchState: unknown
    }) => Promise<unknown>
  }) => (
    <button
      type="button"
      data-testid="share-link-button"
      onClick={() => {
        void props.createPublicShare?.({
          shareTitle: props.shareTitle,
          searchState: props.state,
        })
      }}
    >
      Share
    </button>
  ),
}))

vi.mock('@/components/ResumeCard', () => ({
  ResumeCard: ({ resume }: { resume: { name: string } }) => (
    <div data-testid="resume-card">{resume.name}</div>
  ),
  ResumeCardSkeleton: () => <div data-testid="resume-card-skeleton" />,
}))

vi.mock('@/components/EmptyState', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
      {action}
    </div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}))

const baseMockState = {
  sessionLocation: 'Dongguan',
  sessionKeywords: 'CNC',
  sessionCollectionSource: 'job5156',
  jobDescriptionId: undefined as string | undefined,
  filters: { minRoleYears: undefined, roleFilterType: undefined, maxAge: undefined, minAge: undefined },
  reviewedIdsSet: new Set<string>(),
  trackReviewedResume: vi.fn(),
  error: null as string | null,
  activeLoading: false,
  analyzing: false,
  hasActiveTask: false,
  disableAnalyzeButton: false,
  selectedIds: new Set<string>(),
  activeSessionTitle: '',
  activeSessionLabel: '',
  activeSessionDescription: '',
  activeSessionNote: '',
  activeSessionId: '',
  shareTitle: '',
  shareState: {},
  selectedExperienceLevel: undefined as string | undefined,
  activeTagFilters: [] as string[],
  activeCompanyFilters: [] as string[],
  highScoreCount: 0,
  blockedCount: 0,
  bulkExportFormat: 'csv' as const,
  displayedResumes: [] as Array<Record<string, unknown>>,
  loadedConvexResumeCount: 0,
  canLoadMoreResumes: false,
  convexLoadingMore: false,
  searchHistory: [],
  searchHistoryLoading: false,
  setBulkExportFormat: vi.fn(),
  handleAnalyzeAll: vi.fn(),
  handleRefresh: vi.fn(),
  handleLoadMoreResumes: vi.fn(),
  handleQuickStartApply: vi.fn(),
  handleQuickConstraintApply: vi.fn(),
  handleCollectionSourceChange: vi.fn(),
  handleSaveCurrentSearch: vi.fn(),
  handleApplySearchHistory: vi.fn(),
  handleJobChange: vi.fn(),
  handleFiltersChange: vi.fn(),
  handleToggleTag: vi.fn(),
  handleToggleCompany: vi.fn(),
  handleToggleExperienceLevel: vi.fn(),
  handleSelectAll: vi.fn(),
  handleSelectHighScore: vi.fn(),
  replaceSelection: vi.fn(),
  pruneSelection: vi.fn(),
  handleClearSelection: vi.fn(),
  handleToggleSelect: vi.fn(),
  handleBulkAction: vi.fn(),
  handleCardAction: vi.fn(),
  handleToggleBlock: vi.fn(),
  handleCandidateStatusChange: vi.fn(),
  handleResetAll: vi.fn(),
  ensureApiSession: vi.fn(),
  handleShareSessionCopied: vi.fn(),
  handleAiFeedback: vi.fn(),
  handleRating: vi.fn(),
  getAiFeedback: vi.fn(() => undefined),
  ratingsByResume: {},
  commentsByResume: {},
}

let mockResumeListState = { ...baseMockState }

describe('ResumeList', () => {
  beforeEach(() => {
    mockResumeListState = { ...baseMockState }
    vi.clearAllMocks()
    apiPostMock.mockResolvedValue({
      data: {
        success: true,
        share: {
          publicPath: '/s/public-token-1',
        },
      },
    })
  })

  it('renders empty state when no resumes and not loading', () => {
    render(<ResumeList />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('No resumes found')).toBeInTheDocument()
  })

  it('renders error state when error is present', () => {
    mockResumeListState.error = 'Network error'
    render(<ResumeList />)
    expect(screen.getByText('Failed to load resumes')).toBeInTheDocument()
  })

  it('renders retry button in error state', () => {
    mockResumeListState.error = 'Network error'
    render(<ResumeList />)
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('renders skeletons when loading', () => {
    mockResumeListState.activeLoading = true
    render(<ResumeList />)
    const skeletons = screen.getAllByTestId('resume-card-skeleton')
    expect(skeletons).toHaveLength(3)
  })

  it('renders resume cards when resumes are present', () => {
    mockResumeListState.displayedResumes = [
      {
        key: 'key-0',
        resume: {
          name: 'Alice',
          profileUrl: 'https://example.com/1',
          activityStatus: 'Active',
          age: '30',
          experience: '5 years',
          education: 'Bachelor',
          location: 'Dongguan',
          selfIntro: 'Test',
          jobIntention: 'Engineer',
          expectedSalary: '10k',
          workHistory: [],
          extractedAt: '2026-01-01T00:00:00.000Z',
        },
        match: undefined,
        ruleScore: undefined,
        action: undefined,
        blocked: false,
        status: undefined,
        statusMeta: undefined,
        userRating: undefined,
        identityKey: 'id-0',
      },
    ] as unknown as Array<Record<string, unknown>>
    render(<ResumeList />)
    expect(screen.getByTestId('resume-card')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('renders load more button when canLoadMoreResumes is true', () => {
    mockResumeListState.canLoadMoreResumes = true
    mockResumeListState.displayedResumes = [
      {
        key: 'key-0',
        resume: { name: 'Alice', profileUrl: 'https://example.com/1', activityStatus: 'Active', age: '30', experience: '5 years', education: 'Bachelor', location: 'DG', selfIntro: 'Test', jobIntention: 'Eng', expectedSalary: '10k', workHistory: [], extractedAt: '2026-01-01T00:00:00.000Z' },
        match: undefined, ruleScore: undefined, action: undefined, blocked: false, status: undefined, statusMeta: undefined, userRating: undefined, identityKey: 'id-0',
      },
    ] as unknown as Array<Record<string, unknown>>
    render(<ResumeList />)
    expect(screen.getByText('Load More')).toBeInTheDocument()
  })

  it('renders Analyze All button when no resumes are selected', () => {
    render(<ResumeList />)
    expect(screen.getByText('resumes.analyzeAll')).toBeInTheDocument()
  })

  it('does not render Analyze All when resumes are selected', () => {
    mockResumeListState.selectedIds = new Set(['key-0'])
    render(<ResumeList />)
    expect(screen.queryByText('resumes.analyzeAll')).not.toBeInTheDocument()
  })

  it('renders History button', () => {
    render(<ResumeList />)
    expect(screen.getByText('History')).toBeInTheDocument()
  })

  it('renders Import resumes button', () => {
    render(<ResumeList />)
    expect(screen.getByText('Import resumes')).toBeInTheDocument()
  })

  it('renders loaded count when canLoadMoreResumes', () => {
    mockResumeListState.canLoadMoreResumes = true
    mockResumeListState.loadedConvexResumeCount = 42
    mockResumeListState.displayedResumes = [
      {
        key: 'key-0',
        resume: { name: 'Alice', profileUrl: 'https://example.com/1', activityStatus: 'Active', age: '30', experience: '5 years', education: 'Bachelor', location: 'DG', selfIntro: 'Test', jobIntention: 'Eng', expectedSalary: '10k', workHistory: [], extractedAt: '2026-01-01T00:00:00.000Z' },
        match: undefined, ruleScore: undefined, action: undefined, blocked: false, status: undefined, statusMeta: undefined, userRating: undefined, identityKey: 'id-0',
      },
    ] as unknown as Array<Record<string, unknown>>
    render(<ResumeList />)
    expect(screen.getByText('Loaded 42 resumes so far')).toBeInTheDocument()
  })

  it('renders save search button', () => {
    render(<ResumeList />)
    expect(screen.getByText('Save search')).toBeInTheDocument()
  })

  it('renders multiple resume cards', () => {
    mockResumeListState.displayedResumes = [
      {
        key: 'key-0',
        resume: { name: 'Alice', profileUrl: 'https://example.com/1', activityStatus: 'Active', age: '30', experience: '5 years', education: 'Bachelor', location: 'DG', selfIntro: 'Test', jobIntention: 'Eng', expectedSalary: '10k', workHistory: [], extractedAt: '2026-01-01T00:00:00.000Z' },
        match: undefined, ruleScore: undefined, action: undefined, blocked: false, status: undefined, statusMeta: undefined, userRating: undefined, identityKey: 'id-0',
      },
      {
        key: 'key-1',
        resume: { name: 'Bob', profileUrl: 'https://example.com/2', activityStatus: 'Active', age: '25', experience: '3 years', education: 'Master', location: 'SZ', selfIntro: 'Dev', jobIntention: 'SWE', expectedSalary: '20k', workHistory: [], extractedAt: '2026-01-02T00:00:00.000Z' },
        match: undefined, ruleScore: undefined, action: undefined, blocked: false, status: undefined, statusMeta: undefined, userRating: undefined, identityKey: 'id-1',
      },
    ] as unknown as Array<Record<string, unknown>>
    render(<ResumeList />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('renders quick-start-panel and filter-panel', () => {
    render(<ResumeList />)
    expect(screen.getByTestId('quick-start-panel')).toBeInTheDocument()
    expect(screen.getByTestId('filter-panel')).toBeInTheDocument()
  })

  it('renders bulk-action-bar', () => {
    render(<ResumeList />)
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()
  })

  it('creates public shares from every loaded displayed resume', async () => {
    const user = userEvent.setup()
    mockResumeListState.activeSessionId = 'legacy-session-1'
    mockResumeListState.shareTitle = 'China · CNC'
    mockResumeListState.shareState = {
      location: 'China',
      keywords: ['CNC'],
      requiredKeywords: ['销售'],
      filters: {
        minRoleYears: 1,
        roleFilterType: 'sales',
        minAge: 25,
        maxAge: 40,
      },
    }
    mockResumeListState.displayedResumes = Array.from({ length: 101 }, (_, index) => ({
      key: `key-${index + 1}`,
      identityKey: `identity-${index + 1}`,
      resume: {
        name: `Candidate ${index + 1}`,
        profileUrl: `https://example.com/${index + 1}`,
        activityStatus: 'Active',
        age: '30',
        experience: '5 years',
        education: 'Bachelor',
        location: 'China',
        selfIntro: 'CNC sales',
        jobIntention: 'Sales',
        expectedSalary: '10k',
        workHistory: [],
        extractedAt: '2026-01-01T00:00:00.000Z',
      },
      match: undefined,
      ruleScore: undefined,
      action: undefined,
      blocked: false,
      status: undefined,
      statusMeta: undefined,
      userRating: undefined,
    })) as unknown as Array<Record<string, unknown>>

    render(<ResumeList />)

    await user.click(screen.getByTestId('share-link-button'))

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalled()
    })
    const request = apiPostMock.mock.calls[0]?.[1] as { body: { results: Array<Record<string, unknown>> } } | undefined
    expect(request?.body.results).toHaveLength(101)
    expect(request?.body.results[100]).toMatchObject({
      resumeKey: 'identity-101',
      displayName: 'Candidate 101',
    })
  })
})
