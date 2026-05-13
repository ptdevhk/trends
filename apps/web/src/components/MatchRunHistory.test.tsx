import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MatchRunHistory } from '@/components/MatchRunHistory'
import type { MatchRunItem } from '@/hooks/useMatchRunHistory'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) => {
      if (typeof options === 'string') return options
      if (options?.defaultValue) return options.defaultValue
      return key
    },
  }),
}))

const mockUseMatchRunHistory = vi.fn()
vi.mock('@/hooks/useMatchRunHistory', () => ({
  useMatchRunHistory: (...args: unknown[]) => mockUseMatchRunHistory(...args),
}))

function makeRun(overrides: Partial<MatchRunItem> = {}): MatchRunItem {
  return {
    id: 'run-1',
    jobDescriptionId: 'jd-1',
    mode: 'hybrid',
    status: 'completed',
    totalCount: 100,
    processedCount: 100,
    failedCount: 0,
    matchedCount: 25,
    avgScore: 72,
    startedAt: '2026-05-13T00:00:00Z',
    ...overrides,
  }
}

describe('MatchRunHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMatchRunHistory.mockReturnValue({ runs: [], loading: false, error: null })
  })

  it('renders nothing when loading', () => {
    mockUseMatchRunHistory.mockReturnValue({ runs: [], loading: true, error: null })
    const { container } = render(<MatchRunHistory sessionId="s-1" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when error and no runs', () => {
    mockUseMatchRunHistory.mockReturnValue({ runs: [], loading: false, error: 'network' })
    const { container } = render(<MatchRunHistory sessionId="s-1" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no runs', () => {
    const { container } = render(<MatchRunHistory sessionId="s-1" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows completed summary when latest run is completed and no active runs', () => {
    mockUseMatchRunHistory.mockReturnValue({
      runs: [makeRun({ status: 'completed' })],
      loading: false,
      error: null,
    })
    render(<MatchRunHistory sessionId="s-1" />)
    expect(screen.getByText('aiTasks.monitor.allCompleted')).toBeInTheDocument()
    expect(screen.getByText('aiTasks.monitor.showHistory')).toBeInTheDocument()
  })

  it('shows failed summary when latest run failed', () => {
    mockUseMatchRunHistory.mockReturnValue({
      runs: [makeRun({ status: 'failed', error: 'timeout' })],
      loading: false,
      error: null,
    })
    render(<MatchRunHistory sessionId="s-1" />)
    expect(screen.getByText(/timeout/)).toBeInTheDocument()
  })

  it('shows active runs with progress', () => {
    mockUseMatchRunHistory.mockReturnValue({
      runs: [makeRun({ status: 'processing', processedCount: 50, totalCount: 100 })],
      loading: false,
      error: null,
    })
    render(<MatchRunHistory sessionId="s-1" />)
    expect(screen.getByText('aiTasks.monitor.activeTitle')).toBeInTheDocument()
    expect(screen.getByText(/50 \/ 100/)).toBeInTheDocument()
  })

  it('toggles history visibility when button is clicked', async () => {
    mockUseMatchRunHistory.mockReturnValue({
      runs: [makeRun({ status: 'completed' })],
      loading: false,
      error: null,
    })
    render(<MatchRunHistory sessionId="s-1" />)
    const user = userEvent.setup()
    await user.click(screen.getByText('aiTasks.monitor.showHistory'))
    expect(screen.getByText('jd-1')).toBeInTheDocument()
  })

  it('passes sessionId and jobDescriptionId to hook', () => {
    render(<MatchRunHistory sessionId="s-1" jobDescriptionId="jd-1" />)
    expect(mockUseMatchRunHistory).toHaveBeenCalledWith({
      sessionId: 's-1',
      jobDescriptionId: 'jd-1',
      enabled: true,
      limit: 20,
    })
  })

  it('shows mode label for each run', () => {
    mockUseMatchRunHistory.mockReturnValue({
      runs: [makeRun({ mode: 'ai_only', status: 'processing' })],
      loading: false,
      error: null,
    })
    render(<MatchRunHistory sessionId="s-1" />)
    expect(screen.getByText('AI')).toBeInTheDocument()
  })
})
