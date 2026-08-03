import type { paths } from '@/lib/api-types'

type ReviewQueueResponse = paths['/api/company-industry-proposals/review-queue']['get']['responses'][200]['content']['application/json']

export type ReviewInboxItem = ReviewQueueResponse['items'][number]
export type ReviewInboxProposal = ReviewInboxItem['proposal']
export type ReviewInboxRecommendation = ReviewInboxItem['recommendation']

export const TERMINAL_INDUSTRY_PROPOSAL_STATUSES = [
  'approved',
  'rejected',
  'superseded',
] as const satisfies readonly ReviewInboxProposal['status'][]

export function isTerminalIndustryProposalStatus(status: ReviewInboxProposal['status']): boolean {
  return (TERMINAL_INDUSTRY_PROPOSAL_STATUSES as readonly string[]).includes(status)
}

export type ReviewInboxFilter = 'all' | 'approvable' | 'needs_review' | 'history'
export type ReviewInboxFilterSlug = 'all' | 'approvable' | 'needs-review' | 'history'

export type SessionApproval = {
  proposalId: string
  approvedRevisionId: string
  recomputeRunId?: string
  approvedAt: number
}

export type OneClickEligibility =
  | { eligible: true; safeSourceIds: string[] }
  | {
      eligible: false
      reason:
        | 'canonical_company'
        | 'status'
        | 'recommendation'
        | 'source'
        | 'risk'
        | 'attestation'
        | 'cnc'
    }

export type ReviewInboxRow = {
  item: ReviewInboxItem
  eligibility: OneClickEligibility
  sessionApproval?: SessionApproval
}

export type ReviewQueuePartition = {
  all: ReviewInboxRow[]
  approvable: ReviewInboxRow[]
  needsReview: ReviewInboxRow[]
}

const reviewInboxFiltersBySlug: Record<ReviewInboxFilterSlug, ReviewInboxFilter> = {
  all: 'all',
  approvable: 'approvable',
  'needs-review': 'needs_review',
  history: 'history',
}

export function parseReviewInboxFilter(value: string | null | undefined): ReviewInboxFilter {
  if (!value) return 'all'
  return reviewInboxFiltersBySlug[value as ReviewInboxFilterSlug] ?? 'all'
}

export function reviewInboxFilterToSlug(filter: ReviewInboxFilter): ReviewInboxFilterSlug {
  if (filter === 'needs_review') return 'needs-review'
  return filter
}

/**
 * Select the sources that can be sent through the standard approval path.
 *
 * Recommendations normally provide an ordered source selection. If that
 * selection is empty, the server's approval-safe decisions are the only safe
 * fallback. In either case, source decisions remain authoritative for the
 * browser affordance.
 */
export function getApprovalSafeSourceIds(
  recommendation: ReviewInboxRecommendation,
): string[] {
  const approvalSafeSourceIds = new Set(
    recommendation.sourceDecisions
      .filter((decision) => decision.approvalSafe)
      .map((decision) => decision.sourceId),
  )
  const candidateSourceIds = recommendation.recommendedSourceIds.length > 0
    ? recommendation.recommendedSourceIds
    : recommendation.sourceDecisions.map((decision) => decision.sourceId)

  return [...new Set(candidateSourceIds)].filter((sourceId) => approvalSafeSourceIds.has(sourceId))
}

export function getOneClickEligibility(item: ReviewInboxItem): OneClickEligibility {
  if (!item.proposal.companyKey?.trim()) {
    return { eligible: false, reason: 'canonical_company' }
  }

  if (item.proposal.status !== 'ready_for_review') {
    return { eligible: false, reason: 'status' }
  }

  if (item.recommendation.recommendedAction !== 'approve') {
    return { eligible: false, reason: 'recommendation' }
  }

  const safeSourceIds = getApprovalSafeSourceIds(item.recommendation)
  if (safeSourceIds.length === 0) {
    return { eligible: false, reason: 'source' }
  }

  if (
    item.recommendation.riskFlags.length > 0
    || item.recommendation.riskDecision.nonOverridableRiskFlags.length > 0
  ) {
    return { eligible: false, reason: 'risk' }
  }

  if (item.recommendation.riskDecision.requiresAcknowledgement) {
    return { eligible: false, reason: 'attestation' }
  }

  if (item.recommendation.recommendedIndustryClass === 'cnc') {
    return { eligible: false, reason: 'cnc' }
  }

  return { eligible: true, safeSourceIds }
}

export function partitionReviewQueue(
  items: readonly ReviewInboxItem[],
  sessionApprovals: ReadonlyMap<string, SessionApproval>,
): ReviewQueuePartition {
  const partition: ReviewQueuePartition = {
    all: [],
    approvable: [],
    needsReview: [],
  }

  for (const item of items) {
    const eligibility = getOneClickEligibility(item)
    const sessionApproval = sessionApprovals.get(item.proposal.proposalId)
    const row: ReviewInboxRow = sessionApproval
      ? { item, eligibility, sessionApproval }
      : { item, eligibility }

    partition.all.push(row)
    if (sessionApproval || eligibility.eligible) {
      partition.approvable.push(row)
    } else {
      partition.needsReview.push(row)
    }
  }

  return partition
}

export function filterHistoryForSession<T extends { proposalId: string }>(
  items: readonly T[],
  sessionProposalIds: ReadonlySet<string>,
): T[] {
  return items.filter((item) => !sessionProposalIds.has(item.proposalId))
}
