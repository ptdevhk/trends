import { describe, expect, it } from "vitest";

import {
  AUTO_VERIFY_SOURCE_TYPES,
  INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION,
  INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS,
  hasAutoApprovableEvidence,
  hasExplicitCncEvidence,
  isAutoApprovableSource,
  isExplicitCncEvidenceSource,
  reviewAttestationDecision,
  validateIndustryReviewAttestation,
  type IndustryReviewAttestation,
} from "./industry-review.js";

describe("industry review policy", () => {
  it("recognizes explicit CNC evidence only from fetched industrial sources", () => {
    expect(
      isExplicitCncEvidenceSource({
        sourceType: "official_site",
        trustTier: "primary",
        title: "CNC machining capabilities",
        evidenceExcerpt: "Precision machining and metalworking services.",
        fetchStatus: "fetched",
        sourceState: "active",
      }),
    ).toBe(true);
    expect(
      isExplicitCncEvidenceSource({
        sourceType: "search_result",
        trustTier: "discovery",
        title: "CNC machining",
        evidenceExcerpt: "Search result snippet",
        fetchStatus: "fetched",
        sourceState: "active",
      }),
    ).toBe(false);
    expect(
      hasExplicitCncEvidence([
        {
          sourceType: "directory",
          trustTier: "corroborating",
          title: "CNC machining",
          fetchStatus: "fetched",
          sourceState: "active",
        },
      ]),
    ).toBe(false);
  });

  it("requires every visible risk to be acknowledged before an elevated decision", () => {
    const riskFlags = ["low_source_diversity", "worker_unreachable"] as const;
    expect(reviewAttestationDecision(riskFlags)).toEqual({
      requiresAcknowledgement: true,
      nonOverridableRiskFlags: [],
      canApproveWithRiskOverride: true,
    });

    const attestation: IndustryReviewAttestation = {
      schemaVersion: INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION,
      inputFingerprint: "fingerprint-1",
      decisionMode: "risk_override",
      acknowledgedRiskFlags: [...riskFlags],
      cncEvidenceAcknowledged: false,
      acknowledgementReason: "The single primary source is sufficient for this attended review.",
    };
    expect(
      validateIndustryReviewAttestation({
        attestation,
        expectedInputFingerprint: "fingerprint-1",
        visibleRiskFlags: [...riskFlags],
        recommendedIndustryClass: "industrial",
      }),
    ).toEqual({ ok: true });
  });

  it("does not allow a hard CNC evidence risk to be bypassed by acknowledgement", () => {
    expect(INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS).toContain(
      "cnc_claim_inferred",
    );
    const attestation: IndustryReviewAttestation = {
      schemaVersion: INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION,
      inputFingerprint: "fingerprint-2",
      decisionMode: "risk_override",
      acknowledgedRiskFlags: ["cnc_claim_inferred"],
      cncEvidenceAcknowledged: true,
      acknowledgementReason: "Acknowledged for testing.",
    };
    expect(
      validateIndustryReviewAttestation({
        attestation,
        expectedInputFingerprint: "fingerprint-2",
        visibleRiskFlags: ["cnc_claim_inferred"],
        recommendedIndustryClass: "cnc",
      }),
    ).toEqual({
      ok: false,
      code: "INDUSTRY_REVIEW_CNC_EVIDENCE_REQUIRED",
    });
  });

  it("allows an attended reviewer to override weak_industry_signal with an explicit class", () => {
    expect(INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS).not.toContain(
      "weak_industry_signal",
    );
    expect(reviewAttestationDecision(["weak_industry_signal"])).toEqual({
      requiresAcknowledgement: true,
      nonOverridableRiskFlags: [],
      canApproveWithRiskOverride: true,
    });
    const attestation: IndustryReviewAttestation = {
      schemaVersion: INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION,
      inputFingerprint: "fingerprint-3",
      decisionMode: "risk_override",
      acknowledgedRiskFlags: ["weak_industry_signal"],
      cncEvidenceAcknowledged: false,
      acknowledgementReason:
        "Official site confirms a retail chain; classifying non_industry.",
    };
    expect(
      validateIndustryReviewAttestation({
        attestation,
        expectedInputFingerprint: "fingerprint-3",
        visibleRiskFlags: ["weak_industry_signal"],
        recommendedIndustryClass: "non_industry",
      }),
    ).toEqual({ ok: true });
  });

  it("keeps canonical mapping and source conflicts hard-blocked", () => {
    for (const flag of [
      "canonical_mapping_missing",
      "only_discovery_sources",
      "source_conflict",
      "stale_or_failed_source",
    ] as const) {
      expect(INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS).toContain(flag);
      expect(reviewAttestationDecision([flag])).toEqual({
        requiresAcknowledgement: true,
        nonOverridableRiskFlags: [flag],
        canApproveWithRiskOverride: false,
      });
    }
  });

  it("Lane A auto-verify accepts only structured registry/taxonomy sources with explicit CNC text", () => {
    expect(AUTO_VERIFY_SOURCE_TYPES).toEqual(
      new Set(["registry", "taxonomy"]),
    );
    expect(
      isAutoApprovableSource({
        sourceType: "registry",
        trustTier: "corroborating",
        title: "CNC machining company registry record",
        evidenceExcerpt: "数控机床制造",
        fetchStatus: "fetched",
        sourceState: "active",
        reviewStatus: "unreviewed",
      }),
    ).toBe(true);
    expect(
      isAutoApprovableSource({
        sourceType: "taxonomy",
        trustTier: "primary",
        title: "机床加工",
        evidenceExcerpt: "Precision machining",
        fetchStatus: "fetched",
        sourceState: "active",
      }),
    ).toBe(true);
  });

  it("Lane A rejects prose, discovery, failed, disputed, and non-CNC sources", () => {
    expect(
      isAutoApprovableSource({
        sourceType: "official_site",
        trustTier: "primary",
        title: "CNC machining",
        evidenceExcerpt: "We do CNC machining",
        fetchStatus: "fetched",
        sourceState: "active",
      }),
    ).toBe(false);
    expect(
      isAutoApprovableSource({
        sourceType: "registry",
        trustTier: "discovery",
        title: "CNC machining",
        evidenceExcerpt: "CNC machining",
        fetchStatus: "fetched",
        sourceState: "active",
      }),
    ).toBe(false);
    expect(
      isAutoApprovableSource({
        sourceType: "registry",
        trustTier: "corroborating",
        title: "CNC machining",
        evidenceExcerpt: "CNC machining",
        fetchStatus: "failed",
        sourceState: "active",
      }),
    ).toBe(false);
    expect(
      isAutoApprovableSource({
        sourceType: "registry",
        trustTier: "corroborating",
        title: "CNC machining",
        evidenceExcerpt: "CNC machining",
        fetchStatus: "fetched",
        sourceState: "disputed",
      }),
    ).toBe(false);
    expect(
      isAutoApprovableSource({
        sourceType: "registry",
        trustTier: "corroborating",
        title: "General trading company",
        evidenceExcerpt: "Import and export of consumer goods",
        fetchStatus: "fetched",
        sourceState: "active",
      }),
    ).toBe(false);
  });

  it("Lane A requires every selected source to be auto-approvable", () => {
    expect(
      hasAutoApprovableEvidence([
        {
          sourceType: "registry",
          trustTier: "corroborating",
          title: "CNC machining",
          evidenceExcerpt: "CNC machining",
          fetchStatus: "fetched",
          sourceState: "active",
        },
        {
          sourceType: "taxonomy",
          trustTier: "primary",
          title: "机床",
          evidenceExcerpt: "机床",
          fetchStatus: "fetched",
          sourceState: "active",
        },
      ]),
    ).toBe(true);
    expect(
      hasAutoApprovableEvidence([
        {
          sourceType: "registry",
          trustTier: "corroborating",
          title: "CNC machining",
          evidenceExcerpt: "CNC machining",
          fetchStatus: "fetched",
          sourceState: "active",
        },
        {
          sourceType: "official_site",
          trustTier: "primary",
          title: "CNC machining",
          evidenceExcerpt: "CNC machining",
          fetchStatus: "fetched",
          sourceState: "active",
        },
      ]),
    ).toBe(false);
    expect(hasAutoApprovableEvidence([])).toBe(false);
  });
});
