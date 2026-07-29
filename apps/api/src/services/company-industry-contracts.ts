import {
  INDUSTRY_CLASSES,
  INDUSTRY_EVIDENCE_SOURCE_TYPES,
  INDUSTRY_EVIDENCE_TRUST_TIERS,
  INDUSTRY_MAINTENANCE_TRIGGER_REASONS,
  INDUSTRY_PROPOSAL_STATUSES,
  MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES,
  compareSourcePreviews,
  isRecord,
  normalizeIndustryEvidenceUrl,
  parseSourcePreview,
  parseVerifiedIndustryEvidenceSummary,
  type IndustryClass,
  type IndustryEvidenceSourcePreview,
  type IndustryEvidenceSourceType,
  type IndustryEvidenceTrustTier,
  type IndustryMaintenanceTriggerReason,
  type IndustryProposalStatus,
} from "@trends/shared";

import type { ReviewedIndustryProfileSnapshot } from "./industry-verification-service.js";

const industryClassSet = new Set<string>(INDUSTRY_CLASSES);
const sourceTypeSet = new Set<string>(INDUSTRY_EVIDENCE_SOURCE_TYPES);
const trustTierSet = new Set<string>(INDUSTRY_EVIDENCE_TRUST_TIERS);
const triggerReasonSet = new Set<string>(INDUSTRY_MAINTENANCE_TRIGGER_REASONS);
const proposalStatusSet = new Set<string>(INDUSTRY_PROPOSAL_STATUSES);

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export interface IndustryEvidenceSource {
  _id: string;
  sourceId: string;
  companyKey?: string;
  proposalId?: string;
  url: string;
  sourceDomain: string;
  sourceType: IndustryEvidenceSourceType;
  trustTier: IndustryEvidenceTrustTier;
  title?: string;
  evidenceExcerpt?: string;
  fetchedAt?: number;
  lastSuccessfulFetchAt?: number;
  contentFingerprint?: string;
  fetchStatus: "pending" | "fetched" | "failed" | "unavailable";
  suggestedIndustryClass?: IndustryClass;
  workerConfidence?: number;
  reviewStatus: "unreviewed" | "approved" | "rejected" | "disputed";
  reviewedAt?: number;
  reviewedBy?: string;
  reviewerNote?: string;
  sourceState: "active" | "superseded" | "unavailable" | "disputed";
  supersededBySourceId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IndustryProposal {
  _id: string;
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
  status: IndustryProposalStatus;
  requestedBy?: string;
  researchStartedAt?: number;
  readyForReviewAt?: number;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  approvedRevisionId?: string;
  recomputeRunId?: string;
  applicationState?:
    | "recompute_pending"
    | "recompute_running"
    | "applied"
    | "partial_failure"
    | "superseded";
  appliedRevisionId?: string;
  appliedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface IndustryVerdictRevision {
  _id: string;
  revisionId: string;
  companyKey: string;
  industryClass: IndustryClass;
  verificationLevel: "verified" | "rejected";
  approvedSourceIds: string[];
  evidenceSummary: string;
  reviewedBy: string;
  reviewedAt: number;
  decisionReason: string;
  taxonomyVersion: string;
  ruleVersion?: string;
  supersedesRevisionId?: string;
  proposalId?: string;
  createdAt: number;
}

export function parseReviewedIndustryProfileSnapshot(
  value: unknown,
): ReviewedIndustryProfileSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.verificationLevel === "verified") {
    return parseVerifiedIndustryEvidenceSummary(value);
  }
  const companyKey = nonEmptyString(value.companyKey);
  const industryClass = nonEmptyString(value.industryClass);
  const verdictRevisionId = nonEmptyString(value.verdictRevisionId);
  const evidenceSummary = nonEmptyString(value.evidenceSummary);
  const reviewedAt = finiteNumber(value.reviewedAt);
  const sourceCount = finiteNumber(value.sourceCount);
  if (
    value.verificationLevel !== "rejected" ||
    !companyKey ||
    !industryClass ||
    !industryClassSet.has(industryClass) ||
    !verdictRevisionId ||
    !evidenceSummary ||
    reviewedAt === undefined ||
    sourceCount === undefined ||
    !Array.isArray(value.sourcePreviews)
  ) {
    return null;
  }
  const sourcePreviews = value.sourcePreviews
    .map(parseSourcePreview)
    .filter((item): item is IndustryEvidenceSourcePreview => item !== null)
    .sort(compareSourcePreviews)
    .slice(0, MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES);
  if (sourcePreviews.length !== value.sourcePreviews.length) return null;
  return {
    companyKey,
    industryClass: industryClass as IndustryClass,
    verificationLevel: "rejected",
    verdictRevisionId,
    evidenceSummary,
    reviewedAt,
    ...(nonEmptyString(value.reviewedBy)
      ? { reviewedBy: nonEmptyString(value.reviewedBy)! }
      : {}),
    sourceCount,
    sourcePreviews,
  };
}

