import { describe, expect, it } from "vitest";

import {
  parseIndustryProposal,
  parseIndustryVerdictRevision,
} from "./company-industry-contracts.js";

const revision = {
  _id: "revision-row",
  revisionId: "revision-1",
  companyKey: "acme-cnc",
  industryClass: "cnc",
  verificationLevel: "verified",
  approvedSourceIds: ["source-1"],
  evidenceSummary: "Official CNC product catalog.",
  reviewedBy: "reviewer@example.com",
  reviewedAt: 10,
  decisionReason: "Reviewed the official catalog.",
  taxonomyVersion: "industry-v1",
  createdAt: 10,
  proposalId: "proposal-1",
};

describe("industry proposal contract", () => {
  it("parses proposals triggered by corpus evidence (curate/promote scripts)", () => {
    const proposal = {
      _id: "proposal-row",
      proposalId: "curated-my-acme-cnc",
      companyKey: "acme-cnc",
      status: "approved",
      priority: 100,
      triggerReasons: ["corpus_evidence"],
      createdAt: 10,
      updatedAt: 11,
    };
    const parsed = parseIndustryProposal(proposal);
    expect(parsed).not.toBeNull();
    expect(parsed?.companyKey).toBe("acme-cnc");
  });
});

describe("industry verdict revision contract", () => {
  it("preserves a standard explicit-CNC attestation with an empty risk reason", () => {
    const parsed = parseIndustryVerdictRevision({
      ...revision,
      reviewAttestation: {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: "fingerprint-1",
        decisionMode: "standard",
        acknowledgedRiskFlags: [],
        cncEvidenceAcknowledged: true,
        acknowledgementReason: "",
      },
    });

    expect(parsed?.reviewAttestation).toMatchObject({
      decisionMode: "standard",
      cncEvidenceAcknowledged: true,
      acknowledgementReason: "",
    });
  });

  it("rejects a risk override without a detailed acknowledgement reason", () => {
    const parsed = parseIndustryVerdictRevision({
      ...revision,
      reviewAttestation: {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: "fingerprint-1",
        decisionMode: "risk_override",
        acknowledgedRiskFlags: ["low_source_diversity"],
        cncEvidenceAcknowledged: false,
        acknowledgementReason: "",
      },
    });

    expect(parsed?.reviewAttestation).toBeUndefined();
  });
});
