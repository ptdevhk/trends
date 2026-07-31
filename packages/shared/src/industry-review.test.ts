import { describe, expect, it } from "vitest";

import {
  INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION,
  INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS,
  hasExplicitCncEvidence,
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
});
