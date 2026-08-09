import {
  INDUSTRY_EVIDENCE_RESEARCH_FAILURE_CODES,
  INDUSTRY_EVIDENCE_RESEARCH_ORIGINS,
  INDUSTRY_EVIDENCE_RESEARCH_STATES,
  isIndustryEvidenceResearchFailureCode,
  isIndustryEvidenceResearchOrigin,
  isIndustryEvidenceResearchState,
  type IndustryEvidenceResearchFailureCode,
  type IndustryEvidenceResearchOrigin,
  type IndustryEvidenceResearchRequestSummary,
  type IndustryEvidenceResearchState,
  type IndustryEvidenceResearchSummary,
  type IndustryIdentityCandidateSummary,
} from "@trends/shared";

import { config } from "./config.js";
import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import {
  IndustryReviewNotOpenError,
  industryReviewNotOpenReason,
  isIndustryReviewNotOpenError,
} from "./company-industry-review-errors.js";
import {
  enqueueIndustryMaintenance,
  type EnqueueMaintenanceResult,
} from "./industry-maintenance-pipeline-service.js";

export const INDUSTRY_EVIDENCE_TARGETED_QUEUE_DISABLED =
  "INDUSTRY_EVIDENCE_TARGETED_QUEUE_DISABLED" as const;

export class IndustryEvidenceResearchError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "IndustryEvidenceResearchError";
    this.code = code;
    this.status = status;
  }
}

function ensureEnabled(): void {
  if (!config.industryEvidenceTargetedQueueEnabled) {
    throw new IndustryEvidenceResearchError(
      INDUSTRY_EVIDENCE_TARGETED_QUEUE_DISABLED,
      "Targeted industry-evidence research is disabled in this environment.",
      409,
    );
  }
}

function safeSummary(value: unknown): IndustryEvidenceResearchRequestSummary | null {
  if (!isRecord(value)) return null;
  const requestId = stringValue(value.requestId);
  const proposalId = stringValue(value.proposalId);
  const origin = value.origin;
  const state = value.state;
  const priority = numberValue(value.priority);
  const requestedAt = numberValue(value.requestedAt);
  const demandCount = numberValue(value.demandCount);
  const attemptCount = numberValue(value.attemptCount);
  const updatedAt = numberValue(value.updatedAt);
  if (
    !requestId ||
    !proposalId ||
    !isIndustryEvidenceResearchOrigin(origin) ||
    !isIndustryEvidenceResearchState(state) ||
    priority === undefined ||
    requestedAt === undefined ||
    demandCount === undefined ||
    attemptCount === undefined ||
    updatedAt === undefined
  ) {
    return null;
  }
  const lastErrorCode = isIndustryEvidenceResearchFailureCode(value.lastErrorCode)
    ? value.lastErrorCode
    : undefined;
  return {
    requestId,
    proposalId,
    origin,
    state,
    priority,
    requestedAt,
    demandCount,
    attemptCount,
    ...(numberValue(value.nextAttemptAt) !== undefined
      ? { nextAttemptAt: numberValue(value.nextAttemptAt) }
      : {}),
    ...(numberValue(value.leaseExpiresAt) !== undefined
      ? { leaseExpiresAt: numberValue(value.leaseExpiresAt) }
      : {}),
    ...(stringValue(value.lastRunId) ? { lastRunId: stringValue(value.lastRunId) } : {}),
    ...(stringValue(value.lastOutcome) ? { lastOutcome: stringValue(value.lastOutcome) } : {}),
    ...(lastErrorCode ? { lastErrorCode } : {}),
    updatedAt,
    canRetry: value.canRetry === true,
    canCancel: value.canCancel === true,
  };
}

