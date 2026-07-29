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
  companyIndustryRecomputeService,
  type CompanyIndustryRecomputeRun,
} from "./company-industry-recompute-service.js";
import { config } from "./config.js";
import { callConvexMutation, callConvexQuery } from "./convex-utils.js";

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
  return value.map((item) => {
    const parsed = parseIndustryProposal(item);
    if (!parsed) throw new Error("Invalid industry proposal response");
    return parsed;
  });
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
  return { proposalId: value.proposalId, created: value.created === true };
}

export async function approveIndustryProposal(
  input: {
    proposalId: string;
    revisionId: string;
    expectedCurrentRevisionId?: string;
    verificationLevel: "verified" | "rejected";
    industryClass: IndustryClass;
    approvedSourceIds: string[];
    evidenceSummary: string;
    decisionReason: string;
    taxonomyVersion: string;
    ruleVersion?: string;
    nextReviewAt?: number;
  },
  actorId: string,
): Promise<{ proposalId: string; revisionId: string; companyKey: string }> {
  const reviewer = actorId.trim();
  if (!reviewer) throw new Error("Approval actor is required");
  const value = await callConvexMutation("companies:approveIndustryProposal", {
    ...input,
    reviewer,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (
    !isRecord(value) ||
    typeof value.proposalId !== "string" ||
    typeof value.revisionId !== "string" ||
    typeof value.companyKey !== "string"
  ) {
    throw new Error("Invalid companies:approveIndustryProposal response");
  }
  return {
    proposalId: value.proposalId,
    revisionId: value.revisionId,
    companyKey: value.companyKey,
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

export async function resolveIndustryProposal(
  input: {
    proposalId: string;
    resolution: "rejected" | "needs_more_evidence" | "superseded";
    reviewNote?: string;
  },
  actorId: string,
): Promise<{ proposalId: string; status: IndustryProposalStatus }> {
  const reviewer = actorId.trim();
  if (!reviewer) throw new Error("Review actor is required");
  const value = await callConvexMutation("companies:resolveIndustryProposal", {
    ...input,
    reviewer,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (
    !isRecord(value) ||
    typeof value.proposalId !== "string" ||
    typeof value.status !== "string"
  ) {
    throw new Error("Invalid companies:resolveIndustryProposal response");
  }
  return {
    proposalId: value.proposalId,
    status: value.status as IndustryProposalStatus,
  };
}
