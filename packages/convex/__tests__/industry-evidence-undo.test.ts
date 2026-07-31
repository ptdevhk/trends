import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../convex/_generated/api.js";
import { createTest } from "./test-helpers.js";

const WRITE_SECRET = "test-secret";
const COMPANY_KEY = "acme-industrial";

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

async function seedCompany(t: ReturnType<typeof createTest>) {
  await t.mutation(api.companies.upsert, {
    companyKey: COMPANY_KEY,
    displayName: "ACME Industrial",
    status: "confirmed",
    writeSecret: WRITE_SECRET,
  });
}

async function seedProposal(
  t: ReturnType<typeof createTest>,
  input: { proposalId: string; sourceId: string; currentRevisionId?: string },
) {
  await t.mutation(api.companies.upsertIndustryProposal, {
    proposalId: input.proposalId,
    companyKey: COMPANY_KEY,
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
    companyKey: COMPANY_KEY,
    url: `https://acme.example.com/${input.sourceId}`,
    sourceType: "official_site",
    trustTier: "primary",
    title: "ACME industrial product evidence",
    evidenceExcerpt: "Industrial automation and machinery product evidence.",
    fetchStatus: "fetched",
    contentFingerprint: `sha256:${input.sourceId}`,
    writeSecret: WRITE_SECRET,
  });
}

async function approveProposal(
  t: ReturnType<typeof createTest>,
  input: {
    proposalId: string;
    revisionId: string;
    sourceId: string;
    expectedCurrentRevisionId?: string;
  },
) {
  return t.mutation(api.companies.approveIndustryProposal, {
    proposalId: input.proposalId,
    revisionId: input.revisionId,
    ...(input.expectedCurrentRevisionId
      ? { expectedCurrentRevisionId: input.expectedCurrentRevisionId }
      : {}),
    verificationLevel: "verified",
    industryClass: "industrial",
    approvedSourceIds: [input.sourceId],
    evidenceSummary: `Evidence summary for ${input.revisionId}.`,
    reviewer: "admin@example.com",
    decisionReason: `Reviewed ${input.revisionId}.`,
    taxonomyVersion: "industry-taxonomy-v1",
    writeSecret: WRITE_SECRET,
  });
}

async function markRunSourceDone(
  t: ReturnType<typeof createTest>,
  runId: string,
) {
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("company_industry_recompute_runs")
      .withIndex("by_run_id", (q) => q.eq("runId", runId))
      .collect();
    const run = rows[0];
    if (!run) throw new Error(`Missing test recompute run: ${runId}`);
    await ctx.db.patch(run._id, { sourceDone: true });
  });
}

