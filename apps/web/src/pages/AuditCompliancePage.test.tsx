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

const mockBiasReport = {
  status: 'ok' as const,
  workspaceSlug: 'test-workspace',
  decisionType: 'score',
  scoreThreshold: 70,
  totalAuditRecords: 150,
  groupCount: 3,
  demographicParity: {
    disparityRatio: 0.85,
    maxDifference: 0.08,
    passing: true,
    groupRates: [
      { groupKey: 'group-a', rate: 0.72 },
      { groupKey: 'group-b', rate: 0.61 },
      { groupKey: 'group-c', rate: 0.55 },
    ],
  },
  disparateImpact: [
    { groupKey: 'group-b', ratio: 0.85, referenceGroupKey: 'group-a' },
    { groupKey: 'group-c', ratio: 0.76, referenceGroupKey: 'group-a' },
  ],
  overrideRate: {
    tprDifference: 0.05,
    fprDifference: 0.03,
    passing: true,
  },
  scoreDrift: {
    psi: 0.04,
    driftDetected: false,
  },
  anomalyFlags: {
    statisticalParityViolation: false,
    disparateImpactViolation: true,
    scoreDriftDetected: false,
  },
  computedAt: Date.now() - 7200000,
}

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
    report: mockBiasReport,
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
  })

  it('renders KPI cards with values', () => {
    renderPage()
    expect(screen.getByTestId('bias-kpi-cards')).toBeInTheDocument()
    expect(screen.getByText('DIR Ratio')).toBeInTheDocument()
    expect(screen.getByText('Parity Diff')).toBeInTheDocument()
    expect(screen.getByText('PSI Drift')).toBeInTheDocument()
    expect(screen.getByText('Anomalies')).toBeInTheDocument()
  })

  it('shows PASS/FAIL badges on KPI cards', () => {
    renderPage()
    const passBadges = screen.getAllByTestId('kpi-pass')
    const failBadges = screen.getAllByTestId('kpi-fail')
    expect(passBadges.length).toBeGreaterThanOrEqual(2)
    // DIR and parity pass, PSI passes, anomaly count = 1 (IMPACT violation) so anomalies fails
    expect(failBadges.length).toBeGreaterThanOrEqual(1)
  })

  it('renders anomaly flags section', () => {
    renderPage()
    expect(screen.getByTestId('anomaly-flags-section')).toBeInTheDocument()
    expect(screen.getByText('Parity Violation')).toBeInTheDocument()
    expect(screen.getByText('Impact Violation')).toBeInTheDocument()
    expect(screen.getByText('Score Drift')).toBeInTheDocument()
  })

  it('shows active/inactive anomaly flags correctly', () => {
    renderPage()
    const activeFlags = screen.getAllByTestId('anomaly-active')
    const inactiveFlags = screen.getAllByTestId('anomaly-inactive')
    // disparateImpactViolation is true, others are false
    expect(activeFlags.length).toBe(1)
    expect(inactiveFlags.length).toBe(2)
  })

  it('renders metric breakdown table', () => {
    renderPage()
    expect(screen.getByTestId('metric-breakdown-table')).toBeInTheDocument()
    expect(screen.getByText('Metric Breakdown')).toBeInTheDocument()
  })

  it('renders group rates table', () => {
    renderPage()
    expect(screen.getByTestId('group-rates-table')).toBeInTheDocument()
    expect(screen.getByText('Group Rates')).toBeInTheDocument()
    expect(screen.getByText('group-a')).toBeInTheDocument()
    expect(screen.getByText('group-b')).toBeInTheDocument()
    expect(screen.getByText('group-c')).toBeInTheDocument()
  })

  it('shows reference badge for reference group in group rates', () => {
    renderPage()
    expect(screen.getByText('reference')).toBeInTheDocument()
  })

  it('renders report metadata footer', () => {
    renderPage()
    expect(screen.getByText(/150/)).toBeInTheDocument()
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
