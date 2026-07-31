import { createHash } from "node:crypto";

import {
  INDUSTRY_REVIEW_ACTIONS,
  INDUSTRY_REVIEW_CONFIDENCE_BANDS,
  INDUSTRY_REVIEW_SCHEMA_VERSION,
  INDUSTRY_REVIEW_SOURCE_REASON_CODES,
  normalizeIndustryEvidenceUrl,
  type IndustryClass,
  type IndustryReviewAction,
  type IndustryReviewConfidenceBand,
  type IndustryReviewDataset,
  type IndustryReviewRecommendation,
  type IndustryReviewRiskFlag,
  type IndustryReviewSourceDecision,
  type IndustryReviewSourceReasonCode,
  type IndustryReviewWarning,
} from "@trends/shared";

import {
  type IndustryEvidenceSource,
  type IndustryProposal,
} from "./company-industry-contracts.js";
import {
  listIndustryEvidenceSources,
} from "./company-industry-evidence-service.js";
import {
  getIndustryCoverageSummary,
  type IndustryCoverageMaintenanceRun,
} from "./company-industry-coverage-service.js";
import {
  getIndustryProfile,
  listIndustryProfiles,
  type CompanyIndustryProfile,
} from "./company-industry-profile-service.js";
import {
  getCompanyIndustryEvidenceBundle,
} from "./company-industry-revision-service.js";
import {
  getIndustryProposal,
  listIndustryProposals,
} from "./company-industry-proposal-service.js";
import {
  companyIndustryRecomputeService,
  type CompanyIndustryRecomputeRun,
} from "./company-industry-recompute-service.js";

const REVIEW_ACTIONS = new Set<string>(INDUSTRY_REVIEW_ACTIONS);
const CONFIDENCE_BANDS = new Set<string>(INDUSTRY_REVIEW_CONFIDENCE_BANDS);
const SOURCE_REASON_CODES = new Set<string>(
  INDUSTRY_REVIEW_SOURCE_REASON_CODES,
);

const TRUST_RANK: Record<IndustryEvidenceSource["trustTier"], number> = {
  primary: 0,
  authoritative: 1,
  corroborating: 2,
  discovery: 3,
};

const SOURCE_TYPE_RANK: Record<IndustryEvidenceSource["sourceType"], number> = {
  official_site: 0,
  registry: 1,
  taxonomy: 2,
  oem_partner: 3,
  trade_body: 4,
  reporting: 5,
  directory: 6,
  other: 7,
  search_result: 8,
};

const CNC_SIGNAL_PATTERN =
  /\b(cnc|machining|machine tools?|lathe|milling|metalworking|precision machining)\b|数控|机床|加工中心|金属加工|精密加工/i;

const EXPLICIT_INDUSTRIAL_SOURCE_TYPES = new Set<IndustryEvidenceSource["sourceType"]>([
  "official_site",
  "registry",
  "taxonomy",
  "oem_partner",
  "trade_body",
  "reporting",
]);

export interface IndustryReviewMaintenanceContext {
  latest: IndustryCoverageMaintenanceRun | null;
  lastFailed: IndustryCoverageMaintenanceRun | null;
}

export interface IndustryReviewPacket {
  success: true;
  ok: true;
  schemaVersion: typeof INDUSTRY_REVIEW_SCHEMA_VERSION;
  operation: {
    id: string;
    kind: "recommendation";
    state: "computed";
  };
  dataset: IndustryReviewDataset;
  recommendation: IndustryReviewRecommendation;
  warnings: IndustryReviewWarning[];
  proposal: IndustryProposal;
  sources: IndustryEvidenceSource[];
  bundle: Awaited<ReturnType<typeof getCompanyIndustryEvidenceBundle>> | null;
  recomputeRuns: CompanyIndustryRecomputeRun[];
  maintenance: IndustryReviewMaintenanceContext;
}

export interface IndustryReviewQueueItem {
  proposal: IndustryProposal;
  recommendation: IndustryReviewRecommendation;
  sourceCount: number;
}

export interface IndustryReviewQueueResponse {
  success: true;
  ok: true;
  schemaVersion: typeof INDUSTRY_REVIEW_SCHEMA_VERSION;
  items: IndustryReviewQueueItem[];
  maintenance: IndustryReviewMaintenanceContext;
}

