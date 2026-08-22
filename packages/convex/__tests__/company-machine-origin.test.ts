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

async function seedCompany(
  t: ReturnType<typeof createTest>,
  companyKey: string,
  displayName: string,
) {
  await t.mutation(api.companies.upsert, {
    companyKey,
    displayName,
    status: "confirmed",
    writeSecret: WRITE_SECRET,
  });
}

async function seedProposalAndSource(
  t: ReturnType<typeof createTest>,
  input: {
    proposalId: string;
    companyKey: string;
    sourceId: string;
    currentRevisionId?: string;
  },
) {
  await t.mutation(api.companies.upsertIndustryProposal, {
    proposalId: input.proposalId,
    companyKey: input.companyKey,
    triggerReasons: ["material_source_change"],
    priority: 80,
    ...(input.currentRevisionId
      ? { currentRevisionId: input.currentRevisionId }
      : {}),
    writeSecret: WRITE_SECRET,
  });
  await t.mutation(api.companies.upsertIndustryEvidenceSource, {
    sourceId: input.sourceId,
    proposalId: input.proposalId,
    companyKey: input.companyKey,
    url: `https://${input.companyKey}.example.com/${input.sourceId}`,
    sourceType: "official_site",
    trustTier: "primary",
    title: `${input.companyKey} product evidence`,
    evidenceExcerpt: "Official CNC machining product evidence.",
    fetchStatus: "fetched",
    contentFingerprint: `sha256:${input.sourceId}`,
    writeSecret: WRITE_SECRET,
  });
}

async function approveProposal(
  t: ReturnType<typeof createTest>,
  input: {
    proposalId: string;
    companyKey: string;
    revisionId: string;
    sourceId: string;
    industryClass?: "cnc" | "automation" | "metrology" | "industrial" | "non_industry" | "unknown";
    machineOrigin?: "international" | "domestic" | "unknown";
    verificationLevel?: "verified" | "rejected";
    expectedCurrentRevisionId?: string;
  },
) {
  return t.mutation(api.companies.approveIndustryProposal, {
    proposalId: input.proposalId,
    revisionId: input.revisionId,
    ...(input.expectedCurrentRevisionId
      ? { expectedCurrentRevisionId: input.expectedCurrentRevisionId }
      : {}),
    verificationLevel: input.verificationLevel ?? "verified",
    industryClass: input.industryClass ?? "cnc",
    ...(input.machineOrigin !== undefined ? { machineOrigin: input.machineOrigin } : {}),
    approvedSourceIds: [input.sourceId],
    evidenceSummary: `Evidence summary for ${input.revisionId}.`,
    reviewer: "admin@example.com",
    decisionReason: `Reviewed ${input.revisionId}.`,
    taxonomyVersion: "industry-taxonomy-v1",
    reviewAttestation: {
      schemaVersion: "industry-review-attestation.v1" as const,
      inputFingerprint: "test-fingerprint",
      decisionMode: "standard" as const,
      acknowledgedRiskFlags: [],
      cncEvidenceAcknowledged: true,
      acknowledgementReason: "",
    },
    writeSecret: WRITE_SECRET,
  });
}

