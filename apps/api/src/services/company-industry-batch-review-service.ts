import { createHash, randomUUID } from "node:crypto";

import {
  INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS,
  validateIndustryReviewAttestation,
  type IndustryClass,
  type IndustryProposalStatus,
  type IndustryReviewAttestation,
} from "@trends/shared";

import { enqueueIndustryMaintenance } from "./industry-maintenance-pipeline-service.js";
import {
  approveIndustryProposalAndStartRecompute,
  resolveIndustryProposal,
} from "./company-industry-proposal-service.js";
import { getIndustryReviewPacket } from "./company-industry-review-service.js";

const MAX_BATCH_ACTIONS = 50;

export type BatchReviewAction =
  | {
      kind: "approve";
      proposalId: string;
      /** Attended classification override. Required when the recommendation
       *  has no suggested class (weak_industry_signal) — this is the
       *  non_industry / explicit-class resolution lane. */
      industryClass?: IndustryClass;
      decisionReason?: string;
      evidenceSummary?: string;
    }
  | {
      kind: "reject";
      proposalId: string;
      reviewNote?: string;
    };

export type BatchReviewAttestationInput = Omit<
  IndustryReviewAttestation,
  "inputFingerprint"
>;

export interface BatchReviewItemResult {
  proposalId: string;
  kind: "approve" | "reject";
  ok: boolean;
  revisionId?: string;
  companyKey?: string;
  status?: IndustryProposalStatus;
  code?: string;
  error?: string;
}

export interface BatchReviewResult {
  batchId: string;
  batchFingerprint: string;
  summary: { total: number; succeeded: number; failed: number };
  items: BatchReviewItemResult[];
}

/**
 * Governed bulk approve/reject for industry proposals.
 *
 * One attestation covers the whole batch; the endpoint materializes a
 * per-item attestation clone (item fingerprint, per-item risk flags and
 * decision mode, shared batchId) so every existing governance guard — the
 * shared attestation validation, the Convex stale checks, the immutable
 * revision record — applies to each item unchanged. Items fail individually;
 * a stale or hard-blocked item never aborts the rest of the batch.
 */
