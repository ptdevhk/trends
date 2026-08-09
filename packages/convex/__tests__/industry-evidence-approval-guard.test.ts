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

async function seedCompanyAndProposal(
  t: ReturnType<typeof createTest>,
  proposalId: string,
) {
  await t.mutation(api.companies.upsert, {
    companyKey: "acme-cnc",
    displayName: "ACME CNC",
    status: "confirmed",
    writeSecret: WRITE_SECRET,
  });
  await t.mutation(api.companies.upsertIndustryProposal, {
    proposalId,
    companyKey: "acme-cnc",
    triggerReasons: ["unknown_employer"],
    priority: 50,
    writeSecret: WRITE_SECRET,
  });
}

function approvalArgs(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "proposal-1",
    revisionId: "revision-1",
    verificationLevel: "verified" as const,
    industryClass: "cnc" as const,
    approvedSourceIds: ["source-1"],
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

describe("approveIndustryProposal evidence-source guard", () => {
  it("rejects approval when the only evidence source is search_result/discovery tier", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-1",
      proposalId: "proposal-1",
      companyKey: "acme-cnc",
      url: "https://search.example.com/results?q=acme+cnc",
      sourceType: "search_result",
      trustTier: "discovery",
      fetchStatus: "fetched",
      writeSecret: WRITE_SECRET,
    });

    await expect(
      t.mutation(api.companies.approveIndustryProposal, approvalArgs()),
    ).rejects.toThrow("Evidence source is not approval-safe: source-1");

    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId: "proposal-1",
      writeSecret: WRITE_SECRET,
    });
    expect(proposal?.status).not.toBe("approved");
  });

  it("rejects approval with an empty approvedSourceIds list", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");

    await expect(
      t.mutation(
        api.companies.approveIndustryProposal,
        approvalArgs({ approvedSourceIds: [] }),
      ),
    ).rejects.toThrow("At least one approved evidence source is required");
  });

  it("approves a proposal backed by one approval-safe official_site/primary source", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-1",
      proposalId: "proposal-1",
      companyKey: "acme-cnc",
      url: "https://acme.example.com/products",
      sourceType: "official_site",
      trustTier: "primary",
      title: "CNC machine tools",
      evidenceExcerpt: "Official CNC machining product catalog.",
      fetchStatus: "fetched",
      writeSecret: WRITE_SECRET,
    });

    const result = await t.mutation(
      api.companies.approveIndustryProposal,
      approvalArgs(),
    );
    expect(result).toMatchObject({
      proposalId: "proposal-1",
      revisionId: "revision-1",
      companyKey: "acme-cnc",
      sourceCount: 1,
    });

    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId: "proposal-1",
      writeSecret: WRITE_SECRET,
    });
    expect(proposal).toMatchObject({
      status: "approved",
      approvedRevisionId: "revision-1",
    });
  });

  it("persists a batch attestation (batchId) on the immutable revision", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-1",
      proposalId: "proposal-1",
      companyKey: "acme-cnc",
      url: "https://acme.example.com/products",
      sourceType: "official_site",
      trustTier: "primary",
      title: "CNC machine tools",
      evidenceExcerpt: "Official CNC machining product catalog.",
      fetchStatus: "fetched",
      writeSecret: WRITE_SECRET,
    });

    await t.mutation(
      api.companies.approveIndustryProposal,
      approvalArgs({
        reviewAttestation: {
          schemaVersion: "industry-review-attestation.v1" as const,
          inputFingerprint: "convex-test-fingerprint",
          decisionMode: "risk_override" as const,
          acknowledgedRiskFlags: ["weak_industry_signal"],
          cncEvidenceAcknowledged: true,
          acknowledgementReason: "Batch approval reviewed by an attended reviewer.",
          batchId: "industry-batch-test-1234",
        },
      }),
    );

    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].reviewAttestation).toMatchObject({
      batchId: "industry-batch-test-1234",
      decisionMode: "risk_override",
      acknowledgedRiskFlags: ["weak_industry_signal"],
    });
  });
});

describe("listVerifiedIndustryEmployerAliases", () => {
  async function approveVerifiedCnc(t: ReturnType<typeof createTest>) {
    await seedCompanyAndProposal(t, "proposal-1");
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-1",
      proposalId: "proposal-1",
      companyKey: "acme-cnc",
      url: "https://acme.example.com/products",
      sourceType: "official_site",
      trustTier: "primary",
      title: "CNC machine tools",
      evidenceExcerpt: "Official CNC machining product catalog.",
      fetchStatus: "fetched",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.approveIndustryProposal, approvalArgs());
  }

  it("returns verified employers with display name and sorted aliases", async () => {
    const t = createTest();
    await approveVerifiedCnc(t);
    await t.mutation(api.companies.addAlias, {
      companyKey: "acme-cnc",
      alias: "ACME Machine Tools",
      source: "operator",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.addAlias, {
      companyKey: "acme-cnc",
      alias: "ACME CNC Malaysia",
      source: "operator",
      writeSecret: WRITE_SECRET,
    });

    const rows = await t.query(
      api.companies.listVerifiedIndustryEmployerAliases,
      { writeSecret: WRITE_SECRET },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyKey: "acme-cnc",
      industryClass: "cnc",
      displayName: "ACME CNC",
      aliases: ["ACME CNC Malaysia", "ACME Machine Tools"],
    });
  });

  it("excludes employers whose current verdict is rejected", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-1",
      proposalId: "proposal-1",
      companyKey: "acme-cnc",
      url: "https://acme.example.com/products",
      sourceType: "official_site",
      trustTier: "primary",
      title: "CNC machine tools",
      evidenceExcerpt: "Official CNC machining product catalog.",
      fetchStatus: "fetched",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.approveIndustryProposal, approvalArgs());

    // Superseding rejection flips the profile to rejected. Source is still
    // attached to proposal-1, so approve proposal-2 without source ids is not
    // allowed — instead reference a fresh source attached to proposal-2.
    await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-2",
      companyKey: "acme-cnc",
      triggerReasons: ["evidence_conflict"],
      priority: 90,
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-2",
      proposalId: "proposal-2",
      companyKey: "acme-cnc",
      url: "https://acme.example.com/notice",
      sourceType: "official_site",
      trustTier: "primary",
      title: "Industrial notice",
      evidenceExcerpt: "Official industrial company notice.",
      fetchStatus: "fetched",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(
      api.companies.approveIndustryProposal,
      approvalArgs({
        proposalId: "proposal-2",
        revisionId: "revision-2",
        verificationLevel: "rejected",
        industryClass: "unknown",
        approvedSourceIds: ["source-2"],
      }),
    );

    const rows = await t.query(
      api.companies.listVerifiedIndustryEmployerAliases,
      { writeSecret: WRITE_SECRET },
    );
    expect(rows).toHaveLength(0);
  });

  it("skips verified profiles without a canonical company row", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsertIndustryProfile, {
      companyKey: "orphan-co",
      industryClass: "cnc",
      verificationLevel: "verified",
      evidenceSource: "manual",
      writeSecret: WRITE_SECRET,
    });

    const rows = await t.query(
      api.companies.listVerifiedIndustryEmployerAliases,
      { writeSecret: WRITE_SECRET },
    );
    expect(rows).toHaveLength(0);
  });
});
