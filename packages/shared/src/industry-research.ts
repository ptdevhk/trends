/**
 * Shared vocabulary for the targeted industry-evidence research queue.
 *
 * These values describe delivery of research work. They are intentionally
 * separate from the proposal lifecycle and from approval truth.
 */
export const INDUSTRY_EVIDENCE_RESEARCH_ORIGINS = [
  "resume_detail",
  "resume_search_batch",
  "admin_review",
  "refresh",
  "scheduled_sweep",
] as const;

export type IndustryEvidenceResearchOrigin =
  (typeof INDUSTRY_EVIDENCE_RESEARCH_ORIGINS)[number];

export const INDUSTRY_EVIDENCE_RESEARCH_STATES = [
  "queued",
  "leased",
  "completed",
  "needs_identity_review",
  "needs_more_evidence",
  "retry_wait",
  "failed",
  "cancelled",
] as const;

export type IndustryEvidenceResearchState =
  (typeof INDUSTRY_EVIDENCE_RESEARCH_STATES)[number];

export const INDUSTRY_EVIDENCE_RESEARCH_FAILURE_CODES = [
  "worker_unreachable",
  "timeout",
  "provider_limited",
  "fetch_failed",
  "identity_ambiguous",
  "proposal_terminal",
] as const;

export type IndustryEvidenceResearchFailureCode =
  (typeof INDUSTRY_EVIDENCE_RESEARCH_FAILURE_CODES)[number];

export const INDUSTRY_MAINTENANCE_RUN_MODES = [
  "targeted",
  "sweep",
  "freshness",
] as const;

export type IndustryMaintenanceRunMode =
  (typeof INDUSTRY_MAINTENANCE_RUN_MODES)[number];

export const INDUSTRY_RESEARCH_ORIGIN_PRIORITIES: Record<
  IndustryEvidenceResearchOrigin,
  number
> = {
  resume_detail: 100,
  resume_search_batch: 80,
  admin_review: 60,
  refresh: 50,
  scheduled_sweep: 10,
};

export interface IndustryEvidenceResearchRequestSummary {
  requestId: string;
  proposalId: string;
  origin: IndustryEvidenceResearchOrigin;
  state: IndustryEvidenceResearchState;
  priority: number;
  requestedAt: number;
  demandCount: number;
  attemptCount: number;
  nextAttemptAt?: number;
  leaseExpiresAt?: number;
  lastRunId?: string;
  lastOutcome?: string;
  lastErrorCode?: IndustryEvidenceResearchFailureCode;
  updatedAt: number;
  canRetry: boolean;
  canCancel: boolean;
}

export interface IndustryEvidenceResearchSummary {
  featureEnabled: boolean;
  active: IndustryEvidenceResearchRequestSummary | null;
  history: IndustryEvidenceResearchRequestSummary[];
}

export interface IndustryIdentityCandidateSummary {
  candidateFingerprint: string;
  proposalId: string;
  normalizedLegalName: string;
  jurisdiction?: string;
  registrationNumber?: string;
  sourceIds: string[];
  confidence: number;
  conflictCodes: string[];
  reviewState: "candidate" | "reviewed" | "rejected" | "needs_more_evidence";
  extractionVersion: string;
  createdAt: number;
  updatedAt: number;
}

export type IndustryResearchUiState =
  | "idle"
  | "queued"
  | "researching"
  | "needs_identity_review"
  | "ready_for_review"
  | "needs_more_evidence"
  | "retryable_failure"
  | "terminal_failure";

/** Map queue delivery plus proposal status into a non-ambiguous UI state. */
export function mapIndustryResearchUiState(input: {
  requestState?: IndustryEvidenceResearchState;
  proposalStatus?: string;
  lastErrorCode?: IndustryEvidenceResearchFailureCode;
}): IndustryResearchUiState {
  if (input.requestState === "queued" || input.requestState === "retry_wait") {
    return "queued";
  }
  if (input.requestState === "leased") return "researching";
  if (input.requestState === "needs_identity_review") return "needs_identity_review";
  if (input.requestState === "needs_more_evidence") return "needs_more_evidence";
  if (input.requestState === "failed") {
    return input.lastErrorCode === "proposal_terminal"
      ? "terminal_failure"
      : "retryable_failure";
  }
  if (input.requestState === "completed") {
    return input.proposalStatus === "ready_for_review"
      ? "ready_for_review"
      : "needs_more_evidence";
  }
  return "idle";
}

export function isIndustryEvidenceResearchOrigin(
  value: unknown,
): value is IndustryEvidenceResearchOrigin {
  return (
    typeof value === "string" &&
    INDUSTRY_EVIDENCE_RESEARCH_ORIGINS.some((item) => item === value)
  );
}

export function isIndustryEvidenceResearchState(
  value: unknown,
): value is IndustryEvidenceResearchState {
  return (
    typeof value === "string" &&
    INDUSTRY_EVIDENCE_RESEARCH_STATES.some((item) => item === value)
  );
}

export function isIndustryEvidenceResearchFailureCode(
  value: unknown,
): value is IndustryEvidenceResearchFailureCode {
  return (
    typeof value === "string" &&
    INDUSTRY_EVIDENCE_RESEARCH_FAILURE_CODES.some((item) => item === value)
  );
}
