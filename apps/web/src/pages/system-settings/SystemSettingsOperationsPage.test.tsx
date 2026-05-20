import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockUseMutation = vi.hoisted(() => vi.fn(() => vi.fn()))
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('convex/react', () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

vi.mock('lucide-react', () => ({
  Download: () => <svg data-testid="download-icon" />,
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
  useSettingsRequestJson: () => ({ apiBaseUrl: 'http://localhost:8000' }),
}))

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
})