const REVIEW_ACTION_RANK: Record<IndustryReviewAction, number> = {
  needs_more_evidence: 0,
  inspect: 1,
  approve: 2,
  reject: 3,
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function sourceSort(left: IndustryEvidenceSource, right: IndustryEvidenceSource): number {
  return (
    TRUST_RANK[left.trustTier] - TRUST_RANK[right.trustTier] ||
    SOURCE_TYPE_RANK[left.sourceType] - SOURCE_TYPE_RANK[right.sourceType] ||
    (right.fetchedAt ?? right.updatedAt) - (left.fetchedAt ?? left.updatedAt) ||
    left.sourceId.localeCompare(right.sourceId)
  );
}

function hasCncSignal(source: IndustryEvidenceSource): boolean {
  return CNC_SIGNAL_PATTERN.test(
    `${source.title ?? ""} ${source.evidenceExcerpt ?? ""}`,
  );
}

function sourceReason(
  value: string,
): IndustryReviewSourceReasonCode | undefined {
  return SOURCE_REASON_CODES.has(value)
    ? (value as IndustryReviewSourceReasonCode)
    : undefined;
}

function confidenceBand(value: string): IndustryReviewConfidenceBand {
  return CONFIDENCE_BANDS.has(value)
    ? (value as IndustryReviewConfidenceBand)
    : "low";
}

function reviewAction(value: string): IndustryReviewAction {
  return REVIEW_ACTIONS.has(value) ? (value as IndustryReviewAction) : "inspect";
}

function maintenanceFailureWarning(
  maintenance: IndustryReviewMaintenanceContext,
): IndustryReviewWarning | null {
  const failed = maintenance.lastFailed;
  if (!failed) return null;
  if (
    maintenance.latest &&
    maintenance.latest.runId !== failed.runId &&
    (maintenance.latest.startedAt ?? 0) > (failed.startedAt ?? 0) &&
    maintenance.latest.status !== "failed"
  ) {
    return null;
  }
  const summary = `${failed.operatorSummary ?? ""} ${failed.failureMessage ?? ""}`.toLowerCase();
  if (!summary.includes("worker unreachable") && !summary.includes("worker")) {
    return null;
  }
  return {
    code: "worker_unreachable",
    message: "The latest industry maintenance could not reach the FastAPI worker; no new evidence was promoted.",
    action: "Start apps.worker.api on :8000, verify WORKER_URL, then run maintenance again.",
  };
}

function buildRecommendation(input: {
  proposal: IndustryProposal;
  sources: IndustryEvidenceSource[];
  profile: CompanyIndustryProfile | null;
  maintenance: IndustryReviewMaintenanceContext;
}): {
  recommendation: IndustryReviewRecommendation;
  dataset: IndustryReviewDataset;
  warnings: IndustryReviewWarning[];
} {
  const { proposal, sources, profile, maintenance } = input;
  const sortedSources = [...sources].sort(sourceSort);
  const targetIndustryClass =
    proposal.suggestedIndustryClass ?? profile?.industryClass ?? "unknown";
  const sourceClasses = new Set(
    sortedSources
      .map((source) => source.suggestedIndustryClass)
      .filter((value): value is IndustryClass => Boolean(value && value !== "unknown")),
  );
  if (targetIndustryClass !== "unknown") sourceClasses.add(targetIndustryClass);

  const riskFlags = new Set<IndustryReviewRiskFlag>();
  const reasons: string[] = [];
  const excludedSourceReasons: Record<string, string> = {};
  const sourceDecisions: IndustryReviewSourceDecision[] = [];
  const eligibleSources: IndustryEvidenceSource[] = [];

  if (!proposal.companyKey) {
    riskFlags.add("canonical_mapping_missing");
    reasons.push("The proposal is not mapped to a canonical company.");
  }

  if (sourceClasses.size > 1) {
    riskFlags.add("source_conflict");
    reasons.push("Sources suggest conflicting industry classes.");
  }

  for (const source of sortedSources) {
    const reasonCodes: IndustryReviewSourceReasonCode[] = [];
    const normalizedUrl = normalizeIndustryEvidenceUrl(source.url);
    const approvalSafeCandidate =
      normalizedUrl !== null &&
      source.sourceType !== "search_result" &&
      source.trustTier !== "discovery";
    let usable = approvalSafeCandidate;

    if (!normalizedUrl) {
      reasonCodes.push("unsafe_url");
      usable = false;
    }
    if (source.sourceType === "search_result") {
      reasonCodes.push("search_result_not_approval_safe");
      usable = false;
    }
    if (source.trustTier === "discovery") {
      reasonCodes.push("discovery_not_approval_safe");
      usable = false;
    }
    if (source.fetchStatus !== "fetched") {
      reasonCodes.push(source.fetchStatus === "failed" ? "fetch_failed" : "not_fetched");
      riskFlags.add("stale_or_failed_source");
      usable = false;
    }
    if (source.sourceState === "unavailable") {
      reasonCodes.push("source_unavailable");
      riskFlags.add("stale_or_failed_source");
      usable = false;
    } else if (source.sourceState !== "active") {
      reasonCodes.push("source_not_active");
      riskFlags.add("stale_or_failed_source");
      usable = false;
    }
    if (source.reviewStatus === "disputed") {
      reasonCodes.push("source_disputed");
      riskFlags.add("source_conflict");
      usable = false;
    } else if (source.reviewStatus === "rejected") {
      reasonCodes.push("source_rejected");
      usable = false;
    }
    if (sourceClasses.size > 1 && source.suggestedIndustryClass) {
      reasonCodes.push("class_conflict");
      usable = false;
    }
    if (approvalSafeCandidate && usable) {
      reasonCodes.push("approval_safe");
      eligibleSources.push(source);
    }
    sourceDecisions.push({
      sourceId: source.sourceId,
      approvalSafe: approvalSafeCandidate && usable,
      recommended: false,
      reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["approval_safe"],
    });
    if (!usable) {
      excludedSourceReasons[source.sourceId] = reasonCodes
        .map((code) => code.replaceAll("_", " "))
        .join(", ");
    }
  }

  if (sortedSources.length > 0 && eligibleSources.length === 0) {
    riskFlags.add("only_discovery_sources");
    reasons.push("No attached source is currently approval-safe and usable.");
  }
  if (eligibleSources.length === 0) {
    riskFlags.add("low_source_diversity");
  } else if (
    eligibleSources.length === 1 &&
    eligibleSources[0]?.trustTier !== "primary"
  ) {
    riskFlags.add("low_source_diversity");
  }

  if (targetIndustryClass === "unknown") {
    riskFlags.add("weak_industry_signal");
    reasons.push("No industry class has been suggested by the proposal or reviewed profile.");
  }
  if (
    targetIndustryClass === "cnc" &&
    !eligibleSources.some(
      (source) =>
        EXPLICIT_INDUSTRIAL_SOURCE_TYPES.has(source.sourceType) &&
        hasCncSignal(source),
    )
  ) {
    riskFlags.add("cnc_claim_inferred");
    reasons.push("The CNC classification lacks explicit industrial/product evidence.");
  }
  if (proposal.applicationState === "recompute_pending" || proposal.applicationState === "recompute_running") {
    riskFlags.add("recompute_pending");
  }

  const recommendedSources = eligibleSources.slice(0, 3);
  const recommendedSourceIds = recommendedSources.map((source) => source.sourceId);
  const recommendedSourceSet = new Set(recommendedSourceIds);
  for (const decision of sourceDecisions) {
    if (recommendedSourceSet.has(decision.sourceId)) {
      decision.recommended = true;
      const source = sortedSources.find((item) => item.sourceId === decision.sourceId);
      const code = source?.trustTier === "primary"
        ? "recommended_primary"
        : "recommended_corroborating";
      const parsed = sourceReason(code);
      if (parsed) decision.reasonCodes.push(parsed);
    }
  }

  const failedWarning = maintenanceFailureWarning(maintenance);
  const warnings: IndustryReviewWarning[] = failedWarning ? [failedWarning] : [];
  if (failedWarning) {
    riskFlags.add("worker_unreachable");
    reasons.push(failedWarning.message);
  }

  const blockingFlags = new Set<IndustryReviewRiskFlag>([
    "canonical_mapping_missing",
    "only_discovery_sources",
    "source_conflict",
    "weak_industry_signal",
    "cnc_claim_inferred",
    "stale_or_failed_source",
    "low_source_diversity",
  ]);
  const hasBlockingRisk = [...riskFlags].some((flag) => blockingFlags.has(flag));
  const recommendedAction =
    !proposal.companyKey || targetIndustryClass === "unknown"
      ? "inspect"
      : proposal.suggestedVerificationLevel === "rejected" || targetIndustryClass === "non_industry"
        ? "reject"
        : hasBlockingRisk || recommendedSourceIds.length === 0
          ? "needs_more_evidence"
          : "approve";

  if (recommendedAction === "approve") {
    reasons.unshift(
      `Durable ${recommendedSourceIds.length === 1 ? "source" : "sources"} support the proposed ${targetIndustryClass} classification.`,
    );
  }
  if (reasons.length === 0) reasons.push("Open the evidence packet and inspect the proposed change.");

  let confidence: IndustryReviewConfidenceBand = "low";
  if (recommendedAction === "approve") {
    const hasPrimary = recommendedSources.some((source) => source.trustTier === "primary");
    confidence = hasPrimary && riskFlags.size === 0 ? "high" : "medium";
  } else if (recommendedAction === "reject" && riskFlags.size === 0) {
    confidence = "medium";
  }

  const recommendation: IndustryReviewRecommendation = {
    proposalId: proposal.proposalId,
    proposalStatus: proposal.status,
    recommendedAction: reviewAction(recommendedAction),
    recommendedVerificationLevel: recommendedAction === "reject" ? "rejected" : "verified",
    recommendedIndustryClass: targetIndustryClass,
    recommendedSourceIds,
    sourceDecisions,
    confidenceBand: confidenceBand(confidence),
    riskFlags: [...riskFlags].sort(),
    reasons: [...new Set(reasons)],
    excludedSourceReasons,
    evidenceSummaryDraft:
      proposal.materialChangeSummary?.trim() ||
      recommendedSources
        .map((source) => source.evidenceExcerpt?.trim())
        .find((value): value is string => Boolean(value)) ||
      "Add a bounded evidence summary after reviewing the selected source(s).",
    decisionReasonDraft:
      recommendedAction === "approve"
        ? `Reviewed ${recommendedSourceIds.length} approval-safe source(s); confirm the ${targetIndustryClass} classification and evidence summary.`
        : recommendedAction === "reject"
          ? "The proposed change does not meet the current evidence policy; confirm the rejection reason."
          : "Additional evidence or canonical-company review is required before changing verified truth.",
    requiresHumanReview: true,
  };

  const fingerprintInput = {
    proposal: {
      proposalId: proposal.proposalId,
      status: proposal.status,
      updatedAt: proposal.updatedAt,
      companyKey: proposal.companyKey,
      currentRevisionId: proposal.currentRevisionId,
      suggestedIndustryClass: proposal.suggestedIndustryClass,
      suggestedVerificationLevel: proposal.suggestedVerificationLevel,
      materialChangeSummary: proposal.materialChangeSummary,
    },
    profile: profile
      ? {
          companyKey: profile.companyKey,
          currentRevisionId: profile.currentRevisionId,
          industryClass: profile.industryClass,
          updatedAt: profile.updatedAt,
        }
      : null,
    sources: sortedSources.map((source) => ({
      sourceId: source.sourceId,
      url: source.url,
      sourceType: source.sourceType,
      trustTier: source.trustTier,
      title: source.title,
      evidenceExcerpt: source.evidenceExcerpt,
      fetchedAt: source.fetchedAt,
      lastSuccessfulFetchAt: source.lastSuccessfulFetchAt,
      contentFingerprint: source.contentFingerprint,
      fetchStatus: source.fetchStatus,
      suggestedIndustryClass: source.suggestedIndustryClass,
      reviewStatus: source.reviewStatus,
      sourceState: source.sourceState,
      updatedAt: source.updatedAt,
    })),
  };
  const inputFingerprint = fingerprint(fingerprintInput);
  const dataset: IndustryReviewDataset = {
    revision: `${proposal.proposalId}:${proposal.updatedAt}:${profile?.currentRevisionId ?? proposal.currentRevisionId ?? "none"}`,
    inputFingerprint,
    generatedAt: Date.now(),
    proposalUpdatedAt: proposal.updatedAt,
    sourceVersions: sortedSources.map((source) => ({
      sourceId: source.sourceId,
      updatedAt: source.updatedAt,
    })),
  };

  return { recommendation, dataset, warnings };
}

async function loadMaintenanceContext(
  workspaceSlug?: string,
): Promise<IndustryReviewMaintenanceContext> {
  if (!workspaceSlug) return { latest: null, lastFailed: null };
  try {
    const summary = await getIndustryCoverageSummary(workspaceSlug);
    return {
      latest: summary.maintenance.latest,
      lastFailed: summary.maintenance.lastFailed,
    };
  } catch {
    return { latest: null, lastFailed: null };
  }
}

async function buildRecommendationForProposal(input: {
  proposal: IndustryProposal;
  sources?: IndustryEvidenceSource[];
  profile?: CompanyIndustryProfile | null;
  maintenance: IndustryReviewMaintenanceContext;
}) {
  const sources = input.sources ?? (await listIndustryEvidenceSources({
    proposalId: input.proposal.proposalId,
  }));
  const profile = input.profile !== undefined
    ? input.profile
    : input.proposal.companyKey
      ? await getIndustryProfile(input.proposal.companyKey)
      : null;
  return buildRecommendation({
    proposal: input.proposal,
    sources,
    profile,
    maintenance: input.maintenance,
  });
}

export async function getIndustryReviewPacket(
  proposalId: string,
  workspaceSlug?: string,
): Promise<IndustryReviewPacket | null> {
  const proposal = await getIndustryProposal(proposalId);
  if (!proposal) return null;
  const [sources, bundle, maintenance] = await Promise.all([
    listIndustryEvidenceSources({ proposalId: proposal.proposalId }),
    proposal.companyKey
      ? getCompanyIndustryEvidenceBundle(proposal.companyKey)
      : Promise.resolve(null),
    loadMaintenanceContext(workspaceSlug),
  ]);
  const { recommendation, dataset, warnings } = await buildRecommendationForProposal({
    proposal,
    sources,
    profile: bundle?.profile ?? null,
    maintenance,
  });
  const recomputeRuns = proposal.companyKey
    ? await companyIndustryRecomputeService.list({
        workspaceSlug: workspaceSlug ?? "dev",
        companyKey: proposal.companyKey,
        limit: 10,
      })
    : [];
  return {
    success: true,
    ok: true,
    schemaVersion: INDUSTRY_REVIEW_SCHEMA_VERSION,
    operation: {
      id: `review-${proposal.proposalId}-${dataset.inputFingerprint.slice(0, 12)}`,
      kind: "recommendation",
      state: "computed",
    },
    dataset,
    recommendation,
    warnings,
    proposal,
    sources,
    bundle,
    recomputeRuns,
    maintenance,
  };
}

export async function listIndustryReviewQueue(input: {
  status?: IndustryProposal["status"];
  limit?: number;
  workspaceSlug?: string;
}): Promise<IndustryReviewQueueResponse> {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
  const [proposals, allSources, profiles, maintenance] = await Promise.all([
    listIndustryProposals(input.status),
    listIndustryEvidenceSources(),
    listIndustryProfiles(),
    loadMaintenanceContext(input.workspaceSlug),
  ]);
  const sourcesByProposal = new Map<string, IndustryEvidenceSource[]>();
  for (const source of allSources) {
    if (!source.proposalId) continue;
    const proposalSources = sourcesByProposal.get(source.proposalId) ?? [];
    proposalSources.push(source);
    sourcesByProposal.set(source.proposalId, proposalSources);
  }
  const profilesByCompany = new Map(
    profiles.map((profile) => [profile.companyKey, profile]),
  );
  const items = await mapWithConcurrency(proposals, 8, async (proposal) => {
    const sources = sourcesByProposal.get(proposal.proposalId) ?? [];
    const profile = proposal.companyKey
      ? profilesByCompany.get(proposal.companyKey) ?? null
      : null;
    const { recommendation } = await buildRecommendationForProposal({
      proposal,
      sources,
      profile,
      maintenance,
    });
    return {
      proposal,
      recommendation,
      sourceCount: sources.length,
    };
  });
  items.sort((left, right) => {
    const actionRank =
      REVIEW_ACTION_RANK[left.recommendation.recommendedAction] -
      REVIEW_ACTION_RANK[right.recommendation.recommendedAction];
    return (
      actionRank ||
      right.recommendation.riskFlags.length - left.recommendation.riskFlags.length ||
      right.proposal.priority - left.proposal.priority ||
      left.proposal.updatedAt - right.proposal.updatedAt ||
      left.proposal.proposalId.localeCompare(right.proposal.proposalId)
    );
  });
  return {
    success: true,
    ok: true,
    schemaVersion: INDUSTRY_REVIEW_SCHEMA_VERSION,
    items: items.slice(0, limit),
    maintenance,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length || 1) },
      () => worker(),
    ),
  );
  return results;
}

export const industryReviewInternals = {
  buildRecommendation,
  fingerprint,
  sourceSort,
};
