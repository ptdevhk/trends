import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SchedulerStatus } from '@/components/SchedulerStatus'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('date-fns/formatDistanceToNow', () => ({
  formatDistanceToNow: () => '2 hours ago',
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('SchedulerStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {})) // never resolves
    render(<SchedulerStatus apiBaseUrl="http://localhost:3001" />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows error state when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'))
    render(<SchedulerStatus apiBaseUrl="http://localhost:3001" />)
    await waitFor(() => {
      expect(screen.getByText('Scheduler Offline')).toBeInTheDocument()
    })
    expect(screen.getByText('Failed to load scheduler status')).toBeInTheDocument()
  })

  it('shows error state when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    render(<SchedulerStatus apiBaseUrl="http://localhost:3001" />)
    await waitFor(() => {
      expect(screen.getByText('Scheduler Offline')).toBeInTheDocument()
    })
  })

  it('renders status data on successful fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobs_executed: 42,
        jobs_failed: 3,
        jobs_missed: 1,
        last_run: '2026-05-13T00:00:00Z',
        last_success: '2026-05-13T00:00:00Z',
        last_failure: '2026-05-12T12:00:00Z',
        schedule_type: 'cron',
        schedule_value: '0 */2 * * *',
        running: true,
        jobs: [
          { id: 'crawl_analyze', name: 'Analyze', next_run: '2026-05-13T02:00:00Z', trigger: 'cron' },
        ],
      }),
    })
    render(<SchedulerStatus apiBaseUrl="http://localhost:3001" />)
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument()
    })
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('debugConfig.running')).toBeInTheDocument()
  })

  it('renders job table rows', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobs_executed: 0,
        jobs_failed: 0,
        jobs_missed: 0,
        last_run: null,
        last_success: null,
        last_failure: null,
        schedule_type: 'interval',
        schedule_value: '30m',
        running: true,
        jobs: [
          { id: 'crawl_analyze', name: 'Analyze Resumes', next_run: '2026-05-13T02:00:00Z', trigger: 'interval' },
          { id: 'crawl_profile_1', name: 'Profile Crawl', next_run: null, trigger: 'manual' },
        ],
      }),
    })
    render(<SchedulerStatus apiBaseUrl="http://localhost:3001" />)
    await waitFor(() => {
      expect(screen.getByText('Analyze Resumes')).toBeInTheDocument()
    })
    expect(screen.getByText('Profile Crawl')).toBeInTheDocument()
    expect(screen.getByText('crawl_analyze')).toBeInTheDocument()
  })

  it('shows "no scheduled jobs" when jobs array is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobs_executed: 0,
        jobs_failed: 0,
        jobs_missed: 0,
        last_run: null,
        last_success: null,
        last_failure: null,
        schedule_type: null,
        schedule_value: null,
        running: false,
        jobs: [],
      }),
    })
    render(<SchedulerStatus apiBaseUrl="http://localhost:3001" />)
    await waitFor(() => {
      expect(screen.getByText('debugConfig.noScheduledJobs')).toBeInTheDocument()
    })
  })

  it('fetches from the correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobs_executed: 0, jobs_failed: 0, jobs_missed: 0,
        last_run: null, last_success: null, last_failure: null,
        schedule_type: null, schedule_value: null, running: false, jobs: [],
      }),
    })
    render(<SchedulerStatus apiBaseUrl="http://example.com" />)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('http://example.com/api/worker/status')
    })
  })
})
