import { isRecord, requiresReviewAttestation, selectApprovalSafeSources } from '@trends/shared'
import type { paths } from '@/lib/api-types'
import { SettingsRequestError } from '@/pages/system-settings/lib'

type ReviewQueueResponse = paths['/api/company-industry-proposals/review-queue']['get']['responses'][200]['content']['application/json']

export type ReviewInboxItem = ReviewQueueResponse['items'][number] & {
  /**
   * Linked-resume count for the company (from the review-queue API; the
   * field is being added server-side, so parse defensively with a 0 default).
   */
  resumeImpact: number
}
export type ReviewInboxProposal = ReviewInboxItem['proposal']
export type ReviewInboxRecommendation = ReviewInboxItem['recommendation']

function parseResumeImpact(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** Number of malformed proposals the server skipped while building the queue. */
export function parseReviewQueueSkippedCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** Proposal ids the server skipped; empty when the queue is clean. */
export function parseReviewQueueSkippedProposalIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

/**
 * Parse one review-queue item, attaching a defensive `resumeImpact` default
 * of 0 when the server response does not (yet) include the field.
 */
export function parseReviewInboxItem(value: unknown): ReviewInboxItem | null {
  if (!isRecord(value) || !isRecord(value.proposal) || !isRecord(value.recommendation)) return null
  if (typeof value.proposal.proposalId !== 'string' || typeof value.recommendation.proposalId !== 'string') return null
  return {
    ...(value as unknown as ReviewQueueResponse['items'][number]),
    resumeImpact: parseResumeImpact(value.resumeImpact),
  }
}

/** Parse a review-queue response payload into validated inbox items. */
export function parseReviewInboxItems(value: unknown): ReviewInboxItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  const items: ReviewInboxItem[] = []
  for (const raw of value.items) {
    const item = parseReviewInboxItem(raw)
    if (item) items.push(item)
  }
  return items
}

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
 * Delegates to the shared governance rule (`selectApprovalSafeSources`) so
 * the browser affordance and the server cross the same implementation.
 */
export function getApprovalSafeSourceIds(
  recommendation: ReviewInboxRecommendation,
): string[] {
  return selectApprovalSafeSources({
    recommendedSourceIds: recommendation.recommendedSourceIds,
    sourceDecisions: recommendation.sourceDecisions,
  })
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

export type BatchApproveEligibility =
  | {
      eligible: true
      safeSourceIds: string[]
      /** Attestation required: any visible risk flag or a CNC class. */
      requiresAttestation: boolean
      /** Explicit classification required: the recommendation has no class. */
      requiresClass: boolean
    }
  | { eligible: false; reason: 'terminal' | 'status' | 'source' | 'hard_risk' }

/**
 * Batch-approve eligibility. Mirrors the server-side gates of the
 * batch-review endpoint: open status, at least one approval-safe source,
 * and no non-overridable risk flags. Attended overrides for
 * `weak_industry_signal` are expressed through the batch attestation, so
 * flag presence alone does not block — it only demands acknowledgement.
 */
export function getBatchApproveEligibility(item: ReviewInboxItem): BatchApproveEligibility {
  if (isTerminalIndustryProposalStatus(item.proposal.status)) {
    return { eligible: false, reason: 'terminal' }
  }
  if (item.proposal.status !== 'ready_for_review') {
    return { eligible: false, reason: 'status' }
  }
  const safeSourceIds = getApprovalSafeSourceIds(item.recommendation)
  if (safeSourceIds.length === 0) {
    return { eligible: false, reason: 'source' }
  }
  if (item.recommendation.riskDecision.nonOverridableRiskFlags.length > 0) {
    return { eligible: false, reason: 'hard_risk' }
  }
  return {
    eligible: true,
    safeSourceIds,
    requiresAttestation: requiresReviewAttestation(
      item.recommendation.riskFlags,
      item.recommendation.recommendedIndustryClass,
    ),
    requiresClass: item.recommendation.recommendedIndustryClass === 'unknown',
  }
}

export function unionRiskFlags(items: readonly ReviewInboxItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.recommendation.riskFlags))].sort()
}

export type IdentityResolutionEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'terminal' | 'status' | 'already_mapped' }

/**
 * Identity-resolution eligibility. Mirrors the server-side gates of the
 * identity-resolution endpoint: the proposal must be open (any non-terminal
 * status) and not yet mapped to a canonical company. Once `companyKey` is
 * set, `canonical_mapping_missing` recomputes away and the item can move
 * into the batch approval lane.
 */
export function getIdentityResolutionEligibility(item: ReviewInboxItem): IdentityResolutionEligibility {
  if (isTerminalIndustryProposalStatus(item.proposal.status)) {
    return { eligible: false, reason: 'terminal' }
  }
  if (item.proposal.companyKey?.trim()) {
    return { eligible: false, reason: 'already_mapped' }
  }
  return { eligible: true }
}

/**
 * Whether the row is blocked specifically by the missing-canonical-mapping
 * flag and can therefore be unblocked through the identity-resolution lane.
 */
export function requiresIdentityResolution(item: ReviewInboxItem): boolean {
  return (
    getIdentityResolutionEligibility(item).eligible
    && item.recommendation.riskFlags.includes('canonical_mapping_missing')
  )
}

export function batchAttestationMode(riskFlags: readonly string[]): 'standard' | 'risk_override' {
  return riskFlags.length > 0 ? 'risk_override' : 'standard'
}

