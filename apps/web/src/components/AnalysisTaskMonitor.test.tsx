import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockUseQuery = vi.hoisted(() => vi.fn())
const mockUseMutation = vi.hoisted(() => vi.fn(() => vi.fn()))

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: { analysis_tasks: { list: 'analysis_tasks:list', cancel: 'analysis_tasks:cancel' } },
}))

import { AnalysisTaskMonitor } from '@/components/AnalysisTaskMonitor'

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    _id: `task-${overrides.id ?? '1'}`,
    _creationTime: Date.now() - 60000,
    idempotencyKey: undefined,
    jobKey: undefined,
    config: {
      jobDescriptionId: undefined,
      jobDescriptionTitle: undefined,
      jobDescriptionContent: undefined,
      keywords: ['Sales Engineer'],
      location: undefined,
      promptVersion: undefined,
      sample: undefined,
      resumeCount: 10,
    },
    status: 'pending',
    progress: { current: 0, total: 10, skipped: 0 },
    results: undefined,
    error: undefined,
    ...overrides,
  }
}

describe('AnalysisTaskMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders null when tasks query is undefined (loading)', () => {
    mockUseQuery.mockReturnValue(undefined)
    const { container } = render(<AnalysisTaskMonitor />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders null when tasks array is empty', () => {
    mockUseQuery.mockReturnValue([])
    const { container } = render(<AnalysisTaskMonitor />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders dialog trigger when tasks exist', () => {
    mockUseQuery.mockReturnValue([makeTask()])
    render(<AnalysisTaskMonitor />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('shows active indicator styling when active tasks exist', () => {
    mockUseQuery.mockReturnValue([makeTask({ status: 'processing' })])
    render(<AnalysisTaskMonitor />)
    const button = screen.getByRole('button')
    expect(button.className).toContain('text-primary')
  })

  it('does not show active indicator when only finished tasks exist', () => {
    mockUseQuery.mockReturnValue([makeTask({ status: 'completed' })])
    render(<AnalysisTaskMonitor />)
    const button = screen.getByRole('button')
    expect(button.className).not.toContain('text-primary')
  })

  it('shows active and history sections in dialog', async () => {
    const user = userEvent.setup()
    mockUseQuery.mockReturnValue([
      makeTask({ _id: 'active-1', status: 'processing', progress: { current: 5, total: 10, skipped: 1 } }),
      makeTask({ _id: 'done-1', status: 'completed', progress: { current: 10, total: 10, skipped: 0 }, results: { analyzed: 9, skipped: 0, failed: 0, avgScore: 85, highScoreCount: 3 } }),
    ])

    render(<AnalysisTaskMonitor />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
  })

  it('shows correct status badges for each status', async () => {
    const user = userEvent.setup()
    mockUseQuery.mockReturnValue([
      makeTask({ _id: 'p', status: 'pending' }),
      makeTask({ _id: 'proc', status: 'processing' }),
      makeTask({ _id: 'c', status: 'completed' }),
      makeTask({ _id: 'f', status: 'failed' }),
      makeTask({ _id: 'cc', status: 'cancelled' }),
    ])

    render(<AnalysisTaskMonitor />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Processing')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('shows completed task results in the dialog', async () => {
    const user = userEvent.setup()
    mockUseQuery.mockReturnValue([
      makeTask({
        _id: 'done-1',
        status: 'completed',
        config: { resumeCount: 10, keywords: ['Sales Engineer'] },
        progress: { current: 10, total: 10, skipped: 0 },
        results: { analyzed: 9, skipped: 0, failed: 1, avgScore: 85, highScoreCount: 3 },
      }),
    ])

    render(<AnalysisTaskMonitor />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByText(/aiTasks\.monitor\.analyzed.*9/)).toBeInTheDocument()
    expect(screen.getByText(/aiTasks\.monitor\.avgScore.*85/)).toBeInTheDocument()
    expect(screen.getByText(/aiTasks\.monitor\.highScore.*3/)).toBeInTheDocument()
  })

  it('shows error message for failed tasks', async () => {
    const user = userEvent.setup()
    mockUseQuery.mockReturnValue([
      makeTask({ _id: 'fail-1', status: 'failed', error: 'LLM API timeout' }),
    ])

    render(<AnalysisTaskMonitor />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByText(/LLM API timeout/)).toBeInTheDocument()
  })

  it('shows cancel button for active tasks', async () => {
    const user = userEvent.setup()
    mockUseQuery.mockReturnValue([
      makeTask({ _id: 'active-1', status: 'processing' }),
    ])

    render(<AnalysisTaskMonitor />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByText(/aiTasks\.monitor\.cancel/)).toBeInTheDocument()
  })
})
