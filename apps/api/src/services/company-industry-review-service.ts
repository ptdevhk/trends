import { createHash } from "node:crypto";

import {
  INDUSTRY_REVIEW_ACTIONS,
  INDUSTRY_REVIEW_CONFIDENCE_BANDS,
  INDUSTRY_REVIEW_SCHEMA_VERSION,
  INDUSTRY_REVIEW_SOURCE_REASON_CODES,
  hasAutoApprovableEvidence,
  hasExplicitCncEvidence,
  normalizeIndustryEvidenceUrl,
  reviewAttestationDecision,
  type IndustryReviewRiskDecision,
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
  getCompanyIndustryReviewContext,
  type IndustryReviewContext,
} from "./company-industry-revision-service.js";
import {
  getIndustryProposal,
  listIndustryProposals,
} from "./company-industry-proposal-service.js";
import {
  companyIndustryRecomputeService,
  type CompanyIndustryRecomputeRun,
} from "./company-industry-recompute-service.js";
import {
  getIndustryEvidenceResearchSummary,
  listIndustryIdentityCandidates,
} from "./industry-evidence-research-service.js";
import {
  getCachedIndustryReviewIndex,
  paginateIndustryReviewIndex,
  setCachedIndustryReviewIndex,
  type IndustryReviewIndexEntry,
} from "./company-industry-review-index.js";

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
  reviewContext: IndustryReviewContext;
  recomputeRuns: CompanyIndustryRecomputeRun[];
  maintenance: IndustryReviewMaintenanceContext;
  research: Awaited<ReturnType<typeof getIndustryEvidenceResearchSummary>>;
  identityCandidates: Awaited<ReturnType<typeof listIndustryIdentityCandidates>>;
}

export interface IndustryReviewQueueItem {
  proposal: IndustryProposal;
  recommendation: IndustryReviewRecommendation;
  inputFingerprint: string;
  sourceCount: number;
}

export interface IndustryReviewQueueResponse {
  success: true;
  ok: true;
  schemaVersion: typeof INDUSTRY_REVIEW_SCHEMA_VERSION;
  items: IndustryReviewQueueItem[];
  maintenance: IndustryReviewMaintenanceContext;
  nextCursor?: string;
}

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

/**
 * Lane A (governed auto-verify) eligibility for a proposal.
 *
 * A proposal is auto-approvable only when ALL hold:
 *   - it has a canonical companyKey (no identity ambiguity);
 *   - the recommendation is an approve with zero risk flags (the blocking
 *     flags already cover low_source_diversity, source_conflict, stale
 *     sources, weak signals, and missing identity);
 *   - every eligible source is a structured registry/taxonomy record with
 *     explicit CNC signal text (prose evidence always routes to the human
 *     cockpit).
 *
 * Confidence is deliberately not part of the gate: for structured registry
 * evidence, corroborating records are the trusted tier (registry data is
 * machine-verifiable), and the risk-flag set is the real safety boundary.
 *
 * Auto-approvable proposals are excluded from the human review queue — the
 * governed auto-verify-bot lane handles them with zero manual actions.
 */
