import {
  isRecord,
  type IndustryClass,
  type IndustryMaintenanceTriggerReason,
  type IndustryProposalStatus,
} from "@trends/shared";

import {
  parseIndustryProposal,
  type IndustryProposal,
} from "./company-industry-contracts.js";
import {
  IndustryReviewStaleError,
  industryReviewStaleReason,
  isIndustryReviewStaleError,
} from "./company-industry-review-errors.js";
import {
  companyIndustryRecomputeService,
  type CompanyIndustryRecomputeRun,
} from "./company-industry-recompute-service.js";
import { config } from "./config.js";
import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import { invalidateIndustryReviewIndex } from "./company-industry-review-index.js";
import { logger } from "./logger.js";

const terminalIndustryProposalStatuses = new Set<IndustryProposalStatus>([
  "approved",
  "rejected",
  "superseded",
]);

function isTerminalIndustryProposalStatus(value: unknown): boolean {
  return (
    typeof value === "string" &&
    terminalIndustryProposalStatuses.has(value as IndustryProposalStatus)
  );
}

export async function listIndustryProposals(
  status?: IndustryProposalStatus,
): Promise<IndustryProposal[]> {
  const value = await callConvexQuery("companies:listIndustryProposals", {
    writeSecret: config.auth.convexWriteSecret,
    ...(status ? { status } : {}),
  });
  if (!Array.isArray(value)) {
    throw new Error("Invalid companies:listIndustryProposals response");
  }

  const parsedItems: IndustryProposal[] = [];
  for (const item of value) {
    const parsed = parseIndustryProposal(item);
    if (parsed) {
      parsedItems.push(parsed);
      continue;
    }
    const rawStatus = isRecord(item) ? item.status : undefined;
    if (
      !isTerminalIndustryProposalStatus(status) &&
      !isTerminalIndustryProposalStatus(rawStatus)
    ) {
      throw new Error("Invalid industry proposal response");
    }
    logger.warn("Skipping invalid industry proposal record", {
      status: status ?? "all",
      proposalId: isRecord(item) && typeof item.proposalId === "string"
        ? item.proposalId
        : undefined,
    });
  }
  return parsedItems;
}

