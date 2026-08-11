import { describe, expect, it } from "vitest";

import type {
  IndustryEvidenceSource,
  IndustryProposal,
} from "./company-industry-contracts.js";
import {
  excludeAutoApprovableFromQueue,
  industryReviewInternals,
} from "./company-industry-review-service.js";

function proposal(overrides: Partial<IndustryProposal> = {}): IndustryProposal {
  return {
    _id: "proposal-row",
    proposalId: "proposal-1",
    companyKey: "acme-cnc",
    triggerReasons: ["unknown_employer"],
    priority: 80,
    status: "ready_for_review",
    suggestedIndustryClass: "cnc",
    suggestedVerificationLevel: "verified",
    createdAt: 1,
    updatedAt: 10,
    ...overrides,
  };
}

function source(overrides: Partial<IndustryEvidenceSource> = {}): IndustryEvidenceSource {
  return {
    _id: "source-row",
    sourceId: "source-1",
    companyKey: "acme-cnc",
    proposalId: "proposal-1",
    url: "https://acme.example/products/cnc",
    sourceDomain: "acme.example",
    sourceType: "official_site",
    trustTier: "primary",
    title: "ACME CNC machine tools",
    evidenceExcerpt: "ACME manufactures CNC machine tools and machining centers.",
    fetchedAt: 20,
    lastSuccessfulFetchAt: 20,
    contentFingerprint: "fingerprint-1",
    fetchStatus: "fetched",
    suggestedIndustryClass: "cnc",
    workerConfidence: 0.95,
    reviewStatus: "unreviewed",
    sourceState: "active",
    createdAt: 1,
    updatedAt: 20,
    ...overrides,
  };
}

const noMaintenance = { latest: null, lastFailed: null };