function isAutoApprovableProposal(input: {
  proposal: IndustryProposal;
  recommendedAction: string;
  riskFlags: IndustryReviewRiskFlag[];
  eligibleSources: IndustryEvidenceSource[];
}): boolean {
  const { proposal, recommendedAction, riskFlags, eligibleSources } = input;
  if (!proposal.companyKey) return false;
  if (recommendedAction !== "approve") return false;
  if (riskFlags.length > 0) return false;
  if (eligibleSources.length === 0) return false;
  return hasAutoApprovableEvidence(eligibleSources);
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
      // Only a failed *would-be approval* source is a stale-evidence risk:
      // a failed search-result/discovery row never contributed evidence and
      // is excluded from approval either way, so it must not hard-block a
      // proposal whose official sources fetched cleanly (observed on preview
      // 2026-08-09: bot-blocked 3M/Indeed/CTOS rows blocked United Marking
      // and Gin Seiko approvals despite healthy official sources).
      if (approvalSafeCandidate) {
        riskFlags.add("stale_or_failed_source");
      }
      usable = false;
    }
    if (source.sourceState === "unavailable") {
      reasonCodes.push("source_unavailable");
      if (approvalSafeCandidate) {
        riskFlags.add("stale_or_failed_source");
      }
      usable = false;
    } else if (source.sourceState !== "active") {
      reasonCodes.push("source_not_active");
      if (approvalSafeCandidate) {
        riskFlags.add("stale_or_failed_source");
      }
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
    !hasExplicitCncEvidence(eligibleSources)
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
  let recommendedAction: IndustryReviewAction;
  if (!proposal.companyKey || targetIndustryClass === "unknown") {
    recommendedAction = "inspect";
  } else if (
    proposal.suggestedVerificationLevel === "rejected" ||
    targetIndustryClass === "non_industry"
  ) {
    recommendedAction = "reject";
  } else if (hasBlockingRisk || recommendedSourceIds.length === 0) {
    recommendedAction = "needs_more_evidence";
  } else {
    recommendedAction = "approve";
  }

  if (recommendedAction === "approve") {
    reasons.unshift(
      `Durable ${recommendedSourceIds.length === 1 ? "source" : "sources"} support the proposed ${targetIndustryClass} classification.`,
    );
  }
  if (reasons.length === 0) reasons.push("Open the evidence packet and inspect the proposed change.");

  const riskDecision: IndustryReviewRiskDecision = reviewAttestationDecision([
    ...riskFlags,
  ]);

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
    riskDecision,
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
    autoApprovable: isAutoApprovableProposal({
      proposal,
      recommendedAction,
      riskFlags: [...riskFlags],
      eligibleSources,
    }),
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
  const [sources, reviewContext, maintenance, recomputeRuns, research, identityCandidates] = await Promise.all([
    listIndustryEvidenceSources({ proposalId: proposal.proposalId }),
    proposal.companyKey
      ? getCompanyIndustryReviewContext(proposal.companyKey)
      : Promise.resolve<IndustryReviewContext>({ profile: null, revisions: [] }),
    loadMaintenanceContext(workspaceSlug),
    proposal.companyKey
      ? companyIndustryRecomputeService.list({
          workspaceSlug: workspaceSlug ?? "dev",
          companyKey: proposal.companyKey,
          limit: 10,
        })
      : Promise.resolve([] as CompanyIndustryRecomputeRun[]),
    getIndustryEvidenceResearchSummary({
      workspaceSlug: workspaceSlug ?? "dev",
      proposalId: proposal.proposalId,
    }),
    listIndustryIdentityCandidates(proposal.proposalId),
  ]);
  const { recommendation, dataset, warnings } = await buildRecommendationForProposal({
    proposal,
    sources,
    profile: reviewContext.profile,
    maintenance,
  });
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
    reviewContext,
    recomputeRuns,
    maintenance,
    research,
    identityCandidates,
  };
}

export async function getIndustryReviewRecommendation(
  proposalId: string,
  workspaceSlug?: string,
) {
  const packet = await getIndustryReviewPacket(proposalId, workspaceSlug);
  if (!packet) return null;
  return {
    success: true as const,
    ok: true as const,
    schemaVersion: INDUSTRY_REVIEW_SCHEMA_VERSION,
    operation: packet.operation,
    dataset: packet.dataset,
    recommendation: packet.recommendation,
    warnings: packet.warnings,
  };
}

