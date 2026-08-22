import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewPacketsPage } from './ReviewPacketsPage'

const { getMock, postMock, toastSuccessMock, toastErrorMock, searchParamsState, tMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  searchParamsState: {
    value: new URLSearchParams(),
  },
  tMock: vi.fn((_key: string, options?: { defaultValue?: string; count?: number }) => {
    if (typeof options?.defaultValue === 'string') {
      return options.defaultValue.replace('{{count}}', String(options.count ?? ''))
    }
    return _key
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [searchParamsState.value, vi.fn()],
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

const existingRun = {
  id: 'run-1',
  workspaceSlug: 'dev',
  source: 'convex' as const,
  format: 'xlsx' as const,
  status: 'exported' as const,
  totalCount: 2,
  packetFilename: 'packet-run-1.xlsx',
  exportedAt: '2026-03-25T10:00:00.000Z',
}

const exportedRun = {
  id: 'run-2',
  workspaceSlug: 'dev',
  source: 'sample' as const,
  sampleName: 'sample-initial',
  format: 'xlsx' as const,
  status: 'exported' as const,
  totalCount: 3,
  packetFilename: 'packet-run-2.xlsx',
  exportedAt: '2026-03-25T11:00:00.000Z',
}

const failedRun = {
  id: 'run-3',
  workspaceSlug: 'dev',
  source: 'convex' as const,
  format: 'csv' as const,
  status: 'failed' as const,
  totalCount: 0,
  packetFilename: 'packet-run-3.csv',
  exportedAt: '2026-03-25T12:00:00.000Z',
}

describe('ReviewPacketsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParamsState.value = new URLSearchParams()
  })

  it('creates a tracked export run from manual resume IDs', async () => {
    const user = userEvent.setup()
    let includeExportedRun = false

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/resumes/review-packets') {
        return {
          data: {
            success: true,
            items: includeExportedRun ? [exportedRun, existingRun] : [existingRun],
          },
        }
      }

      if (path === '/api/resumes/review-packets/run-1') {
        return {
          data: {
            success: true,
            run: existingRun,
          },
        }
      }

      if (path === '/api/resumes/review-packets/run-2') {
        return {
          data: {
            success: true,
            run: exportedRun,
          },
        }
      }

      return { data: { success: true } }
    })

    postMock.mockImplementation(async (path: string, options?: { body?: unknown }) => {
      if (path === '/api/resumes/review-packets/export') {
        includeExportedRun = true
        expect(options).toEqual({
          body: {
            format: 'xlsx',
            source: 'sample',
            sample: 'sample-initial',
            sessionId: 'session-123',
            jobDescriptionId: 'lathe-sales',
            userComment: 'Batch note',
            referenceNote: 'Internal handoff',
            entries: [
              { resumeId: 'resume-1' },
              { resumeId: 'resume-2' },
              { resumeId: 'resume-3' },
            ],
          },
        })

        return {
          data: {
            success: true,
            run: exportedRun,
            downloadPath: '/api/resumes/review-packets/run-2/download',
          },
        }
      }

      return { data: { success: true } }
    })

    render(<ReviewPacketsPage />)

    expect(await screen.findByRole('button', { name: 'run-1' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Source'), 'sample')
    await user.type(screen.getByLabelText('Sample name'), 'sample-initial')
    await user.type(screen.getByLabelText('Session ID'), 'session-123')
    await user.type(screen.getByLabelText('Job description ID'), 'lathe-sales')
    await user.type(screen.getByLabelText('Resume IDs'), 'resume-1, resume-2\nresume-3')
    await user.type(screen.getByLabelText('User Comment'), 'Batch note')
    await user.type(screen.getByLabelText('Reference note'), 'Internal handoff')
    await user.click(screen.getByRole('button', { name: 'Create packet' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/resumes/review-packets/export',
        expect.objectContaining({
          body: expect.objectContaining({
            source: 'sample',
            sample: 'sample-initial',
            entries: [
              { resumeId: 'resume-1' },
              { resumeId: 'resume-2' },
              { resumeId: 'resume-3' },
            ],
          }),
        }),
      )
    })

    expect(await screen.findByRole('button', { name: 'run-2' })).toBeInTheDocument()
    expect(await screen.findByText('packet-run-2.xlsx')).toBeInTheDocument()
    expect(toastSuccessMock).toHaveBeenCalledWith('Review packet exported')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('renders the summary preview for the selected run', async () => {
    const user = userEvent.setup()

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/resumes/review-packets') {
        return {
          data: {
            success: true,
            items: [existingRun],
          },
        }
      }

      if (path === '/api/resumes/review-packets/run-1') {
        return {
          data: {
            success: true,
            run: existingRun,
          },
        }
      }

      return { data: { success: true } }
    })

    postMock.mockImplementation(async (path: string) => {
      if (path === '/api/resumes/review-packets/run-1/summary-preview') {
        return {
          data: {
            success: true,
            run: existingRun,
            channel: 'wechat_work',
            templateId: 'review-packet-wechat',
            content: 'Boss summary content',
            data: {
              packetId: 'run-1',
              workspaceSlug: 'dev',
              source: 'convex',
              exportedAt: '2026-03-25T10:00:00.000Z',
              totalExported: 2,
              reviewedCount: 1,
              pendingCount: 1,
              warningCount: 0,
              statusBreakdown: [],
              actionBreakdown: [],
              warnings: [],
            },
          },
        }
      }

      return { data: { success: true } }
    })

    render(<ReviewPacketsPage />)

    expect(await screen.findByRole('button', { name: 'run-1' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Preview summary' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/resumes/review-packets/run-1/summary-preview',
        expect.objectContaining({
          body: {
            templateId: 'review-packet-wechat',
          },
        }),
      )
    })

    expect(await screen.findByDisplayValue('Boss summary content')).toBeInTheDocument()
    expect(toastSuccessMock).toHaveBeenCalledWith('Summary preview generated')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('prefills the export form from route search params', async () => {
    searchParamsState.value = new URLSearchParams(
      'source=sample&format=csv&sample=sample-initial&jobDescriptionId=lathe-sales&sessionId=session-123&referenceNote=Internal%20handoff&resumeIds=resume-1,resume-2'
    )

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/resumes/review-packets') {
        return {
          data: {
            success: true,
            items: [existingRun],
          },
        }
      }

      if (path === '/api/resumes/review-packets/run-1') {
        return {
          data: {
            success: true,
            run: existingRun,
          },
        }
      }

      return { data: { success: true } }
    })

    render(<ReviewPacketsPage />)

    expect(await screen.findByRole('button', { name: 'run-1' })).toBeInTheDocument()
    expect(screen.getByLabelText('Source')).toHaveValue('sample')
    expect(screen.getByLabelText('Format')).toHaveValue('csv')
    expect(screen.getByLabelText('Sample name')).toHaveValue('sample-initial')
    expect(screen.getByLabelText('Session ID')).toHaveValue('session-123')
    expect(screen.getByLabelText('Job description ID')).toHaveValue('lathe-sales')
    expect(screen.getByLabelText('Reference note')).toHaveValue('Internal handoff')
    expect(screen.getByLabelText('Resume IDs')).toHaveValue('resume-1\nresume-2')
  })

  it('prefills resume IDs from a stored bulk-selection handoff and shows the parsed count', async () => {
    window.sessionStorage.setItem(
      'reviewPacketHandoff',
      JSON.stringify({ ids: ['resume-9', 'resume-10'], at: Date.now() }),
    )

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/resumes/review-packets') {
        return { data: { success: true, items: [] } }
      }
      return { data: { success: true } }
    })

    render(<ReviewPacketsPage />)

    expect(await screen.findByLabelText('Resume IDs')).toHaveValue('resume-9\nresume-10')
    expect(screen.getByTestId('review-packets-parsed-count')).toHaveTextContent('2 IDs parsed')
    expect(window.sessionStorage.getItem('reviewPacketHandoff')).toBeNull()
  })

  it('filters runs by status', async () => {
    const user = userEvent.setup()

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/resumes/review-packets') {
        return {
          data: {
            success: true,
            items: [failedRun, existingRun],
          },
        }
      }
      if (path === '/api/resumes/review-packets/run-1') {
        return { data: { success: true, run: existingRun } }
      }
      if (path === '/api/resumes/review-packets/run-3') {
        return { data: { success: true, run: failedRun } }
      }
      return { data: { success: true } }
    })

    render(<ReviewPacketsPage />)

    expect(await screen.findByRole('button', { name: 'run-1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'run-3' })).toBeInTheDocument()

    await user.selectOptions(screen.getByTestId('review-packets-status-filter'), 'failed')

    expect(screen.getByRole('button', { name: 'run-3' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'run-1' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-packets-no-matching-runs')).not.toBeInTheDocument()
  })

  it('shows the no-matching-runs state when the filter excludes every run', async () => {
    const user = userEvent.setup()

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/resumes/review-packets') {
        return {
          data: {
            success: true,
            items: [existingRun],
          },
        }
      }
      if (path === '/api/resumes/review-packets/run-1') {
        return { data: { success: true, run: existingRun } }
      }
      return { data: { success: true } }
    })

    render(<ReviewPacketsPage />)

    await screen.findByRole('button', { name: 'run-1' })
    await user.selectOptions(screen.getByTestId('review-packets-status-filter'), 'failed')

    expect(screen.getByTestId('review-packets-no-matching-runs')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'run-1' })).not.toBeInTheDocument()
  })

  it('copies a run ID to the clipboard with a success toast', async () => {
    const user = userEvent.setup()
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    })

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/resumes/review-packets') {
        return {
          data: {
            success: true,
            items: [existingRun],
          },
        }
      }
      if (path === '/api/resumes/review-packets/run-1') {
        return { data: { success: true, run: existingRun } }
      }
      return { data: { success: true } }
    })

    render(<ReviewPacketsPage />)

    await screen.findByRole('button', { name: 'run-1' })
    await user.click(screen.getByTestId('copy-run-id-run-1'))

    expect(writeTextMock).toHaveBeenCalledWith('run-1')
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('Run ID copied to clipboard')
    })
  })
})
