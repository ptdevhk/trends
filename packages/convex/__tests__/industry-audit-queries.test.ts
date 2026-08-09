import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../convex/_generated/api.js";
import { createTest } from "./test-helpers.js";

const WRITE_SECRET = "test-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
  } else {
    process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
  }
});

/**
 * Seed one open proposal per (distinct) company. upsertIndustryProposal
 * dedupes by companyKey + open status, so multi-revision fixtures need one
 * company per proposal.
 */
async function seedCompanyAndProposal(
  t: ReturnType<typeof createTest>,
  proposalId: string,
  companyKey: string,
) {
  await t.mutation(api.companies.upsert, {
    companyKey,
    displayName: "ACME CNC",
    status: "confirmed",
    writeSecret: WRITE_SECRET,
  });
  await t.mutation(api.companies.upsertIndustryProposal, {
    proposalId,
    companyKey,
    triggerReasons: ["unknown_employer"],
    priority: 50,
    writeSecret: WRITE_SECRET,
  });
  await t.mutation(api.companies.upsertIndustryEvidenceSource, {
    sourceId: `source-${proposalId}`,
    proposalId,
    companyKey,
    url: `https://acme.example.com/${proposalId}`,
    sourceType: "official_site",
    trustTier: "primary",
    fetchStatus: "fetched",
    writeSecret: WRITE_SECRET,
  });
}

function approvalArgs(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "proposal-1",
    revisionId: "revision-1",
    verificationLevel: "verified" as const,
    industryClass: "industrial" as const,
    approvedSourceIds: ["source-proposal-1"],
    evidenceSummary: "Evidence summary for the approval decision.",
    reviewer: "reviewer@example.com",
    decisionReason: "Reviewed against industry evidence policy.",
    taxonomyVersion: "industry-taxonomy-v1",
    reviewAttestation: {
      schemaVersion: "industry-review-attestation.v1" as const,
      inputFingerprint: "convex-test-fingerprint",
      decisionMode: "standard" as const,
      acknowledgedRiskFlags: [],
      cncEvidenceAcknowledged: true,
      acknowledgementReason: "",
    },
    writeSecret: WRITE_SECRET,
    ...overrides,
  };
}

describe("listIndustryVerdictRevisionsPage (C6 audit surface)", () => {
  it("lists verdict revisions newest-first with the full decision fields", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1", "acme-1");
    await seedCompanyAndProposal(t, "proposal-2", "acme-2");
    await t.mutation(
      api.companies.approveIndustryProposal,
      approvalArgs({
        reviewAttestation: {
          schemaVersion: "industry-review-attestation.v1",
          inputFingerprint: "fp-1",
          decisionMode: "standard",
          acknowledgedRiskFlags: [],
          cncEvidenceAcknowledged: true,
          acknowledgementReason: "",
          batchId: "batch-7",
        },
      }),
    );
    await t.mutation(
      api.companies.approveIndustryProposal,
      approvalArgs({
        proposalId: "proposal-2",
        revisionId: "revision-2",
        approvedSourceIds: ["source-proposal-2"],
        reviewAttestation: {
          schemaVersion: "industry-review-attestation.v1",
          inputFingerprint: "fp-2",
          decisionMode: "risk_override",
          acknowledgedRiskFlags: ["weak_industry_signal"],
          cncEvidenceAcknowledged: true,
          acknowledgementReason: "explicit override",
        },
      }),
    );

    const rows = await t.query(api.industry_verdicts.listIndustryVerdictRevisionsPage, {});

    expect(rows).toHaveLength(2);
    // Newest first (reviewedAt desc; ties break on revisionId).
    expect(rows[0].revisionId).toBe("revision-2");
    expect(rows[0].reviewedBy).toBe("reviewer@example.com");
    expect(rows[0].industryClass).toBe("industrial");
    expect(rows[0].reviewAttestation?.decisionMode).toBe("risk_override");
    expect(rows[0].reviewAttestation?.batchId).toBeUndefined();
    expect(rows[1].revisionId).toBe("revision-1");
    expect(rows[1].reviewAttestation?.batchId).toBe("batch-7");
  });

  it("filters by batchId", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1", "acme-1");
    await seedCompanyAndProposal(t, "proposal-2", "acme-2");
    await t.mutation(
      api.companies.approveIndustryProposal,
      approvalArgs({
        reviewAttestation: {
          schemaVersion: "industry-review-attestation.v1",
          inputFingerprint: "fp-1",
          decisionMode: "standard",
          acknowledgedRiskFlags: [],
          cncEvidenceAcknowledged: true,
          acknowledgementReason: "",
          batchId: "batch-7",
        },
      }),
    );
    await t.mutation(
      api.companies.approveIndustryProposal,
      approvalArgs({
        proposalId: "proposal-2",
        revisionId: "revision-2",
        approvedSourceIds: ["source-proposal-2"],
        reviewAttestation: {
          schemaVersion: "industry-review-attestation.v1",
          inputFingerprint: "fp-2",
          decisionMode: "standard",
          acknowledgedRiskFlags: [],
          cncEvidenceAcknowledged: true,
          acknowledgementReason: "",
          batchId: "batch-9",
        },
      }),
    );

    const batched = await t.query(api.industry_verdicts.listIndustryVerdictRevisionsPage, {
      batchId: "batch-9",
    });
    expect(batched).toHaveLength(1);
    expect(batched[0].revisionId).toBe("revision-2");
    expect(batched[0].reviewAttestation?.batchId).toBe("batch-9");

    const none = await t.query(api.industry_verdicts.listIndustryVerdictRevisionsPage, {
      batchId: "batch-does-not-exist",
    });
    expect(none).toHaveLength(0);
  });

  it("respects the limit argument", async () => {
    const t = createTest();
    for (let i = 1; i <= 3; i += 1) {
      await seedCompanyAndProposal(t, `proposal-${i}`, `acme-${i}`);
      await t.mutation(
        api.companies.approveIndustryProposal,
        approvalArgs({
          proposalId: `proposal-${i}`,
          revisionId: `revision-${i}`,
          approvedSourceIds: [`source-proposal-${i}`],
          evidenceSummary: "Summary.",
          reviewAttestation: {
            schemaVersion: "industry-review-attestation.v1",
            inputFingerprint: `fp-${i}`,
            decisionMode: "standard",
            acknowledgedRiskFlags: [],
            cncEvidenceAcknowledged: true,
            acknowledgementReason: "",
          },
        }),
      );
    }
    const rows = await t.query(api.industry_verdicts.listIndustryVerdictRevisionsPage, {
      limit: 2,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].revisionId).toBe("revision-3");
    expect(rows[1].revisionId).toBe("revision-2");
  });
});

