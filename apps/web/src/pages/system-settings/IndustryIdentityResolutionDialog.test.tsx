import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { IndustryIdentityResolutionDialog, pickBestIdentityCandidate } from './IndustryIdentityResolutionDialog'
import type { ReviewInboxItem } from './industry-review-inbox-model'

const unmappedProposal: ReviewInboxItem['proposal'] = {
  _id: 'proposal-unmapped-row',
  proposalId: 'proposal-unmapped',
  normalizedEmployerSurface: 'gmi corporation',
  triggerReasons: ['manual'],
  priority: 80,
  status: 'ready_for_review',
  createdAt: 1,
  updatedAt: 2,
}

const unmappedRecommendation: ReviewInboxItem['recommendation'] = {
  proposalId: 'proposal-unmapped',
  proposalStatus: 'ready_for_review',
  recommendedAction: 'inspect',
  recommendedVerificationLevel: 'unverified',
  recommendedIndustryClass: 'unknown',
  recommendedSourceIds: [],
  sourceDecisions: [],
  confidenceBand: 'low',
  riskFlags: ['canonical_mapping_missing', 'weak_industry_signal'],
  reasons: ['The proposal is not mapped to a canonical company.'],
  excludedSourceReasons: {},
  riskDecision: {
    requiresAcknowledgement: true,
    nonOverridableRiskFlags: ['canonical_mapping_missing'],
    canApproveWithRiskOverride: false,
  },
  evidenceSummaryDraft: '',
  decisionReasonDraft: '',
  requiresHumanReview: true,
}

const item = (proposalId = 'proposal-unmapped'): ReviewInboxItem => ({
  proposal: { ...unmappedProposal, proposalId },
  recommendation: { ...unmappedRecommendation, proposalId },
  inputFingerprint: `fingerprint-${proposalId}`,
  sourceCount: 2,
})

const candidates = [
  {
    candidateFingerprint: 'candidate-gmi',
    proposalId: 'proposal-unmapped',
    normalizedLegalName: 'GMI Corp',
    jurisdiction: 'MY',
    sourceIds: ['source-a', 'source-b'],
    confidence: 0.88,
    conflictCodes: [],
    reviewState: 'candidate' as const,
    extractionVersion: 'v1',
    createdAt: 1,
    updatedAt: 2,
  },
  {
    candidateFingerprint: 'candidate-german-malaysian',
    proposalId: 'proposal-unmapped',
    normalizedLegalName: 'German-Malaysian Institute',
    jurisdiction: 'MY',
    registrationNumber: '12345-A',
    sourceIds: ['source-a'],
    confidence: 0.95,
    conflictCodes: ['ambiguous_short_name'],
    reviewState: 'candidate' as const,
    extractionVersion: 'v1',
    createdAt: 1,
    updatedAt: 2,
  },
  {
    candidateFingerprint: 'candidate-rejected',
    proposalId: 'proposal-unmapped',
    normalizedLegalName: 'PAGE TITLE - GMI',
    sourceIds: ['source-c'],
    confidence: 0.99,
    conflictCodes: [],
    reviewState: 'rejected' as const,
    extractionVersion: 'v1',
    createdAt: 1,
    updatedAt: 2,
  },
]

const companies = [
  { companyKey: 'gmi-corp', displayName: 'GMI Corp Sdn Bhd', status: 'provisional' },
  { companyKey: 'polywell', displayName: 'Polywell', status: 'confirmed' },
]

function renderDialog(overrides: {
  items?: ReviewInboxItem[]
  packets?: Map<string, { candidates: typeof candidates; proposalUpdatedAt: number }>
  onSubmit?: (actions: unknown[]) => void
} = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn()
  const packets = overrides.packets ?? new Map([[
    'proposal-unmapped',
    { candidates, proposalUpdatedAt: 2 },
  ]])
  render(
    <IndustryIdentityResolutionDialog
      open
      items={overrides.items ?? [item()]}
      packets={packets}
      companies={companies}
      companiesLoading={false}
      submitting={false}
      onSubmit={onSubmit}
      onOpenChange={vi.fn()}
    />,
  )
  return { onSubmit }
}

describe('pickBestIdentityCandidate', () => {
  it('prefers the highest-confidence non-rejected candidate', () => {
    expect(pickBestIdentityCandidate(candidates)?.candidateFingerprint).toBe('candidate-german-malaysian')
    expect(pickBestIdentityCandidate([])).toBeUndefined()
    expect(pickBestIdentityCandidate(candidates.slice(2))).toBeUndefined()
  })
})

