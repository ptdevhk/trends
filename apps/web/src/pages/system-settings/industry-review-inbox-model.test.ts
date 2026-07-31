import { describe, expect, it } from 'vitest'

import {
  filterHistoryForSession,
  getApprovalSafeSourceIds,
  getOneClickEligibility,
  partitionReviewQueue,
  type ReviewInboxItem,
  type SessionApproval,
} from './industry-review-inbox-model'

type ProposalOverrides = Partial<ReviewInboxItem['proposal']>
type RecommendationOverrides = Partial<ReviewInboxItem['recommendation']>

const cleanProposal: ReviewInboxItem['proposal'] = {
  _id: 'proposal-clean-row',
  proposalId: 'proposal-clean',
  companyKey: 'company-clean',
  triggerReasons: ['manual'],
  priority: 80,
  suggestedIndustryClass: 'industrial',
  suggestedVerificationLevel: 'verified',
  status: 'ready_for_review',
  createdAt: 1,
  updatedAt: 2,
}

const cleanRecommendation: ReviewInboxItem['recommendation'] = {
  proposalId: 'proposal-clean',
  proposalStatus: 'ready_for_review',
  recommendedAction: 'approve',
  recommendedVerificationLevel: 'verified',
  recommendedIndustryClass: 'industrial',
  recommendedSourceIds: ['source-official'],
  sourceDecisions: [
    {
      sourceId: 'source-official',
      approvalSafe: true,
      recommended: true,
      reasonCodes: ['approval_safe', 'recommended_primary'],
    },
  ],
  confidenceBand: 'high',
  riskFlags: [],
  reasons: ['Official source supports the industrial classification.'],
  excludedSourceReasons: {},
  riskDecision: {
    requiresAcknowledgement: false,
    nonOverridableRiskFlags: [],
    canApproveWithRiskOverride: true,
  },
  evidenceSummaryDraft: 'Official source supports the industrial classification.',
  decisionReasonDraft: 'Reviewed an approval-safe source.',
  requiresHumanReview: true,
}

function makeItem(
  proposal: ProposalOverrides = {},
  recommendation: RecommendationOverrides = {},
): ReviewInboxItem {
  return {
    proposal: { ...cleanProposal, ...proposal },
    recommendation: { ...cleanRecommendation, ...recommendation },
    inputFingerprint: 'fingerprint-clean',
    sourceCount: 1,
  }
}

const cleanItem = makeItem()
const cncItem = makeItem(
  {
    _id: 'proposal-cnc-row',
    proposalId: 'proposal-cnc',
    companyKey: 'company-cnc',
    suggestedIndustryClass: 'cnc',
  },
  {
    proposalId: 'proposal-cnc',
    recommendedIndustryClass: 'cnc',
  },
)
const riskyItem = makeItem(
  {
    _id: 'proposal-risky-row',
    proposalId: 'proposal-risky',
    companyKey: 'company-risky',
  },
  {
    proposalId: 'proposal-risky',
    riskFlags: ['source_conflict'],
    riskDecision: {
      requiresAcknowledgement: true,
      nonOverridableRiskFlags: ['source_conflict'],
      canApproveWithRiskOverride: false,
    },
  },
)
const unsafeSourceItem = makeItem(
  {
    _id: 'proposal-unsafe-row',
    proposalId: 'proposal-unsafe',
    companyKey: 'company-unsafe',
  },
  {
    proposalId: 'proposal-unsafe',
    sourceDecisions: [
      {
        sourceId: 'source-search',
        approvalSafe: false,
        recommended: true,
        reasonCodes: ['search_result_not_approval_safe'],
      },
    ],
  },
)
const missingCanonicalItem = makeItem(
  {
    _id: 'proposal-missing-company-row',
    proposalId: 'proposal-missing-company',
    companyKey: undefined,
  },
  { proposalId: 'proposal-missing-company' },
)
const nonApproveItem = makeItem(
  {
    _id: 'proposal-inspect-row',
    proposalId: 'proposal-inspect',
    companyKey: 'company-inspect',
  },
  {
    proposalId: 'proposal-inspect',
    recommendedAction: 'inspect',
  },
)

