import type {
  IndustryClass,
  IndustryEvidenceSourceType,
  IndustryEvidenceTrustTier,
  IndustryProposalStatus,
} from "./industry-evidence.js";

export const INDUSTRY_REVIEW_SCHEMA_VERSION = "industry-review.v1" as const;

export const INDUSTRY_REVIEW_STALE_CODE = "INDUSTRY_REVIEW_STALE" as const;

export const INDUSTRY_REVIEW_ACTIONS = [
  "approve",
  "needs_more_evidence",
  "reject",
  "inspect",
] as const;

export type IndustryReviewAction = (typeof INDUSTRY_REVIEW_ACTIONS)[number];

export const INDUSTRY_REVIEW_CONFIDENCE_BANDS = [
  "high",
  "medium",
  "low",
] as const;

export type IndustryReviewConfidenceBand =
  (typeof INDUSTRY_REVIEW_CONFIDENCE_BANDS)[number];

export const INDUSTRY_REVIEW_RISK_FLAGS = [
  "canonical_mapping_missing",
  "only_discovery_sources",
  "source_conflict",
  "weak_industry_signal",
  "cnc_claim_inferred",
  "stale_or_failed_source",
  "low_source_diversity",
  "worker_unreachable",
  "recompute_pending",
] as const;

export type IndustryReviewRiskFlag = (typeof INDUSTRY_REVIEW_RISK_FLAGS)[number];

/**
 * CNC evidence is deliberately narrower than a keyword match.  This is the
 * small policy input shared by recommendation, approval, UI, and fixtures so
 * that those surfaces cannot silently drift apart.
 */
export interface IndustryCncEvidenceCandidate {
  sourceType: IndustryEvidenceSourceType;
  trustTier: IndustryEvidenceTrustTier;
  title?: string;
  evidenceExcerpt?: string;
  fetchStatus?: "pending" | "fetched" | "failed" | "unavailable";
  sourceState?: "active" | "superseded" | "unavailable" | "disputed";
}

export const INDUSTRY_CNC_SIGNAL_PATTERN =
  /\b(cnc|machining|machine tools?|lathe|milling|metalworking|precision machining)\b|数控|机床|加工中心|金属加工|精密加工/i;

const EXPLICIT_CNC_SOURCE_TYPES = new Set<IndustryEvidenceSourceType>([
  "official_site",
  "registry",
  "taxonomy",
  "oem_partner",
  "trade_body",
  "reporting",
]);

function hasCncText(candidate: IndustryCncEvidenceCandidate): boolean {
  return INDUSTRY_CNC_SIGNAL_PATTERN.test(
    `${candidate.title ?? ""} ${candidate.evidenceExcerpt ?? ""}`,
  );
}

export function isExplicitCncEvidenceSource(
  candidate: IndustryCncEvidenceCandidate,
): boolean {
  return (
    EXPLICIT_CNC_SOURCE_TYPES.has(candidate.sourceType) &&
    candidate.trustTier !== "discovery" &&
    (candidate.fetchStatus === undefined || candidate.fetchStatus === "fetched") &&
    (candidate.sourceState === undefined || candidate.sourceState === "active") &&
    hasCncText(candidate)
  );
}

export function hasExplicitCncEvidence(
  candidates: readonly IndustryCncEvidenceCandidate[],
): boolean {
  return candidates.some(isExplicitCncEvidenceSource);
}

/**
 * Lane A (governed auto-verify) source types: structured, machine-verifiable
 * data only. Prose sources (official_site, reporting, oem_partner, trade_body,
 * directory, other) and discovery-only search results are never auto-approvable.
 */
export const AUTO_VERIFY_SOURCE_TYPES = new Set<IndustryEvidenceSourceType>([
  "registry",
  "taxonomy",
]);

/**
 * Lane A (governed auto-verify) eligibility for a single evidence source.
 *
 * A source is auto-approvable only when it is a structured registry/taxonomy
 * record (never prose), carries explicit CNC/industrial signal text, is
 * fetched + active + unreviewed, and is not disputed/rejected.
 */
