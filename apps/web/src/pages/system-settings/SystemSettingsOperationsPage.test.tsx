import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockUseMutation = vi.hoisted(() => vi.fn(() => vi.fn()))
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('convex/react', () => ({
  useMutation: (...args: unknown[]) => (mockUseMutation as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

vi.mock('lucide-react', () => ({
  Download: () => <svg data-testid="download-icon" />,
  RefreshCw: () => <svg data-testid="refresh-icon" />,
}))

vi.mock('../../../../../packages/convex/convex/_generated/api', () => ({
  api: { resume_tasks: { dispatch: 'resume_tasks:dispatch' } },
}))

vi.mock('@/components/SchedulerStatus', () => ({
  SchedulerStatus: () => <div data-testid="scheduler-status" />,
}))

vi.mock('@/components/TaskMonitor', () => ({
  TaskMonitor: () => <div data-testid="task-monitor" />,
}))

vi.mock('@/pages/system-settings/SystemSummary', () => ({
  SystemSummary: () => <div data-testid="system-summary" />,
}))

vi.mock('@/pages/system-settings/lib', () => ({
  useSettingsRequestJson: () => ({
    apiBaseUrl: 'http://localhost:8000',
    requestJson: (path: string, init?: RequestInit) => mockRequestJson(path, init),
  }),
}))

const mockRequestJson = vi.hoisted(() => vi.fn())

import { SystemSettingsOperationsPage } from './SystemSettingsOperationsPage'

let fetchSpy: ReturnType<typeof vi.spyOn>

describe('SystemSettingsOperationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('renders summary, scheduler status, and task monitor', () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))
    render(<SystemSettingsOperationsPage />)
    expect(screen.getByTestId('system-summary')).toBeInTheDocument()
    expect(screen.getByTestId('scheduler-status')).toBeInTheDocument()
    expect(screen.getByTestId('task-monitor')).toBeInTheDocument()
  })

  it('shows extension download card when version metadata loads', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ version: '1.2.3' }), { status: 200 }))
    render(<SystemSettingsOperationsPage />)
    // i18n mock returns key (no defaultValue), so check for the link element
    const downloadLink = await screen.findByRole('link', { name: /download/i })
    expect(downloadLink).toHaveAttribute('href', '/extension/trends-resume-collector-latest.zip')
  })

  it('does not show extension card before fetch resolves', () => {
    fetchSpy.mockReturnValue(new Promise(() => {}))
    render(<SystemSettingsOperationsPage />)
    expect(screen.queryByText(/1\.2\.3/)).not.toBeInTheDocument()
  })

  it('renders collection form inputs', () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))
    render(<SystemSettingsOperationsPage />)
    expect(screen.getByTestId('ops-collection-keyword')).toBeInTheDocument()
    expect(screen.getByTestId('ops-collection-location')).toBeInTheDocument()
    expect(screen.getByTestId('ops-collection-limit')).toBeInTheDocument()
    expect(screen.getByTestId('ops-collection-max-pages')).toBeInTheDocument()
    expect(screen.getByTestId('ops-start-collection')).toBeInTheDocument()
  })

  it('dispatches collection on button click', async () => {
    const mockDispatch = vi.fn()
    mockUseMutation.mockReturnValue(mockDispatch)
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))

    const user = userEvent.setup()
    render(<SystemSettingsOperationsPage />)

    await user.type(screen.getByTestId('ops-collection-keyword'), 'Engineer')
    await user.click(screen.getByTestId('ops-start-collection'))

    expect(mockDispatch).toHaveBeenCalledWith({
      keyword: 'Engineer',
      location: '广东',
      limit: 200,
      maxPages: 10,
    })
    expect(mockToast.success).toHaveBeenCalledWith('Collection task dispatched')
  })

  it('shows toast error when keyword is empty', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))
    const user = userEvent.setup()
    render(<SystemSettingsOperationsPage />)

    await user.click(screen.getByTestId('ops-start-collection'))

    expect(mockToast.error).toHaveBeenCalledWith('Please enter a keyword')
  })

  it('renders industry maintenance card with last run status', async () => {
    mockRequestJson.mockResolvedValue({
      success: true,
      items: [
        {
          runId: 'run-1',
          triggerSource: 'manual',
          status: 'completed',
          operatorSummary: 'completed; 1 ready.',
          startedAt: 100,
        },
      ],
    })
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))
    render(<SystemSettingsOperationsPage />)

    expect(await screen.findByTestId('ops-industry-maintenance-card')).toBeInTheDocument()
    expect(await screen.findByText('completed; 1 ready.')).toBeInTheDocument()
  })

  it('triggers maintenance run on button click and toasts runId', async () => {
    mockRequestJson.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/worker/industry-maintenance' && init?.method === 'POST') {
        return Promise.resolve({ success: true, runId: 'run-new', coalesced: false })
      }
      return Promise.resolve({ success: true, items: [] })
    })
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))
    const user = userEvent.setup()
    render(<SystemSettingsOperationsPage />)

    await user.click(await screen.findByTestId('ops-run-industry-maintenance'))
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining('run-new'),
    )
  })
})