export function parseIndustryEvidenceSource(
  value: unknown,
): IndustryEvidenceSource | null {
  if (!isRecord(value)) return null;
  const _id = nonEmptyString(value._id);
  const sourceId = nonEmptyString(value.sourceId);
  const normalizedUrl = normalizeIndustryEvidenceUrl(value.url);
  const sourceType = nonEmptyString(value.sourceType);
  const trustTier = nonEmptyString(value.trustTier);
  const fetchStatus = nonEmptyString(value.fetchStatus);
  const reviewStatus = nonEmptyString(value.reviewStatus);
  const sourceState = nonEmptyString(value.sourceState);
  const createdAt = finiteNumber(value.createdAt);
  const updatedAt = finiteNumber(value.updatedAt);
  if (
    !_id ||
    !sourceId ||
    !normalizedUrl ||
    !sourceType ||
    !sourceTypeSet.has(sourceType) ||
    !trustTier ||
    !trustTierSet.has(trustTier) ||
    !fetchStatus ||
    !["pending", "fetched", "failed", "unavailable"].includes(fetchStatus) ||
    !reviewStatus ||
    !["unreviewed", "approved", "rejected", "disputed"].includes(reviewStatus) ||
    !sourceState ||
    !["active", "superseded", "unavailable", "disputed"].includes(sourceState) ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return null;
  }
  return {
    _id,
    sourceId,
    ...(nonEmptyString(value.companyKey)
      ? { companyKey: nonEmptyString(value.companyKey)! }
      : {}),
    ...(nonEmptyString(value.proposalId)
      ? { proposalId: nonEmptyString(value.proposalId)! }
      : {}),
    url: normalizedUrl.url,
    sourceDomain: normalizedUrl.sourceDomain,
    sourceType: sourceType as IndustryEvidenceSourceType,
    trustTier: trustTier as IndustryEvidenceTrustTier,
    ...(nonEmptyString(value.title) ? { title: nonEmptyString(value.title)! } : {}),
    ...(nonEmptyString(value.evidenceExcerpt)
      ? { evidenceExcerpt: nonEmptyString(value.evidenceExcerpt)! }
      : {}),
    ...(finiteNumber(value.fetchedAt) !== undefined
      ? { fetchedAt: finiteNumber(value.fetchedAt)! }
      : {}),
    ...(finiteNumber(value.lastSuccessfulFetchAt) !== undefined
      ? { lastSuccessfulFetchAt: finiteNumber(value.lastSuccessfulFetchAt)! }
      : {}),
    ...(nonEmptyString(value.contentFingerprint)
      ? { contentFingerprint: nonEmptyString(value.contentFingerprint)! }
      : {}),
    fetchStatus: fetchStatus as IndustryEvidenceSource["fetchStatus"],
    ...(nonEmptyString(value.suggestedIndustryClass) &&
    industryClassSet.has(nonEmptyString(value.suggestedIndustryClass)!)
      ? {
          suggestedIndustryClass: nonEmptyString(
            value.suggestedIndustryClass,
          ) as IndustryClass,
        }
      : {}),
    ...(finiteNumber(value.workerConfidence) !== undefined
      ? { workerConfidence: finiteNumber(value.workerConfidence)! }
      : {}),
    reviewStatus: reviewStatus as IndustryEvidenceSource["reviewStatus"],
    ...(finiteNumber(value.reviewedAt) !== undefined
      ? { reviewedAt: finiteNumber(value.reviewedAt)! }
      : {}),
    ...(nonEmptyString(value.reviewedBy)
      ? { reviewedBy: nonEmptyString(value.reviewedBy)! }
      : {}),
    ...(nonEmptyString(value.reviewerNote)
      ? { reviewerNote: nonEmptyString(value.reviewerNote)! }
      : {}),
    sourceState: sourceState as IndustryEvidenceSource["sourceState"],
    ...(nonEmptyString(value.supersededBySourceId)
      ? { supersededBySourceId: nonEmptyString(value.supersededBySourceId)! }
      : {}),
    createdAt,
    updatedAt,
  };
}

