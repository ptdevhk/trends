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
});
