import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchResultsList } from './SearchResultsList'
import type { ResumeSearchResultItem } from './search-types'
import type { UnverifiedLaneState } from '@/hooks/useConvexResumes'

// Shared stable mock t (repo convention: module-scope t, never inline arrow).
// The lane strings mirror zh-Hant values so assertions read like the UI.
const UNVERIFIED_LANE_STRINGS: Record<string, string> = {
  'industryEvidence.unverifiedLane.title':
    '结果仅含行业验证雇主 · 以下为关键词匹配但证据未计算的候选人',
  'industryEvidence.unverifiedLane.toggleWithCount': '匹配但未验证 ({{count}})',
  'industryEvidence.unverifiedLane.toggle': '匹配但未验证',
  'industryEvidence.unverifiedLane.loading': '加载未验证匹配…',
  'industryEvidence.unverifiedLane.empty': '没有额外的未验证匹配。',
  'industryEvidence.unverifiedLane.employerFunnel':
    '目录候选雇主（按出现次数）· 审核入册可提升验证覆盖',
  'industryEvidence.unverifiedLane.badge': '证据未验证',
  'industryEvidence.unverifiedLane.openProfile': '打开简历',
}

const mockT = (key: string, opts?: Record<string, unknown>) => {
  const value = UNVERIFIED_LANE_STRINGS[key]
  if (typeof value === 'string' && opts && 'count' in opts) {
    return value.replace('{{count}}', String(opts.count))
  }
  return value ?? key
}

// Mutable seat state: tests flip memberships to exercise role-gated panels.
const authState: { memberships: Array<Record<string, string>> } = { memberships: [] }

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ memberships: authState.memberships }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))

vi.mock('@/hooks/useResumeWorkHistoryLimit', () => ({
  useResumeWorkHistoryLimit: () => ({ limit: 3 }),
}))

vi.mock('@/hooks/useConvexResumes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useConvexResumes')>()
  return {
    ...actual,
    useConvexResumeDetail: () => ({ resume: null, loading: false }),
  }
})

const strictItem = {
  key: 'strict-1',
  identityKey: 'profileUrl:example/1',
  resume: {
    resumeId: 'r1' as never,
    name: '严格匹配',
    externalId: 'ext-1',
    crawledAt: 1,
    source: 'seek',
    tags: [],
    workHistory: [],
  } as never,
  blocked: false,
  status: 'new' as const,
} satisfies ResumeSearchResultItem

function buildLane(overrides: Partial<UnverifiedLaneState> = {}): UnverifiedLaneState {
  return {
    gateActive: true,
    estimatedCount: 448,
    expanded: false,
    loading: false,
    items: [],
    ...overrides,
  }
}

function renderList(lane: UnverifiedLaneState | undefined, onToggle = vi.fn()) {
  render(
    <SearchResultsList
      hasMore={false}
      items={[strictItem]}
      onLoadMore={vi.fn()}
      onToggleExpanded={vi.fn()}
      unverifiedLane={lane}
      onToggleUnverifiedLane={onToggle}
    />,
  )
  return onToggle
}

describe('UnverifiedLaneSection', () => {
  beforeEach(() => {
    authState.memberships = []
  })

  it('renders nothing when the lane is absent (gate inactive)', () => {
    renderList(undefined)
    expect(screen.queryByTestId('unverified-lane-section')).not.toBeInTheDocument()
  })

  it('renders nothing when the gate is inactive even if lane state exists', () => {
    renderList(buildLane({ gateActive: false, estimatedCount: 10 }))
    expect(screen.queryByTestId('unverified-lane-section')).not.toBeInTheDocument()
  })

  it('shows the collapsed toggle with the estimated count', () => {
    renderList(buildLane({ estimatedCount: 448 }))
    expect(screen.getByTestId('unverified-lane-section')).toBeInTheDocument()
    expect(screen.getByTestId('unverified-lane-toggle')).toHaveTextContent('匹配但未验证 (448)')
    expect(screen.queryByTestId('unverified-lane-row')).not.toBeInTheDocument()
  })

  it('shows the count-less label when the count is still loading', () => {
    renderList(buildLane({ estimatedCount: null }))
    expect(screen.getByTestId('unverified-lane-toggle')).toHaveTextContent('匹配但未验证')
    expect(screen.getByTestId('unverified-lane-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands on click and renders lane rows with the unverified badge', async () => {
    const user = userEvent.setup()
    const onToggle = renderList(
      buildLane({
        expanded: true,
        items: [
          {
            identityKey: 'profileUrl:seek/2',
            name: 'M. Dildar Hosen',
            employer: 'Benchmark Electronics (M) Sdn Bhd',
            location: 'Penang',
            source: 'hk.employer.seek.com',
            profileUrl: 'https://hk.employer.seek.com/candidates/abc',
          },
        ],
      }),
    )
    await user.click(screen.getByTestId('unverified-lane-toggle'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.getAllByTestId('unverified-lane-row')).toHaveLength(1)
    expect(screen.getByTestId('unverified-lane-badge')).toBeInTheDocument()
    expect(screen.getByText('Benchmark Electronics (M) Sdn Bhd')).toBeInTheDocument()
    expect(screen.getByText('Penang')).toBeInTheDocument()
    const profileLink = screen.getByRole('link', { name: /打开简历/ })
    expect(profileLink).toHaveAttribute('href', 'https://hk.employer.seek.com/candidates/abc')
  })

  it('shows the employer funnel only for industry-review seats', () => {
    authState.memberships = [{ workspaceSlug: 'hr', role: 'reviewer' }]
    renderList(
      buildLane({
        expanded: true,
        items: [
          {
            identityKey: 'profileUrl:seek/3',
            name: 'Kelvin Tan',
            employer: 'Seng Heng Precision Tools Sdn.Bhd',
          },
        ],
      }),
    )
    expect(screen.getByTestId('unverified-lane-employer-funnel')).toBeInTheDocument()
  })

  it('hides the employer funnel for plain HR seats', () => {
    renderList(
      buildLane({
        expanded: true,
        items: [
          {
            identityKey: 'profileUrl:seek/4',
            name: 'Plain HR candidate',
            employer: 'Some Employer Sdn Bhd',
          },
        ],
      }),
    )
    expect(screen.queryByTestId('unverified-lane-employer-funnel')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('unverified-lane-row')).toHaveLength(1)
  })
})