export function isAutoApprovableSource(
  candidate: IndustryCncEvidenceCandidate & {
    reviewStatus?: string;
  },
): boolean {
  return (
    AUTO_VERIFY_SOURCE_TYPES.has(candidate.sourceType) &&
    candidate.trustTier !== "discovery" &&
    (candidate.fetchStatus === undefined || candidate.fetchStatus === "fetched") &&
    (candidate.sourceState === undefined || candidate.sourceState === "active") &&
    candidate.reviewStatus !== "disputed" &&
    candidate.reviewStatus !== "rejected" &&
    hasCncText(candidate)
  );
}

/**
 * Lane A (governed auto-verify) eligibility for a proposal's full evidence set.
 *
 * Every selected source must be auto-approvable (structured registry/taxonomy
 * with explicit CNC text). This is deliberately narrower than the human
 * approval gate: prose evidence always routes to the human cockpit.
 */
export function hasAutoApprovableEvidence(
  candidates: readonly (IndustryCncEvidenceCandidate & { reviewStatus?: string })[],
): boolean {
  return candidates.length > 0 && candidates.every(isAutoApprovableSource);
}

export const INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS = [
  "canonical_mapping_missing",
  "only_discovery_sources",
  "source_conflict",
  "cnc_claim_inferred",
  "stale_or_failed_source",
] as const satisfies readonly IndustryReviewRiskFlag[];

/**
 * Flags a human reviewer may override through the attended risk-override
 * path (decisionMode "risk_override" + acknowledgement reason + explicit
 * industry class). `weak_industry_signal` means "no class was suggested" —
 * an attended reviewer who explicitly classifies the employer (e.g.
 * `non_industry`) resolves the ambiguity, so the flag becomes overridable.
 * CNC claims stay hard-blocked: `cnc_claim_inferred` additionally trips
 * `INDUSTRY_REVIEW_CNC_EVIDENCE_REQUIRED` in validation.
 */
export const INDUSTRY_REVIEW_OVERRIDABLE_RISK_FLAGS = [
  "weak_industry_signal",
] as const satisfies readonly IndustryReviewRiskFlag[];

export const INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION =
  "industry-review-attestation.v1" as const;

export const INDUSTRY_REVIEW_DECISION_MODES = [
  "standard",
  "risk_override",
] as const;

export type IndustryReviewDecisionMode =
  (typeof INDUSTRY_REVIEW_DECISION_MODES)[number];

export interface IndustryReviewAttestation {
  schemaVersion: typeof INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION;
  inputFingerprint: string;
  decisionMode: IndustryReviewDecisionMode;
  acknowledgedRiskFlags: IndustryReviewRiskFlag[];
  cncEvidenceAcknowledged: boolean;
  acknowledgementReason: string;
  /**
   * Batch linkage: set when the attestation was submitted as part of a
   * bulk review (`/api/company-industry-proposals/batch-review`). One
   * attestation covers the whole batch; the shared id lets auditors find
   * every revision approved in that batch.
   */
  batchId?: string;
}

export type IndustryReviewAttestationErrorCode =
  | "INDUSTRY_REVIEW_ATTESTATION_INVALID"
  | "INDUSTRY_REVIEW_FINGERPRINT_MISMATCH"
  | "INDUSTRY_REVIEW_RISKS_NOT_ACKNOWLEDGED"
  | "INDUSTRY_REVIEW_RISK_OVERRIDE_REQUIRED"
  | "INDUSTRY_REVIEW_HARD_RISK"
  | "INDUSTRY_REVIEW_CNC_ACK_REQUIRED"
  | "INDUSTRY_REVIEW_CNC_EVIDENCE_REQUIRED";

export interface IndustryReviewRiskDecision {
  requiresAcknowledgement: boolean;
  nonOverridableRiskFlags: IndustryReviewRiskFlag[];
  canApproveWithRiskOverride: boolean;
}

