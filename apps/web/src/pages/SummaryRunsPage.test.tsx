import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SummaryRunsPage } from './SummaryRunsPage'

const { getMock, toastErrorMock, tMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  toastErrorMock: vi.fn(),
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
  },
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
  },
}))

function renderSummaryRunsPage() {
  return render(
    <MemoryRouter initialEntries={['/dev/system/summaries']}>
      <Routes>
        <Route path="/:teamSlug/system/summaries" element={<SummaryRunsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SummaryRunsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders summary run history and detail with delivery audit metadata', async () => {
    const user = userEvent.setup()

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/summaries/runs') {
        return {
          data: {
            success: true,
            items: [
              {
                id: 'run-1',
                workspaceSlug: 'dev',
                period: 'daily',
                triggerSource: 'api_manual',
                status: 'sent',
                channel: 'telegram',
                dryRun: false,
                windowStart: '2026-03-25T00:00:00Z',
                windowEnd: '2026-03-26T00:00:00Z',
                startedAt: '2026-03-26T00:05:00Z',
                finishedAt: '2026-03-26T00:05:30Z',
                report: {
                  workspaceSlug: 'dev',
                  period: 'daily',
                  generatedAt: '2026-03-26T00:05:00Z',
                  window: {
                    startAt: '2026-03-25T00:00:00Z',
                    endAt: '2026-03-26T00:00:00Z',
                    timezone: 'UTC',
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
                delivery: {
                  channel: 'telegram',
                  accountsAttempted: 1,
                  accountsSent: 1,
                  totalBatches: 2,
                  usedOverrideChatId: true,
                },
              },
              {
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
                delivery: {
                  channel: 'telegram',
                  accountsAttempted: 1,
                  accountsSent: 0,
                  totalBatches: 3,
                },
              },
            ],
          },
        }
      }

      if (path === '/api/summaries/runs/run-1') {
        return {
          data: {
            success: true,
            item: {
              id: 'run-1',
              workspaceSlug: 'dev',
              period: 'daily',
              triggerSource: 'api_manual',
              status: 'sent',
              channel: 'telegram',
              dryRun: false,
              windowStart: '2026-03-25T00:00:00Z',
              windowEnd: '2026-03-26T00:00:00Z',
              startedAt: '2026-03-26T00:05:00Z',
              finishedAt: '2026-03-26T00:05:30Z',
              report: {
                workspaceSlug: 'dev',
                period: 'daily',
                generatedAt: '2026-03-26T00:05:00Z',
                window: {
                  startAt: '2026-03-25T00:00:00Z',
                  endAt: '2026-03-26T00:00:00Z',
                  timezone: 'UTC',
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
            },
          },
        }
      }

      if (path === '/api/summaries/runs/run-2') {
        return {
          data: {
            success: true,
            item: {
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
            },
          },
        }
      }

      return { data: { success: false } }
    })

    renderSummaryRunsPage()

    expect(await screen.findByText('run-1')).toBeInTheDocument()
    expect(await screen.findAllByText(/1\/1 sent • 2 batches • override/i)).toHaveLength(2)
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
})
