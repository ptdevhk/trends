import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SystemSettingsIndustryVerificationPage } from './SystemSettingsIndustryVerificationPage'

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <output data-testid="test-location-search">{location.search}</output>
      <output data-testid="test-location-path">{location.pathname}</output>
    </>
  )
}

function renderPage(initialEntry = '/dev/settings/industry-verification') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <SystemSettingsIndustryVerificationPage />
    </MemoryRouter>,
  )
}

/**
 * Renders the page inside real routes so useParams resolves and any
 * navigation that leaves the review surface lands on the wrong-route
 * fallback (which fails the assertions).
 */
function renderPageAtRoute(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/:teamSlug/system/settings/industry-verification/*"
          element={(
            <>
              <LocationProbe />
              <SystemSettingsIndustryVerificationPage />
            </>
          )}
        />
        <Route
          path="/admin/system/settings/industry-verification/*"
          element={(
            <>
              <LocationProbe />
              <SystemSettingsIndustryVerificationPage />
            </>
          )}
        />
        <Route path="*" element={<div data-testid="wrong-route">wrong route</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const coverageSummary = {
  generatedAt: 1_700_000_000_000,
  workspaceSlug: 'dev',
  proposalsByStatus: {
    new: 427,
    researching: 0,
    ready_for_review: 0,
    needs_more_evidence: 60,
    approved: 16,
    rejected: 3,
    superseded: 3,
  },
  openTotal: 487,
  openWithSources: 0,
  openWithoutSources: 487,
  emptyEvidenceBottleneck: true,
  readyBacklogBottleneck: true,
  resumes: { total: 83, withVerifiedEvidence: 1 },
  profiles: { total: 9, verified: 4, rejected: 5 },
  maintenance: {
    latest: {
      runId: 'run-fail',
      status: 'failed',
      triggerSource: 'restore',
      failureMessage: 'fetch failed',
      operatorSummary: 'failed; worker unreachable.',
      startedAt: 10,
      counts: {
        proposalsResearched: 0,
        readyCreated: 0,
        sourcesDemoted: 0,
        freshnessChecked: 0,
        freshnessRefreshed: 0,
        errors: 0,
      },
    },
    lastUseful: {
      runId: 'run-useful',
      status: 'completed',
      triggerSource: 'manual',
      operatorSummary: 'completed; 0 ready, 0 demoted, 0 refreshed.',
      startedAt: 5,
      counts: {
        proposalsResearched: 20,
        readyCreated: 0,
        sourcesDemoted: 0,
        freshnessChecked: 0,
        freshnessRefreshed: 0,
        errors: 0,
      },
    },
    lastFailed: {
      runId: 'run-fail',
      status: 'failed',
      triggerSource: 'restore',
      failureMessage: 'fetch failed',
      operatorSummary: 'failed; worker unreachable.',
      startedAt: 10,
      counts: {
        proposalsResearched: 0,
        readyCreated: 0,
        sourcesDemoted: 0,
        freshnessChecked: 0,
        freshnessRefreshed: 0,
        errors: 0,
      },
    },
  },
}

const { useAuthMock, useWorkspaceMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useWorkspaceMock: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => useWorkspaceMock(),
}))

const { requestJsonMock, toastSuccessMock, tMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  tMock: vi.fn((key: string, options?: { defaultValue?: string; [name: string]: unknown }) => {
    const template = options?.defaultValue ?? key
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? `{{${name}}}`))
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
    error: vi.fn(),
  },
}))

vi.mock('@/pages/system-settings/lib', async () => {
  const actual = await vi.importActual<typeof import('@/pages/system-settings/lib')>('@/pages/system-settings/lib')
  return {
    ...actual,
    useSettingsRequestJson: () => ({ requestJson: requestJsonMock }),
  }
})

const proposal = {
  _id: 'proposal-row',
  proposalId: 'proposal-1',
  companyKey: 'acme-cnc',
  triggerReasons: ['scheduled_freshness'],
  priority: 90,
  suggestedIndustryClass: 'cnc',
  suggestedVerificationLevel: 'verified',
  materialChangeSummary: 'Official catalog changed.',
  status: 'ready_for_review',
  createdAt: 1,
  updatedAt: 2,
}

const source = {
  _id: 'source-row',
  sourceId: 'source-1',
  companyKey: 'acme-cnc',
  proposalId: 'proposal-1',
  url: 'https://acme.example/products/cnc',
  sourceDomain: 'acme.example',
  sourceType: 'official_site',
  trustTier: 'primary',
  title: 'CNC products',
  evidenceExcerpt: 'Official catalog confirms CNC machine tools.',
  fetchStatus: 'fetched',
  reviewStatus: 'unreviewed',
  sourceState: 'active',
  fetchedAt: 20,
  createdAt: 1,
  updatedAt: 2,
}

const recommendation = {
  proposalId: 'proposal-1',
  proposalStatus: 'ready_for_review',
  recommendedAction: 'approve',
  recommendedVerificationLevel: 'verified',
  recommendedIndustryClass: 'cnc',
  recommendedSourceIds: ['source-1'],
  sourceDecisions: [
    {
      sourceId: 'source-1',
      approvalSafe: true,
      recommended: true,
      reasonCodes: ['approval_safe', 'recommended_primary'],
    },
  ],
  confidenceBand: 'high',
  riskFlags: [],
  reasons: ['Durable source supports the proposed cnc classification.'],
  excludedSourceReasons: {},
  riskDecision: {
    requiresAcknowledgement: false,
    nonOverridableRiskFlags: [],
    canApproveWithRiskOverride: true,
  },
  evidenceSummaryDraft: 'Official catalog changed.',
  decisionReasonDraft: 'Reviewed 1 approval-safe source(s); confirm the cnc classification and evidence summary.',
  requiresHumanReview: true,
}

const reviewPacket = {
  success: true,
  ok: true,
  schemaVersion: 'industry-review.v1',
  operation: { id: 'review-proposal-1-fingerprint', kind: 'recommendation', state: 'computed' },
  dataset: {
    revision: 'proposal-1:2:revision-1',
    inputFingerprint: 'fingerprint-1',
    proposalUpdatedAt: 2,
    sourceVersions: [{ sourceId: 'source-1', updatedAt: 2 }],
    generatedAt: 20,
  },
  recommendation,
  warnings: [],
  proposal,
  sources: [source],
  bundle: {
    profile: {
      companyKey: 'acme-cnc',
      industryClass: 'cnc',
      verificationLevel: 'verified',
      currentRevisionId: 'revision-1',
    },
    revisions: [
      {
        revisionId: 'revision-1',
        verificationLevel: 'verified',
        industryClass: 'cnc',
        evidenceSummary: 'Current approved truth.',
        reviewedBy: 'reviewer-1',
        reviewedAt: 100,
      },
    ],
    sources: [],
  },
  recomputeRuns: [],
  maintenance: { latest: null, lastFailed: null },
}

const cleanInboxProposal = {
  ...proposal,
  _id: 'clean-proposal-row',
  proposalId: 'clean-proposal',
  companyKey: 'clean-company',
  suggestedIndustryClass: 'industrial',
  materialChangeSummary: 'Official industrial catalog is ready for approval.',
}

const cleanInboxRecommendation = {
  ...recommendation,
  proposalId: 'clean-proposal',
  recommendedIndustryClass: 'industrial',
  recommendedSourceIds: ['clean-source'],
  sourceDecisions: [
    {
      sourceId: 'clean-source',
      approvalSafe: true,
      recommended: true,
      reasonCodes: ['approval_safe', 'recommended_primary'],
    },
  ],
  reasons: ['An approval-safe official source supports the industrial class.'],
  evidenceSummaryDraft: 'Official industrial catalog supports the class.',
  decisionReasonDraft: 'Reviewed the approval-safe official source.',
}

const cleanInboxSource = {
  ...source,
  _id: 'clean-source-row',
  sourceId: 'clean-source',
  companyKey: 'clean-company',
  proposalId: 'clean-proposal',
  title: 'Industrial products',
}

function cleanInboxPacket(approved: boolean) {
  return {
    ...reviewPacket,
    proposal: {
      ...cleanInboxProposal,
      status: approved ? 'approved' : 'ready_for_review',
      updatedAt: approved ? 99 : 2,
    },
    recommendation: cleanInboxRecommendation,
    dataset: {
      ...reviewPacket.dataset,
      proposalUpdatedAt: approved ? 99 : 2,
      inputFingerprint: approved ? 'clean-fingerprint-approved' : 'clean-fingerprint',
      sourceVersions: [{ sourceId: 'clean-source', updatedAt: approved ? 99 : 2 }],
    },
    sources: [cleanInboxSource],
    bundle: {
      profile: approved
        ? { companyKey: 'clean-company', verificationLevel: 'verified', currentRevisionId: 'revision-clean' }
        : null,
      revisions: [],
      sources: [],
    },
    reviewContext: {
      profile: approved
        ? { companyKey: 'clean-company', verificationLevel: 'verified', currentRevisionId: 'revision-clean' }
        : null,
      revisions: [],
    },
    recomputeRuns: [],
  }
}

function installCleanInboxMock() {
  let approved = false
  let refreshRequested = false
  const fallback = requestJsonMock.getMockImplementation()
  const historyProposal = {
    ...cleanInboxProposal,
    status: 'approved',
    reviewedAt: 100,
    reviewNote: 'Approved during the test session.',
  }
  requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
      return Promise.resolve({
        success: true,
        ok: true,
        schemaVersion: 'industry-review.v1',
        items: refreshRequested ? [] : [{ proposal: cleanInboxProposal, recommendation: cleanInboxRecommendation, sourceCount: 1 }],
        maintenance: { latest: null, lastFailed: null },
      })
    }
    if (path === '/api/company-industry-proposals/clean-proposal/review-packet') {
      return Promise.resolve(cleanInboxPacket(approved))
    }
    if (path === '/api/company-industry-proposals/clean-proposal/approve' && init?.method === 'POST') {
      approved = true
      return Promise.resolve({
        success: true,
        proposalId: 'clean-proposal',
        revisionId: 'revision-clean',
        companyKey: 'clean-company',
        recompute: { runId: 'run-clean', status: 'queued' },
      })
    }
    if (path === '/api/company-industry-proposals/clean-proposal/undo-approval' && init?.method === 'POST') {
      approved = false
      return Promise.resolve({
        success: true,
        proposalId: 'clean-proposal',
        reversalRevisionId: 'undo-revision-clean',
        restoredRevisionId: undefined,
        status: 'ready_for_review',
      })
    }
    if (path.startsWith('/api/company-industry-proposals?status=')) {
      return Promise.resolve({
        success: true,
        items: refreshRequested && path.includes('status=approved') ? [historyProposal] : [],
      })
    }
    return fallback?.(path, init) ?? Promise.resolve({ success: true })
  })
  return {
    requestRefresh: () => {
      refreshRequested = true
    },
  }
}

describe('SystemSettingsIndustryVerificationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: a dev-workspace admin, so the ops panels render in existing tests.
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'user-1', workspaceSlug: 'dev', role: 'admin' }],
    })
    useWorkspaceMock.mockReturnValue({
      slug: 'dev',
      name: 'dev',
      isAdmin: false,
      surface: 'workspace',
      isSystemSurface: false,
      isPublicSurface: false,
    })
    requestJsonMock.mockImplementation((path: string) => {
      if (path === '/api/company-industry-coverage') {
        return Promise.resolve({ success: true, item: coverageSummary })
      }
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [{ proposal, recommendation, sourceCount: 1 }],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path.startsWith('/api/company-industry-profiles')) {
        return Promise.resolve({
          success: true,
          items: [
            {
              companyKey: 'eonmetall-group',
              industryClass: 'cnc',
              verificationLevel: 'verified',
            },
          ],
        })
      }
      if (path === '/api/company-industry-proposals/proposal-1/review-packet') {
        return Promise.resolve(reviewPacket)
      }
      if (path === '/api/company-industry-evidence-sources?proposalId=proposal-1') {
        return Promise.resolve({ success: true, items: [source] })
      }
      if (path === '/api/company-industry-bundles/acme-cnc') {
        return Promise.resolve({
          success: true,
          profile: {
            companyKey: 'acme-cnc',
            industryClass: 'cnc',
            verificationLevel: 'verified',
            currentRevisionId: 'revision-1',
          },
          revisions: [
            {
              revisionId: 'revision-1',
              verificationLevel: 'verified',
              industryClass: 'cnc',
              evidenceSummary: 'Current approved truth.',
              reviewedBy: 'reviewer-1',
              reviewedAt: 100,
            },
          ],
          sources: [],
        })
      }
      if (path === '/api/company-industry-bundles/eonmetall-group') {
        return Promise.resolve({
          success: true,
          profile: {
            companyKey: 'eonmetall-group',
            industryClass: 'cnc',
            verificationLevel: 'verified',
            currentRevisionId: 'my-rev-eonmetall-cnc-20260730',
          },
          revisions: [
            {
              revisionId: 'my-rev-eonmetall-cnc-20260730',
              verificationLevel: 'verified',
              industryClass: 'cnc',
              evidenceSummary:
                'Bursa-listed Eonmetall Group Bhd: flat steel products and CNC machinery.',
              reviewedBy: 'bootstrap',
              reviewedAt: 1_753_900_000_000,
            },
          ],
          sources: [
            {
              sourceId: 'src-star',
              companyKey: 'eonmetall-group',
              url: 'https://www.thestar.com.my/',
              sourceDomain: 'thestar.com.my',
              sourceType: 'reporting',
              trustTier: 'corroborating',
              title: 'The Star',
              reviewStatus: 'approved',
              sourceState: 'active',
            },
          ],
        })
      }
      // Maintenance history optional
      if (path.startsWith('/api/company-industry-maintenance-runs')) {
        return Promise.resolve({ success: true, items: [] })
      }
      return Promise.resolve({ success: true })
    })
  })

  it('loads the proposal queue, evidence, current verdict, and history', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('tab', { name: /Needs review/ }))
    await user.click(await screen.findByTestId('industry-review-row-proposal-1'))
    expect((await screen.findAllByText('ACME CNC')).length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText('CNC products')).toBeInTheDocument()
    expect(screen.getByText('Current approved truth.')).toBeInTheDocument()
    expect(screen.getAllByText('revision-1')).toHaveLength(2)
  })

  it('keeps proposal navigation on the workspace-scoped base for workspace reviewers', async () => {
    const user = userEvent.setup()
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'reviewer' }],
    })
    useWorkspaceMock.mockReturnValue({
      slug: 'hr',
      name: 'hr',
      isAdmin: false,
      surface: 'workspace',
      isSystemSurface: false,
      isPublicSurface: false,
    })

    renderPageAtRoute('/hr/system/settings/industry-verification')

    await user.click(await screen.findByTestId('industry-review-row-proposal-1'))

    expect(screen.getByTestId('test-location-path')).toHaveTextContent(
      '/hr/system/settings/industry-verification/proposals/proposal-1',
    )
    expect(requestJsonMock).toHaveBeenCalledWith('/api/company-industry-proposals/proposal-1/review-packet')
    expect(screen.queryByTestId('wrong-route')).not.toBeInTheDocument()
  })

  it('keeps proposal navigation on the canonical admin base for system admins', async () => {
    const user = userEvent.setup()

    renderPageAtRoute('/admin/system/settings/industry-verification')

    await user.click(await screen.findByTestId('industry-review-row-proposal-1'))

    expect(screen.getByTestId('test-location-path')).toHaveTextContent(
      '/admin/system/settings/industry-verification/proposals/proposal-1',
    )
    expect(requestJsonMock).toHaveBeenCalledWith('/api/company-industry-proposals/proposal-1/review-packet')
    expect(screen.queryByTestId('wrong-route')).not.toBeInTheDocument()
  })

  it('scrolls the detail section into view after a user-initiated selection', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      useAuthMock.mockReturnValue({
        memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'reviewer' }],
      })
      useWorkspaceMock.mockReturnValue({
        slug: 'hr',
        name: 'hr',
        isAdmin: false,
        surface: 'workspace',
        isSystemSurface: false,
        isPublicSurface: false,
      })
      renderPageAtRoute('/hr/system/settings/industry-verification')

      await user.click(await screen.findByTestId('industry-review-row-proposal-1'))
      // The row and the detail header both show the company name, so wait for
      // the detail to render via the *AllBy* variant (same pattern as the
      // "loads the proposal queue..." test).
      await screen.findAllByText('ACME CNC')

      await waitFor(() => {
        const detailCalls = scrollIntoView.mock.instances.filter(
          (el) => (el as HTMLElement).dataset?.testid === 'industry-review-detail-section',
        )
        expect(detailCalls.length).toBeGreaterThan(0)
      })
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
      // The targeted-row scroll must not race the detail scroll after a
      // user-initiated selection: the row is already on screen, so the inbox
      // must not auto-scroll it (which would win over the smooth detail
      // scroll and leave the detail off-screen).
      const rowCalls = scrollIntoView.mock.instances.filter(
        (el) => (el as HTMLElement).dataset?.testid === 'industry-review-row-proposal-1',
      )
      expect(rowCalls).toHaveLength(0)
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
    }
  })

  it('does not scroll the detail section on an initial deep link', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      useAuthMock.mockReturnValue({
        memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'reviewer' }],
      })
      useWorkspaceMock.mockReturnValue({
        slug: 'hr',
        name: 'hr',
        isAdmin: false,
        surface: 'workspace',
        isSystemSurface: false,
        isPublicSurface: false,
      })
      renderPageAtRoute('/hr/system/settings/industry-verification/proposals/proposal-1')

      await screen.findAllByText('ACME CNC')

      const detailCalls = scrollIntoView.mock.instances.filter(
        (el) => (el as HTMLElement).dataset?.testid === 'industry-review-detail-section',
      )
      expect(detailCalls).toHaveLength(0)
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
    }
  })

  it('lets the operator inspect new and evidence-needed queues when ready is empty', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByTestId('industry-review-summary')
    await user.selectOptions(screen.getByLabelText('Queue status'), 'new')

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-proposals/review-queue?status=new&limit=100',
      )
    })
  })

  it('renders the URL-backed All filter and updates the query when a chip is clicked', async () => {
    const user = userEvent.setup()
    const fallback = requestJsonMock.getMockImplementation()
    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [
            { proposal: cleanInboxProposal, recommendation: cleanInboxRecommendation, sourceCount: 1 },
            { proposal, recommendation, sourceCount: 1 },
          ],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      return fallback?.(path, init) ?? Promise.resolve({ success: true })
    })

    renderPage('/dev/settings/industry-verification?filter=all')

    expect(await screen.findByTestId('industry-review-filter-all')).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByTestId('industry-review-row-clean-proposal')).toBeInTheDocument()
    expect(screen.getByTestId('industry-review-row-proposal-1')).toBeInTheDocument()
    expect(screen.queryByTestId('industry-history-list')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('industry-review-filter-history'))
    expect(screen.getByTestId('test-location-search')).toHaveTextContent('?filter=history')
    expect(screen.getByTestId('industry-review-filter-history')).toHaveAttribute('aria-selected', 'true')
  })

  it('opens an off-page canonical target as the first Inbox row and scrolls it below the sticky header', async () => {
    const defaultRequestJson = requestJsonMock.getMockImplementation()
    const queueRequests: string[] = []
    const scrollIntoView = vi.fn()
    const nativeFocus = HTMLElement.prototype.focus
    const focus = vi.fn(function (this: HTMLElement) {
      nativeFocus.call(this)
    })
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    const originalFocus = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      configurable: true,
      value: focus,
    })

    const visionProposal = {
      ...proposal,
      _id: 'vision-proposal-row',
      proposalId: 'industry-maintenance-vision',
      companyKey: undefined,
      normalizedEmployerSurface: 'vision machine tools',
      materialChangeSummary: 'Legacy role evidence needs a canonical employer mapping.',
      status: 'new',
    }
    const visionRecommendation = {
      ...recommendation,
      proposalId: visionProposal.proposalId,
      proposalStatus: 'new',
      recommendedAction: 'inspect',
      recommendedSourceIds: [],
      sourceDecisions: [],
      confidenceBand: 'low',
      riskFlags: ['canonical_mapping_missing'],
      reasons: ['No canonical employer mapping or approval-safe source is attached.'],
      excludedSourceReasons: {},
      riskDecision: {
        requiresAcknowledgement: false,
        nonOverridableRiskFlags: [],
        canApproveWithRiskOverride: false,
      },
    }

    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        queueRequests.push(path)
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [
            { proposal: cleanInboxProposal, recommendation: cleanInboxRecommendation, sourceCount: 1 },
            { proposal: visionProposal, recommendation: visionRecommendation, sourceCount: 0 },
          ],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path === '/api/company-industry-proposals/industry-maintenance-vision/review-packet') {
        return Promise.resolve({
          ...reviewPacket,
          proposal: visionProposal,
          recommendation: visionRecommendation,
          sources: [],
          reviewContext: { profile: null, revisions: [] },
          recomputeRuns: [],
        })
      }
      return defaultRequestJson?.(path, init) ?? Promise.resolve({ success: true })
    })

    try {
      renderPage('/admin/system/settings/industry-verification/proposals/industry-maintenance-vision')

      const row = await screen.findByTestId('industry-review-row-industry-maintenance-vision')
      expect(row).toHaveAttribute('aria-current', 'true')
      expect(row).toHaveAttribute('data-industry-review-target', 'true')
      expect(row).toHaveClass('scroll-mt-px')
      expect(row).toHaveTextContent('VISION MACHINE TOOLS')
      expect(row).toHaveTextContent('Canonical company mapping is missing')
      const followingQueueRow = await screen.findByTestId('industry-review-row-clean-proposal')
      expect(row.compareDocumentPosition(followingQueueRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          block: 'start',
          inline: 'nearest',
          behavior: 'auto',
        })
      })
      expect(focus).toHaveBeenCalledWith({ preventScroll: true })
      expect(screen.getByTestId('test-location-search')).toHaveTextContent('')
      expect(queueRequests).toEqual([
        '/api/company-industry-proposals/review-queue?status=new&limit=100',
      ])
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
      } else {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
      }
      if (originalFocus) {
        Object.defineProperty(HTMLElement.prototype, 'focus', originalFocus)
      }
    }
  })

  it('keeps a terminal canonical target read-only without loading the live queue', async () => {
    const defaultRequestJson = requestJsonMock.getMockImplementation()
    const queueRequests: string[] = []
    const terminalProposal = {
      ...proposal,
      _id: 'terminal-proposal-row',
      proposalId: 'industry-maintenance-terminal',
      status: 'approved',
    }
    const terminalRecommendation = {
      ...recommendation,
      proposalId: terminalProposal.proposalId,
      proposalStatus: 'approved',
    }

    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        queueRequests.push(path)
        return Promise.resolve({ success: true, items: [] })
      }
      if (path === '/api/company-industry-proposals/industry-maintenance-terminal/review-packet') {
        return Promise.resolve({
          ...reviewPacket,
          proposal: terminalProposal,
          recommendation: terminalRecommendation,
        })
      }
      return defaultRequestJson?.(path, init) ?? Promise.resolve({ success: true })
    })

    renderPage('/admin/system/settings/industry-verification/proposals/industry-maintenance-terminal')

    expect(await screen.findByTestId('industry-history-row-industry-maintenance-terminal')).toBeInTheDocument()
    expect(await screen.findByTestId('industry-review-terminal-read-only')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve revision' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Request more evidence' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject proposal' })).toBeDisabled()
    expect(queueRequests).toEqual([])
  })

  it('treats an unknown filter as All and keeps History separate from live rows', async () => {
    renderPage('/dev/settings/industry-verification?filter=not-a-filter')

    expect(await screen.findByTestId('industry-review-filter-all')).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByTestId('industry-review-row-proposal-1')).toBeInTheDocument()
    expect(screen.queryByTestId('industry-history-row-proposal-1')).not.toBeInTheDocument()
  })

  it('approves a clean row with one click, keeps it visible, and supports same-row Undo', async () => {
    const user = userEvent.setup()
    installCleanInboxMock()
    renderPage()

    const approveButton = await screen.findByRole('button', { name: 'Approve CLEAN COMPANY' })
    await user.click(approveButton)

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-proposals/clean-proposal/approve',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByText('Approved in this session')).toBeInTheDocument()
    const undoButton = screen.getByRole('button', { name: 'Undo approval for CLEAN COMPANY' })
    expect(undoButton).toBeInTheDocument()

    await user.click(undoButton)
    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-proposals/clean-proposal/undo-approval',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByRole('button', { name: 'Approve CLEAN COMPANY' })).toBeInTheDocument()
    const undoCall = requestJsonMock.mock.calls.find(
      ([path, init]) => path.endsWith('/undo-approval') && init?.method === 'POST',
    )
    expect(JSON.parse(String(undoCall?.[1]?.body))).toMatchObject({
      approvedRevisionId: 'revision-clean',
      expectedCurrentRevisionId: 'revision-clean',
      expectedProposalUpdatedAt: 99,
      recomputeRunId: 'run-clean',
    })
  })

  it('moves a session-approved row to History only after explicit refresh', async () => {
    const user = userEvent.setup()
    const cleanMock = installCleanInboxMock()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Approve CLEAN COMPANY' }))
    expect(await screen.findByRole('button', { name: 'Undo approval for CLEAN COMPANY' })).toBeInTheDocument()

    cleanMock.requestRefresh()
    await user.click(screen.getByTestId('industry-review-refresh'))
    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith('/api/company-industry-proposals?status=approved')
    })
    await user.click(screen.getByRole('tab', { name: /History/ }))
    expect(await screen.findByTestId('industry-history-row-clean-proposal')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo approval for CLEAN COMPANY' })).not.toBeInTheDocument()
  })

  it('keeps available History rows visible when one terminal status request fails', async () => {
    const user = userEvent.setup()
    const historyProposal = {
      ...proposal,
      proposalId: 'history-approved',
      status: 'approved',
      reviewedAt: 100,
      reviewNote: 'Approved history row.',
    }
    requestJsonMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [{ proposal, recommendation, sourceCount: 1 }],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path === '/api/company-industry-proposals?status=approved') {
        return Promise.resolve({ success: true, items: [historyProposal] })
      }
      if (path === '/api/company-industry-proposals?status=rejected') {
        return Promise.reject(new Error('HTTP 500'))
      }
      if (path === '/api/company-industry-proposals?status=superseded') {
        return Promise.resolve({ success: true, items: [] })
      }
      return Promise.resolve({ success: true })
    })

    renderPage()
    await user.click(await screen.findByRole('tab', { name: /History/ }))

    expect(await screen.findByTestId('industry-history-row-history-approved')).toBeInTheDocument()
    expect(await screen.findByTestId('industry-history-partial-error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })

  it('shows a History outage without taking the live queue down', async () => {
    const user = userEvent.setup()
    requestJsonMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [{ proposal, recommendation, sourceCount: 1 }],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path.startsWith('/api/company-industry-proposals?status=')) {
        return Promise.reject(new Error('History service unavailable'))
      }
      return Promise.resolve({ success: true })
    })

    renderPage()
    await user.click(await screen.findByRole('tab', { name: /History/ }))

    expect(await screen.findByTestId('industry-history-error')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Needs review/ }))
    expect(await screen.findByTestId('industry-review-row-proposal-1')).toBeInTheDocument()
  })

  it('shows coverage pipeline, empty-evidence bottleneck, and maintenance health', async () => {
    renderPage()

    expect(await screen.findByTestId('industry-coverage-health')).toBeInTheDocument()
    expect(screen.getByTestId('industry-coverage-bottleneck-empty')).toBeInTheDocument()
    expect(screen.getByTestId('industry-coverage-bottleneck-failed')).toBeInTheDocument()
    expect(screen.getByTestId('industry-coverage-status-new')).toHaveTextContent('427')
    expect(screen.getByTestId('industry-coverage-status-needs_more_evidence')).toHaveTextContent(
      '60',
    )
    expect(screen.getByTestId('industry-coverage-status-ready_for_review')).toHaveTextContent('0')
    expect(screen.getByTestId('industry-coverage-open-sources')).toHaveTextContent('0')
    expect(screen.getByTestId('industry-coverage-open-sources')).toHaveTextContent('487')
    expect(screen.getByTestId('industry-coverage-resumes')).toHaveTextContent('1')
    expect(screen.getByTestId('industry-coverage-resumes')).toHaveTextContent('83')
    expect(screen.getByTestId('industry-coverage-maintenance')).toHaveTextContent(
      'researched 20, ready 0',
    )
    expect(screen.getByTestId('industry-coverage-bottleneck-failed')).toHaveTextContent(
      'worker unreachable',
    )
  })

  it('hides ops panels for reviewer members while keeping review surfaces', async () => {
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'user-1', workspaceSlug: 'dev', role: 'reviewer' }],
    })
    const user = userEvent.setup()
    renderPage()

    // Review surfaces remain visible: queue, evidence, verdict revision history.
    await user.click(await screen.findByRole('tab', { name: /Needs review/ }))
    await user.click(await screen.findByTestId('industry-review-row-proposal-1'))
    expect(await screen.findByText('CNC products')).toBeInTheDocument()
    expect(screen.getByText('Current approved truth.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve revision' })).toBeInTheDocument()

    // Ops panels are absent for reviewers: coverage health, maintenance
    // history, and the targeted recompute card.
    expect(screen.queryByTestId('industry-coverage-health')).not.toBeInTheDocument()
    expect(screen.queryByText('Maintenance run history')).not.toBeInTheDocument()
    expect(screen.queryByText('Targeted recompute')).not.toBeInTheDocument()
    expect(
      requestJsonMock.mock.calls.some(([path]) =>
        String(path).includes('/api/company-industry-coverage'),
      ),
    ).toBe(false)
    expect(
      requestJsonMock.mock.calls.some(([path]) =>
        String(path).includes('/api/company-industry-maintenance-runs'),
      ),
    ).toBe(false)
  })

  it('does not surface a historical failure after a newer run completes', async () => {
    const defaultRequestJson = requestJsonMock.getMockImplementation()
    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/company-industry-coverage') {
        return Promise.resolve({
          success: true,
          item: {
            ...coverageSummary,
            maintenance: {
              ...coverageSummary.maintenance,
              latest: {
                ...coverageSummary.maintenance.lastUseful,
                runId: 'run-success',
                status: 'completed',
                startedAt: 20,
              },
              lastFailed: {
                ...coverageSummary.maintenance.lastFailed,
                runId: 'run-old-fail',
                startedAt: 10,
              },
            },
          },
        })
      }
      return defaultRequestJson?.(path, init) ?? Promise.resolve({ success: true })
    })

    renderPage()

    expect(await screen.findByTestId('industry-coverage-health')).toBeInTheDocument()
    expect(screen.queryByTestId('industry-coverage-bottleneck-failed')).not.toBeInTheDocument()
    expect(screen.getByTestId('industry-coverage-maintenance')).toHaveTextContent(
      'completed · manual · researched 20, ready 0',
    )
  })

  it('looks up an approved profile by companyKey and shows bundle sources', async () => {
    const user = userEvent.setup()
    renderPage()

    // Verified quick-pick chip from profiles list
    expect(await screen.findByTestId('industry-lookup-chip-eonmetall-group')).toBeInTheDocument()

    await user.type(screen.getByTestId('industry-lookup-company-key'), 'eonmetall-group')
    await user.click(screen.getByTestId('industry-lookup-submit'))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-bundles/eonmetall-group',
      )
    })
    expect(await screen.findByTestId('industry-lookup-result')).toBeInTheDocument()
    // Summary appears in the result body and revision history.
    expect(screen.getAllByText(/Bursa-listed Eonmetall Group Bhd/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('my-rev-eonmetall-cnc-20260730').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('industry-lookup-source-src-star')).toBeInTheDocument()
    expect(screen.getByText('https://www.thestar.com.my/')).toBeInTheDocument()
  })

  it('approves selected evidence into an immutable revision', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('tab', { name: /Needs review/ }))
    await user.click(await screen.findByTestId('industry-review-row-proposal-1'))
    expect(await screen.findByText('CNC products')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Evidence summary'))
    await user.type(screen.getByLabelText('Evidence summary'), 'Reviewed official evidence.')
    await user.type(screen.getByLabelText('Decision reason'), 'Primary source confirmed.')
    await user.click(screen.getByLabelText('I reviewed the explicit CNC evidence'))
    await user.click(screen.getByRole('button', { name: 'Approve revision' }))
    expect(screen.getByTestId('industry-review-approval-confirmation')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm approve revision' }))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-proposals/proposal-1/approve',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const call = requestJsonMock.mock.calls.find(
      ([path, init]) => path.endsWith('/approve') && init?.method === 'POST',
    )
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      expectedCurrentRevisionId: 'revision-1',
      expectedProposalUpdatedAt: 2,
      expectedInputFingerprint: 'fingerprint-1',
      expectedSourceVersions: [{ sourceId: 'source-1', updatedAt: 2 }],
      verificationLevel: 'verified',
      industryClass: 'cnc',
      approvedSourceIds: ['source-1'],
      evidenceSummary: 'Reviewed official evidence.',
      decisionReason: expect.stringContaining('Primary source confirmed.'),
      reviewAttestation: expect.objectContaining({
        schemaVersion: 'industry-review-attestation.v1',
        inputFingerprint: 'fingerprint-1',
        decisionMode: 'standard',
        acknowledgedRiskFlags: [],
        cncEvidenceAcknowledged: true,
      }),
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('Industry verdict revision approved')
  })

  it('requests more evidence without changing current truth', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('tab', { name: /Needs review/ }))
    await user.click(await screen.findByTestId('industry-review-row-proposal-1'))
    expect(await screen.findByText('CNC products')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Request more evidence' }))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-proposals/proposal-1/resolve',
        {
          method: 'POST',
          body: JSON.stringify({
            resolution: 'needs_more_evidence',
            expectedProposalUpdatedAt: 2,
            reviewNote: 'Reviewer requested additional evidence.',
          }),
        },
      )
    })
  })

  it('requires visible risk acknowledgement and a CNC evidence acknowledgement before approval', async () => {
    const user = userEvent.setup()
    const defaultRequestJson = requestJsonMock.getMockImplementation()
    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/company-industry-proposals/proposal-1/review-packet') {
        return Promise.resolve({
          ...reviewPacket,
          recommendation: {
            ...recommendation,
            riskFlags: ['low_source_diversity'],
            riskDecision: {
              requiresAcknowledgement: true,
              nonOverridableRiskFlags: [],
              canApproveWithRiskOverride: true,
            },
          },
        })
      }
      return defaultRequestJson?.(path, init) ?? Promise.resolve({ success: true })
    })

    renderPage()
    await user.click(await screen.findByRole('tab', { name: /Needs review/ }))
    await user.click(await screen.findByTestId('industry-review-row-proposal-1'))
    expect(await screen.findByTestId('industry-review-risk-attestation')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve revision' }))
    expect(screen.queryByTestId('industry-review-approval-confirmation')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Acknowledge low_source_diversity'))
    await user.type(
      screen.getByLabelText('Detailed acknowledgement reason'),
      'The primary source is sufficient for this attended review.',
    )
    await user.click(screen.getByLabelText('I reviewed the explicit CNC evidence'))
    await user.click(screen.getByRole('button', { name: 'Approve revision' }))
    expect(screen.getByTestId('industry-review-approval-confirmation')).toBeInTheDocument()
  })

  it('renders run history section with recent maintenance runs', async () => {
    requestJsonMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/company-industry-proposals?')) {
        return Promise.resolve({ success: true, items: [proposal] })
      }
      if (path === '/api/company-industry-evidence-sources?proposalId=proposal-1') {
        return Promise.resolve({ success: true, items: [source] })
      }
      if (path === '/api/company-industry-bundles/acme-cnc') {
        return Promise.resolve({ success: true, profile: { companyKey: 'acme-cnc', industryClass: 'cnc', verificationLevel: 'verified', currentRevisionId: 'revision-1' }, revisions: [], sources: [] })
      }
      if (path === '/api/company-industry-maintenance-runs?limit=20') {
        return Promise.resolve({
          success: true,
          items: [
            { runId: 'run-h1', triggerSource: 'manual', status: 'completed', operatorSummary: 'completed; 1 ready.', startedAt: 1000 },
          ],
        })
      }
      return Promise.resolve({ success: true })
    })
    renderPage()

    expect(await screen.findByText('completed; 1 ready.')).toBeInTheDocument()
  })

  it('shows empty-queue hint pointing at run history when queue is empty', async () => {
    requestJsonMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path === '/api/company-industry-maintenance-runs?limit=20') {
        return Promise.resolve({
          success: true,
          items: [
            { runId: 'run-h2', triggerSource: 'restore', status: 'completed', operatorSummary: 'completed; 0 ready.', startedAt: 2000 },
          ],
        })
      }
      return Promise.resolve({ success: true })
    })
    renderPage('/dev/settings/industry-verification?filter=approvable')

    // Queue empty hint is shown.
    expect(await screen.findByText('No clean approvals are waiting.')).toBeInTheDocument()
    // Run history still renders.
    expect(await screen.findByText('completed; 0 ready.')).toBeInTheDocument()
  })
})

describe('SystemSettingsIndustryVerificationPage batch review', () => {
  function makeQueueItem(
    proposalOverrides: Record<string, unknown>,
    recommendationOverrides: Record<string, unknown>,
  ) {
    return {
      proposal: {
        ...cleanInboxProposal,
        ...proposalOverrides,
      },
      recommendation: {
        ...cleanInboxRecommendation,
        ...recommendationOverrides,
      },
      sourceCount: 1,
    }
  }

  function installBatchMock(items: Array<Record<string, unknown>>) {
    let batchBody: { actions: unknown[]; attestation?: unknown } | null = null
    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/company-industry-coverage') {
        return Promise.resolve({ success: true, item: coverageSummary })
      }
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items,
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path.startsWith('/api/company-industry-proposals?status=')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-maintenance-runs')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-profiles')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path === '/api/company-industry-proposals/batch-review' && init?.method === 'POST') {
        batchBody = JSON.parse(String(init.body))
        return Promise.resolve({
          success: true,
          batchId: 'industry-batch-test',
          batchFingerprint: 'f'.repeat(64),
          summary: { total: 1, succeeded: 1, failed: 0 },
          items: [
            {
              proposalId: 'clean-proposal',
              kind: 'approve',
              ok: true,
              revisionId: 'revision-batch',
              companyKey: 'clean-company',
            },
          ],
        })
      }
      return Promise.resolve({ success: true })
    })
    return {
      batchBody: () => batchBody,
    }
  }

  it('batch-approves a clean proposal without attestation details', async () => {
    const harness = installBatchMock([makeQueueItem({}, {})])
    renderPage('/dev/settings/industry-verification')

    const user = userEvent.setup()
    const checkbox = await screen.findByTestId('industry-batch-check-clean-proposal')
    await user.click(checkbox)

    expect(screen.getByTestId('industry-batch-action-bar')).toBeInTheDocument()
    expect(screen.getByTestId('industry-batch-selected-count')).toHaveTextContent('1 selected')

    await user.click(screen.getByTestId('industry-batch-approve-button'))
    expect(await screen.findByTestId('industry-batch-approve-items')).toBeInTheDocument()
    await user.click(screen.getByTestId('industry-batch-approve-submit'))

    await waitFor(() => {
      expect(harness.batchBody()).toEqual({
        actions: [
          { kind: 'approve', proposalId: 'clean-proposal', industryClass: 'industrial' },
        ],
        attestation: {
          schemaVersion: 'industry-review-attestation.v1',
          decisionMode: 'standard',
          acknowledgedRiskFlags: [],
          cncEvidenceAcknowledged: false,
          acknowledgementReason: '',
        },
      })
    })
    expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringContaining('1 approved'))
  })

  it('classifies a weak-signal proposal as non_industry with a risk-override attestation', async () => {
    const harness = installBatchMock([makeQueueItem(
      {
        proposalId: 'weak-proposal',
        companyKey: 'watsons-my',
        suggestedIndustryClass: 'unknown',
      },
      {
        proposalId: 'weak-proposal',
        recommendedIndustryClass: 'unknown',
        recommendedAction: 'inspect',
        riskFlags: ['weak_industry_signal'],
        riskDecision: {
          requiresAcknowledgement: true,
          nonOverridableRiskFlags: [],
          canApproveWithRiskOverride: true,
        },
      },
    )])
    renderPage('/dev/settings/industry-verification')

    const user = userEvent.setup()
    const checkbox = await screen.findByTestId('industry-batch-check-weak-proposal')
    await user.click(checkbox)
    await user.click(screen.getByTestId('industry-batch-approve-button'))

    const classSelect = await screen.findByTestId('industry-batch-class-weak-proposal')
    await user.selectOptions(classSelect, 'non_industry')
    const reason = screen.getByTestId('industry-batch-reason')
    await user.type(reason, 'Official site confirms a retail chain; classifying non_industry.')
    await user.click(screen.getByTestId('industry-batch-approve-submit'))

    await waitFor(() => {
      expect(harness.batchBody()).toEqual({
        actions: [
          { kind: 'approve', proposalId: 'weak-proposal', industryClass: 'non_industry' },
        ],
        attestation: {
          schemaVersion: 'industry-review-attestation.v1',
          decisionMode: 'risk_override',
          acknowledgedRiskFlags: ['weak_industry_signal'],
          cncEvidenceAcknowledged: false,
          acknowledgementReason: 'Official site confirms a retail chain; classifying non_industry.',
        },
      })
    })
  })

  it('batch-rejects selected proposals with a shared note', async () => {
    let batchBody: { actions: unknown[] } | null = null
    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/company-industry-coverage') {
        return Promise.resolve({ success: true, item: coverageSummary })
      }
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [makeQueueItem({}, {})],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path.startsWith('/api/company-industry-proposals?status=')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-maintenance-runs')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-profiles')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path === '/api/company-industry-proposals/batch-review' && init?.method === 'POST') {
        batchBody = JSON.parse(String(init.body))
        return Promise.resolve({
          success: true,
          batchId: 'industry-batch-reject',
          batchFingerprint: 'r'.repeat(64),
          summary: { total: 1, succeeded: 1, failed: 0 },
          items: [
            { proposalId: 'clean-proposal', kind: 'reject', ok: true, status: 'rejected' },
          ],
        })
      }
      return Promise.resolve({ success: true })
    })
    renderPage('/dev/settings/industry-verification')

    const user = userEvent.setup()
    const checkbox = await screen.findByTestId('industry-batch-check-clean-proposal')
    await user.click(checkbox)
    await user.click(screen.getByTestId('industry-batch-reject-button'))

    const note = await screen.findByTestId('industry-batch-reject-note')
    await user.type(note, 'Noise listing without a real company.')
    await user.click(screen.getByTestId('industry-batch-reject-submit'))

    await waitFor(() => {
      expect(batchBody).toEqual({
        actions: [
          {
            kind: 'reject',
            proposalId: 'clean-proposal',
            reviewNote: 'Noise listing without a real company.',
          },
        ],
      })
    })
  })

  it('excludes hard-blocked proposals from the approve dialog', async () => {
    installBatchMock([makeQueueItem(
      {
        proposalId: 'conflict-proposal',
        companyKey: 'conflict-company',
        suggestedIndustryClass: 'unknown',
      },
      {
        proposalId: 'conflict-proposal',
        recommendedIndustryClass: 'unknown',
        recommendedAction: 'needs_more_evidence',
        riskFlags: ['weak_industry_signal', 'source_conflict'],
        riskDecision: {
          requiresAcknowledgement: true,
          nonOverridableRiskFlags: ['source_conflict'],
          canApproveWithRiskOverride: false,
        },
      },
    )])
    renderPage('/dev/settings/industry-verification')

    const user = userEvent.setup()
    const checkbox = await screen.findByTestId('industry-batch-check-conflict-proposal')
    await user.click(checkbox)
    await user.click(screen.getByTestId('industry-batch-approve-button'))

    expect(await screen.findByTestId('industry-batch-excluded')).toBeInTheDocument()
    expect(screen.getByText(/has a non-overridable risk flag/)).toBeInTheDocument()
    expect(screen.getByTestId('industry-batch-approve-submit')).toBeDisabled()
  })

  it('shows the linked-resumes impact line for batch items with resumeImpact and hides it for zero', async () => {
    installBatchMock([
      { ...makeQueueItem({}, {}), resumeImpact: 12 },
      {
        ...makeQueueItem(
          { proposalId: 'clean-proposal-2', companyKey: 'other-company' },
          { proposalId: 'clean-proposal-2' },
        ),
        resumeImpact: 0,
      },
    ])
    renderPage('/dev/settings/industry-verification')

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('industry-batch-check-clean-proposal'))
    await user.click(await screen.findByTestId('industry-batch-check-clean-proposal-2'))
    await user.click(screen.getByTestId('industry-batch-approve-button'))

    const impactLine = await screen.findByTestId('industry-batch-impact-clean-proposal')
    expect(impactLine).toHaveTextContent('Links 12 resumes')
    expect(screen.queryByTestId('industry-batch-impact-clean-proposal-2')).not.toBeInTheDocument()
  })
})

describe('SystemSettingsIndustryVerificationPage identity resolution', () => {
  const unmappedItem = () => ({
    proposal: {
      ...cleanInboxProposal,
      proposalId: 'unmapped-proposal',
      companyKey: undefined,
      normalizedEmployerSurface: 'gmi corporation',
    },
    recommendation: {
      ...cleanInboxRecommendation,
      proposalId: 'unmapped-proposal',
      recommendedAction: 'inspect',
      recommendedIndustryClass: 'unknown',
      recommendedVerificationLevel: 'unverified',
      recommendedSourceIds: [],
      riskFlags: ['canonical_mapping_missing', 'weak_industry_signal'],
      riskDecision: {
        requiresAcknowledgement: true,
        nonOverridableRiskFlags: ['canonical_mapping_missing'],
        canApproveWithRiskOverride: false,
      },
    },
    sourceCount: 2,
  })

  function installIdentityMock() {
    let identityBody: Record<string, unknown> | null = null
    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/company-industry-coverage') {
        return Promise.resolve({ success: true, item: coverageSummary })
      }
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [unmappedItem()],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path.startsWith('/api/company-industry-proposals?status=')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-maintenance-runs')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-profiles')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path === '/api/company-industry-proposals/unmapped-proposal/review-packet') {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          dataset: {
            revision: 'revision-identity',
            inputFingerprint: 'identity-fingerprint',
            proposalUpdatedAt: 2,
            sourceVersions: [],
          },
          proposal: {
            ...cleanInboxProposal,
            proposalId: 'unmapped-proposal',
            companyKey: undefined,
            normalizedEmployerSurface: 'gmi corporation',
          },
          recommendation: {
            ...cleanInboxRecommendation,
            proposalId: 'unmapped-proposal',
            recommendedAction: 'inspect',
            recommendedIndustryClass: 'unknown',
            riskFlags: ['canonical_mapping_missing', 'weak_industry_signal'],
            riskDecision: {
              requiresAcknowledgement: true,
              nonOverridableRiskFlags: ['canonical_mapping_missing'],
              canApproveWithRiskOverride: false,
            },
          },
          reviewContext: { profile: null },
          identityCandidates: [
            {
              candidateFingerprint: 'candidate-gmi',
              proposalId: 'unmapped-proposal',
              normalizedLegalName: 'GMI Corp',
              jurisdiction: 'MY',
              sourceIds: ['source-a', 'source-b'],
              confidence: 0.88,
              conflictCodes: [],
              reviewState: 'candidate',
              extractionVersion: 'v1',
              createdAt: 1,
              updatedAt: 2,
            },
            {
              candidateFingerprint: 'candidate-gmi-high',
              proposalId: 'unmapped-proposal',
              normalizedLegalName: 'German-Malaysian Institute',
              jurisdiction: 'MY',
              sourceIds: ['source-a'],
              confidence: 0.95,
              conflictCodes: ['ambiguous_short_name'],
              reviewState: 'candidate',
              extractionVersion: 'v1',
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        })
      }
      if (path === '/api/companies') {
        return Promise.resolve({
          success: true,
          items: [
            { companyKey: 'gmi-corp', displayName: 'GMI Corp Sdn Bhd', status: 'provisional' },
            { companyKey: 'polywell', displayName: 'Polywell', status: 'confirmed' },
          ],
        })
      }
      if (path === '/api/company-industry-proposals/unmapped-proposal/identity-resolution' && init?.method === 'POST') {
        identityBody = JSON.parse(String(init.body))
        return Promise.resolve({
          success: true,
          proposalId: 'unmapped-proposal',
          companyKey: 'candidate-gmi-high-1',
          auditId: 'audit-identity-test',
        })
      }
      return Promise.resolve({ success: true })
    })
    return {
      identityBody: () => identityBody,
    }
  }

  it('resolves a selected batch item to a provisional identity and clears the selection', async () => {
    const harness = installIdentityMock()
    renderPage('/dev/settings/industry-verification')

    const user = userEvent.setup()
    const checkbox = await screen.findByTestId('industry-batch-check-unmapped-proposal')
    await user.click(checkbox)

    expect(screen.getByTestId('industry-batch-resolve-identity-button')).toBeEnabled()
    await user.click(screen.getByTestId('industry-batch-resolve-identity-button'))

    expect(await screen.findByTestId('industry-identity-candidate-unmapped-proposal-candidate-gmi')).toBeInTheDocument()
    const displayName = screen.getByTestId('industry-identity-display-name-unmapped-proposal') as HTMLInputElement
    expect(displayName.value).toBe('German-Malaysian Institute')

    await user.click(screen.getByTestId('industry-identity-resolve-submit'))

    await waitFor(() => {
      expect(harness.identityBody()).toEqual({
        proposalId: 'unmapped-proposal',
        expectedProposalUpdatedAt: 2,
        candidateFingerprint: 'candidate-gmi-high',
        mappingMode: 'create_provisional',
        provisionalDisplayName: 'German-Malaysian Institute',
        sourceIds: ['source-a'],
        reviewNote: 'Identity mapping reviewed from the batch review lane.',
      })
    })
    expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringContaining('1 mapped'))
  })

  it('resolves identity from the row action and maps to an existing registry company', async () => {
    const harness = installIdentityMock()
    renderPage('/dev/settings/industry-verification')

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('industry-review-resolve-identity-unmapped-proposal'))

    expect(await screen.findByTestId('industry-identity-item-unmapped-proposal')).toBeInTheDocument()
    await user.click(screen.getByTestId('industry-identity-mode-existing-unmapped-proposal'))
    await user.selectOptions(screen.getByTestId('industry-identity-company-unmapped-proposal'), 'polywell')
    await user.click(screen.getByTestId('industry-identity-resolve-submit'))

    await waitFor(() => {
      expect(harness.identityBody()).toEqual(expect.objectContaining({
        proposalId: 'unmapped-proposal',
        mappingMode: 'existing',
        companyKey: 'polywell',
        candidateFingerprint: 'candidate-gmi-high',
        sourceIds: ['source-a'],
      }))
    })
  })
})

describe('SystemSettingsIndustryVerificationPage propagation runs', () => {
  function makeRecomputeRun(overrides: Record<string, unknown>) {
    return {
      runId: 'run-p1',
      workspaceSlug: 'dev',
      companyKey: 'acme-cnc',
      targetRevisionId: 'revision-1',
      status: 'queued',
      attempt: 1,
      sourceDone: false,
      pageCount: 1,
      affectedCount: 12,
      alreadyCurrentCount: 3,
      scheduledCount: 5,
      readyCount: 2,
      failureCount: 0,
      batchCount: 10,
      failures: [],
      createdAt: 1,
      updatedAt: 10,
      operatorSummary: 'queued',
      ...overrides,
    }
  }

  function installPropagationMock() {
    let advanced = false
    const queueItem = (proposalId: string, companyKey: string) => ({
      proposal: { ...proposal, proposalId, companyKey },
      recommendation: { ...recommendation, proposalId },
      sourceCount: 1,
      resumeImpact: 0,
    })
    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/company-industry-coverage') {
        return Promise.resolve({ success: true, item: coverageSummary })
      }
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [queueItem('proposal-1', 'acme-cnc'), queueItem('proposal-2', 'clean-company')],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path.startsWith('/api/company-industry-proposals?status=ready_for_review')) {
        return Promise.resolve({
          success: true,
          items: [queueItem('proposal-1', 'acme-cnc'), queueItem('proposal-2', 'clean-company')],
        })
      }
      if (path.startsWith('/api/company-industry-recompute-runs?companyKey=acme-cnc')) {
        return Promise.resolve({
          success: true,
          items: [
            makeRecomputeRun({ status: advanced ? 'completed' : 'queued' }),
            makeRecomputeRun({ runId: 'run-p2', status: 'completed', updatedAt: 5 }),
          ],
        })
      }
      if (path.startsWith('/api/company-industry-recompute-runs?companyKey=clean-company')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path === '/api/company-industry-recompute-runs/run-p1/advance-all' && init?.method === 'POST') {
        advanced = true
        return Promise.resolve({ success: true, item: makeRecomputeRun({ status: 'completed' }) })
      }
      if (path.startsWith('/api/company-industry-proposals?status=')) {
        // Real proposals-list shape: TOP-LEVEL companyKey (no `.proposal` nesting).
        return Promise.resolve({
          success: true,
          items: [
            { ...proposal, proposalId: 'proposal-1', companyKey: 'acme-cnc' },
            { ...proposal, proposalId: 'proposal-2', companyKey: 'clean-company' },
          ],
        })
      }
      if (path.startsWith('/api/company-industry-maintenance-runs')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-profiles')) {
        return Promise.resolve({ success: true, items: [] })
      }
      return Promise.resolve({ success: true })
    })
  }

  it('renders per-company recompute runs with statuses, counts, and advance controls', async () => {
    installPropagationMock()
    renderPage('/dev/settings/industry-verification')

    expect(await screen.findByTestId('industry-coverage-propagation')).toBeInTheDocument()
    const runRow = screen.getByTestId('industry-coverage-propagation-run-run-p1')
    expect(runRow).toHaveTextContent('ACME CNC')
    expect(runRow).toHaveTextContent('Status queued')
    expect(runRow).toHaveTextContent('12')
    expect(runRow).toHaveTextContent('5')
    expect(screen.getByTestId('industry-coverage-propagation-advance-run-p1')).toBeInTheDocument()

    const completedRow = screen.getByTestId('industry-coverage-propagation-run-run-p2')
    expect(completedRow).toHaveTextContent('Status completed')
    expect(screen.queryByTestId('industry-coverage-propagation-advance-run-p2')).not.toBeInTheDocument()
  })

  it('advances a non-terminal run via advance-all and refetches the section', async () => {
    const user = userEvent.setup()
    installPropagationMock()
    renderPage('/dev/settings/industry-verification')

    const advanceButton = await screen.findByTestId('industry-coverage-propagation-advance-run-p1')
    await user.click(advanceButton)

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-recompute-runs/run-p1/advance-all',
        { method: 'POST' },
      )
    })
    await waitFor(() => {
      expect(screen.queryByTestId('industry-coverage-propagation-advance-run-p1')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('industry-coverage-propagation-run-run-p1')).toHaveTextContent('Status completed')
  })

  it('shows the empty state when no recompute runs exist for inbox companies', async () => {
    requestJsonMock.mockImplementation((path: string) => {
      if (path === '/api/company-industry-coverage') {
        return Promise.resolve({ success: true, item: coverageSummary })
      }
      if (path.startsWith('/api/company-industry-proposals/review-queue?')) {
        return Promise.resolve({
          success: true,
          ok: true,
          schemaVersion: 'industry-review.v1',
          items: [
            { proposal: { ...proposal, proposalId: 'proposal-1', companyKey: 'acme-cnc' }, recommendation, sourceCount: 1 },
          ],
          maintenance: { latest: null, lastFailed: null },
        })
      }
      if (path.startsWith('/api/company-industry-proposals?status=ready_for_review')) {
        return Promise.resolve({
          success: true,
          items: [
            { ...proposal, proposalId: 'proposal-1', companyKey: 'acme-cnc' },
          ],
        })
      }
      if (path.startsWith('/api/company-industry-recompute-runs?')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-proposals?status=')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-maintenance-runs')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path.startsWith('/api/company-industry-profiles')) {
        return Promise.resolve({ success: true, items: [] })
      }
      return Promise.resolve({ success: true })
    })
    renderPage('/dev/settings/industry-verification')

    expect(await screen.findByTestId('industry-coverage-propagation-empty')).toBeInTheDocument()
  })
})