describe('IndustryIdentityResolutionDialog', () => {
  it('renders every candidate with the best one selected and provisional mode by default', () => {
    renderDialog()

    expect(screen.getByTestId('industry-identity-candidate-proposal-unmapped-candidate-gmi')).toBeInTheDocument()
    expect(screen.getByTestId('industry-identity-candidate-proposal-unmapped-candidate-german-malaysian')).toBeInTheDocument()
    expect(screen.getByTestId('industry-identity-candidate-proposal-unmapped-candidate-rejected')).toBeDisabled()

    const displayName = screen.getByTestId('industry-identity-display-name-proposal-unmapped') as HTMLInputElement
    expect(displayName.value).toBe('German-Malaysian Institute')
    expect(screen.getByTestId('industry-identity-mode-provisional-proposal-unmapped')).toBeChecked()
  })

  it('submits a create_provisional action with candidate sources and the shared note', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderDialog()

    await user.type(screen.getByTestId('industry-identity-note'), 'Matches the resume employer surface.')
    await user.click(screen.getByTestId('industry-identity-resolve-submit'))

    expect(onSubmit).toHaveBeenCalledWith([
      {
        proposalId: 'proposal-unmapped',
        expectedProposalUpdatedAt: 2,
        candidateFingerprint: 'candidate-german-malaysian',
        mappingMode: 'create_provisional',
        provisionalDisplayName: 'German-Malaysian Institute',
        sourceIds: ['source-a'],
        reviewNote: 'Matches the resume employer surface.',
      },
    ])
  })

  it('uses the candidate name when the display name is cleared', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderDialog()

    const displayName = screen.getByTestId('industry-identity-display-name-proposal-unmapped') as HTMLInputElement
    await user.clear(displayName)
    await user.click(screen.getByTestId('industry-identity-resolve-submit'))

    const [action] = vi.mocked(onSubmit).mock.calls[0][0] as Array<{ provisionalDisplayName: string }>
    expect(action.provisionalDisplayName).toBe('German-Malaysian Institute')
  })

  it('submits an existing-company action after switching mode and picking a registry row', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderDialog()

    await user.click(screen.getByTestId('industry-identity-mode-existing-proposal-unmapped'))
    await user.selectOptions(
      screen.getByTestId('industry-identity-company-proposal-unmapped'),
      'polywell',
    )
    await user.click(screen.getByTestId('industry-identity-resolve-submit'))

    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({
        proposalId: 'proposal-unmapped',
        candidateFingerprint: 'candidate-german-malaysian',
        mappingMode: 'existing',
        companyKey: 'polywell',
        sourceIds: ['source-a'],
      }),
    ])
  })

  it('blocks submission until an existing-mode company is chosen', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderDialog()

    await user.click(screen.getByTestId('industry-identity-mode-existing-proposal-unmapped'))
    expect(screen.getByTestId('industry-identity-resolve-submit')).toBeDisabled()
    await user.click(screen.getByTestId('industry-identity-resolve-submit'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('filters the registry list by name or key', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByTestId('industry-identity-mode-existing-proposal-unmapped'))
    const companySelect = screen.getByTestId('industry-identity-company-proposal-unmapped') as HTMLSelectElement
    expect(companySelect.options).toHaveLength(3)

    await user.type(screen.getByTestId('industry-identity-registry-filter'), 'poly')
    expect(companySelect.options).toHaveLength(2)
    expect(companySelect.options[1].value).toBe('polywell')
  })

  it('excludes items without candidates and submits only the resolvable ones', async () => {
    const user = userEvent.setup()
    const packets = new Map([
      ['proposal-unmapped', { candidates, proposalUpdatedAt: 2 }],
      ['proposal-empty', { candidates: [], proposalUpdatedAt: 3 }],
    ])
    const { onSubmit } = renderDialog({
      items: [item('proposal-unmapped'), item('proposal-empty')],
      packets,
    })

    expect(screen.getByTestId('industry-identity-excluded')).toHaveTextContent('GMI CORPORATION')
    await user.click(screen.getByTestId('industry-identity-resolve-submit'))

    const actions = vi.mocked(onSubmit).mock.calls[0][0] as Array<{ proposalId: string }>
    expect(actions.map((action) => action.proposalId)).toEqual(['proposal-unmapped'])
  })
})
