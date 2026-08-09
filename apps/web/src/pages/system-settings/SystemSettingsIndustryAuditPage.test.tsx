import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockUseQuery = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => (mockUseQuery as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('../../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    industry_identity: { listIndustryIdentityResolutionAudits: 'industry_identity:listIndustryIdentityResolutionAudits' },
    industry_verdicts: { listIndustryVerdictRevisionsPage: 'industry_verdicts:listIndustryVerdictRevisionsPage' },
  },
}))

import SystemSettingsIndustryAuditPage from './SystemSettingsIndustryAuditPage'

const IDENTITY_REF = 'industry_identity:listIndustryIdentityResolutionAudits'
const VERDICT_REF = 'industry_verdicts:listIndustryVerdictRevisionsPage'

const identityFixtures = [
  {
    auditId: 'audit-1',
    proposalId: 'proposal-a',
    workspaceSlug: 'hr',
    actor: 'hr.lead',
    candidateFingerprint: 'fp-1',
    mappingMode: 'existing',
    targetCompanyKey: 'eonmetall-group',
    sourceIds: ['src-1', 'src-2'],
    previousProposalUpdatedAt: 1000,
    reviewNote: 'Legal name matches registry.',
    createdAt: 1710000000000,
  },
  {
    auditId: 'audit-2',
    proposalId: 'proposal-b',
    workspaceSlug: 'hr',
    actor: 'ops.bot',
    candidateFingerprint: 'fp-2',
    mappingMode: 'create_provisional',
    targetCompanyKey: 'newco-ltd',
    sourceIds: ['src-3'],
    previousProposalUpdatedAt: 1000,
    createdAt: 1710000100000,
  },
]

