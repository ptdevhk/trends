import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SummaryRunsPage } from './SummaryRunsPage'

const { getMock, postMock, toastErrorMock, toastSuccessMock, tMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  tMock: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

type SummaryRun = {
  id: string
  workspaceSlug: string
  period: 'daily' | 'weekly'
  triggerSource: 'api_manual' | 'worker_schedule' | 'api_preview' | 'worker_manual'
  status: 'previewed' | 'dry_run' | 'sent' | 'failed'
  channel?: 'telegram' | 'wechat_work' | 'feishu' | 'email'
  templateId?: string
  dryRun: boolean
  windowStart: string
  windowEnd: string
  startedAt: string
  finishedAt?: string
  report: {
    workspaceSlug: string
    period: 'daily' | 'weekly'
    generatedAt: string
    window: {
      startAt: string
      endAt: string
      timezone: string
    }
    comparison?: {
      previousWindow: {
        startAt: string
        endAt: string
        timezone: string
      }
      totalsDelta: {
        sharedIngest: {
          newResumes: number
          collectionTasksCompleted: number
          collectionTasksFailed: number
        }
        workspaceActivity: {
          candidateStatusUpdates: number
          shortlistActions: number
          rejectActions: number
          contactActions: number
        }
      }
    }
    totals: {
      newResumes: number
      candidateStatusUpdates: number
      shortlistActions: number
      rejectActions: number
      contactActions: number
      collectionTasksCompleted: number
      collectionTasksFailed: number
    }
    breakdowns: {
      resumesBySource: unknown[]
      candidateStatusByValue: unknown[]
      actionsByType: unknown[]
      collectionTasksByStatus: unknown[]
    }
    notes: string[]
  }
  content?: string
  delivery?: {
    channel?: string
    accountsConfigured?: number
    accountsSelected?: number
    accountsAttempted?: number
    accountsSent?: number
    totalBatches?: number
    usedOverrideChatId?: boolean
    usedOverrideBotToken?: boolean
    accounts?: Array<{
      index: number
      chatIdHint: string
      attempted: boolean
      sent: boolean
      batchesPlanned: number
      skippedReason?: string
    }>
  }
  error?: string
}

function renderSummaryRunsPage() {
  return render(
    <MemoryRouter initialEntries={['/dev/system/summaries']}>
      <Routes>
        <Route path="/:teamSlug/system/summaries" element={<SummaryRunsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function createWeeklyRun(overrides: Partial<SummaryRun> = {}): SummaryRun {
  return {
    id: 'run-1',
    workspaceSlug: 'dev',
    period: 'weekly',
    triggerSource: 'api_manual',
    status: 'sent',
    channel: 'telegram',
    templateId: 'summary-daily',
    dryRun: false,
    windowStart: '2026-03-25T00:00:00Z',
    windowEnd: '2026-03-26T00:00:00Z',
    startedAt: '2026-03-26T00:05:00Z',
    finishedAt: '2026-03-26T00:05:30Z',
    report: {
      workspaceSlug: 'dev',
      period: 'weekly',
      generatedAt: '2026-03-26T00:05:00Z',
      window: {
        startAt: '2026-03-25T00:00:00Z',
        endAt: '2026-03-26T00:00:00Z',
        timezone: 'UTC',
      },
      comparison: {
        previousWindow: {
          startAt: '2026-03-18T00:00:00Z',
          endAt: '2026-03-25T00:00:00Z',
          timezone: 'UTC',
        },
        totalsDelta: {
          sharedIngest: {
            newResumes: 2,
            collectionTasksCompleted: 1,
            collectionTasksFailed: 0,
          },
          workspaceActivity: {
            candidateStatusUpdates: 1,
            shortlistActions: 1,
            rejectActions: 0,
            contactActions: 1,
          },
        },
      },
      totals: {
        newResumes: 2,
        candidateStatusUpdates: 1,
        shortlistActions: 1,
        rejectActions: 0,
        contactActions: 1,
        collectionTasksCompleted: 1,
        collectionTasksFailed: 0,
      },
      breakdowns: {
        resumesBySource: [],
        candidateStatusByValue: [],
        actionsByType: [],
        collectionTasksByStatus: [],
      },
      notes: ['First run note'],
    },
    content: 'Rendered summary content',
    delivery: {
      channel: 'telegram',
      accountsConfigured: 2,
      accountsSelected: 2,
      accountsAttempted: 1,
      accountsSent: 1,
      totalBatches: 2,
      usedOverrideChatId: true,
      accounts: [
        {
          index: 1,
          chatIdHint: '***1234',
          attempted: true,
          sent: true,
          batchesPlanned: 2,
        },
        {
          index: 2,
          chatIdHint: '***5678',
          attempted: false,
          sent: false,
          batchesPlanned: 0,
          skippedReason: 'missing token or chat_id',
        },
      ],
    },
    ...overrides,
  }
}

function createDailyFailedRun(): SummaryRun {
  return {
    id: 'run-2',
    workspaceSlug: 'dev',
    period: 'daily',
    triggerSource: 'worker_schedule',
    status: 'failed',
    channel: 'telegram',
    dryRun: false,
    windowStart: '2026-03-24T00:00:00Z',
    windowEnd: '2026-03-25T00:00:00Z',
    startedAt: '2026-03-25T00:05:00Z',
    finishedAt: '2026-03-25T00:05:45Z',
    report: {
      workspaceSlug: 'dev',
      period: 'daily',
      generatedAt: '2026-03-25T00:05:00Z',
      window: {
        startAt: '2026-03-24T00:00:00Z',
        endAt: '2026-03-25T00:00:00Z',
        timezone: 'UTC',
      },
      totals: {
        newResumes: 0,
        candidateStatusUpdates: 0,
        shortlistActions: 0,
        rejectActions: 0,
        contactActions: 0,
        collectionTasksCompleted: 0,
        collectionTasksFailed: 1,
      },
      breakdowns: {
        resumesBySource: [],
        candidateStatusByValue: [],
        actionsByType: [],
        collectionTasksByStatus: [],
      },
      notes: [],
    },
    content: 'Failed summary content',
    delivery: {
      channel: 'telegram',
      accountsAttempted: 1,
      accountsSent: 0,
      totalBatches: 3,
      accounts: [
        {
          index: 1,
          chatIdHint: '***9999',
          attempted: true,
          sent: false,
          batchesPlanned: 3,
        },
      ],
    },
    error: 'Telegram summary delivery failed',
  }
}

function createListAndDetailMocks(detailRun: SummaryRun, extraRuns: SummaryRun[] = []) {
  getMock.mockImplementation(async (path: string) => {
    if (path === '/api/summaries/runs') {
      return {
        data: {
          success: true,
          items: [detailRun, ...extraRuns],
        },
      }
    }

    if (path === `/api/summaries/runs/${detailRun.id}`) {
      return {
        data: {
          success: true,
          item: detailRun,
        },
      }
    }

    const matchingExtraRun = extraRuns.find((item) => `/api/summaries/runs/${item.id}` === path)
    if (matchingExtraRun) {
      return {
        data: {
          success: true,
          item: matchingExtraRun,
        },
      }
    }

    return { data: { success: false } }
  })
}

function getRequestBody(options: unknown): Record<string, unknown> {
  if (typeof options !== 'object' || options === null || !('body' in options)) {
    return {}
  }
  const body = options.body
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
}

describe('SummaryRunsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders summary run history and detail with delivery audit metadata', async () => {
    const user = userEvent.setup()
    const weeklyRun = createWeeklyRun()
    const failedRun = createDailyFailedRun()
    createListAndDetailMocks(weeklyRun, [failedRun])

    renderSummaryRunsPage()

    expect(await screen.findByText('run-1')).toBeInTheDocument()
    expect(await screen.findAllByText('Weekly')).toHaveLength(3)
    expect(await screen.findAllByText(/1\/1 sent • 2 batches • override/i)).toHaveLength(2)
    expect(await screen.findByText(/Compared with previous week • shared ingest \+2 resumes • workspace \+1 status/i)).toBeInTheDocument()
    expect(await screen.findByText(/Previous period window/i)).toBeInTheDocument()
    expect(await screen.findByText(/2026-03-18T00:00:00Z → 2026-03-25T00:00:00Z/i)).toBeInTheDocument()
    expect(await screen.findByText('***1234')).toBeInTheDocument()
    expect(await screen.findByText('Rendered summary content')).toBeInTheDocument()
    expect(await screen.findByText('First run note')).toBeInTheDocument()

    await user.click(screen.getAllByText('run-2')[0]!)

    await waitFor(() => {
      expect(screen.getAllByText(/0\/1 sent • 3 batches/i)).toHaveLength(2)
    })
    expect(screen.getByText('***9999')).toBeInTheDocument()
    expect(screen.getByText('Telegram summary delivery failed')).toBeInTheDocument()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('reuses the selected run and submits preview and send actions', async () => {
    const user = userEvent.setup()
    const weeklyRun = createWeeklyRun()
    createListAndDetailMocks(weeklyRun)

    postMock.mockImplementation(async (path: string, options?: unknown) => {
      expect(path).toBe('/api/summaries/run')
      const body = getRequestBody(options)

      if (body.dryRun === true) {
        return {
          data: {
            success: true,
            channel: body.channel,
            dryRun: true,
            templateId: body.templateId ?? 'summary-daily',
            subject: body.subject ?? 'Preview subject',
            report: weeklyRun.report,
            content: 'Preview content from dry run',
            run: createWeeklyRun({
              id: 'run-preview',
              status: 'dry_run',
              dryRun: true,
              channel: (typeof body.channel === 'string' ? body.channel : 'email') as SummaryRun['channel'],
              templateId: typeof body.templateId === 'string' ? body.templateId : 'summary-daily',
              windowEnd: typeof body.endAt === 'string' ? body.endAt : weeklyRun.windowEnd,
              content: 'Preview content from dry run',
              delivery: undefined,
            }),
          },
        }
      }

      return {
        data: {
          success: true,
          channel: body.channel,
          dryRun: false,
          templateId: body.templateId ?? 'summary-daily',
          subject: body.subject ?? 'Send subject',
          report: weeklyRun.report,
          content: 'Sent content from run',
          delivery: {
            channel: body.channel,
            accountsAttempted: 1,
            accountsSent: 1,
            totalBatches: 1,
          },
          run: createWeeklyRun({
            id: 'run-send',
            status: 'sent',
            dryRun: false,
            channel: (typeof body.channel === 'string' ? body.channel : 'telegram') as SummaryRun['channel'],
            templateId: typeof body.templateId === 'string' ? body.templateId : 'summary-daily',
            windowEnd: typeof body.endAt === 'string' ? body.endAt : weeklyRun.windowEnd,
            content: 'Sent content from run',
            delivery: {
              channel: typeof body.channel === 'string' ? body.channel : 'telegram',
              accountsAttempted: 1,
              accountsSent: 1,
              totalBatches: 1,
            },
          }),
        },
      }
    })

    renderSummaryRunsPage()

    expect(await screen.findByText('Rendered summary content')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use selected run' }))

    expect(screen.getByLabelText('Period')).toHaveValue('weekly')
    expect(screen.getByLabelText('Channel')).toHaveValue('telegram')
    expect(screen.getByLabelText('Template ID')).toHaveValue('summary-daily')
    expect(screen.getByLabelText('Window end (ISO8601)')).toHaveValue('2026-03-26T00:00:00Z')

    await user.selectOptions(screen.getByLabelText('Channel'), 'email')
    expect(screen.getByLabelText('Email recipient')).toBeInTheDocument()
    expect(screen.getByLabelText('Subject override')).toBeInTheDocument()
    expect(screen.queryByLabelText('Telegram bot token override')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Email recipient'), 'ops@example.com')
    await user.type(screen.getByLabelText('Subject override'), 'Weekly digest')
    await user.click(screen.getByRole('button', { name: 'Preview summary' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1)
    })
    expect(postMock.mock.calls[0]?.[0]).toBe('/api/summaries/run')
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({
      body: {
        period: 'weekly',
        channel: 'email',
        dryRun: true,
        templateId: 'summary-daily',
        endAt: '2026-03-26T00:00:00Z',
        to: 'ops@example.com',
        subject: 'Weekly digest',
      },
    })
    expect(await screen.findByText('Preview content from dry run')).toBeInTheDocument()
    expect(await screen.findByText('run-preview')).toBeInTheDocument()
    expect(toastSuccessMock).toHaveBeenCalledWith('Summary preview generated')

    await user.selectOptions(screen.getByLabelText('Channel'), 'telegram')
    expect(screen.queryByLabelText('Email recipient')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Telegram bot token override')).toBeInTheDocument()
    expect(screen.getByLabelText('Telegram chat ID override')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Telegram bot token override'), 'bot-1')
    await user.type(screen.getByLabelText('Telegram chat ID override'), 'chat-1')
    await user.click(screen.getByRole('button', { name: 'Send summary' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2)
    })
    expect(postMock.mock.calls[1]?.[1]).toMatchObject({
      body: {
        period: 'weekly',
        channel: 'telegram',
        dryRun: false,
        templateId: 'summary-daily',
        endAt: '2026-03-26T00:00:00Z',
        botToken: 'bot-1',
        chatId: 'chat-1',
      },
    })
    expect(postMock.mock.calls[1]?.[1]).not.toMatchObject({
      body: {
        to: 'ops@example.com',
        subject: 'Weekly digest',
      },
    })
    expect(await screen.findByText('Sent content from run')).toBeInTheDocument()
    expect(await screen.findByText('run-send')).toBeInTheDocument()
    expect(toastSuccessMock).toHaveBeenCalledWith('Summary sent')
  })

  it('shows an error toast for failed run actions and preserves the current detail', async () => {
    const user = userEvent.setup()
    const weeklyRun = createWeeklyRun()
    createListAndDetailMocks(weeklyRun)

    postMock.mockResolvedValue({
      error: {
        message: 'Failed to send summary',
      },
    })

    renderSummaryRunsPage()

    expect(await screen.findByText('Rendered summary content')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Preview summary' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1)
    })
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to send summary')
    expect(screen.getByText('Rendered summary content')).toBeInTheDocument()
  })
})