export async function listIndustryReviewQueue(input: {
  status?: IndustryProposal["status"];
  limit?: number;
  workspaceSlug?: string;
  cursor?: string;
  riskFlag?: IndustryReviewRiskFlag;
  confidenceBand?: IndustryReviewConfidenceBand;
  recommendedAction?: IndustryReviewAction;
}): Promise<IndustryReviewQueueResponse> {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
  const maintenance = await loadMaintenanceContext(input.workspaceSlug);
  const maintenanceFingerprint = fingerprint(maintenance);
  const cacheKey = reviewIndexCacheKey(input);
  const cachedEntries = getCachedIndustryReviewIndex(
    cacheKey,
    maintenanceFingerprint,
  );

  let indexEntries: IndustryReviewIndexEntry[];
  let itemsByProposalId: Map<string, IndustryReviewQueueItem> | undefined;
  if (cachedEntries) {
    indexEntries = [...cachedEntries];
  } else {
    const [proposals, allSources, profiles] = await Promise.all([
      listIndustryProposals(input.status),
      listIndustryEvidenceSources(),
      listIndustryProfiles(),
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
      const { recommendation, dataset } = await buildRecommendationForProposal({
        proposal,
        sources,
        profile,
        maintenance,
      });
      return {
        proposal,
        recommendation,
        inputFingerprint: dataset.inputFingerprint,
        sourceCount: sources.length,
      };
    });
    itemsByProposalId = new Map(
      items.map((item) => [item.proposal.proposalId, item]),
    );
    indexEntries = items.map((item) => ({
      proposalId: item.proposal.proposalId,
      inputFingerprint: item.inputFingerprint,
      recommendedAction: item.recommendation.recommendedAction,
      confidenceBand: item.recommendation.confidenceBand,
      riskFlags: item.recommendation.riskFlags,
      priority: item.proposal.priority,
      updatedAt: item.proposal.updatedAt,
      sourceCount: item.sourceCount,
    }));
    setCachedIndustryReviewIndex(cacheKey, indexEntries, maintenanceFingerprint);
  }
  const page = paginateIndustryReviewIndex(indexEntries, {
    limit,
    cursor: input.cursor,
    riskFlag: input.riskFlag,
    confidenceBand: input.confidenceBand,
    recommendedAction: input.recommendedAction,
  });
  const itemByProposalId = itemsByProposalId ?? new Map(
    (await mapWithConcurrency(page.items, 8, async (entry) => {
      const proposal = await getIndustryProposal(entry.proposalId);
      if (!proposal || (input.status && proposal.status !== input.status)) return null;
      const sources = await listIndustryEvidenceSources({ proposalId: proposal.proposalId });
      const profile = proposal.companyKey
        ? await getIndustryProfile(proposal.companyKey)
        : null;
      const { recommendation, dataset } = await buildRecommendationForProposal({
        proposal,
        sources,
        profile,
        maintenance,
      });
      return {
        proposal,
        recommendation,
        inputFingerprint: dataset.inputFingerprint,
        sourceCount: sources.length,
      };
    })).filter((item): item is IndustryReviewQueueItem => item !== null)
      .map((item) => [item.proposal.proposalId, item]),
  );
  return {
    success: true,
    ok: true,
    schemaVersion: INDUSTRY_REVIEW_SCHEMA_VERSION,
    items: excludeAutoApprovableFromQueue(
      page.items
        .map((entry) => itemByProposalId.get(entry.proposalId))
        .filter((item): item is IndustryReviewQueueItem => item !== undefined),
    ),
    maintenance,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

/**
 * Lane A exclusion: auto-approvable proposals never appear in the human
 * review queue — the governed auto-verify-bot lane handles them with zero
 * manual actions. All other proposals flow through unchanged.
 */
export function excludeAutoApprovableFromQueue(
  items: IndustryReviewQueueItem[],
): IndustryReviewQueueItem[] {
  return items.filter((item) => item.recommendation.autoApprovable !== true);
}

function reviewIndexCacheKey(input: {
  status?: IndustryProposal["status"];
  workspaceSlug?: string;
}): string {
  return `${input.workspaceSlug ?? "default"}:${input.status ?? "all"}`;
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
