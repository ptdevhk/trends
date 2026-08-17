import { expect, test, type Page, type Route } from '@playwright/test'
import { isRecord, SYSTEM_SETTINGS_NAV_ITEMS } from '@trends/shared'

/**
 * E2e UAT for the HR industry-verification manual review flow.
 *
 * Exercises the full unknown-company review path demonstrated in the
 * 2026-08-14 session:
 *   inbox → view evidence → resolve identity → select class →
 *   acknowledge risks → approve → history.
 *
 * All API routes are mocked (same pattern as provider-membership-admin.spec.ts);
 * no live backend required. The mock data encodes the CN-registry fixes:
 * the qcc.com homepage is search_result/discovery (not registry), and
 * source_conflict / stale_or_failed_source do not appear.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserKind = 'hr'

type AuthUser = {
  id: string
  email: string
  displayName: string
  status: 'active'
}

type WorkspaceMembership = {
  userId: string
  workspaceSlug: string
  role: 'user' | 'admin'
}

// ---------------------------------------------------------------------------
// Auth + config mocks
// ---------------------------------------------------------------------------

const users: Record<UserKind, AuthUser> = {
  hr: {
    id: 'hr-e2e',
    email: 'hr-demo@example.com',
    displayName: 'HR User E2E',
    status: 'active',
  },
}

const memberships: Record<UserKind, WorkspaceMembership[]> = {
  hr: [{ userId: users.hr.id, workspaceSlug: 'hr', role: 'admin' }],
}

// ---------------------------------------------------------------------------
// Industry proposal / packet mock data
// ---------------------------------------------------------------------------

const proposalId = 'industry-e2e-proposal-1'
const companyKey = 'candidate-e2e-test-company-key'
const candidateFingerprint = 'e2ecandidatefingerprint0000000000000000001'

const unmappedProposal = {
  _id: 'proposal-row-e2e',
  proposalId,
  companyKey: undefined,
  triggerReasons: ['unknown_employer'],
  priority: 50,
  status: 'ready_for_review',
  suggestedIndustryClass: 'unknown',
  suggestedVerificationLevel: 'candidate',
  normalizedEmployerSurface: '测试工业有限公司',
  materialChangeSummary: 'Research found 1 reviewable source(s).',
  createdAt: 1,
  updatedAt: 2,
}

const mappedProposal = {
  ...unmappedProposal,
  companyKey,
  updatedAt: 3,
}

// Only canonical_mapping_missing — no stale_or_failed_source, source_conflict,
// or only_discovery_sources (the hard blocks the fixes removed).
const unmappedRecommendation = {
  proposalId,
  proposalStatus: 'ready_for_review',
  recommendedAction: 'inspect',
  recommendedVerificationLevel: 'verified',
  recommendedIndustryClass: 'unknown',
  recommendedSourceIds: ['source-baike'],
  sourceDecisions: [
    {
      sourceId: 'source-baike',
      approvalSafe: true,
      recommended: true,
      reasonCodes: ['approval_safe', 'recommended_corroborating'],
    },
    {
      sourceId: 'source-qcc',
      approvalSafe: false,
      recommended: false,
      reasonCodes: ['search_result_not_approval_safe', 'discovery_not_approval_safe'],
    },
  ],
  confidenceBand: 'low',
  riskFlags: ['canonical_mapping_missing', 'low_source_diversity', 'weak_industry_signal'],
  reasons: [
    'The proposal is not mapped to a canonical company.',
    'No industry class has been suggested by the proposal or reviewed profile.',
  ],
  excludedSourceReasons: {
    'source-qcc': 'search result not approval safe, discovery not approval safe',
  },
  riskDecision: {
    requiresAcknowledgement: true,
    nonOverridableRiskFlags: ['canonical_mapping_missing'],
    canApproveWithRiskOverride: false,
  },
  evidenceSummaryDraft: 'Research found 1 reviewable source(s).',
  decisionReasonDraft: 'Additional evidence or canonical-company review is required before changing verified truth.',
  requiresHumanReview: true,
  autoApprovable: false,
}

const mappedRecommendation = {
  ...unmappedRecommendation,
  riskFlags: ['low_source_diversity', 'weak_industry_signal'],
  recommendedAction: 'inspect',
  riskDecision: {
    requiresAcknowledgement: true,
    nonOverridableRiskFlags: [],
    canApproveWithRiskOverride: true,
  },
  reasons: [
    'No industry class has been suggested by the proposal or reviewed profile.',
  ],
}

const approvedRecommendation = {
  ...mappedRecommendation,
  recommendedAction: 'approve',
  recommendedIndustryClass: 'industrial',
  riskFlags: [],
  riskDecision: {
    requiresAcknowledgement: false,
    nonOverridableRiskFlags: [],
    canApproveWithRiskOverride: true,
  },
  recommendedSourceIds: ['source-baike'],
  sourceDecisions: [
    {
      sourceId: 'source-baike',
      approvalSafe: true,
      recommended: true,
      reasonCodes: ['approval_safe', 'recommended_corroborating'],
    },
    {
      sourceId: 'source-qcc',
      approvalSafe: false,
      recommended: false,
      reasonCodes: ['search_result_not_approval_safe', 'discovery_not_approval_safe'],
    },
  ],
}

// baike.so.com — reporting/corroborating, approval-safe
const baikeSource = {
  _id: 'source-row-baike',
  sourceId: 'source-baike',
  companyKey,
  proposalId,
  url: 'https://baike.so.com/doc/421249-446111.html',
  sourceDomain: 'baike.so.com',
  sourceType: 'reporting',
  trustTier: 'corroborating',
  title: '测试工业有限公司_360百科',
  evidenceExcerpt: '测试工业有限公司 电机 减速电机 齿轮减速电机 微型马达 商铺首页',
  fetchedAt: 20,
  lastSuccessfulFetchAt: 20,
  contentFingerprint: 'sha256:baike',
  fetchStatus: 'fetched',
  suggestedIndustryClass: 'industrial',
  workerConfidence: 0.67,
  reviewStatus: 'unreviewed',
  sourceState: 'active',
  createdAt: 1,
  updatedAt: 20,
}

// qcc.com homepage — search_result/discovery, NOT approval-safe
// (the fix: qcc.com/?utm_source=360zrkp is a search landing, not a registry record)
const qccSource = {
  _id: 'source-row-qcc',
  sourceId: 'source-qcc',
  companyKey,
  proposalId,
  url: 'https://www.qcc.com/?utm_source=360zrkp&utm_query=%E6%B5%8B%E8%AF%95',
  sourceDomain: 'www.qcc.com',
  sourceType: 'search_result',
  trustTier: 'discovery',
  title: '企查查 - 查企业_查老板_查风险_企业信息查询系统',
  evidenceExcerpt: '企查查 - 查企业_查老板_查风险_企业信息查询系统',
  fetchedAt: 21,
  lastSuccessfulFetchAt: 21,
  contentFingerprint: 'sha256:qcc',
  fetchStatus: 'fetched',
  suggestedIndustryClass: 'unknown',
  workerConfidence: 0.2,
  reviewStatus: 'unreviewed',
  sourceState: 'active',
  createdAt: 1,
  updatedAt: 21,
}

function buildPacket(options: {
  proposal: typeof unmappedProposal
  recommendation: typeof unmappedRecommendation
  identityCandidates?: unknown[]
}) {
  return {
    success: true,
    ok: true,
    schemaVersion: 'industry-review.v1',
    operation: { id: 'review-e2e', kind: 'recommendation', state: 'computed' },
    dataset: {
      revision: `${proposalId}:2:none`,
      inputFingerprint: 'e2e-fingerprint',
      proposalUpdatedAt: options.proposal.updatedAt,
      sourceVersions: [
        { sourceId: 'source-baike', updatedAt: 20 },
        { sourceId: 'source-qcc', updatedAt: 21 },
      ],
      generatedAt: 20,
    },
    recommendation: options.recommendation,
    warnings: [],
    proposal: options.proposal,
    sources: [baikeSource, qccSource],
    reviewContext: {
      profile: null,
      revisions: [],
    },
    recomputeRuns: [],
    maintenance: { latest: null, lastFailed: null },
    research: { summary: null, candidates: [] },
    identityCandidates: options.identityCandidates ?? [],
    bundle: {
      profile: null,
      revisions: [],
      sources: [],
    },
  }
}

const identityCandidate = {
  candidateFingerprint,
  proposalId,
  normalizedLegalName: '测试工业有限公司',
  jurisdiction: 'CN',
  sourceIds: ['source-baike'],
  confidence: 0.82,
  conflictCodes: [],
  reviewState: 'candidate',
  extractionVersion: 'legal-name-v1',
  createdAt: 1,
  updatedAt: 2,
}

const coverageSummary = {
  generatedAt: 1_700_000_000_000,
  workspaceSlug: 'hr',
  proposalsByStatus: {
    new: 0,
    researching: 0,
    ready_for_review: 1,
    needs_more_evidence: 0,
    approved: 0,
    rejected: 0,
    superseded: 0,
  },
  openTotal: 1,
  openWithSources: 1,
  openWithoutSources: 0,
  emptyEvidenceBottleneck: false,
  readyBacklogBottleneck: false,
  resumes: { total: 100, withVerifiedEvidence: 0 },
  profiles: { total: 0, verified: 0, rejected: 0 },
  maintenance: { latest: null, lastFailed: null },
}

const approvedProposalHistory = {
  ...mappedProposal,
  status: 'approved',
  reviewedAt: 100,
  reviewNote: 'E2E approved.',
  suggestedIndustryClass: 'industrial',
  updatedAt: 99,
}

// ---------------------------------------------------------------------------
// Mock API installer
// ---------------------------------------------------------------------------

function jsonResponse(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function parseJsonBody(route: Route): unknown {
  try {
    return route.request().postDataJSON()
  } catch {
    return undefined
  }
}

interface MockState {
  identityResolved: boolean
  approved: boolean
  identityBody: unknown
  approveBody: unknown
}

async function installMockApi(page: Page): Promise<{ state: MockState }> {
  const state: MockState = {
    identityResolved: false,
    approved: false,
    identityBody: undefined,
    approveBody: undefined,
  }

  await page.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'zh-Hans')
  })

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const { pathname } = new URL(request.url())

    // Auth
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = parseJsonBody(route)
      if (isRecord(body) && body.username === 'hr-e2e' && body.password === 'hr-secret') {
        await jsonResponse(route, 200, {
          success: true,
          user: users.hr,
          memberships: memberships.hr,
          csrfToken: 'csrf-e2e',
          expiresAt: '2026-08-15T00:00:00.000Z',
        })
        return
      }
      await jsonResponse(route, 401, { success: false, error: 'Invalid username or password' })
      return
    }

    if (pathname === '/api/auth/me') {
      await jsonResponse(route, 200, {
        success: true,
        user: users.hr,
        memberships: memberships.hr,
        workspaceRole: 'admin',
      })
      return
    }

    // Config + system metadata
    if (pathname === '/api/config/resume-field-usage-policy') {
      await jsonResponse(route, 200, { success: true, config: {} })
      return
    }
    if (pathname === '/api/industry/brand-display-map') {
      await jsonResponse(route, 200, {})
      return
    }
    if (pathname === '/api/config/system-metadata') {
      await jsonResponse(route, 200, {
        success: true,
        metadata: {
          identity: { appVersion: 'e2e' },
          navigation: {
            system: [],
            settings: [],
            systemSettings: SYSTEM_SETTINGS_NAV_ITEMS,
            debugPage: [],
          },
        },
      })
      return
    }
    if (pathname === '/api/system/resume-work-history-limit') {
      await jsonResponse(route, 200, { success: true, limit: 20 })
      return
    }

    // Resume analysis tasks (polled by the layout)
    if (pathname === '/api/resumes/analysis-tasks') {
      await jsonResponse(route, 200, { success: true, items: [] })
      return
    }

    // Convex query/mutation pass-through (for the auth context Convex calls)
    if (pathname === '/api/query') {
      await jsonResponse(route, 200, { status: 'success', value: null })
      return
    }
    if (pathname === '/api/mutation') {
      await jsonResponse(route, 200, { status: 'success', value: null })
      return
    }

    // Industry coverage
    if (pathname === '/api/company-industry-coverage') {
      const coverage = state.approved
        ? { ...coverageSummary, proposalsByStatus: { ...coverageSummary.proposalsByStatus, ready_for_review: 0, approved: 1 }, resumes: { total: 100, withVerifiedEvidence: 1 }, profiles: { total: 1, verified: 1, rejected: 0 } }
        : coverageSummary
      await jsonResponse(route, 200, { success: true, item: coverage })
      return
    }

    // Maintenance runs
    if (pathname.startsWith('/api/company-industry-maintenance-runs')) {
      await jsonResponse(route, 200, { success: true, items: [] })
      return
    }

    // Recompute runs
    if (pathname.startsWith('/api/company-industry-recompute-runs')) {
      await jsonResponse(route, 200, { success: true, items: [] })
      return
    }

    // Industry profiles list
    if (pathname.startsWith('/api/company-industry-profiles')) {
      await jsonResponse(route, 200, { success: true, items: [] })
      return
    }

    // Industry bundles (company profile lookup)
    if (pathname.startsWith('/api/company-industry-bundles/')) {
      await jsonResponse(route, 200, {
        success: true,
        profile: null,
        revisions: [],
        sources: [],
      })
      return
    }

    // Review queue
    if (pathname === '/api/company-industry-proposals/review-queue') {
      const proposal = state.identityResolved ? mappedProposal : unmappedProposal
      const recommendation = state.identityResolved ? mappedRecommendation : unmappedRecommendation
      await jsonResponse(route, 200, {
        success: true,
        ok: true,
        schemaVersion: 'industry-review.v1',
        items: [{ proposal, recommendation, sourceCount: 2 }],
        maintenance: { latest: null, lastFailed: null },
      })
      return
    }

    // Proposals list (for history tab — path is exactly /api/company-industry-proposals)
    if (pathname === '/api/company-industry-proposals') {
      const items = state.approved ? [approvedProposalHistory] : []
      await jsonResponse(route, 200, { success: true, items })
      return
    }

    // Review packet
    if (pathname === `/api/company-industry-proposals/${proposalId}/review-packet`) {
      const proposal = state.identityResolved ? mappedProposal : unmappedProposal
      const recommendation = state.identityResolved
        ? (state.approved ? approvedRecommendation : mappedRecommendation)
        : unmappedRecommendation
      const identityCandidates = state.identityResolved ? [] : [identityCandidate]
      await jsonResponse(route, 200, buildPacket({ proposal, recommendation, identityCandidates }))
      return
    }

    // Identity resolution
    if (pathname === `/api/company-industry-proposals/${proposalId}/identity-resolution` && method === 'POST') {
      state.identityBody = parseJsonBody(route)
      state.identityResolved = true
      await jsonResponse(route, 200, {
        success: true,
        proposalId,
        companyKey,
        auditId: 'audit-e2e-identity',
      })
      return
    }

    // Approve
    if (pathname === `/api/company-industry-proposals/${proposalId}/approve` && method === 'POST') {
      state.approveBody = parseJsonBody(route)
      state.approved = true
      await jsonResponse(route, 200, {
        success: true,
        proposalId,
        revisionId: 'industry-candidate-e2e-test-company-key-revision-e2e',
        companyKey,
        recompute: {
          runId: 'recompute-e2e',
          workspaceSlug: 'hr',
          companyKey,
          status: 'completed',
          attempt: 1,
          affectedCount: 0,
          failureCount: 0,
        },
      })
      return
    }

    // Companies list (for identity dialog)
    if (pathname === '/api/companies') {
      await jsonResponse(route, 200, {
        success: true,
        items: [
          { companyKey, displayName: '测试工业有限公司', status: 'provisional' },
        ],
      })
      return
    }

    // Default
    await jsonResponse(route, 200, { success: true })
  })

  return { state }
}

// ---------------------------------------------------------------------------
// Console problem collection
// ---------------------------------------------------------------------------

function collectConsoleProblems(page: Page) {
  const messages: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (
      message.type() === 'error'
      || message.type() === 'warning'
      || /missingKey|missing i18n|i18next::translator/i.test(text)
    ) {
      messages.push(`${message.type()}: ${text}`)
    }
  })
  page.on('pageerror', (error) => {
    messages.push(`pageerror: ${error.message}`)
  })
  return { messages }
}

async function signIn(page: Page) {
  await page.goto(`/hr/login?redirectTo=${encodeURIComponent('/hr/system/settings/industry-verification')}`)
  // Labels are in zh-Hans (set via initScript): 用户名=Username, 密码=Password, 登录=Sign in
  await page.getByLabel('用户名').fill('hr-e2e')
  await page.getByLabel('密码').fill('hr-secret')
  await page.getByRole('button', { name: '登录' }).click()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Industry verification manual review (HR unknown company)', () => {
  test('loads the inbox with ready proposals and no hard-block flags', async ({ page }) => {
    const { state } = await installMockApi(page)
    const consoleProblems = collectConsoleProblems(page)
    await signIn(page)

    await expect(page).toHaveURL(/industry-verification/)
    await expect(page.getByRole('heading', { name: '行业验证' })).toBeVisible()

    // Queue should show the proposal
    await expect(page.getByText('测试工业有限公司').first()).toBeVisible()

    // The only risk flag visible should be canonical_mapping_missing
    // (no stale_or_failed_source, source_conflict, or only_discovery_sources)
    await expect(page.getByText('缺少规范公司映射')).toBeVisible()

    // Resolve identity button must be present
    await expect(page.getByTestId(`industry-review-resolve-identity-${proposalId}`)).toBeVisible()

    // No console errors
    expect(consoleProblems.messages).toEqual([])
    expect(state.identityResolved).toBe(false)
  })

  test('resolves identity for an unknown company with a candidate', async ({ page }) => {
    const { state } = await installMockApi(page)
    const consoleProblems = collectConsoleProblems(page)
    await signIn(page)

    // Click resolve identity
    await page.getByTestId(`industry-review-resolve-identity-${proposalId}`).click()

    // Dialog should appear with the candidate
    const dialog = page.getByRole('dialog', { name: '解析雇主身份' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('测试工业有限公司').first()).toBeVisible()
    await expect(dialog.getByText('82%')).toBeVisible()

    // Create provisional company should be selected by default
    await expect(dialog.getByRole('radio', { name: '创建临时公司' })).toBeChecked()

    // Submit identity resolution
    await page.getByTestId('industry-identity-resolve-submit').click()

    // Dialog should close
    await expect(dialog).toHaveCount(0)

    // POST /identity-resolution was called
    expect(state.identityResolved).toBe(true)
    expect(isRecord(state.identityBody)).toBe(true)

    // No console errors
    expect(consoleProblems.messages).toEqual([])
  })

  test('shows qcc.com homepage as discovery not approval-safe', async ({ page }) => {
    const { state } = await installMockApi(page)
    await signIn(page)

    // First resolve identity so the packet shows with companyKey
    await page.getByTestId(`industry-review-resolve-identity-${proposalId}`).click()
    await page.getByTestId('industry-identity-resolve-submit').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Click view to open the evidence packet detail
    await page.getByTestId(`industry-review-row-${proposalId}`).getByRole('button', { name: '查看' }).click()

    // The qcc.com homepage source should be search_result/discovery, not approval-safe
    await expect(page.getByText('企查查 - 查企业_查老板_查风险_企业信息查询系统').first()).toBeVisible()
    await expect(page.getByText('search_result').first()).toBeVisible()
    await expect(page.getByText('discovery').first()).toBeVisible()
    await expect(page.getByText('不适合批准').first()).toBeVisible()

    // The qcc source checkbox should be disabled
    const qccCheckbox = page.getByRole('checkbox', { name: /企查查/ })
    await expect(qccCheckbox).toBeDisabled()

    // The baike source should be reporting/corroborating and checked
    await expect(page.getByText('reporting')).toBeVisible()
    await expect(page.getByText('corroborating')).toBeVisible()
    expect(state.identityResolved).toBe(true)
  })

  test('approves with risk-override attestation', async ({ page }) => {
    const { state } = await installMockApi(page)
    const consoleProblems = collectConsoleProblems(page)
    await signIn(page)

    // Resolve identity first
    await page.getByTestId(`industry-review-resolve-identity-${proposalId}`).click()
    await page.getByTestId('industry-identity-resolve-submit').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Open evidence packet
    await page.getByTestId(`industry-review-row-${proposalId}`).getByRole('button', { name: '查看' }).click()

    // Select industrial as the industry class
    await page.getByLabel(/Industry class/).selectOption('industrial')

    // Fill evidence summary + decision reason
    await page.getByLabel(/Evidence summary/).fill(
      '360百科 confirms industrial manufacturer of gear motors and micro motors.',
    )
    await page.getByLabel(/Decision reason/).fill(
      'Reviewer approves industrial classification based on evidence.',
    )

    // Acknowledge risk flags
    await page.getByLabel(/Acknowledge low_source_diversity/).check()
    await page.getByLabel(/Acknowledge weak_industry_signal/).check()

    // Fill acknowledgement reason (zh-Hans label)
    await page.getByLabel('详细确认理由').fill(
      'Single corroborating source with direct employer mention.',
    )

    // Click Approve revision
    await page.getByRole('button', { name: 'Approve revision' }).click()

    // Confirm dialog should appear — click the confirm button
    await page.getByRole('button', { name: 'Confirm approve revision' }).click()

    // POST /approve was called
    expect(state.approved).toBe(true)
    expect(isRecord(state.approveBody)).toBe(true)

    // No console errors
    expect(consoleProblems.messages).toEqual([])
  })

  test('shows the approved proposal in History', async ({ page }) => {
    test.setTimeout(60_000)
    const { state } = await installMockApi(page)
    await signIn(page)

    // Resolve identity + approve
    await page.getByTestId(`industry-review-resolve-identity-${proposalId}`).click()
    await page.getByTestId('industry-identity-resolve-submit').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByTestId(`industry-review-row-${proposalId}`).getByRole('button', { name: '查看' }).click()
    await page.getByLabel(/Industry class/).selectOption('industrial')
    await page.getByLabel(/Evidence summary/).fill('Evidence summary.')
    await page.getByLabel(/Decision reason/).fill('Decision reason.')
    await page.getByLabel(/Acknowledge low_source_diversity/).check()
    await page.getByLabel(/Acknowledge weak_industry_signal/).check()
    await page.getByLabel('详细确认理由').fill('Acknowledged.')
    await page.getByRole('button', { name: 'Approve revision' }).click()
    await page.getByRole('button', { name: 'Confirm approve revision' }).click()

    // Wait for state to propagate
    expect(state.approved).toBe(true)

    // Click the History tab (zh-Hans: 历史)
    await page.getByRole('tab', { name: /历史/ }).click()

    // The approved proposal should appear in history
    await expect(page.getByText('测试工业有限公司').first()).toBeVisible()
    await expect(page.getByText('approved').first()).toBeVisible()
    await expect(page.getByText('industrial').first()).toBeVisible()
  })
})