function safeCandidate(value: unknown): IndustryIdentityCandidateSummary | null {
  if (!isRecord(value)) return null;
  const candidateFingerprint = stringValue(value.candidateFingerprint);
  const proposalId = stringValue(value.proposalId);
  const normalizedLegalName = stringValue(value.normalizedLegalName);
  const sourceIds = stringArray(value.sourceIds);
  const confidence = numberValue(value.confidence);
  const conflictCodes = stringArray(value.conflictCodes);
  const reviewState = value.reviewState;
  const extractionVersion = stringValue(value.extractionVersion);
  const createdAt = numberValue(value.createdAt);
  const updatedAt = numberValue(value.updatedAt);
  if (
    !candidateFingerprint ||
    !proposalId ||
    !normalizedLegalName ||
    !sourceIds ||
    confidence === undefined ||
    !conflictCodes ||
    (reviewState !== "candidate" &&
      reviewState !== "reviewed" &&
      reviewState !== "rejected" &&
      reviewState !== "needs_more_evidence") ||
    !extractionVersion ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return null;
  }
  return {
    candidateFingerprint,
    proposalId,
    normalizedLegalName,
    ...(stringValue(value.jurisdiction) ? { jurisdiction: stringValue(value.jurisdiction) } : {}),
    ...(stringValue(value.registrationNumber)
      ? { registrationNumber: stringValue(value.registrationNumber) }
      : {}),
    sourceIds,
    confidence,
    conflictCodes,
    reviewState,
    extractionVersion,
    createdAt,
    updatedAt,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value.map((item) => item.trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function triggerSourceForOrigin(origin: IndustryEvidenceResearchOrigin): "manual" | "approval" | "restore" | "schedule" {
  if (origin === "refresh") return "restore";
  if (origin === "scheduled_sweep") return "schedule";
  return "manual";
}

export async function enqueueIndustryEvidenceResearch(input: {
  workspaceSlug: string;
  proposalId: string;
  origin: IndustryEvidenceResearchOrigin;
  requestedBy: string;
}): Promise<{
  request: IndustryEvidenceResearchRequestSummary;
  dispatch: EnqueueMaintenanceResult;
  disposition: "created" | "already_queued" | "reprioritized";
}> {
  ensureEnabled();
  if (!INDUSTRY_EVIDENCE_RESEARCH_ORIGINS.includes(input.origin)) {
    throw new IndustryEvidenceResearchError("INVALID_RESEARCH_ORIGIN", "Unsupported research origin", 400);
  }
  const result = await enqueueResearchRequestRow(input);
  const dispatch = await enqueueIndustryMaintenance({
    workspaceSlug: input.workspaceSlug,
    triggerSource: triggerSourceForOrigin(input.origin),
    triggerContext: `targeted research request ${result.request.requestId}`,
    mode: "targeted",
    proposalIds: [input.proposalId],
    requestIds: [result.request.requestId],
  });
  return { ...result, dispatch };
}

async function enqueueResearchRequestRow(input: {
  workspaceSlug: string;
  proposalId: string;
  origin: IndustryEvidenceResearchOrigin;
  requestedBy: string;
}): Promise<{
  request: IndustryEvidenceResearchRequestSummary;
  disposition: "created" | "already_queued" | "reprioritized";
}> {
  let queued: unknown;
  try {
    queued = await callConvexMutation("companies:enqueueIndustryEvidenceResearchRequest", {
      workspaceSlug: input.workspaceSlug,
      proposalId: input.proposalId,
      origin: input.origin,
      requestedBy: input.requestedBy,
      writeSecret: config.auth.convexWriteSecret,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("queue limit reached")) {
      throw new IndustryEvidenceResearchError(
        "RESEARCH_QUEUE_CAP_REACHED",
        "The bounded industry research queue is full. Retry after active work drains.",
        409,
      );
    }
    if (message.includes("Unknown proposalId")) {
      throw new IndustryEvidenceResearchError("RESEARCH_PROPOSAL_NOT_FOUND", message, 404);
    }
    if (message.includes("not requestable")) {
      throw new IndustryEvidenceResearchError("RESEARCH_PROPOSAL_NOT_REQUESTABLE", message, 409);
    }
    throw error;
  }
  const request = safeSummary(queued);
  if (!request) throw new Error("Invalid research request response");
  const disposition =
    queued && isRecord(queued) && queued.disposition === "reprioritized"
      ? "reprioritized"
      : queued && isRecord(queued) && queued.disposition === "already_queued"
        ? "already_queued"
        : "created";
  return { request, disposition };
}

export async function enqueueIndustryEvidenceResearchBatch(input: {
  workspaceSlug: string;
  proposalIds: string[];
  origin: IndustryEvidenceResearchOrigin;
  requestedBy: string;
  maxTargets?: number;
}): Promise<{
  requests: IndustryEvidenceResearchRequestSummary[];
  queued: number;
  alreadyQueued: number;
  dispatch: EnqueueMaintenanceResult;
}> {
  ensureEnabled();
  if (!INDUSTRY_EVIDENCE_RESEARCH_ORIGINS.includes(input.origin)) {
    throw new IndustryEvidenceResearchError("INVALID_RESEARCH_ORIGIN", "Unsupported research origin", 400);
  }
  const maxTargets = Math.min(50, Math.max(1, Math.floor(input.maxTargets ?? config.industryEvidenceResearchMaxBatch)));
  const proposalIds = [...new Set(input.proposalIds.map((id) => id.trim()).filter(Boolean))].slice(0, maxTargets);
  const requests: IndustryEvidenceResearchRequestSummary[] = [];
  let queued = 0;
  let alreadyQueued = 0;
  for (const proposalId of proposalIds) {
    const result = await enqueueResearchRequestRow({ ...input, proposalId });
    requests.push(result.request);
    if (result.disposition === "created") queued += 1;
    else alreadyQueued += 1;
  }
  if (requests.length === 0) {
    return {
      requests,
      queued,
      alreadyQueued,
      dispatch: { runId: null, coalesced: false },
    };
  }
  const dispatch = await enqueueIndustryMaintenance({
    workspaceSlug: input.workspaceSlug,
    triggerSource: triggerSourceForOrigin(input.origin),
    triggerContext: `targeted research batch (${requests.length})`,
    mode: "targeted",
    proposalIds: proposalIds,
    requestIds: requests.map((request) => request.requestId),
  });
  return { requests, queued, alreadyQueued, dispatch };
}

export async function getIndustryEvidenceResearchSummary(input: {
  workspaceSlug: string;
  proposalId: string;
  limit?: number;
}): Promise<IndustryEvidenceResearchSummary> {
  const value = await callConvexQuery("companies:getIndustryEvidenceResearchRequestSummary", {
    workspaceSlug: input.workspaceSlug,
    proposalId: input.proposalId,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    writeSecret: config.auth.convexWriteSecret,
  });
  const active = isRecord(value) ? safeSummary(value.active) : null;
  const history = isRecord(value) && Array.isArray(value.history)
    ? value.history.map(safeSummary).filter((item): item is IndustryEvidenceResearchRequestSummary => item !== null)
    : [];
  return {
    featureEnabled: config.industryEvidenceTargetedQueueEnabled,
    active,
    history,
  };
}

export async function listIndustryIdentityCandidates(proposalId: string): Promise<IndustryIdentityCandidateSummary[]> {
  const value = await callConvexQuery("companies:listIndustryIdentityCandidates", {
    proposalId,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!Array.isArray(value)) return [];
  return value.map(safeCandidate).filter((item): item is IndustryIdentityCandidateSummary => item !== null);
}

export async function resolveIndustryProposalIdentity(input: {
  workspaceSlug: string;
  actor: string;
  proposalId: string;
  expectedProposalUpdatedAt: number;
  candidateFingerprint: string;
  mappingMode: "existing" | "create_provisional";
  companyKey?: string;
  provisionalDisplayName?: string;
  provisionalAlias?: string;
  sourceIds: string[];
  reviewNote?: string;
}): Promise<{ proposalId: string; companyKey: string; auditId: string }> {
  ensureEnabled();
  let value: unknown;
  try {
    value = await callConvexMutation("companies:resolveIndustryProposalIdentity", {
      ...input,
      writeSecret: config.auth.convexWriteSecret,
    });
  } catch (error) {
    if (isIndustryReviewNotOpenError(error)) {
      throw new IndustryReviewNotOpenError(industryReviewNotOpenReason(error));
    }
    throw error;
  }
  if (!isRecord(value) || !stringValue(value.proposalId) || !stringValue(value.companyKey) || !stringValue(value.auditId)) {
    throw new Error("Invalid identity resolution response");
  }
  const proposalId = stringValue(value.proposalId)!;
  const companyKey = stringValue(value.companyKey)!;
  const auditId = stringValue(value.auditId)!;
  return {
    proposalId,
    companyKey,
    auditId,
  };
}

export async function retryIndustryEvidenceResearch(input: {
  workspaceSlug: string;
  proposalId: string;
  requestId: string;
}): Promise<void> {
  ensureEnabled();
  try {
    await callConvexMutation("companies:retryIndustryEvidenceResearchRequest", {
      ...input,
      writeSecret: config.auth.convexWriteSecret,
    });
    await enqueueIndustryMaintenance({
      workspaceSlug: input.workspaceSlug,
      triggerSource: "manual",
      triggerContext: `retry targeted research request ${input.requestId}`,
      mode: "targeted",
      proposalIds: [input.proposalId],
      requestIds: [input.requestId],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unknown research request")) {
      throw new IndustryEvidenceResearchError("RESEARCH_REQUEST_NOT_FOUND", message, 404);
    }
    if (message.includes("not retryable") || message.includes("retry limit")) {
      throw new IndustryEvidenceResearchError("RESEARCH_REQUEST_NOT_RETRYABLE", message, 409);
    }
    throw error;
  }
}

export async function cancelIndustryEvidenceResearch(input: {
  workspaceSlug: string;
  proposalId: string;
  requestId: string;
}): Promise<{ cancelled: boolean }> {
  ensureEnabled();
  try {
    const value = await callConvexMutation("companies:cancelIndustryEvidenceResearchRequest", {
      ...input,
      writeSecret: config.auth.convexWriteSecret,
    });
    if (isRecord(value) && value.cancelled === false) {
      throw new IndustryEvidenceResearchError(
        "RESEARCH_REQUEST_NOT_ACTIVE",
        "This research request is no longer active.",
        409,
      );
    }
    return { cancelled: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unknown research request")) {
      throw new IndustryEvidenceResearchError("RESEARCH_REQUEST_NOT_FOUND", message, 404);
    }
    throw error;
  }
}

export async function resolveExactResumeResearchTargets(input: {
  workspaceSlug: string;
  resumeIds: string[];
  requestedBy: string;
  maxTargets?: number;
}): Promise<{
  queued: number;
  alreadyQueued: number;
  notLinked: number;
  notEligible: number;
  requestIds: string[];
  proposalIds: string[];
  dispatch: EnqueueMaintenanceResult;
}> {
  ensureEnabled();
  const maxTargets = Math.min(50, Math.max(1, Math.floor(input.maxTargets ?? 20)));
  const uniqueResumeIds = [...new Set(input.resumeIds.map((id) => id.trim()).filter(Boolean))].slice(0, maxTargets);
  const proposalIds = new Set<string>();
  const requestIds: string[] = [];
  let queued = 0;
  let alreadyQueued = 0;
  let notLinked = 0;
  let notEligible = 0;
  const eligibleProposalIds: string[] = [];
  const selectedProposalIds: string[] = [];
  let dispatch: EnqueueMaintenanceResult = { runId: null, coalesced: false };
  for (const resumeId of uniqueResumeIds) {
    let resolved: unknown;
    try {
      resolved = await callConvexQuery("companies:resolveIndustryReviewTargetsForResume", {
        workspaceSlug: input.workspaceSlug,
        resumeId,
        writeSecret: config.auth.convexWriteSecret,
      });
    } catch {
      // A stale/malformed result-set ID is reported as not eligible rather
      // than aborting the remaining exact targets.
      notEligible += 1;
      continue;
    }
    const targets = isRecord(resolved) && Array.isArray(resolved.targets) ? resolved.targets : [];
    const available = targets.filter((target): target is Record<string, unknown> => isRecord(target) && target.availability === "target_available" && typeof target.proposalId === "string");
    if (available.length === 0) {
      notLinked += 1;
      continue;
    }
    for (const target of available) {
      const proposalId = String(target.proposalId);
      if (proposalIds.has(proposalId)) continue;
      proposalIds.add(proposalId);
      eligibleProposalIds.push(proposalId);
    }
  }
  if (eligibleProposalIds.length > 0) {
    const boundedProposalIds = eligibleProposalIds.slice(0, maxTargets);
    notEligible += Math.max(0, eligibleProposalIds.length - boundedProposalIds.length);
    try {
      const result = await enqueueIndustryEvidenceResearchBatch({
        workspaceSlug: input.workspaceSlug,
        proposalIds: boundedProposalIds,
        origin: "resume_search_batch",
        requestedBy: input.requestedBy,
        maxTargets,
      });
      requestIds.push(...result.requests.map((request) => request.requestId));
      selectedProposalIds.push(...result.requests.map((request) => request.proposalId));
      queued += result.queued;
      alreadyQueued += result.alreadyQueued;
      dispatch = result.dispatch;
    } catch (error) {
      if (error instanceof IndustryEvidenceResearchError && ["INVALID_RESEARCH_ORIGIN", "RESEARCH_QUEUE_CAP_REACHED"].includes(error.code)) {
        throw error;
      }
      notEligible += boundedProposalIds.length;
    }
  }
  return {
    queued,
    alreadyQueued,
    notLinked,
    notEligible,
    requestIds,
    proposalIds: [...new Set(selectedProposalIds)],
    dispatch,
  };
}

export const industryEvidenceResearchInternals = {
  safeSummary,
  safeCandidate,
  isIndustryEvidenceResearchFailureCode,
  INDUSTRY_EVIDENCE_RESEARCH_FAILURE_CODES,
  INDUSTRY_EVIDENCE_RESEARCH_STATES,
};
