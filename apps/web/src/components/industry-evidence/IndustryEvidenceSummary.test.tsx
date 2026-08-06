import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IndustryEvidenceDetail,
  IndustryEvidenceSummary,
  VerifiedCompanyBadge,
} from '@/components/industry-evidence/IndustryEvidenceSummary'
import { findVerifiedIndustrySummaryForCompany } from '@/components/industry-evidence/industry-evidence'
import { rawApiClient } from '@/lib/api-helpers'

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: vi.fn(),
  },
}))

const summaries = [{
  companyKey: 'acme-cnc',
  companyName: 'Acme CNC',
  industryClass: 'cnc' as const,
  verificationLevel: 'verified' as const,
  verdictRevisionId: 'revision-1',
  evidenceSummary: 'Known CNC company confirmed by approved official evidence.',
  reviewedAt: Date.UTC(2026, 6, 20),
  reviewedBy: 'Reviewer A',
  verifiedYears: 4,
  roleTypes: ['sales'],
  sourceCount: 2,
  sourcePreviews: [{
    sourceId: 'source-1',
    url: 'https://acme.example/about',
    sourceDomain: 'acme.example',
    sourceType: 'official_site' as const,
    trustTier: 'primary' as const,
    title: 'About Acme',
    evidenceExcerpt: 'Acme manufactures CNC machining centres.',
    fetchedAt: Date.UTC(2026, 6, 18),
    reviewedAt: Date.UTC(2026, 6, 20),
  }],
  additionalSourceCount: 1,
}, {
  companyKey: 'beta-cnc',
  companyName: 'Beta CNC',
  industryClass: 'cnc' as const,
  verificationLevel: 'verified' as const,
  verdictRevisionId: 'revision-2',
  evidenceSummary: 'Approved CNC distributor.',
  reviewedAt: Date.UTC(2026, 6, 18),
  sourceCount: 0,
  sourcePreviews: [],
  additionalSourceCount: 0,
}]

afterEach(() => {
  vi.clearAllMocks()
})

describe('IndustryEvidenceSummary', () => {
  it('shows one compact approved summary and the additional employer count', () => {
    render(<IndustryEvidenceSummary summaries={summaries} preferredRoleTypes={['sales']} />)

    expect(screen.getByText(/CNC (Verified|行业验证)/)).toBeInTheDocument()
    expect(screen.getByText('Acme CNC')).toBeInTheDocument()
    expect(screen.getByText('Known CNC company confirmed by approved official evidence.')).toBeInTheDocument()
    expect(screen.getByText('+1 verified employer')).toBeInTheDocument()
    expect(screen.queryByText('Beta CNC')).not.toBeInTheDocument()
  })

  it('triggers onCompanyClick when company name is clicked', async () => {
    const user = userEvent.setup()
    const handleCompanyClick = vi.fn()

    render(
      <IndustryEvidenceSummary
        summaries={summaries.slice(0, 1)}
        onCompanyClick={handleCompanyClick}
      />
    )

    const companyButton = screen.getByRole('button', { name: /Acme CNC/i })
    await user.click(companyButton)

    expect(handleCompanyClick).toHaveBeenCalledWith('Acme CNC')
  })

  it('opens a source preview by hover, focus, and tap and dismisses it safely', async () => {
    const user = userEvent.setup()
    render(<IndustryEvidenceSummary summaries={summaries.slice(0, 1)} />)
    const sourceChip = screen.getByRole('button', { name: /Official source from acme\.example/i })

    fireEvent.mouseEnter(sourceChip)
    expect(await screen.findByRole('dialog', { name: 'About Acme' })).toBeInTheDocument()
    expect(screen.getByText('Acme manufactures CNC machining centres.')).toBeInTheDocument()
    expect(screen.getByText('Human approved')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute('rel', expect.stringContaining('noopener'))

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'About Acme' })).not.toBeInTheDocument())

    sourceChip.focus()
    expect(await screen.findByRole('dialog', { name: 'About Acme' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'About Acme' })).not.toBeInTheDocument())

    sourceChip.blur()
    await user.click(sourceChip)
    expect(await screen.findByRole('dialog', { name: 'About Acme' })).toBeInTheDocument()
    await user.click(sourceChip)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'About Acme' })).not.toBeInTheDocument())
  })
})

