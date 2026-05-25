import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { AuditCompliancePage } from './AuditCompliancePage'

const mockSetOutcome = vi.fn().mockResolvedValue(true)

// Mock the workspace context
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'test-workspace', isAdmin: true }),
}))

// Mock the audit hooks
const mockLogs = [
  {
    _id: 'al1',
    resumeId: 'r1',
    workspaceSlug: 'test-workspace',
    decisionType: 'score' as const,
    actionRef: 'analyze:analyzeResume',
    inputSnapshot: {},
    modelMeta: { model: 'gpt-4', provider: 'openai' },
    output: { score: 85, recommendation: 'strong_match' },
    outcome: 'accepted' as const,
    outcomeSetBy: 'system:analyzeResume',
    decidedAt: Date.now() - 3600000,
    expiresAt: Date.now() + 86400000,
  },
  {
    _id: 'al2',
    resumeId: 'r2',
    workspaceSlug: 'test-workspace',
    decisionType: 'tag' as const,
    actionRef: 'ai_tagging_results:drainQueue',
    inputSnapshot: {},
    modelMeta: { model: 'gpt-4', provider: 'openai' },
    output: { tags: ['senior', 'python'] },
    decidedAt: Date.now() - 1800000,
    expiresAt: Date.now() + 86400000,
  },
  {
    _id: 'al3',
    resumeId: 'r3',
    workspaceSlug: 'test-workspace',
    decisionType: 'score' as const,
    actionRef: 'analyze:analyzeResume',
    inputSnapshot: {},
    modelMeta: { model: 'gpt-4', provider: 'openai' },
    output: { score: 30, recommendation: 'no_match' },
    anomalyFlags: {
      statisticalParityViolation: true,
      flagReason: 'Score disparity detected',
    },
    decidedAt: Date.now() - 900000,
    expiresAt: Date.now() + 86400000,
  },
]

vi.mock('@/hooks/useAuditLogs', () => ({
  useAuditLogs: () => ({
    logs: mockLogs,
    loading: false,
    error: null,
    filters: {},
    setFilters: vi.fn(),
    setOutcome: mockSetOutcome,
  }),
  useBiasReport: () => ({
    report: {
      generatedAt: Date.now(),
      workspaceSlug: 'test-workspace',
      anomalyDetected: true,
    },
    anomalyAlerts: {
      workspaceSlug: 'test-workspace',
      flags: ['statistical_parity_violation', 'disparate_impact_violation'],
      psiValue: 0.25,
      disparityRatio: 0.65,
      alertedAt: Date.now(),
    },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

// Mock sonner
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function renderPage() {
  return render(
    <BrowserRouter>
      <AuditCompliancePage />
    </BrowserRouter>,
  )
}

describe('AuditCompliancePage', () => {
  it('renders the page title and description', () => {
    renderPage()
    expect(screen.getByTestId('audit-compliance-page')).toBeInTheDocument()
    expect(screen.getByText('Audit & Compliance')).toBeInTheDocument()
  })

  it('renders the bias audit report card', () => {
    renderPage()
    expect(screen.getByText('Bias Audit Report')).toBeInTheDocument()
    expect(screen.getByText('test-workspace')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
  })

  it('renders the audit log table with entries', () => {
    renderPage()
    expect(screen.getByText('Decision Audit Log')).toBeInTheDocument()
    expect(screen.getByTestId('audit-log-table')).toBeInTheDocument()
    expect(screen.getAllByTestId('audit-log-row')).toHaveLength(3)
  })

  it('shows anomaly flag badge for entries with anomalies', () => {
    renderPage()
    const anomalyBadges = screen.getAllByTestId('anomaly-flag')
    expect(anomalyBadges).toHaveLength(1)
    expect(anomalyBadges[0]).toHaveTextContent('Score disparity detected')
  })

  it('shows Review button for pending entries', () => {
    renderPage()
    const reviewButtons = screen.getAllByTestId('set-outcome-btn')
    expect(reviewButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('shows pending count badge when there are pending entries', () => {
    renderPage()
    expect(screen.getByTestId('pending-count-badge')).toBeInTheDocument()
  })

  it('shows anomaly count badge when there are anomalies', () => {
    renderPage()
    expect(screen.getByTestId('anomaly-count-badge')).toBeInTheDocument()
  })

  it('opens outcome dialog when Review is clicked', async () => {
    const user = userEvent.setup()
    renderPage()

    const reviewBtn = screen.getAllByTestId('set-outcome-btn')[0]
    await user.click(reviewBtn)

    await waitFor(() => {
      expect(screen.getByText('Set Audit Outcome')).toBeInTheDocument()
    })
  })

  it('calls setOutcome when confirming in dialog', async () => {
    const user = userEvent.setup()
    renderPage()

    const reviewBtn = screen.getAllByTestId('set-outcome-btn')[0]
    await user.click(reviewBtn)

    await waitFor(() => {
      expect(screen.getByText('Set Audit Outcome')).toBeInTheDocument()
    })

    const confirmBtn = screen.getByText('Set Outcome')
    await user.click(confirmBtn)

    expect(mockSetOutcome).toHaveBeenCalled()
  })

  it('renders decision type filter', () => {
    renderPage()
    expect(screen.getByTestId('filter-decision-type')).toBeInTheDocument()
  })

  it('renders outcome filter', () => {
    renderPage()
    expect(screen.getByTestId('filter-outcome')).toBeInTheDocument()
  })

  it('renders anomaly alert banner when alerts are active', () => {
    renderPage()
    expect(screen.getByTestId('anomaly-alert-banner')).toBeInTheDocument()
    expect(screen.getByText('statistical_parity_violation')).toBeInTheDocument()
    expect(screen.getByText('disparate_impact_violation')).toBeInTheDocument()
  })
})
