import { describe, expect, it } from 'vitest'

import {
  batchAttestationMode,
  batchRequiresCncAcknowledgement,
  filterHistoryForSession,
  getApprovalSafeSourceIds,
  getBatchApproveEligibility,
  getIdentityResolutionEligibility,
  getOneClickEligibility,
  parseReviewInboxFilter,
  parseReviewInboxItems,
  partitionReviewQueue,
  requiresIdentityResolution,
  reviewInboxFilterToSlug,
  unionRiskFlags,
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
    resumeImpact: 0,
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
    expect(partition.all.map(({ item }) => item.proposal.proposalId)).toEqual([
      'proposal-clean',
      'proposal-cnc',
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

describe('review inbox filter query contract', () => {
  it('maps public filter slugs to internal filters and defaults safely', () => {
    expect(parseReviewInboxFilter('all')).toBe('all')
    expect(parseReviewInboxFilter('approvable')).toBe('approvable')
    expect(parseReviewInboxFilter('needs-review')).toBe('needs_review')
    expect(parseReviewInboxFilter('history')).toBe('history')
    expect(parseReviewInboxFilter('unknown')).toBe('all')
    expect(parseReviewInboxFilter(undefined)).toBe('all')
    expect(reviewInboxFilterToSlug('needs_review')).toBe('needs-review')
  })

  it('preserves the source order in the live all group', () => {
    const partition = partitionReviewQueue([cncItem, cleanItem], new Map())

    expect(partition.all.map(({ item }) => item.proposal.proposalId)).toEqual([
      'proposal-cnc',
      'proposal-clean',
    ])
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

describe('identity resolution eligibility', () => {
  const unmappedItem = makeItem(
    {
      proposalId: 'proposal-unmapped',
      companyKey: undefined,
    },
    {
      proposalId: 'proposal-unmapped',
      riskFlags: ['canonical_mapping_missing'],
    },
  )

  it('opens the lane for any non-terminal unmapped proposal', () => {
    expect(getIdentityResolutionEligibility(unmappedItem)).toEqual({ eligible: true })
    expect(getIdentityResolutionEligibility(makeItem(
      { proposalId: 'proposal-evidence', companyKey: undefined, status: 'needs_more_evidence' },
      { proposalId: 'proposal-evidence', proposalStatus: 'needs_more_evidence' },
    ))).toEqual({ eligible: true })
  })

  it('keeps terminal and already-mapped proposals out of the lane', () => {
    expect(getIdentityResolutionEligibility(makeItem({ status: 'approved' }))).toEqual({
      eligible: false,
      reason: 'terminal',
    })
    expect(getIdentityResolutionEligibility(makeItem({ status: 'rejected' }))).toEqual({
      eligible: false,
      reason: 'terminal',
    })
    expect(getIdentityResolutionEligibility(cleanItem)).toEqual({
      eligible: false,
      reason: 'already_mapped',
    })
  })

  it('flags rows blocked specifically by the missing canonical mapping', () => {
    expect(requiresIdentityResolution(unmappedItem)).toBe(true)
    expect(requiresIdentityResolution(makeItem(
      { proposalId: 'proposal-unmapped-noflag', companyKey: undefined },
      { proposalId: 'proposal-unmapped-noflag' },
    ))).toBe(false)
    expect(requiresIdentityResolution(cleanItem)).toBe(false)
    expect(requiresIdentityResolution(makeItem(
      { proposalId: 'proposal-mapped-flag', companyKey: 'company-x' },
      { proposalId: 'proposal-mapped-flag', riskFlags: ['canonical_mapping_missing'] },
    ))).toBe(false)
  })
})

describe('parseReviewInboxItems', () => {
  it('parses resumeImpact from review-queue items and defaults missing or invalid values to 0', () => {
    const parsed = parseReviewInboxItems({
      success: true,
      items: [
        {
          proposal: cleanProposal,
          recommendation: cleanRecommendation,
          inputFingerprint: 'fingerprint-impact',
          sourceCount: 1,
          resumeImpact: 12,
        },
        {
          proposal: { ...cleanProposal, proposalId: 'proposal-no-impact' },
          recommendation: { ...cleanRecommendation, proposalId: 'proposal-no-impact' },
          inputFingerprint: 'fingerprint-no-impact',
          sourceCount: 1,
        },
        {
          proposal: { ...cleanProposal, proposalId: 'proposal-string-impact' },
          recommendation: { ...cleanRecommendation, proposalId: 'proposal-string-impact' },
          inputFingerprint: 'fingerprint-string-impact',
          sourceCount: 1,
          resumeImpact: '7',
        },
        {
          proposal: { ...cleanProposal, proposalId: 'proposal-negative-impact' },
          recommendation: { ...cleanRecommendation, proposalId: 'proposal-negative-impact' },
          inputFingerprint: 'fingerprint-negative-impact',
          sourceCount: 1,
          resumeImpact: -3,
        },
      ],
    })

    expect(parsed.map((item) => item.resumeImpact)).toEqual([12, 0, 7, 0])
    expect(parsed[0]?.proposal.proposalId).toBe('proposal-clean')
    expect(parsed[0]?.inputFingerprint).toBe('fingerprint-impact')
  })

  it('returns an empty list for payloads without an items array', () => {
    expect(parseReviewInboxItems({ success: true })).toEqual([])
    expect(parseReviewInboxItems(undefined)).toEqual([])
  })

  it('filters items that are missing proposal or recommendation shape', () => {
    expect(parseReviewInboxItems({
      success: true,
      items: [
        { proposal: {}, recommendation: {} },
        { proposal: cleanProposal, recommendation: { ...cleanRecommendation, proposalId: undefined } },
        { proposal: cleanProposal, recommendation: cleanRecommendation, inputFingerprint: 'fp', sourceCount: 1 },
      ],
    })).toHaveLength(1)
  })
})

describe('batch approve eligibility', () => {
  const weakSignalItem = makeItem(
    {
      _id: 'proposal-weak-row',
      proposalId: 'proposal-weak',
      companyKey: 'company-weak',
      suggestedIndustryClass: 'unknown',
    },
    {
      proposalId: 'proposal-weak',
      recommendedIndustryClass: 'unknown',
      riskFlags: ['weak_industry_signal'],
      riskDecision: {
        requiresAcknowledgement: true,
        nonOverridableRiskFlags: [],
        canApproveWithRiskOverride: true,
      },
      recommendedAction: 'inspect',
    },
  )

  it('accepts a clean proposal without attestation or class choice', () => {
    expect(getBatchApproveEligibility(cleanItem)).toEqual({
      eligible: true,
      safeSourceIds: ['source-official'],
      requiresAttestation: false,
      requiresClass: false,
    })
  })

  it('treats weak_industry_signal as batch-approvable with acknowledgement', () => {
    expect(getBatchApproveEligibility(weakSignalItem)).toEqual({
      eligible: true,
      safeSourceIds: ['source-official'],
      requiresAttestation: true,
      requiresClass: true,
    })
  })

  it('keeps non-overridable flags out of the batch lane', () => {
    expect(getBatchApproveEligibility(riskyItem)).toEqual({
      eligible: false,
      reason: 'hard_risk',
    })
  })

  it.each([
    ['terminal', makeItem({ status: 'approved' })],
    ['status', makeItem({ status: 'needs_more_evidence' })],
    ['source', unsafeSourceItem],
  ] as const)('excludes %s items', (reason, item) => {
    expect(getBatchApproveEligibility(item)).toEqual({
      eligible: false,
      reason,
    })
  })

  it('unions risk flags across the selection in sorted order', () => {
    expect(unionRiskFlags([
      weakSignalItem,
      makeItem({}, { riskFlags: ['source_conflict', 'low_source_diversity'] }),
    ])).toEqual(['low_source_diversity', 'source_conflict', 'weak_industry_signal'])
  })

  it('derives the attestation mode from the union of flags', () => {
    expect(batchAttestationMode([])).toBe('standard')
    expect(batchAttestationMode(['weak_industry_signal'])).toBe('risk_override')
  })

  it('requires CNC acknowledgement only when a class or flag demands it', () => {
    expect(batchRequiresCncAcknowledgement([cleanItem], {})).toBe(false)
    expect(batchRequiresCncAcknowledgement([cncItem], {})).toBe(true)
    expect(batchRequiresCncAcknowledgement([weakSignalItem], {
      'proposal-weak': 'cnc',
    })).toBe(true)
  })
})
