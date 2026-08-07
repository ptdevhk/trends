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
  companyKey = "acme-cnc",
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
    triggerReasons: ["corpus_evidence"],
    priority: 95,
    suggestedIndustryClass: "cnc",
    suggestedVerificationLevel: "verified",
    writeSecret: WRITE_SECRET,
  });
}

async function seedRegistrySource(
  t: ReturnType<typeof createTest>,
  sourceId: string,
  proposalId: string,
  overrides: Record<string, unknown> = {},
) {
  await t.mutation(api.companies.upsertIndustryEvidenceSource, {
    sourceId,
    proposalId,
    companyKey: "acme-cnc",
    url: "https://registry.example.com/company/acme-cnc",
    sourceType: "registry",
    trustTier: "corroborating",
    title: "CNC machining company registry record",
    evidenceExcerpt: "数控机床制造与精密加工",
    fetchStatus: "fetched",
    ...overrides,
    writeSecret: WRITE_SECRET,
  });
}

function autoApproveArgs(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "proposal-1",
    industryClass: "cnc" as const,
    approvedSourceIds: ["source-1"],
    evidenceSummary: "Registry evidence: CNC machining company.",
    decisionReason: "Governed Lane A auto-approval: structured registry evidence with explicit CNC text.",
    taxonomyVersion: "industry-v1",
    expectedInputFingerprint: "convex-test-fingerprint",
    writeSecret: WRITE_SECRET,
    ...overrides,
  };
}

describe("autoApproveIndustryProposal (governed Lane A)", () => {
  it("approves a proposal backed by a fetched, active, unreviewed registry source with explicit CNC text", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await seedRegistrySource(t, "source-1", "proposal-1");

    const result = await t.mutation(
      api.companies.autoApproveIndustryProposal,
      autoApproveArgs(),
    );
    expect(result).toMatchObject({
      proposalId: "proposal-1",
      companyKey: "acme-cnc",
      sourceCount: 1,
    });
    expect(result.revisionId).toMatch(/^auto-/);

    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId: "proposal-1",
      writeSecret: WRITE_SECRET,
    });
    expect(proposal).toMatchObject({
      status: "approved",
      approvedRevisionId: result.revisionId,
    });

    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revisionId: result.revisionId,
      reviewedBy: "auto-verify-bot",
      reviewerType: "auto-verify-bot",
      verificationLevel: "verified",
      industryClass: "cnc",
    });
  });

  it("rejects prose evidence (official_site) — Lane A is structured-only", async () => {
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

    await expect(
      t.mutation(api.companies.autoApproveIndustryProposal, autoApproveArgs()),
    ).rejects.toThrow("AUTO_VERIFY_LANE_A_REQUIRED");

    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId: "proposal-1",
      writeSecret: WRITE_SECRET,
    });
    expect(proposal?.status).not.toBe("approved");
  });

  it("rejects a registry source without explicit CNC text", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await seedRegistrySource(t, "source-1", "proposal-1", {
      title: "General trading company",
      evidenceExcerpt: "Import and export of consumer goods",
    });

    await expect(
      t.mutation(api.companies.autoApproveIndustryProposal, autoApproveArgs()),
    ).rejects.toThrow("AUTO_VERIFY_LANE_A_REQUIRED");
  });

  it("rejects a failed or disputed registry source", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await seedRegistrySource(t, "source-1", "proposal-1", {
      fetchStatus: "failed",
    });

    await expect(
      t.mutation(api.companies.autoApproveIndustryProposal, autoApproveArgs()),
    ).rejects.toThrow("AUTO_VERIFY_LANE_A_REQUIRED");
  });

  it("rejects a proposal without a canonical companyKey", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-1",
      normalizedEmployerSurface: "ACME CNC SDN BHD",
      triggerReasons: ["unknown_employer"],
      priority: 50,
      writeSecret: WRITE_SECRET,
    });

    await expect(
      t.mutation(api.companies.autoApproveIndustryProposal, autoApproveArgs()),
    ).rejects.toThrow("Proposal is missing a canonical company");
  });

  it("rejects an empty approvedSourceIds list", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");

    await expect(
      t.mutation(
        api.companies.autoApproveIndustryProposal,
        autoApproveArgs({ approvedSourceIds: [] }),
      ),
    ).rejects.toThrow("At least one approved evidence source is required");
  });

  it("is idempotent: re-approving the same proposal is a no-op with the same revisionId", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await seedRegistrySource(t, "source-1", "proposal-1");

    const first = await t.mutation(
      api.companies.autoApproveIndustryProposal,
      autoApproveArgs(),
    );
    const second = await t.mutation(
      api.companies.autoApproveIndustryProposal,
      autoApproveArgs(),
    );
    expect(second).toMatchObject({
      proposalId: "proposal-1",
      revisionId: first.revisionId,
      companyKey: "acme-cnc",
      idempotent: true,
    });

    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(revisions).toHaveLength(1);
  });

  it("records reviewerType=human on the attended approval path", async () => {
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await seedRegistrySource(t, "source-1", "proposal-1");

    await t.mutation(api.companies.approveIndustryProposal, {
      proposalId: "proposal-1",
      revisionId: "revision-human-1",
      verificationLevel: "verified",
      industryClass: "cnc",
      approvedSourceIds: ["source-1"],
      evidenceSummary: "Human review of registry evidence.",
      reviewer: "reviewer@example.com",
      decisionReason: "Attended review.",
      taxonomyVersion: "industry-v1",
      reviewAttestation: {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: "convex-test-fingerprint",
        decisionMode: "standard",
        acknowledgedRiskFlags: [],
        cncEvidenceAcknowledged: true,
        acknowledgementReason: "",
      },
      writeSecret: WRITE_SECRET,
    });

    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(revisions[0]).toMatchObject({
      revisionId: "revision-human-1",
      reviewedBy: "reviewer@example.com",
      reviewerType: "human",
    });
  });
});