describe("undoIndustryProposalApproval", () => {
  it("restores the previous revision, supersedes an active run, and is idempotent", async () => {
    const t = createTest();
    await seedCompany(t);

    await seedProposal(t, {
      proposalId: "proposal-before",
      sourceId: "source-before",
    });
    await approveProposal(t, {
      proposalId: "proposal-before",
      revisionId: "revision-before",
      sourceId: "source-before",
    });

    await seedProposal(t, {
      proposalId: "proposal-approved",
      sourceId: "source-approved",
      currentRevisionId: "revision-before",
    });
    await approveProposal(t, {
      proposalId: "proposal-approved",
      revisionId: "revision-approved",
      sourceId: "source-approved",
      expectedCurrentRevisionId: "revision-before",
    });

    await t.mutation(api.companies.startIndustryRecomputeRun, {
      runId: "run-approved",
      workspaceSlug: "hr",
      companyKey: COMPANY_KEY,
      targetRevisionId: "revision-approved",
      proposalId: "proposal-approved",
      requestedBy: "admin@example.com",
      writeSecret: WRITE_SECRET,
    });

    const result = await t.mutation(api.companies.undoIndustryProposalApproval, {
      proposalId: "proposal-approved",
      approvedRevisionId: "revision-approved",
      expectedCurrentRevisionId: "revision-approved",
      recomputeRunId: "run-approved",
      reviewer: "admin@example.com",
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({
      proposalId: "proposal-approved",
      companyKey: COMPANY_KEY,
      reversalRevisionId: "undo-revision-approved",
      restoredRevisionId: "revision-before",
      previousRunId: "run-approved",
      previousRunStatus: "queued",
      replacementRecomputeRequired: false,
      idempotent: false,
    });

    const profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: COMPANY_KEY,
      writeSecret: WRITE_SECRET,
    });
    expect(profile).toMatchObject({
      companyKey: COMPANY_KEY,
      industryClass: "industrial",
      verificationLevel: "verified",
      currentRevisionId: "undo-revision-approved",
      sourceCount: 1,
    });

    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId: "proposal-approved",
      writeSecret: WRITE_SECRET,
    });
    expect(proposal).toMatchObject({
      status: "ready_for_review",
    });
    expect(proposal?.approvedRevisionId).toBeUndefined();
    expect(proposal?.applicationState).toBeUndefined();
    expect(proposal?.appliedRevisionId).toBeUndefined();
    expect(proposal?.appliedAt).toBeUndefined();

    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: COMPANY_KEY,
      writeSecret: WRITE_SECRET,
    });
    const reversal = revisions.find(
      (revision) => revision.revisionId === "undo-revision-approved",
    );
    expect(reversal).toMatchObject({
      industryClass: "industrial",
      verificationLevel: "verified",
      approvedSourceIds: ["source-before"],
      evidenceSummary: "Evidence summary for revision-before.",
      supersedesRevisionId: "revision-approved",
      proposalId: "proposal-approved",
      reviewedBy: "admin@example.com",
    });

    const run = await t.query(api.companies.getIndustryRecomputeRun, {
      runId: "run-approved",
      writeSecret: WRITE_SECRET,
    });
    expect(run).toMatchObject({
      status: "superseded",
      supersededByRevisionId: "undo-revision-approved",
    });

    const repeated = await t.mutation(api.companies.undoIndustryProposalApproval, {
      proposalId: "proposal-approved",
      approvedRevisionId: "revision-approved",
      expectedCurrentRevisionId: "revision-approved",
      recomputeRunId: "run-approved",
      reviewer: "admin@example.com",
      writeSecret: WRITE_SECRET,
    });
    expect(repeated).toMatchObject({
      proposalId: "proposal-approved",
      companyKey: COMPANY_KEY,
      reversalRevisionId: "undo-revision-approved",
      restoredRevisionId: "revision-before",
      previousRunId: "run-approved",
      previousRunStatus: "superseded",
      replacementRecomputeRequired: false,
      idempotent: true,
    });

    const revisionsAfterRepeat = await t.query(
      api.companies.listIndustryVerdictRevisions,
      {
        companyKey: COMPANY_KEY,
        writeSecret: WRITE_SECRET,
      },
    );
    expect(
      revisionsAfterRepeat.filter(
        (revision) => revision.revisionId === "undo-revision-approved",
      ),
    ).toHaveLength(1);
  });

  it("restores a concrete rejected/unknown no-truth marker for the first approval", async () => {
    const t = createTest();
    await seedCompany(t);
    await seedProposal(t, {
      proposalId: "proposal-first",
      sourceId: "source-first",
    });
    await approveProposal(t, {
      proposalId: "proposal-first",
      revisionId: "revision-first",
      sourceId: "source-first",
    });

    const result = await t.mutation(api.companies.undoIndustryProposalApproval, {
      proposalId: "proposal-first",
      approvedRevisionId: "revision-first",
      expectedCurrentRevisionId: "revision-first",
      reviewer: "admin@example.com",
      writeSecret: WRITE_SECRET,
    });

    expect(result.restoredRevisionId).toBeUndefined();
    const profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: COMPANY_KEY,
      writeSecret: WRITE_SECRET,
    });
    expect(profile).toMatchObject({
      industryClass: "unknown",
      verificationLevel: "rejected",
      currentRevisionId: "undo-revision-first",
      sourceCount: 0,
    });

    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: COMPANY_KEY,
      writeSecret: WRITE_SECRET,
    });
    expect(revisions[0]).toMatchObject({
      revisionId: "undo-revision-first",
      industryClass: "unknown",
      verificationLevel: "rejected",
      approvedSourceIds: [],
      supersedesRevisionId: "revision-first",
    });
  });

  it("fails closed when the approved revision is no longer current", async () => {
    const t = createTest();
    await seedCompany(t);
    await seedProposal(t, {
      proposalId: "proposal-stale",
      sourceId: "source-stale",
    });
    await approveProposal(t, {
      proposalId: "proposal-stale",
      revisionId: "revision-stale",
      sourceId: "source-stale",
    });

    await expect(
      t.mutation(api.companies.undoIndustryProposalApproval, {
        proposalId: "proposal-stale",
        approvedRevisionId: "revision-stale",
        expectedCurrentRevisionId: "revision-from-another-reviewer",
        reviewer: "admin@example.com",
        writeSecret: WRITE_SECRET,
      }),
    ).rejects.toThrow("INDUSTRY_REVIEW_STALE");

    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId: "proposal-stale",
      writeSecret: WRITE_SECRET,
    });
    expect(proposal?.status).toBe("approved");
    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: COMPANY_KEY,
      writeSecret: WRITE_SECRET,
    });
    expect(revisions.map((revision) => revision.revisionId)).toEqual([
      "revision-stale",
    ]);
  });

  it("reports a completed run for replacement recompute without mutating that run", async () => {
    const t = createTest();
    await seedCompany(t);
    await seedProposal(t, {
      proposalId: "proposal-completed",
      sourceId: "source-completed",
    });
    await approveProposal(t, {
      proposalId: "proposal-completed",
      revisionId: "revision-completed",
      sourceId: "source-completed",
    });

    await t.mutation(api.companies.startIndustryRecomputeRun, {
      runId: "run-completed",
      workspaceSlug: "hr",
      companyKey: COMPANY_KEY,
      targetRevisionId: "revision-completed",
      proposalId: "proposal-completed",
      requestedBy: "admin@example.com",
      writeSecret: WRITE_SECRET,
    });
    await markRunSourceDone(t, "run-completed");
    await t.mutation(api.companies.finalizeIndustryRecomputeRun, {
      runId: "run-completed",
      writeSecret: WRITE_SECRET,
    });

    const result = await t.mutation(api.companies.undoIndustryProposalApproval, {
      proposalId: "proposal-completed",
      approvedRevisionId: "revision-completed",
      recomputeRunId: "run-completed",
      reviewer: "admin@example.com",
      writeSecret: WRITE_SECRET,
    });
    expect(result).toMatchObject({
      previousRunId: "run-completed",
      previousRunStatus: "completed",
      replacementRecomputeRequired: true,
    });

    const run = await t.query(api.companies.getIndustryRecomputeRun, {
      runId: "run-completed",
      writeSecret: WRITE_SECRET,
    });
    expect(run?.status).toBe("completed");
  });
});