describe("industry review recommendation rules", () => {
  it("recommends an explicit primary CNC source without auto-approving it", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [source()],
      profile: null,
      maintenance: noMaintenance,
    });
    expect(result.recommendation.recommendedAction).toBe("approve");
    expect(result.recommendation.confidenceBand).toBe("high");
    expect(result.recommendation.recommendedSourceIds).toEqual(["source-1"]);
    expect(result.recommendation.requiresHumanReview).toBe(true);
    expect(result.recommendation.riskFlags).toEqual([]);
    expect(result.dataset.sourceVersions).toEqual([
      { sourceId: "source-1", updatedAt: 20 },
    ]);
  });

  it("fails closed when only discovery/search-result evidence exists", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [
        source({
          sourceId: "search-1",
          sourceType: "search_result",
          trustTier: "discovery",
          fetchStatus: "fetched",
        }),
      ],
      profile: null,
      maintenance: noMaintenance,
    });

    expect(result.recommendation.recommendedAction).toBe("needs_more_evidence");
    expect(result.recommendation.recommendedSourceIds).toEqual([]);
    expect(result.recommendation.riskFlags).toEqual(
      expect.arrayContaining(["only_discovery_sources", "low_source_diversity"]),
    );
    expect(result.recommendation.sourceDecisions[0]).toMatchObject({
      approvalSafe: false,
      recommended: false,
    });
  });

  it("does not treat a keyword-only CNC directory hit as explicit CNC evidence", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [
        source({
          sourceType: "directory",
          trustTier: "corroborating",
          title: "ACME CNC directory listing",
          evidenceExcerpt: "CNC supplier directory keyword match.",
        }),
      ],
      profile: null,
      maintenance: noMaintenance,
    });

    expect(result.recommendation.recommendedAction).toBe("needs_more_evidence");
    expect(result.recommendation.riskFlags).toContain("cnc_claim_inferred");
    expect(result.recommendation.riskDecision.nonOverridableRiskFlags).toContain(
      "cnc_claim_inferred",
    );
  });

  it("does not label stale or failed sources approval-safe", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [source({ fetchStatus: "failed", sourceState: "unavailable" })],
      profile: null,
      maintenance: noMaintenance,
    });

    expect(result.recommendation.sourceDecisions[0]).toMatchObject({
      approvalSafe: false,
      recommended: false,
    });
    expect(result.recommendation.riskFlags).toContain("stale_or_failed_source");
  });

  it("does not hard-block on failed search-result sources", () => {
    // A bot-blocked junk search result never contributed evidence and is
    // excluded from approval either way; it must not hard-block a proposal
    // whose official sources fetched cleanly (observed on preview 2026-08-09
    // with 3M/Indeed/CTOS rows blocking otherwise clean approvals).
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [
        source(),
        source({
          _id: "source-row-junk",
          sourceId: "source-junk",
          url: "https://www.3m.com/",
          sourceDomain: "www.3m.com",
          sourceType: "search_result",
          trustTier: "discovery",
          fetchStatus: "failed",
          suggestedIndustryClass: undefined,
          workerConfidence: 0.2,
          title: "3M",
          evidenceExcerpt: "",
        }),
      ],
      profile: null,
      maintenance: noMaintenance,
    });

    expect(result.recommendation.riskFlags).not.toContain("stale_or_failed_source");
    expect(result.recommendation.recommendedAction).toBe("approve");
    expect(result.recommendation.recommendedSourceIds).toEqual(["source-1"]);
    const junkDecision = result.recommendation.sourceDecisions.find(
      (decision) => decision.sourceId === "source-junk",
    );
    expect(junkDecision).toMatchObject({
      approvalSafe: false,
      recommended: false,
    });
    expect(junkDecision?.reasonCodes).toContain("fetch_failed");
  });

  it("routes conflicting source classes to more evidence", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [
        source(),
        source({
          _id: "source-row-2",
          sourceId: "source-2",
          url: "https://acme.example/company",
          sourceType: "registry",
          trustTier: "authoritative",
          suggestedIndustryClass: "automation",
          title: "ACME automation registry",
          evidenceExcerpt: "ACME automation equipment registry entry.",
          updatedAt: 21,
        }),
      ],
      profile: null,
      maintenance: noMaintenance,
    });

    expect(result.recommendation.recommendedAction).toBe("needs_more_evidence");
    expect(result.recommendation.riskFlags).toContain("source_conflict");
    expect(result.recommendation.reasons).toContain(
      "Sources suggest conflicting industry classes.",
    );
  });

  it("shows worker-unreachable maintenance as a warning without changing truth", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [source()],
      profile: null,
      maintenance: {
        latest: null,
        lastFailed: {
          runId: "run-1",
          status: "failed",
          operatorSummary: "failed; worker unreachable.",
          counts: {
            proposalsResearched: 0,
            readyCreated: 0,
            sourcesDemoted: 0,
            freshnessChecked: 0,
            freshnessRefreshed: 0,
            errors: 1,
          },
        },
      },
    });

    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "worker_unreachable" }),
    ]);
    expect(result.recommendation.riskFlags).toContain("worker_unreachable");
    expect(result.recommendation.requiresHumanReview).toBe(true);
  });

  it("does not carry an older worker failure into a newer successful run", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [source()],
      profile: null,
      maintenance: {
        latest: {
          runId: "run-success",
          status: "completed",
          startedAt: 30,
          counts: {
            proposalsResearched: 1,
            readyCreated: 1,
            sourcesDemoted: 0,
            freshnessChecked: 0,
            freshnessRefreshed: 0,
            errors: 0,
          },
        },
        lastFailed: {
          runId: "run-old-fail",
          status: "failed",
          startedAt: 10,
          operatorSummary: "failed; worker unreachable.",
          counts: {
            proposalsResearched: 0,
            readyCreated: 0,
            sourcesDemoted: 0,
            freshnessChecked: 0,
            freshnessRefreshed: 0,
            errors: 1,
          },
        },
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.recommendation.riskFlags).not.toContain("worker_unreachable");
  });

  it("changes the packet fingerprint when evidence changes", () => {
    const first = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [source()],
      profile: null,
      maintenance: noMaintenance,
    });
    const second = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [source({ updatedAt: 21, contentFingerprint: "fingerprint-2" })],
      profile: null,
      maintenance: noMaintenance,
    });

    expect(second.dataset.inputFingerprint).not.toBe(first.dataset.inputFingerprint);
  });

  it("marks a structured registry-only proposal auto-approvable (Lane A)", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [
        source({
          sourceType: "registry",
          trustTier: "corroborating",
          title: "ACME CNC registry record",
          evidenceExcerpt: "数控机床制造与精密加工",
        }),
        source({
          _id: "source-row-2",
          sourceId: "source-2",
          url: "https://registry.example.com/company/acme-cnc-2",
          sourceType: "registry",
          trustTier: "corroborating",
          title: "ACME CNC second registry record",
          evidenceExcerpt: "CNC machining and metalworking",
          updatedAt: 21,
        }),
      ],
      profile: null,
      maintenance: noMaintenance,
    });
    expect(result.recommendation.recommendedAction).toBe("approve");
    expect(result.recommendation.riskFlags).toEqual([]);
    expect(result.recommendation.autoApprovable).toBe(true);
  });

  it("does not auto-approve prose evidence (official_site) even when high-confidence", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [source()],
      profile: null,
      maintenance: noMaintenance,
    });
    expect(result.recommendation.recommendedAction).toBe("approve");
    expect(result.recommendation.confidenceBand).toBe("high");
    expect(result.recommendation.autoApprovable).toBe(false);
  });

  it("does not auto-approve when any risk flag is present", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal(),
      sources: [
        source({
          sourceType: "registry",
          trustTier: "corroborating",
          title: "ACME CNC registry record",
          evidenceExcerpt: "数控机床制造与精密加工",
        }),
        source({
          _id: "source-row-2",
          sourceId: "source-2",
          url: "https://acme.example/company",
          sourceType: "registry",
          trustTier: "authoritative",
          suggestedIndustryClass: "automation",
          title: "ACME automation registry",
          evidenceExcerpt: "ACME automation equipment registry entry.",
          updatedAt: 21,
        }),
      ],
      profile: null,
      maintenance: noMaintenance,
    });
    expect(result.recommendation.riskFlags).toContain("source_conflict");
    expect(result.recommendation.autoApprovable).toBe(false);
  });

  it("does not auto-approve a proposal without a canonical companyKey", () => {
    const result = industryReviewInternals.buildRecommendation({
      proposal: proposal({ companyKey: undefined }),
      sources: [
        source({
          sourceType: "registry",
          trustTier: "corroborating",
          title: "ACME CNC registry record",
          evidenceExcerpt: "数控机床制造与精密加工",
        }),
      ],
      profile: null,
      maintenance: noMaintenance,
    });
    expect(result.recommendation.riskFlags).toContain("canonical_mapping_missing");
    expect(result.recommendation.autoApprovable).toBe(false);
  });
});