const verdictFixtures = [
  {
    revisionId: 'rev-1',
    companyKey: 'eonmetall-group',
    industryClass: 'cnc',
    verificationLevel: 'verified',
    approvedSourceIds: ['src-1'],
    evidenceSummary: 'Official site confirms CNC machinery.',
    reviewedBy: 'hr.lead',
    reviewerType: 'human',
    reviewedAt: 1710000000000,
    decisionReason: 'Official site confirms CNC machinery.',
    taxonomyVersion: 'v1',
    reviewAttestation: {
      schemaVersion: 'industry-review-attestation.v1',
      inputFingerprint: 'fp-x',
      decisionMode: 'risk_override',
      acknowledgedRiskFlags: ['weak_industry_signal', 'source_conflict'],
      cncEvidenceAcknowledged: true,
      acknowledgementReason: 'Reviewed durable primary sources.',
      batchId: 'batch-9',
    },
  },
  {
    revisionId: 'rev-2',
    companyKey: 'lathe-co',
    industryClass: 'automation',
    verificationLevel: 'rejected',
    approvedSourceIds: [],
    evidenceSummary: 'No durable sources.',
    reviewedBy: 'auto-verify-bot',
    reviewerType: 'auto-verify-bot',
    reviewedAt: 1710000100000,
    decisionReason: 'No durable sources.',
    taxonomyVersion: 'v1',
  },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/hr/system/settings/industry-audit']}>
      <Routes>
        <Route path="/:teamSlug/system/settings/industry-audit" element={<SystemSettingsIndustryAuditPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const timestampMatcher = (content: string) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(content)

describe('SystemSettingsIndustryAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockImplementation((ref: string, args: { proposalId?: string; batchId?: string }) => {
      if (ref === IDENTITY_REF) {
        return identityFixtures.filter((row) => !args.proposalId || row.proposalId === args.proposalId)
      }
      if (ref === VERDICT_REF) {
        return verdictFixtures.filter(
          (row) => !args.batchId || row.reviewAttestation?.batchId === args.batchId,
        )
      }
      return undefined
    })
  })

  it('renders the identity section with actor, mapping mode, target company, and proposal', () => {
    renderPage()

    const section = screen.getByTestId('industry-audit-identity-section')
    expect(within(section).getByText('hr.lead')).toBeInTheDocument()
    expect(within(section).getByText('Existing company')).toBeInTheDocument()
    expect(within(section).getByText('Provisional company')).toBeInTheDocument()
    expect(within(section).getByText('eonmetall-group')).toBeInTheDocument()
    expect(within(section).getByText('proposal-a')).toBeInTheDocument()
    expect(within(section).getByText('proposal-b')).toBeInTheDocument()
    expect(within(section).getByText('2')).toBeInTheDocument()
    expect(within(section).getByText('Legal name matches registry.')).toBeInTheDocument()
    expect(within(section).getAllByText(timestampMatcher)).toHaveLength(2)
  })

  it('renders the verdict section with decision, actor, timestamp, and batchId when present', () => {
    renderPage()

    const section = screen.getByTestId('industry-audit-verdict-section')
    expect(within(section).getByText('eonmetall-group')).toBeInTheDocument()
    expect(within(section).getByText('CNC')).toBeInTheDocument()
    expect(within(section).getByText('Verified')).toBeInTheDocument()
    expect(within(section).getByText('Rejected')).toBeInTheDocument()
    expect(within(section).getByText('hr.lead')).toBeInTheDocument()
    expect(within(section).getByText(/· Human/)).toBeInTheDocument()
    expect(within(section).getByText(/· Auto-verify bot/)).toBeInTheDocument()
    expect(within(section).getByText('Risk override')).toBeInTheDocument()
    expect(within(section).getByText('Weak industry signal')).toBeInTheDocument()
    expect(within(section).getByText('Source conflict')).toBeInTheDocument()
    expect(within(section).getByText('batch-9')).toBeInTheDocument()
    expect(within(section).getByText('Official site confirms CNC machinery.')).toBeInTheDocument()
    expect(within(section).getAllByText(timestampMatcher)).toHaveLength(2)
  })

  it('hides the batchId cell for revisions without a batch attestation', () => {
    renderPage()

    // Only rev-1 carries a batchId; rev-2 must not render a batch cell.
    expect(screen.getAllByTestId('industry-audit-batch-cell')).toHaveLength(1)
    const verdictRows = screen.getAllByTestId('industry-audit-verdict-row')
    const unattestedRow = verdictRows.find((row) => within(row).queryByText('lathe-co'))
    expect(unattestedRow).toBeTruthy()
    expect(within(unattestedRow as HTMLElement).queryByTestId('industry-audit-batch-cell')).not.toBeInTheDocument()
  })

  it('queries the identity audits with the workspace slug from the route', () => {
    renderPage()

    expect(mockUseQuery).toHaveBeenCalledWith(
      IDENTITY_REF,
      expect.objectContaining({ workspaceSlug: 'hr', limit: 100 }),
    )
  })

  it('filters the verdict set by batchId and the identity set by proposalId', async () => {
    const user = userEvent.setup()
    renderPage()

    // Both verdict rows are visible before filtering.
    expect(screen.getByText('lathe-co')).toBeInTheDocument()

    const verdictSection = screen.getByTestId('industry-audit-verdict-section')
    const batchFilter = within(verdictSection).getByTestId('industry-audit-batch-filter')
    await user.type(batchFilter, 'batch-9')
    await user.click(within(verdictSection).getByRole('button', { name: 'Apply' }))

    expect(mockUseQuery).toHaveBeenLastCalledWith(
      VERDICT_REF,
      expect.objectContaining({ batchId: 'batch-9', limit: 100 }),
    )
    expect(within(verdictSection).getByText('eonmetall-group')).toBeInTheDocument()
    expect(within(verdictSection).queryByText('lathe-co')).not.toBeInTheDocument()

    const identitySection = screen.getByTestId('industry-audit-identity-section')
    const proposalFilter = within(identitySection).getByTestId('industry-audit-proposal-filter')
    await user.type(proposalFilter, 'proposal-b')
    await user.click(within(identitySection).getByRole('button', { name: 'Apply' }))

    // The identity query runs before the verdict query in the component body,
    // so assert it with toHaveBeenCalledWith rather than the last call.
    expect(mockUseQuery).toHaveBeenCalledWith(
      IDENTITY_REF,
      expect.objectContaining({ proposalId: 'proposal-b', limit: 100 }),
    )
    expect(within(identitySection).getByText('newco-ltd')).toBeInTheDocument()
    expect(within(identitySection).queryByText('proposal-a')).not.toBeInTheDocument()
    expect(within(identitySection).queryByText('eonmetall-group')).not.toBeInTheDocument()
  })

  it('shows the loading state while either query is unresolved', () => {
    mockUseQuery.mockReturnValue(undefined)
    renderPage()

    expect(screen.getByTestId('industry-audit-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('industry-audit-identity-section')).not.toBeInTheDocument()
  })

  it('renders empty states when both queries return no rows', () => {
    mockUseQuery.mockReturnValue([])
    renderPage()

    expect(screen.getByTestId('industry-audit-identity-empty')).toHaveTextContent(
      'No identity-resolution audits yet.',
    )
    expect(screen.getByTestId('industry-audit-verdict-empty')).toHaveTextContent(
      'No verdict revisions yet.',
    )
  })
})