export function batchRequiresCncAcknowledgement(
  items: readonly ReviewInboxItem[],
  classOverrides: Readonly<Record<string, string>>,
): boolean {
  return items.some((item) => {
    const effectiveClass =
      classOverrides[item.proposal.proposalId] ?? item.recommendation.recommendedIndustryClass
    return effectiveClass === 'cnc' || item.recommendation.riskFlags.includes('cnc_claim_inferred')
  })
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

// --- V4: business logic extracted from IndustryReviewInbox.tsx ---

export type BatchReviewResult = {
  proposalId: string
  kind: 'approve' | 'reject'
  ok: boolean
  revisionId?: string
  companyKey?: string
  status?: string
  code?: string
  error?: string
}

export function parseBatchReviewResults(value: unknown): BatchReviewResult[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  return value.items.filter((item): item is BatchReviewResult => (
    isRecord(item)
    && typeof item.proposalId === 'string'
    && (item.kind === 'approve' || item.kind === 'reject')
    && typeof item.ok === 'boolean'
  ))
}

type ProposalListResponse = paths['/api/company-industry-proposals']['get']['responses'][200]['content']['application/json']
export type IndustryHistoryItem = ProposalListResponse['items'][number]

export function parseHistory(value: unknown): IndustryHistoryItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  return value.items.filter((item): item is IndustryHistoryItem => (
    isRecord(item) && typeof item.proposalId === 'string'
  )) as IndustryHistoryItem[]
}

export type InboxErrorKind = 'conflict' | 'policy' | 'network'

export function rowErrorKind(status: number | undefined): InboxErrorKind {
  if (status === 409) return 'conflict'
  if (status === 422) return 'policy'
  return 'network'
}

export function errorStatus(error: unknown): number | undefined {
  return error instanceof SettingsRequestError ? error.status : undefined
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof SettingsRequestError && isRecord(error.body)) {
    const bodyMessage = error.body.error ?? error.body.message
    if (typeof bodyMessage === 'string' && bodyMessage.trim()) return bodyMessage
  }
  if (error instanceof Error && error.message && !/^HTTP \d+$/.test(error.message)) {
    return error.message
  }
  return fallback
}

export type CleanReviewPacket = {
  proposal: ReviewInboxProposal
  recommendation: ReviewInboxRecommendation
  dataset: {
    inputFingerprint: string
    proposalUpdatedAt: number
    sourceVersions: Array<{ sourceId: string; updatedAt: number }>
  }
  reviewContext: {
    profile: { currentRevisionId?: string } | null
  }
  identityCandidates: IdentityCandidate[]
}

type ReviewPacketResponse = paths['/api/company-industry-proposals/:proposalId/review-packet']['get']['responses'][200]['content']['application/json']
export type IdentityCandidate = ReviewPacketResponse['identityCandidates'][number]

export function parseIdentityCandidates(value: unknown): IdentityCandidate[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is IdentityCandidate => (
    isRecord(item)
    && typeof item.candidateFingerprint === 'string'
    && typeof item.normalizedLegalName === 'string'
    && Array.isArray(item.sourceIds)
    && typeof item.confidence === 'number'
    && Array.isArray(item.conflictCodes)
  ))
}

export function parseCleanPacket(value: unknown): CleanReviewPacket | null {
  if (!isRecord(value) || !isRecord(value.proposal) || !isRecord(value.recommendation)) return null
  if (!isRecord(value.dataset) || typeof value.dataset.inputFingerprint !== 'string') return null
  const reviewContextValue = isRecord(value.reviewContext)
    ? value.reviewContext
    : isRecord(value.bundle)
      ? value.bundle
      : {}
  const profile = isRecord(reviewContextValue.profile)
    ? { currentRevisionId: typeof reviewContextValue.profile.currentRevisionId === 'string' ? reviewContextValue.profile.currentRevisionId : undefined }
    : null
  return {
    proposal: value.proposal as ReviewInboxProposal,
    recommendation: value.recommendation as ReviewInboxRecommendation,
    dataset: {
      inputFingerprint: value.dataset.inputFingerprint,
      proposalUpdatedAt: typeof value.dataset.proposalUpdatedAt === 'number'
        ? value.dataset.proposalUpdatedAt
        : 0,
      sourceVersions: Array.isArray(value.dataset.sourceVersions)
        ? value.dataset.sourceVersions.filter((item): item is { sourceId: string; updatedAt: number } => (
          isRecord(item) && typeof item.sourceId === 'string' && typeof item.updatedAt === 'number'
        ))
        : [],
    },
    reviewContext: { profile },
    identityCandidates: parseIdentityCandidates(value.identityCandidates),
  }
}

export function buildCleanApprovalRequest(
  item: ReviewInboxItem,
  packet: CleanReviewPacket,
  revisionId: string,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const packetItem: ReviewInboxItem = {
    ...item,
    proposal: packet.proposal,
    recommendation: packet.recommendation,
  }
  const eligibility = getOneClickEligibility(packetItem)
  if (!eligibility.eligible) {
    return {
      ok: false,
      message: 'The review packet is no longer eligible for one-click approval.',
    }
  }
  return {
    ok: true,
    body: {
      revisionId,
      ...(packet.reviewContext.profile?.currentRevisionId
        ? { expectedCurrentRevisionId: packet.reviewContext.profile.currentRevisionId }
        : {}),
      expectedProposalUpdatedAt: packet.dataset.proposalUpdatedAt || item.proposal.updatedAt,
      expectedInputFingerprint: packet.dataset.inputFingerprint,
      expectedSourceVersions: packet.dataset.sourceVersions,
      verificationLevel: packet.recommendation.recommendedVerificationLevel,
      industryClass: packet.recommendation.recommendedIndustryClass,
      approvedSourceIds: eligibility.safeSourceIds,
      evidenceSummary: packet.recommendation.evidenceSummaryDraft.trim(),
      decisionReason: packet.recommendation.decisionReasonDraft.trim(),
      taxonomyVersion: 'industry-v1',
    },
  }
}