describe("excludeAutoApprovableFromQueue (Lane A queue exclusion)", () => {
  function queueItem(autoApprovable: boolean, proposalId = "proposal-1") {
    return {
      proposal: proposal({ proposalId }),
      recommendation: {
        proposalId,
        proposalStatus: "ready_for_review" as const,
        recommendedAction: "approve" as const,
        recommendedVerificationLevel: "verified" as const,
        recommendedIndustryClass: "cnc" as const,
        recommendedSourceIds: ["source-1"],
        sourceDecisions: [],
        confidenceBand: "high" as const,
        riskFlags: [],
        reasons: [],
        excludedSourceReasons: {},
        riskDecision: {
          requiresAcknowledgement: false,
          nonOverridableRiskFlags: [],
          canApproveWithRiskOverride: true,
        },
        evidenceSummaryDraft: "Registry evidence.",
        decisionReasonDraft: "Auto-approve.",
        requiresHumanReview: true as const,
        autoApprovable,
      },
      inputFingerprint: "fingerprint-1",
      sourceCount: 1,
    };
  }

  it("drops auto-approvable proposals from the human queue", () => {
    const items = [
      queueItem(true, "proposal-auto"),
      queueItem(false, "proposal-human"),
    ];
    const filtered = excludeAutoApprovableFromQueue(items);
    expect(filtered.map((item) => item.proposal.proposalId)).toEqual([
      "proposal-human",
    ]);
  });

  it("keeps all proposals when none are auto-approvable", () => {
    const items = [queueItem(false, "proposal-1"), queueItem(false, "proposal-2")];
    expect(excludeAutoApprovableFromQueue(items)).toHaveLength(2);
  });
});
