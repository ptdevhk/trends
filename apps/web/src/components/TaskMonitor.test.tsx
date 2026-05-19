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
  api: {
    resume_tasks: { list: 'resume_tasks:list', getWorkerHealth: 'resume_tasks:getWorkerHealth', cancel: 'resume_tasks:cancel' },
  },
}))

import { TaskMonitor } from '@/components/TaskMonitor'

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    _id: `task-${overrides.id ?? '1'}`,
    _creationTime: Date.now() - 60000,
    config: { keyword: 'Sales Engineer', limit: 50 },
    status: 'pending',
    progress: { current: 0, page: 0 },
    error: undefined,
    workerId: undefined,
    lastStatus: undefined,
    ...overrides,
  }
}

describe('TaskMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockImplementation((query: string) => {
      if (query === 'resume_tasks:list') return []
      if (query === 'resume_tasks:getWorkerHealth') return { hasHealthyWorker: true }
      return undefined
    })
  })

  it('renders null when tasks query is undefined (loading)', () => {
    mockUseQuery.mockReturnValue(undefined)
    const { container } = render(<TaskMonitor />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders null when tasks array is empty', () => {
    mockUseQuery.mockReturnValue([])
    const { container } = render(<TaskMonitor />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows active tasks with correct title', () => {
    mockUseQuery.mockImplementation((query: string) => {
      if (query === 'resume_tasks:list') return [makeTask({ status: 'processing' })]
      if (query === 'resume_tasks:getWorkerHealth') return { hasHealthyWorker: true }
      return undefined
    })
    render(<TaskMonitor />)
    expect(screen.getByText('Active Collections')).toBeInTheDocument()
    expect(screen.getByText('Sales Engineer')).toBeInTheDocument()
  })

  it('shows all-completed summary when only finished tasks exist', () => {
    mockUseQuery.mockImplementation((query: string) => {
      if (query === 'resume_tasks:list') return [makeTask({ status: 'completed' })]
      if (query === 'resume_tasks:getWorkerHealth') return { hasHealthyWorker: true }
      return undefined
    })
    render(<TaskMonitor />)
    expect(screen.getByText(/All tasks completed/)).toBeInTheDocument()
  })

  it('shows worker health warning when pending tasks exist without healthy worker', () => {
    mockUseQuery.mockImplementation((query: string) => {
      if (query === 'resume_tasks:list') return [makeTask({ status: 'pending' })]
      if (query === 'resume_tasks:getWorkerHealth') return { hasHealthyWorker: false }
      return undefined
    })
    render(<TaskMonitor />)
    expect(screen.getByText(/no healthy scraper worker/)).toBeInTheDocument()
  })

  it('shows page number for processing tasks', () => {
    mockUseQuery.mockImplementation((query: string) => {
      if (query === 'resume_tasks:list') return [makeTask({ status: 'processing', progress: { current: 25, page: 3 } })]
      if (query === 'resume_tasks:getWorkerHealth') return { hasHealthyWorker: true }
      return undefined
    })
    render(<TaskMonitor />)
    expect(screen.getByText(/Page 3/)).toBeInTheDocument()
    expect(screen.getByText(/25 \/ 50/)).toBeInTheDocument()
  })

  it('shows worker id for active tasks', () => {
    mockUseQuery.mockImplementation((query: string) => {
      if (query === 'resume_tasks:list') return [makeTask({ status: 'processing', workerId: 'worker-abc-123' })]
      if (query === 'resume_tasks:getWorkerHealth') return { hasHealthyWorker: true }
      return undefined
    })
    render(<TaskMonitor />)
    // workerId split by '-' and last segment shown: 'worker-abc-123' → '123'
    expect(screen.getByText(/Worker/)).toBeInTheDocument()
    expect(screen.getByText(/123/)).toBeInTheDocument()
  })

  it('shows error message for failed tasks in history', async () => {
    const user = userEvent.setup()
    mockUseQuery.mockImplementation((query: string) => {
      if (query === 'resume_tasks:list') {
        return [
          makeTask({ status: 'processing' }),
          makeTask({ _id: 'fail-1', status: 'failed', error: 'Scraper timeout' }),
        ]
      }
      if (query === 'resume_tasks:getWorkerHealth') return { hasHealthyWorker: true }
      return undefined
    })
    render(<TaskMonitor />)
    await user.click(screen.getByText(/View History/))
    expect(screen.getByText(/Scraper timeout/)).toBeInTheDocument()
  })

  it('shows cancel button for active tasks', () => {
    mockUseQuery.mockImplementation((query: string) => {
      if (query === 'resume_tasks:list') return [makeTask({ status: 'processing' })]
      if (query === 'resume_tasks:getWorkerHealth') return { hasHealthyWorker: true }
      return undefined
    })
    render(<TaskMonitor />)
    expect(screen.getAllByText('Cancel').length).toBeGreaterThanOrEqual(1)
  })

  it('toggles history view on button click', async () => {
    const user = userEvent.setup()
    mockUseQuery.mockImplementation((query: string) => {
      if (query === 'resume_tasks:list') {
        return [
          makeTask({ status: 'processing' }),
          makeTask({ _id: 'done-1', status: 'completed', config: { keyword: 'CNC Operator', limit: 30 } }),
        ]
      }
      if (query === 'resume_tasks:getWorkerHealth') return { hasHealthyWorker: true }
      return undefined
    })
    render(<TaskMonitor />)
    expect(screen.getByText('Active Collections')).toBeInTheDocument()
    expect(screen.queryByText('CNC Operator')).not.toBeInTheDocument()

    await user.click(screen.getByText(/View History/))
    expect(screen.getByText('CNC Operator')).toBeInTheDocument()
  })
})
