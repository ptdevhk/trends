import { randomUUID } from "node:crypto";

import {
  INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS,
  requiresReviewAttestation,
  selectApprovalSafeSources,
  validateIndustryReviewAttestation,
  type IndustryClass,
  type IndustryReviewAttestation,
} from "@trends/shared";

import type { IndustryReviewPacket } from "./company-industry-review-service.js";
import type { approveIndustryProposalAndStartRecompute } from "./company-industry-proposal-service.js";

export type IndustryApprovalPayload = Parameters<
  typeof approveIndustryProposalAndStartRecompute
>[0];

export type IndustryApprovalDecision =
  | { ok: true; payload: IndustryApprovalPayload }
  | { ok: false; code: string; error: string };

export type IndustryApprovalAttestationInput = Omit<
  IndustryReviewAttestation,
  "inputFingerprint" | "acknowledgedRiskFlags" | "decisionMode"
>;

export interface BuildIndustryApprovalDecisionInput {
  workspaceSlug: string;
  packet: IndustryReviewPacket;
  /** Attended classification override. Required when the recommendation has
   *  no suggested class (weak_industry_signal). */
  industryClass?: IndustryClass;
  decisionReason?: string;
  evidenceSummary?: string;
  attestation?: IndustryApprovalAttestationInput;
  /** Batch linkage: set when the decision is part of a bulk review; the
   *  shared id is recorded on the per-item attestation clone. */
  batchId?: string;
  /** Fallback text for the attestation acknowledgement reason and the
   *  decision reason when neither the attestation nor the recommendation
   *  drafts supply one (batch note). */
  batchNote?: string;
}

/**
 * One approval-decision module for every attended industry approval.
 *
 * Turns (packet, classification, attestation) into a validated approval
 * payload — or a policy failure code. The review packet is authoritative:
 * `revisionId`, `expected*` fingerprints, source versions, and the per-item
 * attestation clone (item fingerprint, server-derived risk flags and
 * decision mode, optional `batchId`) are all constructed here, never taken
 * from the caller. Both the single-approve route and the batch-review
 * endpoint cross this module, so governance changes land in one place.
 */
export function buildIndustryApprovalDecision(
  input: BuildIndustryApprovalDecisionInput,
): IndustryApprovalDecision {
  const { packet, workspaceSlug } = input;
  const { recommendation, dataset, reviewContext } = packet;

  if (recommendation.proposalStatus !== "ready_for_review") {
    return {
      ok: false,
      code: "INVALID_STATUS",
      error: `Proposal is ${recommendation.proposalStatus}; only ready_for_review proposals can be approved.`,
    };
  }

  const effectiveClass =
    input.industryClass ?? recommendation.recommendedIndustryClass;
  if (!effectiveClass || effectiveClass === "unknown") {
    return {
      ok: false,
      code: "CLASS_REQUIRED",
      error:
        "The recommendation has no suggested industry class; choose an explicit classification (including non_industry) for this proposal.",
    };
  }

  const safeSourceIds = selectApprovalSafeSources(recommendation);
  if (safeSourceIds.length === 0) {
    return {
      ok: false,
      code: "NO_SAFE_SOURCE",
      error: "No approval-safe evidence source is available for this proposal.",
    };
  }

  const visibleRiskFlags = [...recommendation.riskFlags];
  const hardFlags = visibleRiskFlags.filter((flag) =>
    INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS.some(
      (candidate) => candidate === flag,
    ),
  );
  if (hardFlags.length > 0) {
    return {
      ok: false,
      code: "INDUSTRY_REVIEW_HARD_RISK",
      error: `Non-overridable risk flags remain: ${hardFlags.join(", ")}. Resolve them before approval.`,
    };
  }

  const attestationRequired = requiresReviewAttestation(
    visibleRiskFlags,
    effectiveClass,
  );
  const submitted = input.attestation;
  if (attestationRequired && !submitted) {
    return {
      ok: false,
      code: "INDUSTRY_REVIEW_ATTESTATION_REQUIRED",
      error: "A review attestation is required before this elevated decision.",
    };
  }

  const itemAttestation: IndustryReviewAttestation | undefined = submitted
    ? {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: dataset.inputFingerprint,
        decisionMode:
          visibleRiskFlags.length > 0 ? "risk_override" : "standard",
        acknowledgedRiskFlags: visibleRiskFlags,
        cncEvidenceAcknowledged:
          submitted.cncEvidenceAcknowledged &&
          (effectiveClass === "cnc" ||
            visibleRiskFlags.includes("cnc_claim_inferred")),
        acknowledgementReason:
          submitted.acknowledgementReason || input.batchNote || "",
        ...(input.batchId ? { batchId: input.batchId } : {}),
      }
    : undefined;

  if (itemAttestation) {
    const validation = validateIndustryReviewAttestation({
      attestation: itemAttestation,
      expectedInputFingerprint: dataset.inputFingerprint,
      visibleRiskFlags,
      recommendedIndustryClass: effectiveClass,
    });
    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code,
        error: `The review attestation does not satisfy the current evidence policy (${validation.code}).`,
      };
    }
  }

  const companyKey = packet.proposal.companyKey;
  if (!companyKey) {
    return {
      ok: false,
      code: "INDUSTRY_REVIEW_HARD_RISK",
      error: "Proposal is missing a canonical company mapping.",
    };
  }

  const draftSummary = recommendation.evidenceSummaryDraft.trim();
  const draftReason = recommendation.decisionReasonDraft.trim();
  const evidenceSummary =
    input.evidenceSummary?.trim() ||
    (draftSummary && !draftSummary.startsWith("Add a bounded evidence summary")
      ? draftSummary
      : `Batch approval of ${companyKey} as ${effectiveClass} from ${safeSourceIds.length} approval-safe source(s).`);
  const decisionReason =
    input.decisionReason?.trim() ||
    (draftReason.startsWith("Reviewed")
      ? draftReason
      : `Batch approval (${input.batchId ?? "attended"}): ${submitted?.acknowledgementReason?.trim() || input.batchNote || "attended review"}.`);

  return {
    ok: true,
    payload: {
      proposalId: packet.proposal.proposalId,
      workspaceSlug,
      revisionId: `industry-${companyKey}-${randomUUID()}`,
      ...(reviewContext.profile?.currentRevisionId
        ? { expectedCurrentRevisionId: reviewContext.profile.currentRevisionId }
        : {}),
      expectedProposalUpdatedAt: dataset.proposalUpdatedAt,
      expectedInputFingerprint: dataset.inputFingerprint,
      expectedSourceVersions: dataset.sourceVersions,
      verificationLevel: "verified",
      industryClass: effectiveClass,
      approvedSourceIds: safeSourceIds,
      evidenceSummary,
      decisionReason,
      taxonomyVersion: "industry-v1",
      ...(itemAttestation ? { reviewAttestation: itemAttestation } : {}),
    },
  };
}

export const industryApprovalInternals = {
  buildIndustryApprovalDecision,
};
