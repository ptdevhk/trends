import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SchedulerStatus } from '@/components/SchedulerStatus'

const mockT = (key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
      if (key === 'common.loading') return 'Loading from i18n'
      if (typeof options === 'string') return options
      if (options?.defaultValue) {
        return options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_match: string, k: string) => String(options[k] ?? `{{${k}}}`))
      }
      return key
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('date-fns/formatDistanceToNow', () => ({
  formatDistanceToNow: () => '2 hours ago',
}))

const getMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    GET: (...args: unknown[]) => getMock(...args),
  },
}))

function mockStatusResponse(overrides: Record<string, unknown> = {}) {
  return getMock.mockResolvedValueOnce({
    data: {
      jobs_executed: 0, jobs_failed: 0, jobs_missed: 0,
      last_run: null, last_success: null, last_failure: null,
      schedule_type: null, schedule_value: null, running: false, jobs: [],
      ...overrides,
    },
    response: { ok: true, status: 200 },
  })
}

describe('SchedulerStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    getMock.mockReturnValue(new Promise(() => {}))
    render(<SchedulerStatus />)
    expect(screen.getByText('Loading from i18n')).toBeInTheDocument()
  })

  it('reserves the loaded-card structure while loading (stable grid height)', () => {
    getMock.mockReturnValue(new Promise(() => {}))
    render(<SchedulerStatus />)
    // The loading card keeps the loaded card's skeleton structure so the
    // loading→loaded swap never shifts the ops-page grid row (CLS).
    expect(screen.getByTestId('scheduler-status-loading')).toBeInTheDocument()
  })

  it('shows error state when fetch fails', async () => {
    getMock.mockRejectedValueOnce(new Error('network error'))
    render(<SchedulerStatus />)
    await waitFor(() => {
      expect(screen.getByText('Scheduler Offline')).toBeInTheDocument()
    })
    expect(screen.getByText('Failed to load scheduler status')).toBeInTheDocument()
  })

  it('shows error state when response is not ok', async () => {
    getMock.mockResolvedValueOnce({ data: undefined, response: { ok: false, status: 500 } })
    render(<SchedulerStatus />)
    await waitFor(() => {
      expect(screen.getByText('Scheduler Offline')).toBeInTheDocument()
    })
  })

  it('renders status data on successful fetch', async () => {
    mockStatusResponse({
      jobs_executed: 42, jobs_failed: 3, jobs_missed: 1,
      last_run: '2026-05-13T00:00:00Z', last_success: '2026-05-13T00:00:00Z',
      last_failure: '2026-05-12T12:00:00Z',
      schedule_type: 'cron', schedule_value: '0 */2 * * *', running: true,
      jobs: [{ id: 'crawl_analyze', name: 'Analyze', next_run: '2026-05-13T02:00:00Z', trigger: 'cron' }],
    })
    render(<SchedulerStatus />)
    await waitFor(() => { expect(screen.getByText('42')).toBeInTheDocument() })
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('debugConfig.running')).toBeInTheDocument()
  })

  it('renders job table rows', async () => {
    mockStatusResponse({
      schedule_type: 'interval', schedule_value: '30m', running: true,
      jobs: [
        { id: 'crawl_analyze', name: 'Analyze Resumes', next_run: '2026-05-13T02:00:00Z', trigger: 'interval' },
        { id: 'crawl_profile_1', name: 'Profile Crawl', next_run: null, trigger: 'manual' },
      ],
    })
    render(<SchedulerStatus />)
    await waitFor(() => { expect(screen.getByText('Analyze Resumes')).toBeInTheDocument() })
    expect(screen.getByText('Profile Crawl')).toBeInTheDocument()
    expect(screen.getByText('crawl_analyze')).toBeInTheDocument()
  })

  it('shows "no scheduled jobs" when jobs array is empty', async () => {
    mockStatusResponse({ running: false })
    render(<SchedulerStatus />)
    await waitFor(() => { expect(screen.getByText('debugConfig.noScheduledJobs')).toBeInTheDocument() })
  })

  it('fetches worker status through the shared api client', async () => {
    mockStatusResponse()
    render(<SchedulerStatus />)
    await waitFor(() => { expect(getMock).toHaveBeenCalledWith('/api/worker/status') })
  })

  it('shows retry button on error and recovers on click', async () => {
    const user = userEvent.setup()
    getMock.mockRejectedValueOnce(new Error('network error'))
    getMock.mockResolvedValueOnce({
      data: {
        jobs_executed: 1, jobs_failed: 0, jobs_missed: 0,
        last_run: null, last_success: null, last_failure: null,
        schedule_type: null, schedule_value: null, running: false, jobs: [],
      },
      response: { ok: true, status: 200 },
    })
    render(<SchedulerStatus />)
    await waitFor(() => { expect(screen.getByText('Scheduler Offline')).toBeInTheDocument() })
    expect(screen.getByTestId('scheduler-status-retry')).toBeInTheDocument()
    await user.click(screen.getByTestId('scheduler-status-retry'))
    await waitFor(() => { expect(screen.getByText('1')).toBeInTheDocument() })
    expect(getMock).toHaveBeenCalledTimes(2)
  })
})
