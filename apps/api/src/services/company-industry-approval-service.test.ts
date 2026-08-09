import { describe, expect, it } from "vitest";

import type { IndustryReviewPacket } from "./company-industry-review-service.js";
import {
  buildIndustryApprovalDecision,
  type BuildIndustryApprovalDecisionInput,
} from "./company-industry-approval-service.js";

function reviewPacket(overrides: Record<string, unknown> = {}): IndustryReviewPacket {
  const base: Record<string, unknown> = {
    proposal: {
      proposalId: "proposal-1",
      companyKey: "acme-cnc",
      status: "ready_for_review",
    },
    dataset: {
      inputFingerprint: "fingerprint-1",
      proposalUpdatedAt: 123,
      sourceVersions: [{ sourceId: "source-1", updatedAt: 7 }],
    },
    recommendation: {
      proposalStatus: "ready_for_review",
      recommendedIndustryClass: "industrial",
      recommendedSourceIds: ["source-1"],
      sourceDecisions: [
        { sourceId: "source-1", approvalSafe: true, recommended: true, reasonCodes: ["approval_safe"] },
        { sourceId: "source-2", approvalSafe: false, recommended: false, reasonCodes: ["search_result_not_approval_safe"] },
      ],
      riskFlags: [],
      evidenceSummaryDraft: "Official site confirms industrial equipment sales.",
      decisionReasonDraft: "Reviewed 1 approval-safe source(s); confirm the industrial classification and evidence summary.",
    },
    reviewContext: {
      profile: { currentRevisionId: "revision-current" },
    },
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      (key === "proposal" || key === "dataset" || key === "recommendation" || key === "reviewContext") &&
      typeof value === "object" && value !== null && !Array.isArray(value)
    ) {
      base[key] = { ...(base[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      base[key] = value;
    }
  }
  return base as unknown as IndustryReviewPacket;
}

function decisionFor(
  packet: IndustryReviewPacket,
  extra: Partial<BuildIndustryApprovalDecisionInput> = {},
) {
  return buildIndustryApprovalDecision({
    workspaceSlug: "hr",
    packet,
    ...extra,
  });
}

describe("buildIndustryApprovalDecision", () => {
  it("builds a server-constructed payload for a clean approval", () => {
    const decision = decisionFor(reviewPacket());
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.payload).toMatchObject({
      proposalId: "proposal-1",
      workspaceSlug: "hr",
      expectedCurrentRevisionId: "revision-current",
      expectedProposalUpdatedAt: 123,
      expectedInputFingerprint: "fingerprint-1",
      expectedSourceVersions: [{ sourceId: "source-1", updatedAt: 7 }],
      verificationLevel: "verified",
      industryClass: "industrial",
      approvedSourceIds: ["source-1"],
      taxonomyVersion: "industry-v1",
      evidenceSummary: "Official site confirms industrial equipment sales.",
    });
    expect(decision.payload.revisionId).toMatch(/^industry-acme-cnc-/);
    expect(decision.payload.reviewAttestation).toBeUndefined();
  });

  it("rejects proposals that are not ready for review", () => {
    const decision = decisionFor(reviewPacket({
      recommendation: { proposalStatus: "approved" },
    }));
    expect(decision).toEqual({
      ok: false,
      code: "INVALID_STATUS",
      error: expect.stringContaining("approved") as unknown as string,
    });
  });

  it("requires an explicit class when the recommendation has none", () => {
    const decision = decisionFor(reviewPacket({
      recommendation: { recommendedIndustryClass: "unknown" },
    }));
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("CLASS_REQUIRED");
  });

  it("accepts an attended non_industry override", () => {
    const decision = decisionFor(
      reviewPacket({ recommendation: { recommendedIndustryClass: "unknown" } }),
      { industryClass: "non_industry" },
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.payload.industryClass).toBe("non_industry");
  });

  it("fails when no approval-safe source exists", () => {
    const decision = decisionFor(reviewPacket({
      recommendation: {
        sourceDecisions: [
          { sourceId: "source-1", approvalSafe: false, recommended: true, reasonCodes: ["search_result_not_approval_safe"] },
        ],
      },
    }));
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("NO_SAFE_SOURCE");
  });

  it("keeps non-overridable flags hard-blocked", () => {
    const decision = decisionFor(reviewPacket({
      recommendation: { riskFlags: ["weak_industry_signal", "source_conflict"] },
    }), {
      industryClass: "industrial",
      attestation: {
        schemaVersion: "industry-review-attestation.v1",
        cncEvidenceAcknowledged: false,
        acknowledgementReason: "Reviewed the conflict.",
      },
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("INDUSTRY_REVIEW_HARD_RISK");
    expect(decision.error).toContain("source_conflict");
  });

  it("requires an attestation for flagged or cnc decisions", () => {
    expect(decisionFor(reviewPacket({
      recommendation: { riskFlags: ["weak_industry_signal"] },
    }), { industryClass: "non_industry" })).toEqual({
      ok: false,
      code: "INDUSTRY_REVIEW_ATTESTATION_REQUIRED",
      error: expect.any(String) as unknown as string,
    });
    expect(decisionFor(reviewPacket({}), { industryClass: "cnc" })).toEqual({
      ok: false,
      code: "INDUSTRY_REVIEW_ATTESTATION_REQUIRED",
      error: expect.any(String) as unknown as string,
    });
  });

  it("materializes a per-item attestation clone for an overridden weak signal", () => {
    const decision = decisionFor(reviewPacket({
      recommendation: {
        recommendedIndustryClass: "unknown",
        riskFlags: ["weak_industry_signal"],
        evidenceSummaryDraft: "",
        decisionReasonDraft: "Additional evidence or canonical-company review is required before changing verified truth.",
      },
    }), {
      industryClass: "non_industry",
      batchId: "industry-batch-test",
      batchNote: "Weekly bulk review",
      attestation: {
        schemaVersion: "industry-review-attestation.v1",
        cncEvidenceAcknowledged: false,
        acknowledgementReason: "Official site confirms a retail chain.",
      },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.payload.reviewAttestation).toEqual({
      schemaVersion: "industry-review-attestation.v1",
      inputFingerprint: "fingerprint-1",
      decisionMode: "risk_override",
      acknowledgedRiskFlags: ["weak_industry_signal"],
      cncEvidenceAcknowledged: false,
      acknowledgementReason: "Official site confirms a retail chain.",
      batchId: "industry-batch-test",
    });
    expect(decision.payload.decisionReason).toContain("industry-batch-test");
  });

  it("rejects a cnc decision without the explicit CNC acknowledgement", () => {
    const decision = decisionFor(reviewPacket({}), {
      industryClass: "cnc",
      attestation: {
        schemaVersion: "industry-review-attestation.v1",
        cncEvidenceAcknowledged: false,
        acknowledgementReason: "I reviewed the evidence.",
      },
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("INDUSTRY_REVIEW_CNC_ACK_REQUIRED");
  });

  it("accepts a cnc decision with the acknowledgement and records it", () => {
    const decision = decisionFor(reviewPacket({}), {
      industryClass: "cnc",
      attestation: {
        schemaVersion: "industry-review-attestation.v1",
        cncEvidenceAcknowledged: true,
        acknowledgementReason: "I reviewed the evidence.",
      },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.payload.reviewAttestation).toMatchObject({
      decisionMode: "standard",
      acknowledgedRiskFlags: [],
      cncEvidenceAcknowledged: true,
    });
  });

  it("fails an attestation that lacks the override reason", () => {
    const decision = decisionFor(reviewPacket({
      recommendation: { riskFlags: ["weak_industry_signal"] },
    }), {
      industryClass: "industrial",
      attestation: {
        schemaVersion: "industry-review-attestation.v1",
        cncEvidenceAcknowledged: false,
        acknowledgementReason: "",
      },
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("INDUSTRY_REVIEW_ATTESTATION_INVALID");
  });

  it("fails when the proposal lacks a canonical company", () => {
    const decision = decisionFor(reviewPacket({
      proposal: { proposalId: "proposal-1", companyKey: undefined },
    }));
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("INDUSTRY_REVIEW_HARD_RISK");
  });

  it("honors explicit evidence and decision overrides", () => {
    const decision = decisionFor(reviewPacket(), {
      evidenceSummary: "My summary.",
      decisionReason: "My reason.",
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.payload.evidenceSummary).toBe("My summary.");
    expect(decision.payload.decisionReason).toBe("My reason.");
  });
});
