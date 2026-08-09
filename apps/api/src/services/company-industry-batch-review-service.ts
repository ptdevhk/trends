import { createHash, randomUUID } from "node:crypto";

import {
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
import { isIndustryReviewStaleError } from "./company-industry-review-errors.js";
import { buildIndustryApprovalDecision } from "./company-industry-approval-service.js";

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

    // Approve lane: the shared approval-decision module gates and builds
    // the payload from the authoritative review packet.
    const decision = buildIndustryApprovalDecision({
      workspaceSlug: input.workspaceSlug,
      packet,
      ...(action.industryClass ? { industryClass: action.industryClass } : {}),
      ...(action.decisionReason ? { decisionReason: action.decisionReason } : {}),
      ...(action.evidenceSummary ? { evidenceSummary: action.evidenceSummary } : {}),
      ...(input.attestation
        ? {
            attestation: {
              schemaVersion: "industry-review-attestation.v1" as const,
              cncEvidenceAcknowledged: input.attestation.cncEvidenceAcknowledged,
              acknowledgementReason: input.attestation.acknowledgementReason,
            },
            batchId,
            batchNote: input.batchNote,
          }
        : {}),
    });
    if (!decision.ok) {
      failed += 1;
      items.push({
        proposalId: action.proposalId,
        kind: "approve",
        ok: false,
        code: decision.code,
        error: decision.error,
      });
      continue;
    }

    try {
      const result = await approveIndustryProposalAndStartRecompute(
        decision.payload,
        reviewer,
      );
      succeeded += 1;
      approvedFingerprints.push(
        `${action.proposalId}:${packet.dataset.inputFingerprint}`,
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

function rejectItemError(
  proposalId: string,
  kind: "approve" | "reject",
  error: unknown,
  phase: string,
): BatchReviewItemResult {
  const message = error instanceof Error ? error.message : String(error);
  // Convex local-backend errors arrive wrapped ("[Request ID: …] Server
  // Error\nUncaught Error: INDUSTRY_REVIEW_*: …"), so extract the code from
  // anywhere in the message rather than requiring a leading prefix.
  const wrappedCode = message.match(/INDUSTRY_REVIEW_[A-Z_]+(?=:)/);
  const code = isIndustryReviewStaleError(error)
    ? "INDUSTRY_REVIEW_STALE"
    : message.startsWith("INDUSTRY_REVIEW_")
      ? message.slice(0, message.indexOf(":")) || "INDUSTRY_REVIEW_POLICY"
      : wrappedCode
        ? wrappedCode[0]
        : "BATCH_ITEM_FAILED";
  return {
    proposalId,
    kind,
    ok: false,
    code,
    error: `${phase}: ${message}`,
  };
}