export function parseIndustryProposal(value: unknown): IndustryProposal | null {
  if (!isRecord(value)) return null;
  const _id = nonEmptyString(value._id);
  const proposalId = nonEmptyString(value.proposalId);
  const triggerReasons = stringArray(value.triggerReasons);
  const priority = finiteNumber(value.priority);
  const status = nonEmptyString(value.status);
  const createdAt = finiteNumber(value.createdAt);
  const updatedAt = finiteNumber(value.updatedAt);
  if (
    !_id ||
    !proposalId ||
    !triggerReasons ||
    triggerReasons.some((reason) => !triggerReasonSet.has(reason)) ||
    priority === undefined ||
    !status ||
    !proposalStatusSet.has(status) ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return null;
  }
  const sampleReferences = Array.isArray(value.sampleReferences)
    ? value.sampleReferences
        .map((reference) => {
          if (!isRecord(reference)) return null;
          const workspaceSlug = nonEmptyString(reference.workspaceSlug);
          const resumeIdentity = nonEmptyString(reference.resumeIdentity);
          if (!workspaceSlug || !resumeIdentity) return null;
          return {
            workspaceSlug,
            resumeIdentity,
            ...(nonEmptyString(reference.workEntryFingerprint)
              ? {
                  workEntryFingerprint:
                    nonEmptyString(reference.workEntryFingerprint)!,
                }
              : {}),
          };
        })
        .filter(
          (
            reference,
          ): reference is {
            workspaceSlug: string;
            resumeIdentity: string;
            workEntryFingerprint?: string;
          } => reference !== null,
        )
        .slice(0, 10)
    : undefined;
  if (
    Array.isArray(value.sampleReferences) &&
    sampleReferences?.length !== value.sampleReferences.length
  ) {
    return null;
  }
  return {
    _id,
    proposalId,
    ...(nonEmptyString(value.companyKey)
      ? { companyKey: nonEmptyString(value.companyKey)! }
      : {}),
    ...(nonEmptyString(value.normalizedEmployerSurface)
      ? {
          normalizedEmployerSurface: nonEmptyString(
            value.normalizedEmployerSurface,
          )!,
        }
      : {}),
    triggerReasons: triggerReasons as IndustryMaintenanceTriggerReason[],
    priority,
    ...(sampleReferences && sampleReferences.length > 0
      ? { sampleReferences }
      : {}),
    currentRevisionId: nonEmptyString(value.currentRevisionId),
    ...(nonEmptyString(value.suggestedIndustryClass) &&
    industryClassSet.has(nonEmptyString(value.suggestedIndustryClass)!)
      ? {
          suggestedIndustryClass: nonEmptyString(
            value.suggestedIndustryClass,
          ) as IndustryClass,
        }
      : {}),
    ...(value.suggestedVerificationLevel === "verified" ||
    value.suggestedVerificationLevel === "candidate" ||
    value.suggestedVerificationLevel === "rejected"
      ? { suggestedVerificationLevel: value.suggestedVerificationLevel }
      : {}),
    ...(nonEmptyString(value.materialChangeSummary)
      ? { materialChangeSummary: nonEmptyString(value.materialChangeSummary)! }
      : {}),
    status: status as IndustryProposalStatus,
    ...(nonEmptyString(value.requestedBy)
      ? { requestedBy: nonEmptyString(value.requestedBy)! }
      : {}),
    ...(finiteNumber(value.researchStartedAt) !== undefined
      ? { researchStartedAt: finiteNumber(value.researchStartedAt)! }
      : {}),
    ...(finiteNumber(value.readyForReviewAt) !== undefined
      ? { readyForReviewAt: finiteNumber(value.readyForReviewAt)! }
      : {}),
    ...(finiteNumber(value.reviewedAt) !== undefined
      ? { reviewedAt: finiteNumber(value.reviewedAt)! }
      : {}),
    ...(nonEmptyString(value.reviewedBy)
      ? { reviewedBy: nonEmptyString(value.reviewedBy)! }
      : {}),
    ...(nonEmptyString(value.reviewNote)
      ? { reviewNote: nonEmptyString(value.reviewNote)! }
      : {}),
    ...(nonEmptyString(value.approvedRevisionId)
      ? { approvedRevisionId: nonEmptyString(value.approvedRevisionId)! }
      : {}),
    ...(nonEmptyString(value.recomputeRunId)
      ? { recomputeRunId: nonEmptyString(value.recomputeRunId)! }
      : {}),
    ...(value.applicationState === "recompute_pending" ||
    value.applicationState === "recompute_running" ||
    value.applicationState === "applied" ||
    value.applicationState === "partial_failure" ||
    value.applicationState === "superseded"
      ? { applicationState: value.applicationState }
      : {}),
    ...(nonEmptyString(value.appliedRevisionId)
      ? { appliedRevisionId: nonEmptyString(value.appliedRevisionId)! }
      : {}),
    ...(finiteNumber(value.appliedAt) !== undefined
      ? { appliedAt: finiteNumber(value.appliedAt)! }
      : {}),
    createdAt,
    updatedAt,
  };
}

