import type {
  IndustryClass,
  IndustryProposalStatus,
} from "./industry-evidence.js";

export const INDUSTRY_REVIEW_SCHEMA_VERSION = "industry-review.v1" as const;

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
  evidenceSummaryDraft: string;
  decisionReasonDraft: string;
  requiresHumanReview: true;
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
