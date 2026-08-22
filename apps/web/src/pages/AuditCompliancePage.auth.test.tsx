import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AuditCompliancePage } from './AuditCompliancePage'

// Regression test for the audit-compliance fetch gate (nightly-uat P1):
// the page used to read `isAdmin` from the workspace context, which is
// hardcoded false (WorkspaceContext.tsx), so the bias report and audit log
// NEVER fetched. Admin must be derived from auth memberships instead, and
// the fetch behavior must be observable with the REAL hooks.
//
// These tests drive the real useAuditLogs/useBiasReport hooks with a mocked
// API client; the mocked-hook tests in AuditCompliancePage.test.tsx cannot
// catch this class of bug because they stub the hooks themselves.

const authMock = vi.hoisted(() => ({
  memberships: [] as Array<{ userId: string; workspaceSlug: string; role: string }>,
}))

const mockPost = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authMock,
}))

// System surface: the audit route lives under /admin/system, where the
// SystemWorkspaceShell pins the workspace slug to 'dev' (SYSTEM_AUTH_WORKSPACE).
// The context value includes isAdmin: false — that is the REAL contract
// (WorkspaceContext.tsx hardcodes it); the page must not depend on it.
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev', isAdmin: false }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { POST: mockPost, GET: mockGet },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const auditLogEntry = {
  _id: 'al-auth-1',
  resumeId: 'r1',
  workspaceSlug: 'dev',
  decisionType: 'score' as const,
  actionRef: 'analyze:analyzeResume',
  inputSnapshot: {},
  modelMeta: { model: 'gpt-4', provider: 'openai' },
  output: { score: 85, recommendation: 'strong_match' },
  outcome: 'accepted' as const,
  outcomeSetBy: 'system:analyzeResume',
  decidedAt: Date.now() - 3600000,
  expiresAt: Date.now() + 86400000,
}

const biasReport = {
  status: 'ok' as const,
  workspaceSlug: 'dev',
  decisionType: 'score',
  scoreThreshold: 70,
  totalAuditRecords: 1,
  groupCount: 2,
  demographicParity: {
    disparityRatio: 0.9,
    maxDifference: 0.05,
    passing: true,
    groupRates: [
      { groupKey: 'group-a', rate: 0.7 },
      { groupKey: 'group-b', rate: 0.63 },
    ],
  },
  disparateImpact: [{ groupKey: 'group-b', ratio: 0.9, referenceGroupKey: 'group-a' }],
  overrideRate: { tprDifference: 0.02, fprDifference: 0.01, passing: true },
  scoreDrift: { psi: 0.02, driftDetected: false },
  anomalyFlags: {
    statisticalParityViolation: false,
    disparateImpactViolation: false,
    scoreDriftDetected: false,
  },
  computedAt: Date.now() - 7200000,
}

function renderPage() {
  return render(
    <BrowserRouter>
      <AuditCompliancePage />
    </BrowserRouter>,
  )
}

describe('AuditCompliancePage auth-gated fetch (real hooks)', () => {
  beforeEach(() => {
    authMock.memberships = []
    mockPost.mockReset()
    mockGet.mockReset()
  })

  it('fetches audit logs and bias report for a dev-workspace admin', async () => {
    authMock.memberships = [{ userId: 'u1', workspaceSlug: 'dev', role: 'admin' }]
    mockPost.mockResolvedValue({ data: { success: true, data: [auditLogEntry] } })
    mockGet.mockImplementation((path: string) => {
      if (path === '/api/resumes/bias-report') {
        return Promise.resolve({ data: { success: true, report: biasReport } })
      }
      if (path === '/api/resumes/anomaly-alerts') {
        return Promise.resolve({ data: { success: true, alerts: null } })
      }
      return Promise.resolve({ data: { success: true } })
    })

    renderPage()

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/resumes/audit-logs',
        expect.objectContaining({ body: expect.objectContaining({ workspaceSlug: 'dev' }) }),
      )
    })
    expect(mockGet).toHaveBeenCalledWith(
      '/api/resumes/bias-report',
      expect.objectContaining({ params: { query: { workspaceSlug: 'dev' } } }),
    )
    expect(mockGet).toHaveBeenCalledWith(
      '/api/resumes/anomaly-alerts',
      expect.objectContaining({ params: { query: { workspaceSlug: 'dev' } } }),
    )

    // Data actually renders: bias KPI cards + an audit log row.
    expect(await screen.findByTestId('bias-kpi-cards')).toBeInTheDocument()
    expect(await screen.findByTestId('audit-log-table')).toBeInTheDocument()
    expect(await screen.findByTestId('audit-log-row')).toBeInTheDocument()
  })

  it('does not fetch when the user is not an admin of the workspace', async () => {
    authMock.memberships = [{ userId: 'u1', workspaceSlug: 'dev', role: 'user' }]

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No audit log entries found.')).toBeInTheDocument()
    })
    expect(screen.getByText('No bias audit report available yet.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
    expect(mockGet).not.toHaveBeenCalled()
  })
})
