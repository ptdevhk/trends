import { formatInAppTimezone } from '@/lib/timezone'

/**
 * Pure display-model helpers for the industry audit surface (C6).
 *
 * All functions here are DOM-free and unit-testable in node. They normalize
 * convex audit docs into the display rows rendered by
 * SystemSettingsIndustryAuditPage.
 */

/** Default row cap passed to both audit queries. */
export const AUDIT_QUERY_LIMIT = 100

/** Convex doc shape: industry_identity_resolution_audits. */
export type IdentityResolutionAudit = {
  auditId: string
  proposalId: string
  workspaceSlug: string
  actor: string
  candidateFingerprint: string
  mappingMode: 'existing' | 'create_provisional'
  targetCompanyKey: string
  sourceIds: string[]
  previousProposalUpdatedAt: number
  reviewNote?: string
  createdAt: number
}

export type IdentityAuditRow = {
  actor: string
  mappingMode: 'existing' | 'create_provisional'
  targetCompanyKey: string
  proposalId: string
  sourceCount: number
  createdAt: number
  reviewNote: string
}

/** Convex doc shape: company_industry_verdict_revisions (read surface). */
export type VerdictRevision = {
  revisionId: string
  companyKey: string
  industryClass: string
  verificationLevel: string
  approvedSourceIds: string[]
  evidenceSummary: string
  reviewedBy: string
  reviewerType?: 'human' | 'auto-verify-bot'
  reviewedAt: number
  decisionReason: string
  taxonomyVersion: string
  reviewAttestation?: {
    schemaVersion: string
    inputFingerprint: string
    decisionMode: 'standard' | 'risk_override'
    acknowledgedRiskFlags: string[]
    cncEvidenceAcknowledged: boolean
    acknowledgementReason: string
    batchId?: string
  }
  supersedesRevisionId?: string
  proposalId?: string
}

export type VerdictAuditRow = {
  companyKey: string
  industryClass: string
  verificationLevel: string
  reviewedBy: string
  reviewerType: string
  reviewedAt: number
  decisionMode: string
  acknowledgedRiskFlags: string[]
  batchId: string
  decisionReason: string
}

export function identityAuditRow(audit: IdentityResolutionAudit): IdentityAuditRow {
  return {
    actor: audit.actor.trim(),
    mappingMode: audit.mappingMode,
    targetCompanyKey: audit.targetCompanyKey.trim(),
    proposalId: audit.proposalId.trim(),
    sourceCount: audit.sourceIds.length,
    createdAt: audit.createdAt,
    reviewNote: audit.reviewNote?.trim() ?? '',
  }
}

/**
 * Verdict revision → display row. The batch attestation id is optional on
 * revisions; `batchId` is the empty string when absent so callers can hide
 * the cell. `reviewerType` and `decisionMode` follow the same convention.
 */
export function verdictAuditRow(revision: VerdictRevision): VerdictAuditRow {
  return {
    companyKey: revision.companyKey.trim(),
    industryClass: revision.industryClass,
    verificationLevel: revision.verificationLevel,
    reviewedBy: revision.reviewedBy.trim(),
    reviewerType: revision.reviewerType ?? '',
    reviewedAt: revision.reviewedAt,
    decisionMode: revision.reviewAttestation?.decisionMode ?? '',
    acknowledgedRiskFlags: revision.reviewAttestation?.acknowledgedRiskFlags ?? [],
    batchId: revision.reviewAttestation?.batchId?.trim() ?? '',
    decisionReason: revision.decisionReason.trim(),
  }
}

/** Format an epoch-ms audit timestamp in the app timezone (date + seconds). */
export function formatAuditTimestamp(ts: number): string {
  return formatInAppTimezone(ts, { includeDate: true, includeSeconds: true })
}

/** The known review-attestation risk flag codes (schema union). */
export const RISK_FLAG_CODES = [
  'canonical_mapping_missing',
  'only_discovery_sources',
  'source_conflict',
  'weak_industry_signal',
  'cnc_claim_inferred',
  'stale_or_failed_source',
  'low_source_diversity',
  'worker_unreachable',
  'recompute_pending',
] as const

/** English fallbacks for risk flags; the i18n labels live in the locales. */
export const RISK_FLAG_LABELS: Record<string, string> = {
  canonical_mapping_missing: 'Canonical mapping missing',
  only_discovery_sources: 'Only discovery sources',
  source_conflict: 'Source conflict',
  weak_industry_signal: 'Weak industry signal',
  cnc_claim_inferred: 'CNC claim inferred',
  stale_or_failed_source: 'Stale or failed source',
  low_source_diversity: 'Low source diversity',
  worker_unreachable: 'Evidence worker unreachable',
  recompute_pending: 'Recompute pending',
}

/** i18n key for a risk flag label, e.g. `industryAudit.riskFlags.source_conflict`. */
export function riskFlagLabelKey(flag: string): string {
  return `industryAudit.riskFlagLabels.${flag}`
}

/** English fallbacks for the industry class labels. */
export const INDUSTRY_CLASS_LABELS: Record<string, string> = {
  cnc: 'CNC',
  automation: 'Automation',
  metrology: 'Metrology',
  industrial: 'Industrial',
  non_industry: 'Non-industry',
  unknown: 'Unknown',
}

/** English fallbacks for the verification level labels. */
export const VERIFICATION_LEVEL_LABELS: Record<string, string> = {
  verified: 'Verified',
  rejected: 'Rejected',
}

/** English fallbacks for the attestation decision mode labels. */
export const DECISION_MODE_LABELS: Record<string, string> = {
  standard: 'Standard',
  risk_override: 'Risk override',
}

/** English fallbacks for the reviewer type labels. */
export const REVIEWER_TYPE_LABELS: Record<string, string> = {
  human: 'Human',
  'auto-verify-bot': 'Auto-verify bot',
}

/** English fallbacks for the identity mapping mode labels. */
export const MAPPING_MODE_LABELS: Record<string, string> = {
  existing: 'Existing company',
  create_provisional: 'Provisional company',
}
