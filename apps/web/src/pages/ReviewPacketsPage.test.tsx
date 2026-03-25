import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewPacketsPage } from './ReviewPacketsPage'

const { getMock, postMock, toastSuccessMock, toastErrorMock, tMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
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

describe('ReviewPacketsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    await user.type(screen.getByLabelText('User comment'), 'Batch note')
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
    await user.click(screen.getByRole('button', { name: 'Preview summary' }))

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
})