export function parseIndustryVerdictRevision(
  value: unknown,
): IndustryVerdictRevision | null {
  if (!isRecord(value)) return null;
  const _id = nonEmptyString(value._id);
  const revisionId = nonEmptyString(value.revisionId);
  const companyKey = nonEmptyString(value.companyKey);
  const industryClass = nonEmptyString(value.industryClass);
  const approvedSourceIds = stringArray(value.approvedSourceIds);
  const evidenceSummary = nonEmptyString(value.evidenceSummary);
  const reviewedBy = nonEmptyString(value.reviewedBy);
  const reviewedAt = finiteNumber(value.reviewedAt);
  const decisionReason = nonEmptyString(value.decisionReason);
  const taxonomyVersion = nonEmptyString(value.taxonomyVersion);
  const createdAt = finiteNumber(value.createdAt);
  if (
    !_id ||
    !revisionId ||
    !companyKey ||
    !industryClass ||
    !industryClassSet.has(industryClass) ||
    (value.verificationLevel !== "verified" &&
      value.verificationLevel !== "rejected") ||
    !approvedSourceIds ||
    !evidenceSummary ||
    !reviewedBy ||
    reviewedAt === undefined ||
    !decisionReason ||
    !taxonomyVersion ||
    createdAt === undefined
  ) {
    return null;
  }
  return {
    _id,
    revisionId,
    companyKey,
    industryClass: industryClass as IndustryClass,
    verificationLevel: value.verificationLevel,
    approvedSourceIds,
    evidenceSummary,
    reviewedBy,
    reviewedAt,
    decisionReason,
    taxonomyVersion,
    ...(nonEmptyString(value.ruleVersion)
      ? { ruleVersion: nonEmptyString(value.ruleVersion)! }
      : {}),
    ...(nonEmptyString(value.supersedesRevisionId)
      ? { supersedesRevisionId: nonEmptyString(value.supersedesRevisionId)! }
      : {}),
    ...(nonEmptyString(value.proposalId)
      ? { proposalId: nonEmptyString(value.proposalId)! }
      : {}),
    createdAt,
  };
}