describe("listVerifiedCompanyProfiles & machineOrigin", () => {
  it("listVerifiedCompanyProfiles returns only verified and machineOrigin !== unknown", async () => {
    const t = createTest();
    await seedCompany(t, "fanuc-corp", "Fanuc Corporation");
    await seedCompany(t, "gmt-cnc", "Guangdong GMT");
    await seedCompany(t, "unknown-cnc", "Unknown Origin CNC");
    await seedCompany(t, "rejected-cnc", "Rejected CNC");

    // 1. Fanuc: verified + international
    await seedProposalAndSource(t, {
      proposalId: "prop-fanuc",
      companyKey: "fanuc-corp",
      sourceId: "src-fanuc",
    });
    await approveProposal(t, {
      proposalId: "prop-fanuc",
      companyKey: "fanuc-corp",
      revisionId: "rev-fanuc",
      sourceId: "src-fanuc",
      industryClass: "cnc",
      machineOrigin: "international",
    });

    // 2. GMT: verified + domestic
    await seedProposalAndSource(t, {
      proposalId: "prop-gmt",
      companyKey: "gmt-cnc",
      sourceId: "src-gmt",
    });
    await approveProposal(t, {
      proposalId: "prop-gmt",
      companyKey: "gmt-cnc",
      revisionId: "rev-gmt",
      sourceId: "src-gmt",
      industryClass: "cnc",
      machineOrigin: "domestic",
    });

    // 3. Unknown origin CNC: verified + machineOrigin unknown (default or explicit)
    await seedProposalAndSource(t, {
      proposalId: "prop-unknown",
      companyKey: "unknown-cnc",
      sourceId: "src-unknown",
    });
    await approveProposal(t, {
      proposalId: "prop-unknown",
      companyKey: "unknown-cnc",
      revisionId: "rev-unknown",
      sourceId: "src-unknown",
      industryClass: "cnc",
      machineOrigin: "unknown",
    });

    // 4. Rejected CNC: rejected + international
    await seedProposalAndSource(t, {
      proposalId: "prop-rejected",
      companyKey: "rejected-cnc",
      sourceId: "src-rejected",
    });
    await approveProposal(t, {
      proposalId: "prop-rejected",
      companyKey: "rejected-cnc",
      revisionId: "rev-rejected",
      sourceId: "src-rejected",
      industryClass: "cnc",
      machineOrigin: "international",
      verificationLevel: "rejected",
    });

    // Query with all keys + non-existent key
    const results = await t.query(api.companies.listVerifiedCompanyProfiles, {
      keys: [
        "fanuc-corp",
        "gmt-cnc",
        "unknown-cnc",
        "rejected-cnc",
        "non-existent-key",
      ],
      writeSecret: WRITE_SECRET,
    });

    expect(results).toHaveLength(2);
    expect(results).toEqual([
      {
        companyKey: "fanuc-corp",
        machineOrigin: "international",
        industryClass: "cnc",
        updatedAt: expect.any(Number),
      },
      {
        companyKey: "gmt-cnc",
        machineOrigin: "domestic",
        industryClass: "cnc",
        updatedAt: expect.any(Number),
      },
    ]);
  });

  it("handles key cap and empty keys gracefully without error", async () => {
    const t = createTest();
    await seedCompany(t, "fanuc-corp", "Fanuc Corporation");
    await seedProposalAndSource(t, {
      proposalId: "prop-fanuc",
      companyKey: "fanuc-corp",
      sourceId: "src-fanuc",
    });
    await approveProposal(t, {
      proposalId: "prop-fanuc",
      companyKey: "fanuc-corp",
      revisionId: "rev-fanuc",
      sourceId: "src-fanuc",
      machineOrigin: "international",
    });

    const emptyResults = await t.query(api.companies.listVerifiedCompanyProfiles, {
      keys: [],
      writeSecret: WRITE_SECRET,
    });
    expect(emptyResults).toEqual([]);

    const manyKeys = Array.from({ length: 250 }, (_, i) => `key-${i}`);
    manyKeys.unshift("fanuc-corp");
    const cappedResults = await t.query(api.companies.listVerifiedCompanyProfiles, {
      keys: manyKeys,
      writeSecret: WRITE_SECRET,
    });
    expect(cappedResults).toHaveLength(1);
    expect(cappedResults[0].companyKey).toBe("fanuc-corp");
  });

  it("listIndustryProfiles includes machineOrigin in returned documents", async () => {
    const t = createTest();
    await seedCompany(t, "fanuc-corp", "Fanuc Corporation");
    await seedProposalAndSource(t, {
      proposalId: "prop-fanuc",
      companyKey: "fanuc-corp",
      sourceId: "src-fanuc",
    });
    await approveProposal(t, {
      proposalId: "prop-fanuc",
      companyKey: "fanuc-corp",
      revisionId: "rev-fanuc",
      sourceId: "src-fanuc",
      machineOrigin: "international",
    });

    const profiles = await t.query(api.companies.listIndustryProfiles, {
      writeSecret: WRITE_SECRET,
    });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].companyKey).toBe("fanuc-corp");
    expect(profiles[0].machineOrigin).toBe("international");
  });

  it("approve with machineOrigin writes to profile and revision, and undo restores prior machineOrigin", async () => {
    const t = createTest();
    await seedCompany(t, "fanuc-corp", "Fanuc Corporation");

    // First approval: domestic
    await seedProposalAndSource(t, {
      proposalId: "prop-1",
      companyKey: "fanuc-corp",
      sourceId: "src-1",
    });
    await approveProposal(t, {
      proposalId: "prop-1",
      companyKey: "fanuc-corp",
      revisionId: "rev-1",
      sourceId: "src-1",
      machineOrigin: "domestic",
    });

    let profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "fanuc-corp",
      writeSecret: WRITE_SECRET,
    });
    expect(profile?.machineOrigin).toBe("domestic");

    let revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "fanuc-corp",
      writeSecret: WRITE_SECRET,
    });
    expect(revisions[0].machineOrigin).toBe("domestic");

    // Second approval: international
    await seedProposalAndSource(t, {
      proposalId: "prop-2",
      companyKey: "fanuc-corp",
      sourceId: "src-2",
      currentRevisionId: "rev-1",
    });
    await approveProposal(t, {
      proposalId: "prop-2",
      companyKey: "fanuc-corp",
      revisionId: "rev-2",
      sourceId: "src-2",
      machineOrigin: "international",
      expectedCurrentRevisionId: "rev-1",
    });

    profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "fanuc-corp",
      writeSecret: WRITE_SECRET,
    });
    expect(profile?.machineOrigin).toBe("international");

    revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "fanuc-corp",
      writeSecret: WRITE_SECRET,
    });
    expect(revisions[0].revisionId).toBe("rev-2");
    expect(revisions[0].machineOrigin).toBe("international");

    // Undo second approval: should restore rev-1 machineOrigin ("domestic")
    const undoResult = await t.mutation(api.companies.undoIndustryProposalApproval, {
      proposalId: "prop-2",
      approvedRevisionId: "rev-2",
      expectedCurrentRevisionId: "rev-2",
      reviewer: "admin@example.com",
      writeSecret: WRITE_SECRET,
    });
    expect(undoResult.restoredRevisionId).toBe("rev-1");

    profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "fanuc-corp",
      writeSecret: WRITE_SECRET,
    });
    expect(profile?.machineOrigin).toBe("domestic");
    expect(profile?.currentRevisionId).toBe("undo-rev-2");

    revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "fanuc-corp",
      writeSecret: WRITE_SECRET,
    });
    const undoRevision = revisions.find((r) => r.revisionId === "undo-rev-2");
    expect(undoRevision?.machineOrigin).toBe("domestic");
  });
});