export async function getIndustryProposal(
  proposalId: string,
): Promise<IndustryProposal | null> {
  const value = await callConvexQuery("companies:getIndustryProposal", {
    proposalId,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (value === null) return null;
  const parsed = parseIndustryProposal(value);
  if (!parsed) throw new Error("Invalid industry proposal response");
  return parsed;
}

export async function upsertIndustryProposal(input: {
  proposalId: string;
  companyKey?: string;
  normalizedEmployerSurface?: string;
  triggerReasons: IndustryMaintenanceTriggerReason[];
  priority: number;
  sampleReferences?: Array<{
    workspaceSlug: string;
    resumeIdentity: string;
    workEntryFingerprint?: string;
  }>;
  currentRevisionId?: string;
  suggestedIndustryClass?: IndustryClass;
  suggestedVerificationLevel?: "verified" | "candidate" | "rejected";
  materialChangeSummary?: string;
  requestedBy?: string;
}): Promise<{ proposalId: string; created: boolean }> {
  const value = await callConvexMutation("companies:upsertIndustryProposal", {
    ...input,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!isRecord(value) || typeof value.proposalId !== "string") {
    throw new Error("Invalid companies:upsertIndustryProposal response");
  }
  invalidateIndustryReviewIndex();
  return { proposalId: value.proposalId, created: value.created === true };
}

export async function approveIndustryProposal(
  input: {
    proposalId: string;
    revisionId: string;
    expectedCurrentRevisionId?: string;
    expectedProposalUpdatedAt?: number;
    expectedSourceVersions?: Array<{ sourceId: string; updatedAt: number }>;
    verificationLevel: "verified" | "rejected";
    industryClass: IndustryClass;
    approvedSourceIds: string[];
    evidenceSummary: string;
    decisionReason: string;
    taxonomyVersion: string;
    ruleVersion?: string;
    nextReviewAt?: number;
    expectedInputFingerprint?: string;
    reviewAttestation?: {
      schemaVersion: "industry-review-attestation.v1";
      inputFingerprint: string;
      decisionMode: "standard" | "risk_override";
      acknowledgedRiskFlags: string[];
      cncEvidenceAcknowledged: boolean;
      acknowledgementReason: string;
    };
  },
  actorId: string,
): Promise<{ proposalId: string; revisionId: string; companyKey: string }> {
  const reviewer = actorId.trim();
  if (!reviewer) throw new Error("Approval actor is required");
  let value: unknown;
  try {
    value = await callConvexMutation("companies:approveIndustryProposal", {
      ...input,
      reviewer,
      writeSecret: config.auth.convexWriteSecret,
    });
  } catch (error) {
    if (isIndustryReviewStaleError(error)) {
      throw new IndustryReviewStaleError(industryReviewStaleReason(error));
    }
    throw error;
  }
  if (
    !isRecord(value) ||
    typeof value.proposalId !== "string" ||
    typeof value.revisionId !== "string" ||
    typeof value.companyKey !== "string"
  ) {
    throw new Error("Invalid companies:approveIndustryProposal response");
  }
  invalidateIndustryReviewIndex();
  return {
    proposalId: value.proposalId,
    revisionId: value.revisionId,
    companyKey: value.companyKey,
  };
}

/**
 * Governed Lane A auto-approval (auto-verify-bot).
 *
 * Thin driver over the Convex `autoApproveIndustryProposal` mutation — the
 * Lane A gate (structured registry/taxonomy sources only, explicit CNC text,
 * fetched+active+unreviewed, canonical companyKey, verified-only) is enforced
 * server-side in the mutation, never in the caller. The revisionId is
 * deterministic, so re-approving the same proposal is a no-op.
 */
export async function autoApproveIndustryProposal(input: {
  proposalId: string;
  industryClass: IndustryClass;
  approvedSourceIds: string[];
  evidenceSummary: string;
  decisionReason: string;
  taxonomyVersion: string;
  ruleVersion?: string;
  expectedInputFingerprint?: string;
}): Promise<{
  proposalId: string;
  revisionId: string;
  companyKey: string;
  idempotent?: boolean;
}> {
  let value: unknown;
  try {
    value = await callConvexMutation("companies:autoApproveIndustryProposal", {
      ...input,
      writeSecret: config.auth.convexWriteSecret,
    });
  } catch (error) {
    if (isIndustryReviewStaleError(error)) {
      throw new IndustryReviewStaleError(industryReviewStaleReason(error));
    }
    throw error;
  }
  if (
    !isRecord(value) ||
    typeof value.proposalId !== "string" ||
    typeof value.revisionId !== "string" ||
    typeof value.companyKey !== "string"
  ) {
    throw new Error("Invalid companies:autoApproveIndustryProposal response");
  }
  invalidateIndustryReviewIndex();
  return {
    proposalId: value.proposalId,
    revisionId: value.revisionId,
    companyKey: value.companyKey,
    ...(value.idempotent === true ? { idempotent: true } : {}),
  };
}

/**
 * Attended approval boundary used by the future stewardship route.
 *
 * Truth is committed first as an immutable revision. The proposal remains in
 * `recompute_pending` until the durable targeted run reaches `completed`;
 * partial failure and revision supersession stay visible to operators.
 */
export async function approveIndustryProposalAndStartRecompute(
  input: Parameters<typeof approveIndustryProposal>[0] & {
    workspaceSlug: string;
  },
  actorId: string,
): Promise<{
  proposalId: string;
  revisionId: string;
  companyKey: string;
  recompute: CompanyIndustryRecomputeRun;
}> {
  const { workspaceSlug, ...approvalInput } = input;
  const approval = await approveIndustryProposal(approvalInput, actorId);
  const recompute = await companyIndustryRecomputeService.start({
    workspaceSlug,
    companyKey: approval.companyKey,
    targetRevisionId: approval.revisionId,
    proposalId: approval.proposalId,
    requestedBy: actorId,
  });
  return { ...approval, recompute };
}

export type UndoIndustryApprovalInput = {
  proposalId: string;
  approvedRevisionId: string;
  expectedCurrentRevisionId?: string;
  expectedProposalUpdatedAt?: number;
  recomputeRunId?: string;
  workspaceSlug: string;
};

export type UndoIndustryApprovalResult = {
  proposalId: string;
  reversalRevisionId: string;
  restoredRevisionId?: string;
  status: "ready_for_review";
  recompute?: {
    previousRunId?: string;
    previousRunStatus?: string;
    replacementRunId?: string;
    status: string;
  };
};

function optionalResponseString(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  if (!(field in value) || value[field] === undefined) return undefined;
  if (typeof value[field] !== "string" || !value[field].trim()) {
    throw new Error(`Invalid companies:undoIndustryProposalApproval ${field}`);
  }
  return value[field] as string;
}

export async function undoIndustryProposalApproval(
  input: UndoIndustryApprovalInput,
  actorId: string,
): Promise<UndoIndustryApprovalResult> {
  const reviewer = actorId.trim();
  if (!reviewer) throw new Error("Review actor is required");

  let value: unknown;
  try {
    value = await callConvexMutation("companies:undoIndustryProposalApproval", {
      proposalId: input.proposalId,
      approvedRevisionId: input.approvedRevisionId,
      ...(input.expectedCurrentRevisionId !== undefined
        ? { expectedCurrentRevisionId: input.expectedCurrentRevisionId }
        : {}),
      ...(input.expectedProposalUpdatedAt !== undefined
        ? { expectedProposalUpdatedAt: input.expectedProposalUpdatedAt }
        : {}),
      ...(input.recomputeRunId !== undefined
        ? { recomputeRunId: input.recomputeRunId }
        : {}),
      reviewer,
      writeSecret: config.auth.convexWriteSecret,
    });
  } catch (error) {
    if (isIndustryReviewStaleError(error)) {
      throw new IndustryReviewStaleError(industryReviewStaleReason(error));
    }
    throw error;
  }

  if (!isRecord(value)) {
    throw new Error("Invalid companies:undoIndustryProposalApproval response");
  }
  const proposalId = optionalResponseString(value, "proposalId");
  const companyKey = optionalResponseString(value, "companyKey");
  const reversalRevisionId = optionalResponseString(
    value,
    "reversalRevisionId",
  );
  const restoredRevisionId = optionalResponseString(
    value,
    "restoredRevisionId",
  );
  const previousRunId = optionalResponseString(value, "previousRunId");
  const previousRunStatus = optionalResponseString(value, "previousRunStatus");
  if (
    !proposalId ||
    !companyKey ||
    !reversalRevisionId ||
    typeof value.replacementRecomputeRequired !== "boolean" ||
    typeof value.idempotent !== "boolean"
  ) {
    throw new Error("Invalid companies:undoIndustryProposalApproval response");
  }

  invalidateIndustryReviewIndex();

  let recompute: UndoIndustryApprovalResult["recompute"] =
    previousRunId || previousRunStatus
      ? {
          ...(previousRunId ? { previousRunId } : {}),
          ...(previousRunStatus ? { previousRunStatus } : {}),
          status: previousRunStatus ?? "unknown",
        }
      : undefined;

  if (value.replacementRecomputeRequired) {
    if (!restoredRevisionId) {
      throw new Error(
        "Invalid companies:undoIndustryProposalApproval response: restoredRevisionId is required for replacement recompute",
      );
    }

    const existingRuns = await companyIndustryRecomputeService.list({
      workspaceSlug: input.workspaceSlug,
      companyKey,
      limit: 100,
    });
    const replacement =
      existingRuns.find((run) => run.targetRevisionId === restoredRevisionId) ??
      (await companyIndustryRecomputeService.start({
        workspaceSlug: input.workspaceSlug,
        companyKey,
        targetRevisionId: restoredRevisionId,
        proposalId,
        requestedBy: reviewer,
      }));
    recompute = {
      ...(previousRunId ? { previousRunId } : {}),
      ...(previousRunStatus ? { previousRunStatus } : {}),
      replacementRunId: replacement.runId,
      status: replacement.status,
    };
  }

  return {
    proposalId,
    reversalRevisionId,
    ...(restoredRevisionId ? { restoredRevisionId } : {}),
    status: "ready_for_review",
    ...(recompute ? { recompute } : {}),
  };
}

export async function resolveIndustryProposal(
  input: {
    proposalId: string;
    resolution: "rejected" | "needs_more_evidence" | "superseded";
    reviewNote?: string;
    expectedProposalUpdatedAt?: number;
  },
  actorId: string,
): Promise<{ proposalId: string; status: IndustryProposalStatus }> {
  const reviewer = actorId.trim();
  if (!reviewer) throw new Error("Review actor is required");
  let value: unknown;
  try {
    value = await callConvexMutation("companies:resolveIndustryProposal", {
      ...input,
      reviewer,
      writeSecret: config.auth.convexWriteSecret,
    });
  } catch (error) {
    if (isIndustryReviewStaleError(error)) {
      throw new IndustryReviewStaleError(industryReviewStaleReason(error));
    }
    throw error;
  }
  if (
    !isRecord(value) ||
    typeof value.proposalId !== "string" ||
    typeof value.status !== "string"
  ) {
    throw new Error("Invalid companies:resolveIndustryProposal response");
  }
  invalidateIndustryReviewIndex();
  return {
    proposalId: value.proposalId,
    status: value.status as IndustryProposalStatus,
  };
}