export function reviewAttestationDecision(
  visibleRiskFlags: readonly IndustryReviewRiskFlag[],
): IndustryReviewRiskDecision {
  const uniqueFlags = [...new Set(visibleRiskFlags)];
  const nonOverridableRiskFlags = uniqueFlags.filter((flag) =>
    INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS.some(
      (candidate) => candidate === flag,
    ),
  );
  return {
    requiresAcknowledgement: uniqueFlags.length > 0,
    nonOverridableRiskFlags,
    canApproveWithRiskOverride: nonOverridableRiskFlags.length === 0,
  };
}

export function validateIndustryReviewAttestation(input: {
  attestation: IndustryReviewAttestation;
  expectedInputFingerprint: string;
  visibleRiskFlags: readonly IndustryReviewRiskFlag[];
  recommendedIndustryClass: IndustryClass;
}): { ok: true } | { ok: false; code: IndustryReviewAttestationErrorCode } {
  const { attestation, expectedInputFingerprint, visibleRiskFlags } = input;
  if (
    attestation.schemaVersion !== INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION ||
    !attestation.inputFingerprint ||
    !INDUSTRY_REVIEW_DECISION_MODES.includes(attestation.decisionMode) ||
    !Array.isArray(attestation.acknowledgedRiskFlags) ||
    typeof attestation.cncEvidenceAcknowledged !== "boolean" ||
    typeof attestation.acknowledgementReason !== "string"
  ) {
    return { ok: false, code: "INDUSTRY_REVIEW_ATTESTATION_INVALID" };
  }
  if (
    attestation.acknowledgedRiskFlags.some(
      (flag) => !INDUSTRY_REVIEW_RISK_FLAGS.some((candidate) => candidate === flag),
    )
  ) {
    return { ok: false, code: "INDUSTRY_REVIEW_ATTESTATION_INVALID" };
  }
  if (attestation.inputFingerprint !== expectedInputFingerprint) {
    return { ok: false, code: "INDUSTRY_REVIEW_FINGERPRINT_MISMATCH" };
  }

  const riskDecision = reviewAttestationDecision(visibleRiskFlags);
  const acknowledged = new Set(attestation.acknowledgedRiskFlags);
  if ([...new Set(visibleRiskFlags)].some((flag) => !acknowledged.has(flag))) {
    return { ok: false, code: "INDUSTRY_REVIEW_RISKS_NOT_ACKNOWLEDGED" };
  }
  if (
    riskDecision.requiresAcknowledgement &&
    attestation.decisionMode !== "risk_override"
  ) {
    return { ok: false, code: "INDUSTRY_REVIEW_RISK_OVERRIDE_REQUIRED" };
  }
  if (
    !riskDecision.requiresAcknowledgement &&
    attestation.decisionMode !== "standard"
  ) {
    return { ok: false, code: "INDUSTRY_REVIEW_ATTESTATION_INVALID" };
  }
  if (
    attestation.decisionMode === "risk_override" &&
    !attestation.acknowledgementReason.trim()
  ) {
    return { ok: false, code: "INDUSTRY_REVIEW_ATTESTATION_INVALID" };
  }
  if (input.recommendedIndustryClass === "cnc" && !attestation.cncEvidenceAcknowledged) {
    return { ok: false, code: "INDUSTRY_REVIEW_CNC_ACK_REQUIRED" };
  }
  if (visibleRiskFlags.includes("cnc_claim_inferred")) {
    return { ok: false, code: "INDUSTRY_REVIEW_CNC_EVIDENCE_REQUIRED" };
  }
  if (riskDecision.nonOverridableRiskFlags.length > 0) {
    return { ok: false, code: "INDUSTRY_REVIEW_HARD_RISK" };
  }
  return { ok: true };
}

/**
 * Select the evidence sources that may be sent through the standard approval
 * path: the recommended selection, intersected with the approval-safe
 * source decisions. When no source was recommended, every approval-safe
 * decision is the fallback.
 *
 * Single source of truth for the tier-agnostic selection rule — the web
 * affordance model, the batch-review endpoint, and the review producer all
 * cross this function instead of re-implementing the predicate.
 */