describe("listIndustryIdentityResolutionAudits (C6 audit surface)", () => {
  async function seedResolutionAudit(
    t: ReturnType<typeof createTest>,
    proposalId: string,
    fingerprint: string,
    workspaceSlug = "hr",
  ) {
    await seedCompanyAndProposal(t, proposalId, `acme-${proposalId}`);
    // Provisional mapping creates a NEW company key, so the attached source
    // must start unattached (no companyKey) — the resolver rejects sources
    // already bound to a different company. A distinct sourceId keeps this
    // from colliding with the seeded proposal source.
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: `audit-source-${proposalId}`,
      proposalId,
      url: `https://acme.example.com/audit/${proposalId}`,
      sourceType: "official_site",
      trustTier: "primary",
      fetchStatus: "fetched",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryIdentityCandidate, {
      proposalId,
      candidateFingerprint: fingerprint,
      normalizedLegalName: `ACME CNC ${proposalId} Sdn. Bhd.`,
      jurisdiction: "MY",
      sourceIds: [`audit-source-${proposalId}`],
      confidence: 0.92,
      conflictCodes: [],
      extractionVersion: "test-v1",
      writeSecret: WRITE_SECRET,
    });
    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId,
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.resolveIndustryProposalIdentity, {
      writeSecret: WRITE_SECRET,
      workspaceSlug,
      actor: "hr-demo@example.com",
      proposalId,
      expectedProposalUpdatedAt: proposal?.updatedAt ?? 0,
      candidateFingerprint: fingerprint,
      mappingMode: "create_provisional",
      provisionalDisplayName: `ACME CNC ${proposalId} Sdn. Bhd.`,
      sourceIds: [`audit-source-${proposalId}`],
      reviewNote: "Identity mapping reviewed from the batch review lane.",
    });
  }

  it("lists identity-resolution audits for a workspace with actor/mode/target", async () => {
    const t = createTest();
    await seedResolutionAudit(t, "proposal-1", "fp-1");

    const rows = await t.query(api.industry_identity.listIndustryIdentityResolutionAudits, {
      workspaceSlug: "hr",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].proposalId).toBe("proposal-1");
    expect(rows[0].actor).toBe("hr-demo@example.com");
    expect(rows[0].mappingMode).toBe("create_provisional");
    expect(rows[0].targetCompanyKey).toBe("candidate-fp-1");
    expect(rows[0].sourceIds).toEqual(["audit-source-proposal-1"]);
    expect(rows[0].reviewNote).toContain("batch review lane");
    expect(rows[0].workspaceSlug).toBe("hr");
  });

  it("scopes by workspace and filters by proposalId", async () => {
    const t = createTest();
    await seedResolutionAudit(t, "proposal-1", "fp-1");
    await seedResolutionAudit(t, "proposal-2", "fp-2", "dev");

    const devRows = await t.query(api.industry_identity.listIndustryIdentityResolutionAudits, {
      workspaceSlug: "dev",
    });
    expect(devRows).toHaveLength(1);
    expect(devRows[0].proposalId).toBe("proposal-2");

    const hrFiltered = await t.query(api.industry_identity.listIndustryIdentityResolutionAudits, {
      workspaceSlug: "hr",
      proposalId: "proposal-1",
    });
    expect(hrFiltered).toHaveLength(1);
    expect(hrFiltered[0].proposalId).toBe("proposal-1");

    const hrOther = await t.query(api.industry_identity.listIndustryIdentityResolutionAudits, {
      workspaceSlug: "hr",
      proposalId: "proposal-missing",
    });
    expect(hrOther).toHaveLength(0);
  });

  it("orders newest-first and respects the limit", async () => {
    const t = createTest();
    for (let i = 1; i <= 3; i += 1) {
      await seedResolutionAudit(t, `proposal-${i}`, `fp-${i}`);
    }
    const rows = await t.query(api.industry_identity.listIndustryIdentityResolutionAudits, {
      workspaceSlug: "hr",
      limit: 2,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].proposalId).toBe("proposal-3");
    expect(rows[1].proposalId).toBe("proposal-2");
  });
});
