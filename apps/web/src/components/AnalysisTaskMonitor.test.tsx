import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockUseQuery = vi.hoisted(() => vi.fn())
const mockUseMutation = vi.hoisted(() => vi.fn(() => vi.fn()))
const cancelTaskMock = vi.hoisted(() => vi.fn(async () => undefined))
const useAnalysisTasksMock = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => (mockUseMutation as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: { analysis_tasks: { list: 'analysis_tasks:list', cancel: 'analysis_tasks:cancel' } },
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('@/contexts/AnalysisTasksContext', () => ({
  useAnalysisTasks: () => useAnalysisTasksMock(),
}))

import { AnalysisTaskMonitor } from '@/components/AnalysisTaskMonitor'

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: `task-${overrides.id ?? '1'}`,
    createdAt: Date.now() - 60000,
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

function mockAnalysisTasks(tasks: ReturnType<typeof makeTask>[], overrides: Record<string, unknown> = {}) {
  mockUseQuery.mockReturnValue(tasks)
  mockUseMutation.mockReturnValue(cancelTaskMock)
  useAnalysisTasksMock.mockReturnValue({
    tasks,
    loading: false,
    error: null,
    refresh: vi.fn(),
    dispatch: vi.fn(),
    cancel: cancelTaskMock,
    canManage: true,
    ...overrides,
  })
}

describe('AnalysisTaskMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnalysisTasks([])
  })

  it('renders null while BFF-backed task context is loading', () => {
    mockAnalysisTasks([], { loading: true })
    const { container } = render(<AnalysisTaskMonitor />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders null when tasks array is empty', () => {
    mockAnalysisTasks([])
    const { container } = render(<AnalysisTaskMonitor />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uses the analysis-task context instead of raw Convex task operations', () => {
    render(<AnalysisTaskMonitor />)

    expect(useAnalysisTasksMock).toHaveBeenCalled()
    expect(mockUseQuery).not.toHaveBeenCalled()
    expect(mockUseMutation).not.toHaveBeenCalled()
  })

  it('renders dialog trigger when tasks exist', () => {
    mockAnalysisTasks([makeTask()])
    render(<AnalysisTaskMonitor />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('shows active indicator styling when active tasks exist', () => {
    mockAnalysisTasks([makeTask({ status: 'processing' })])
    render(<AnalysisTaskMonitor />)
    const button = screen.getByRole('button')
    expect(button.className).toContain('text-primary')
  })

  it('does not show active indicator when only finished tasks exist', () => {
    mockAnalysisTasks([makeTask({ status: 'completed' })])
    render(<AnalysisTaskMonitor />)
    const button = screen.getByRole('button')
    expect(button.className).not.toContain('text-primary')
  })

  it('shows active and history sections in dialog', async () => {
    const user = userEvent.setup()
    mockAnalysisTasks([
      makeTask({ id: 'active-1', status: 'processing', progress: { current: 5, total: 10, skipped: 1 } }),
      makeTask({ id: 'done-1', status: 'completed', progress: { current: 10, total: 10, skipped: 0 }, results: { analyzed: 9, skipped: 0, failed: 0, avgScore: 85, highScoreCount: 3 } }),
    ])

    render(<AnalysisTaskMonitor />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
  })

  it('shows correct status badges for each status', async () => {
    const user = userEvent.setup()
    mockAnalysisTasks([
      makeTask({ id: 'p', status: 'pending' }),
      makeTask({ id: 'proc', status: 'processing' }),
      makeTask({ id: 'c', status: 'completed' }),
      makeTask({ id: 'f', status: 'failed' }),
      makeTask({ id: 'cc', status: 'cancelled' }),
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
    mockAnalysisTasks([
      makeTask({
        id: 'done-1',
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
    mockAnalysisTasks([
      makeTask({ id: 'fail-1', status: 'failed', error: 'LLM API timeout' }),
    ])

    render(<AnalysisTaskMonitor />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByText(/LLM API timeout/)).toBeInTheDocument()
  })

  it('shows cancel button for active tasks', async () => {
    const user = userEvent.setup()
    mockAnalysisTasks([
      makeTask({ id: 'active-1', status: 'processing' }),
    ])

    render(<AnalysisTaskMonitor />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByText(/aiTasks\.monitor\.cancel/)).toBeInTheDocument()
  })

  it('cancels an active task through the context using its BFF summary id', async () => {
    const user = userEvent.setup()
    mockAnalysisTasks([
      makeTask({ id: 'active-1', status: 'processing' }),
    ])

    render(<AnalysisTaskMonitor />)
    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText(/aiTasks\.monitor\.cancel/))

    expect(cancelTaskMock).toHaveBeenCalledWith('active-1')
    expect(mockUseMutation).not.toHaveBeenCalled()
  })
})