describe('VerifiedCompanyBadge', () => {
  it('renders inline badge for verified company in work history list', () => {
    render(<VerifiedCompanyBadge summary={summaries[0]} />)
    expect(screen.getByText(/CNC (Verified|行业验证)/)).toBeInTheDocument()
  })

  it('correctly matches company names using findVerifiedIndustrySummaryForCompany', () => {
    const lionapexSummary = {
      companyKey: 'lionapex-equipment-m-sdn-bhd',
      companyName: 'Lionapex Equipment (M) Sdn. Bhd.',
      industryClass: 'cnc' as const,
      verificationLevel: 'verified' as const,
      verdictRevisionId: 'revision-3',
      evidenceSummary: 'CNC machinery supplier.',
      reviewedAt: Date.UTC(2026, 6, 20),
      sourceCount: 1,
      sourcePreviews: [],
      additionalSourceCount: 0,
    }
    const testSummaries = [...summaries, lionapexSummary]

    // Exact string match with dot variation: "Lionapex Equipment (M) Sdn Bhd" vs "Lionapex Equipment (M) Sdn. Bhd."
    const matchLionapex = findVerifiedIndustrySummaryForCompany('Lionapex Equipment (M) Sdn Bhd', testSummaries)
    expect(matchLionapex?.companyKey).toBe('lionapex-equipment-m-sdn-bhd')

    // Role signals fallback match
    const matchViaSignal = findVerifiedIndustrySummaryForCompany(
      'Lionapex Equipment',
      testSummaries,
      {
        roleSignals: [{
          matchedWorkEntries: [{
            companyKey: 'lionapex-equipment-m-sdn-bhd',
            companyName: 'Lionapex Equipment (M) Sdn. Bhd.',
            years: 5,
            matchedSignals: ['cnc'],
            industryVerified: true,
          }],
        }],
      },
    )
    expect(matchViaSignal?.companyKey).toBe('lionapex-equipment-m-sdn-bhd')

    const match1 = findVerifiedIndustrySummaryForCompany('Acme CNC Co.', testSummaries)
    expect(match1?.companyKey).toBe('acme-cnc')

    const match2 = findVerifiedIndustrySummaryForCompany('Beta CNC Ltd.', testSummaries)
    expect(match2?.companyKey).toBe('beta-cnc')

    const noMatch = findVerifiedIndustrySummaryForCompany('Unknown Corp', testSummaries)
    expect(noMatch).toBeUndefined()
  })
})

describe('IndustryEvidenceDetail', () => {
  it('shows full materialized approved evidence and requests a coalesced refresh', async () => {
    vi.mocked(rawApiClient.POST).mockResolvedValue({
      data: { success: true, proposalId: 'proposal-1', coalesced: true },
    })
    const user = userEvent.setup()

    render(<IndustryEvidenceDetail summaries={summaries} resumeId="resume-1" />)

    expect(screen.getAllByText('Approved revision')).toHaveLength(2)
    expect(screen.getByText('Reviewer A')).toBeInTheDocument()
    expect(screen.getByText('revision-1')).toBeInTheDocument()
    expect(screen.getByText('1 additional approved source')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Request refresh for Acme CNC' }))

    await waitFor(() => {
      expect(rawApiClient.POST).toHaveBeenCalledWith(
        '/api/company-industry-refresh-requests',
        {
          body: {
            companyKey: 'acme-cnc',
            verdictRevisionId: 'revision-1',
            resumeId: 'resume-1',
          },
        },
      )
    })
    expect(screen.getByText('Refresh requested')).toBeInTheDocument()
  })
})