export async function batchReviewIndustryProposals(
  input: {
    workspaceSlug: string;
    actions: BatchReviewAction[];
    attestation?: BatchReviewAttestationInput;
    batchNote?: string;
  },
  actorId: string,
): Promise<BatchReviewResult> {
  const reviewer = actorId.trim();
  if (!reviewer) throw new Error("Review actor is required");
  if (input.actions.length === 0 || input.actions.length > MAX_BATCH_ACTIONS) {
    throw new Error(
      `Batch review requires 1..${MAX_BATCH_ACTIONS} actions (got ${input.actions.length})`,
    );
  }

  const batchId = `industry-batch-${randomUUID()}`;
  const seen = new Set<string>();
  const items: BatchReviewItemResult[] = [];
  let succeeded = 0;
  let failed = 0;
  const approvedFingerprints: string[] = [];

  for (const action of input.actions) {
    if (seen.has(action.proposalId)) {
      failed += 1;
      items.push({
        proposalId: action.proposalId,
        kind: action.kind,
        ok: false,
        code: "DUPLICATE_ACTION",
        error: "Proposal appears more than once in the batch.",
      });
      continue;
    }
    seen.add(action.proposalId);

    if (action.kind === "reject") {
      try {
        const result = await resolveIndustryProposal(
          {
            proposalId: action.proposalId,
            resolution: "rejected",
            ...(action.reviewNote ? { reviewNote: action.reviewNote } : {}),
          },
          reviewer,
        );
        succeeded += 1;
        items.push({
          proposalId: action.proposalId,
          kind: "reject",
          ok: true,
          status: result.status,
        });
      } catch (error) {
        failed += 1;
        items.push(
          rejectItemError(action.proposalId, "reject", error, "resolve"),
        );
      }
      continue;
    }

    // Approve lane: load the authoritative packet and gate on its contents.
    let packet;
    try {
      packet = await getIndustryReviewPacket(
        action.proposalId,
        input.workspaceSlug,
      );
    } catch (error) {
      failed += 1;
      items.push(
        rejectItemError(action.proposalId, "approve", error, "packet"),
      );
      continue;
    }
    if (!packet) {
      failed += 1;
      items.push({
        proposalId: action.proposalId,
        kind: "approve",
        ok: false,
        code: "NOT_FOUND",
        error: "Industry proposal not found.",
      });
      continue;
    }

    const { recommendation, dataset, reviewContext } = packet;
    if (recommendation.proposalStatus !== "ready_for_review") {
      failed += 1;
      items.push({
        proposalId: action.proposalId,
        kind: "approve",
        ok: false,
        code: "INVALID_STATUS",
        error: `Proposal is ${recommendation.proposalStatus}; only ready_for_review proposals can be batch-approved.`,
      });
      continue;
    }

    const effectiveClass =
      action.industryClass ?? recommendation.recommendedIndustryClass;
    if (!effectiveClass || effectiveClass === "unknown") {
      failed += 1;
      items.push({
        proposalId: action.proposalId,
        kind: "approve",
        ok: false,
        code: "CLASS_REQUIRED",
        error:
          "The recommendation has no suggested industry class; choose an explicit classification (including non_industry) for this proposal.",
      });
      continue;
    }

    const safeSourceIds = approvalSafeSourceIds(recommendation);
    if (safeSourceIds.length === 0) {
      failed += 1;
      items.push({
        proposalId: action.proposalId,
        kind: "approve",
        ok: false,
        code: "NO_SAFE_SOURCE",
        error: "No approval-safe evidence source is available for this proposal.",
      });
      continue;
    }

    const visibleRiskFlags = [...recommendation.riskFlags];
    const hardFlags = visibleRiskFlags.filter((flag) =>
      INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS.some(
        (candidate) => candidate === flag,
      ),
    );
    if (hardFlags.length > 0) {
      failed += 1;
      items.push({
        proposalId: action.proposalId,
        kind: "approve",
        ok: false,
        code: "INDUSTRY_REVIEW_HARD_RISK",
        error: `Non-overridable risk flags remain: ${hardFlags.join(", ")}. Resolve them before batch approval.`,
      });
      continue;
    }

    const attestationRequired =
      visibleRiskFlags.length > 0 || effectiveClass === "cnc";
    const submitted = input.attestation;
    if (attestationRequired && !submitted) {
      failed += 1;
      items.push({
        proposalId: action.proposalId,
        kind: "approve",
        ok: false,
        code: "INDUSTRY_REVIEW_ATTESTATION_REQUIRED",
        error:
          "A review attestation is required before this elevated decision.",
      });
      continue;
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
          batchId,
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
        failed += 1;
        items.push({
          proposalId: action.proposalId,
          kind: "approve",
          ok: false,
          code: validation.code,
          error: `The review attestation does not satisfy the current evidence policy (${validation.code}).`,
        });
        continue;
      }
    }

    const companyKey = packet.proposal.companyKey;
    if (!companyKey) {
      failed += 1;
      items.push({
        proposalId: action.proposalId,
        kind: "approve",
        ok: false,
        code: "INDUSTRY_REVIEW_HARD_RISK",
        error: "Proposal is missing a canonical company mapping.",
      });
      continue;
    }

    const draftSummary = recommendation.evidenceSummaryDraft.trim();
    const draftReason = recommendation.decisionReasonDraft.trim();
    const evidenceSummary =
      action.evidenceSummary?.trim() ||
      (draftSummary && !draftSummary.startsWith("Add a bounded evidence summary")
        ? draftSummary
        : `Batch approval of ${companyKey} as ${effectiveClass} from ${safeSourceIds.length} approval-safe source(s).`);
    const decisionReason =
      action.decisionReason?.trim() ||
      (draftReason.startsWith("Reviewed")
        ? draftReason
        : `Batch approval (${batchId}): ${submitted?.acknowledgementReason?.trim() || "attended bulk review"}.`);

    try {
      const result = await approveIndustryProposalAndStartRecompute(
        {
          proposalId: action.proposalId,
          workspaceSlug: input.workspaceSlug,
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
        reviewer,
      );
      succeeded += 1;
      approvedFingerprints.push(
        `${action.proposalId}:${dataset.inputFingerprint}`,
      );
      items.push({
        proposalId: action.proposalId,
        kind: "approve",
        ok: true,
        revisionId: result.revisionId,
        companyKey: result.companyKey,
      });
    } catch (error) {
      failed += 1;
      items.push(
        rejectItemError(action.proposalId, "approve", error, "approve"),
      );
    }
  }

  const batchFingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        approvedFingerprints.sort(),
      ),
    )
    .digest("hex");

  if (succeeded > 0) {
    // Approval hook: enqueue a maintenance run so recycled
    // needs_more_evidence proposals re-chew automatically after human
    // approvals. Fire-and-forget; coalescing prevents duplicate runs.
    void enqueueIndustryMaintenance({
      workspaceSlug: input.workspaceSlug,
      triggerSource: "approval",
      triggerContext: batchId,
    });
  }

  return {
    batchId,
    batchFingerprint,
    summary: {
      total: input.actions.length,
      succeeded,
      failed,
    },
    items,
  };
}

function approvalSafeSourceIds(
  recommendation: {
    recommendedSourceIds: string[];
    sourceDecisions: Array<{
      sourceId: string;
      approvalSafe: boolean;
    }>;
  },
): string[] {
  const safe = new Set(
    recommendation.sourceDecisions
      .filter((decision) => decision.approvalSafe)
      .map((decision) => decision.sourceId),
  );
  const candidateSourceIds =
    recommendation.recommendedSourceIds.length > 0
      ? recommendation.recommendedSourceIds
      : recommendation.sourceDecisions.map((decision) => decision.sourceId);
  return [...new Set(candidateSourceIds)].filter((id) => safe.has(id));
}

function rejectItemError(
  proposalId: string,
  kind: "approve" | "reject",
  error: unknown,
  phase: string,
): BatchReviewItemResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.startsWith("INDUSTRY_REVIEW_STALE")
    ? "INDUSTRY_REVIEW_STALE"
    : message.startsWith("INDUSTRY_REVIEW_")
      ? message.slice(0, message.indexOf(":")) || "INDUSTRY_REVIEW_POLICY"
      : "BATCH_ITEM_FAILED";
  return {
    proposalId,
    kind,
    ok: false,
    code,
    error: `${phase}: ${message}`,
  };
}
