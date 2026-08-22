import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndustryReviewInbox } from './IndustryReviewInbox'

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}))

// Module-scope stable `t` (repo convention — inline `t` destabilizes useCallback deps).
const mockT = (key: string, opts?: string | Record<string, unknown>) => {
  if (typeof opts === 'string') {
    return opts
  }
  if (opts?.defaultValue && typeof opts.defaultValue === 'string') {
    return opts.defaultValue.replace(
      /\{\{(\w+)\}\}/g,
      (_match: string, varName: string) => String(opts[varName] ?? `{{${varName}}}`),
    )
  }
  return key
}

const searchParamsState: { value: URLSearchParams } = { value: new URLSearchParams() }

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [
    searchParamsState.value,
    (next: URLSearchParams) => {
      searchParamsState.value = next
    },
  ],
}))

vi.mock('./IndustryReviewRow', () => ({
  IndustryReviewRow: () => <div data-testid="mock-review-row" />,
}))

vi.mock('./IndustryBatchReview', () => ({
  IndustryBatchActionBar: () => <div />,
  IndustryBatchApproveDialog: () => <div />,
  IndustryBatchRejectDialog: () => <div />,
}))

vi.mock('./IndustryIdentityResolutionDialog', () => ({
  IndustryIdentityResolutionDialog: () => <div />,
}))

vi.mock('./IndustryHistoryList', () => ({
  IndustryHistoryList: ({ items }: { items: Array<{ proposalId: string; status: string }> }) => (
    <div data-testid="mock-history-list">{items.map((item) => `${item.proposalId}:${item.status}`).join(',')}</div>
  ),
}))

const requestJson = vi.fn()

function historyItem(proposalId: string, status: string, reviewedAt = 100) {
  return { proposalId, status, reviewedAt, updatedAt: reviewedAt }
}

function inboxProps() {
  return {
    requestJson,
    initialStatus: 'ready_for_review' as const,
    onQueueStatusChange: vi.fn(),
    onSelectProposal: vi.fn(),
  }
}

function renderInbox() {
  return render(<IndustryReviewInbox {...inboxProps()} />)
}

describe('IndustryReviewInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParamsState.value = new URLSearchParams()
    requestJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/company-industry-proposals/review-queue')) {
        return { items: [], nextCursor: undefined }
      }
      if (path.includes('status=approved')) {
        return { items: [historyItem('p-1', 'approved'), historyItem('p-2', 'approved', 90)] }
      }
      if (path.includes('status=rejected')) {
        return { items: [historyItem('p-3', 'rejected')] }
      }
      if (path.includes('status=superseded')) {
        return { items: [] }
      }
      return { items: [] }
    })
  })

  it('renders per-status count chips next to the History tab label', async () => {
    const user = userEvent.setup()
    const view = renderInbox()

    await user.click(screen.getByRole('tab', { name: /History/ }))
    // The mocked useSearchParams setter mutates state without re-rendering —
    // force the component to pick up the new params via rerender.
    await act(async () => {
      view.rerender(<IndustryReviewInbox {...inboxProps()} />)
    })

    expect(await screen.findByTestId('industry-review-history-status-approved')).toHaveTextContent('Approved 2')
    expect(screen.getByTestId('industry-review-history-status-rejected')).toHaveTextContent('Rejected 1')
    expect(screen.queryByTestId('industry-review-history-status-superseded')).not.toBeInTheDocument()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('keeps queue tabs free of history status chips', async () => {
    renderInbox()

    // Flush the initial queue-load effect so its async state update lands in act.
    await act(async () => {})
    expect(screen.queryByTestId('industry-review-history-status-approved')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /History/ })).toBeInTheDocument()
  })
})