export function selectApprovalSafeSources(
  recommendation: Pick<
    IndustryReviewRecommendation,
    "recommendedSourceIds" | "sourceDecisions"
  >,
): string[] {
  const approvalSafeSourceIds = new Set(
    recommendation.sourceDecisions
      .filter((decision) => decision.approvalSafe)
      .map((decision) => decision.sourceId),
  );
  const candidateSourceIds =
    recommendation.recommendedSourceIds.length > 0
      ? recommendation.recommendedSourceIds
      : recommendation.sourceDecisions.map((decision) => decision.sourceId);
  return [...new Set(candidateSourceIds)].filter((sourceId) =>
    approvalSafeSourceIds.has(sourceId),
  );
}

/**
 * True when an attended review attestation is required before an elevated
 * decision: any visible risk flag, or a CNC classification.
 */
export function requiresReviewAttestation(
  riskFlags: readonly IndustryReviewRiskFlag[],
  industryClass: IndustryClass,
): boolean {
  return riskFlags.length > 0 || industryClass === "cnc";
}

export const INDUSTRY_REVIEW_SOURCE_REASON_CODES = [
  "approval_safe",
  "search_result_not_approval_safe",
  "discovery_not_approval_safe",
  "unsafe_url",
  "not_fetched",
  "fetch_failed",
  "source_unavailable",
  "source_not_active",
  "source_disputed",
  "source_rejected",
  "recommended_primary",
  "recommended_corroborating",
  "class_conflict",
] as const;

export type IndustryReviewSourceReasonCode =
  (typeof INDUSTRY_REVIEW_SOURCE_REASON_CODES)[number];

export interface IndustryReviewWarning {
  code: string;
  message: string;
  action?: string;
}

export interface IndustryReviewSourceDecision {
  sourceId: string;
  approvalSafe: boolean;
  recommended: boolean;
  reasonCodes: IndustryReviewSourceReasonCode[];
}

export interface IndustryReviewRecommendation {
  proposalId: string;
  proposalStatus: IndustryProposalStatus;
  recommendedAction: IndustryReviewAction;
  recommendedVerificationLevel: "verified" | "rejected";
  recommendedIndustryClass: IndustryClass;
  recommendedSourceIds: string[];
  sourceDecisions: IndustryReviewSourceDecision[];
  confidenceBand: IndustryReviewConfidenceBand;
  riskFlags: IndustryReviewRiskFlag[];
  reasons: string[];
  excludedSourceReasons: Record<string, string>;
  riskDecision: IndustryReviewRiskDecision;
  evidenceSummaryDraft: string;
  decisionReasonDraft: string;
  requiresHumanReview: true;
  /**
   * Lane A (governed auto-verify) eligibility: true only when the proposal
   * has a canonical companyKey, the recommendation is a high-confidence
   * approve with zero risk flags, and every eligible source is a structured
   * registry/taxonomy record with explicit CNC signal text. Auto-approvable
   * proposals are excluded from the human review queue — the governed
   * auto-verify-bot lane handles them with zero manual actions.
   */
  autoApprovable: boolean;
}

export interface IndustryReviewOperation {
  id: string;
  kind: "recommendation";
  state: "computed";
}

export interface IndustryReviewDataset {
  revision: string;
  inputFingerprint: string;
  generatedAt: number;
  proposalUpdatedAt: number;
  sourceVersions: Array<{ sourceId: string; updatedAt: number }>;
  gitSha?: string;
}

export interface IndustryReviewRecommendationEnvelope {
  success: true;
  ok: true;
  schemaVersion: typeof INDUSTRY_REVIEW_SCHEMA_VERSION;
  operation: IndustryReviewOperation;
  dataset: IndustryReviewDataset;
  recommendation: IndustryReviewRecommendation;
  warnings: IndustryReviewWarning[];
}