describe('getOneClickEligibility', () => {
  it('allows only a clean standard ready_for_review proposal', () => {
    expect(getOneClickEligibility(cleanItem)).toEqual({
      eligible: true,
      safeSourceIds: ['source-official'],
    })
  })

  it.each([cncItem, riskyItem, unsafeSourceItem, missingCanonicalItem, nonApproveItem])(
    'keeps policy exceptions out of 可批准',
    (item) => expect(getOneClickEligibility(item).eligible).toBe(false),
  )

  it('returns the policy reason for each exception', () => {
    expect(getOneClickEligibility(cncItem)).toEqual({ eligible: false, reason: 'cnc' })
    expect(getOneClickEligibility(riskyItem)).toEqual({ eligible: false, reason: 'risk' })
    expect(getOneClickEligibility(unsafeSourceItem)).toEqual({ eligible: false, reason: 'source' })
    expect(getOneClickEligibility(missingCanonicalItem)).toEqual({ eligible: false, reason: 'canonical_company' })
    expect(getOneClickEligibility(nonApproveItem)).toEqual({ eligible: false, reason: 'recommendation' })
  })

  it('requires the proposal status to remain ready_for_review', () => {
    expect(getOneClickEligibility(makeItem({ status: 'approved' }))).toEqual({
      eligible: false,
      reason: 'status',
    })
  })

  it('requires a clean recommendation attestation decision', () => {
    expect(getOneClickEligibility(makeItem({}, {
      riskDecision: {
        requiresAcknowledgement: true,
        nonOverridableRiskFlags: [],
        canApproveWithRiskOverride: true,
      },
    }))).toEqual({ eligible: false, reason: 'attestation' })
  })
})

describe('getApprovalSafeSourceIds', () => {
  it('returns only recommended source IDs whose decisions are approval-safe', () => {
    expect(getApprovalSafeSourceIds({
      ...cleanRecommendation,
      recommendedSourceIds: ['source-unsafe', 'source-official', 'source-official'],
      sourceDecisions: [
        ...cleanRecommendation.sourceDecisions,
        {
          sourceId: 'source-unsafe',
          approvalSafe: false,
          recommended: true,
          reasonCodes: ['source_rejected'],
        },
      ],
    })).toEqual(['source-official'])
  })

  it('falls back to all approval-safe decisions when no source was recommended', () => {
    expect(getApprovalSafeSourceIds({
      ...cleanRecommendation,
      recommendedSourceIds: [],
      sourceDecisions: [
        {
          sourceId: 'source-official',
          approvalSafe: true,
          recommended: false,
          reasonCodes: ['approval_safe'],
        },
        {
          sourceId: 'source-search',
          approvalSafe: false,
          recommended: false,
          reasonCodes: ['search_result_not_approval_safe'],
        },
      ],
    })).toEqual(['source-official'])
  })
})

describe('partitionReviewQueue', () => {
  const sessionApproval: SessionApproval = {
    proposalId: 'proposal-clean',
    approvedRevisionId: 'revision-approved',
    recomputeRunId: 'recompute-clean',
    approvedAt: 10,
  }

  it('keeps a session-approved row in the active group with an explicit overlay', () => {
    const partition = partitionReviewQueue(
      [cleanItem, cncItem],
      new Map([[sessionApproval.proposalId, sessionApproval]]),
    )

    expect(partition.approvable).toEqual([
      {
        item: cleanItem,
        eligibility: { eligible: true, safeSourceIds: ['source-official'] },
        sessionApproval,
      },
    ])
    expect(partition.needsReview).toEqual([
      {
        item: cncItem,
        eligibility: { eligible: false, reason: 'cnc' },
      },
    ])
  })

  it('keeps open exception states out of terminal History', () => {
    const openItems = [
      makeItem({ proposalId: 'proposal-new', status: 'new' }, { proposalId: 'proposal-new', proposalStatus: 'new' }),
      makeItem({ proposalId: 'proposal-researching', status: 'researching' }, { proposalId: 'proposal-researching', proposalStatus: 'researching' }),
      makeItem({ proposalId: 'proposal-evidence', status: 'needs_more_evidence' }, { proposalId: 'proposal-evidence', proposalStatus: 'needs_more_evidence' }),
    ]

    expect(partitionReviewQueue(openItems, new Map()).needsReview.map(({ item }) => item.proposal.proposalId)).toEqual([
      'proposal-new',
      'proposal-researching',
      'proposal-evidence',
    ])
  })

  it('does not represent row selection or click handlers in the pure model', () => {
    const [row] = partitionReviewQueue([cleanItem], new Map()).approvable

    expect(row).not.toHaveProperty('onClick')
    expect(row).not.toHaveProperty('action')
  })
})

describe('filterHistoryForSession', () => {
  it('keeps a session-approved row out of History until the refresh boundary', () => {
    const historyItems = [
      { proposalId: 'proposal-1', status: 'approved' },
      { proposalId: 'proposal-2', status: 'rejected' },
    ]

    expect(filterHistoryForSession(historyItems, new Set(['proposal-1']))).toEqual([
      { proposalId: 'proposal-2', status: 'rejected' },
    ])
  })

  it('does not mutate the server history collection', () => {
    const historyItems = [
      { proposalId: 'proposal-1', status: 'approved' },
      { proposalId: 'proposal-2', status: 'superseded' },
    ]

    const filtered = filterHistoryForSession(historyItems, new Set(['proposal-1']))

    expect(filtered).not.toBe(historyItems)
    expect(historyItems).toHaveLength(2)
  })
})
