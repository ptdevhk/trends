import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api, internal } from "../convex/_generated/api.js";
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

async function seedReviewedRevision(
  t: ReturnType<typeof createTest>,
  revisionId = "revision-2",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("company_industry_profiles", {
      companyKey: "acme-cnc",
      industryClass: "cnc",
      verificationLevel: "verified",
      evidenceSource: "manual",
      currentRevisionId: revisionId,
      updatedAt: 100,
    });
    await ctx.db.insert("company_industry_review_proposals", {
      proposalId: "proposal-1",
      companyKey: "acme-cnc",
      triggerReasons: ["unknown_employer"],
      priority: 100,
      status: "approved",
      createdAt: 90,
      updatedAt: 100,
    });
  });
}

describe("company industry targeted recompute runs", () => {
  it("keeps exact reingest readiness pending until the affected company link carries the target revision", async () => {
    const t = createTest();
    const resumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "resume-readiness",
        content: {},
        hash: "hash-readiness",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "hr",
      }),
    );
    const buildIngestData = (verdictRevisionId: string) => ({
      industryTags: [],
      synonymHits: [],
      brandHits: [],
      brandOrigin: "unknown" as const,
      productClass: "other" as const,
      companyHits: [],
      roleSignals: [
        {
          type: "sales",
          matchedSignals: ["sales"],
          signalCount: 1,
          occurrences: 1,
          years: 1,
          industryVerifiedYears: 1,
          matchedWorkEntries: [
            {
              companyKey: "acme-cnc",
              companyName: "ACME CNC",
              jobTitle: "Sales",
              years: 1,
              industryVerified: true,
              verdictRevisionId,
              workEntryFingerprint: "entry-1",
              matchedSignals: ["sales"],
              directRoleMatch: true,
            },
          ],
          verifyIn: "workHistory",
        },
      ],
      ruleScores: {},
      experienceLevel: "senior",
      computedAt: 200,
      skillsVersion: 7,
      ingestComputeEpoch: 3,
      evidenceProjectionVersion: 1,
    });
    await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
      updates: [{ resumeId, ingestData: buildIngestData("revision-1") }],
    });

    const stale = await t.query(api.ingest_agent.getExactReingestReadiness, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
      resumeIds: [resumeId],
      dispatchedAt: 150,
      expectedSkillsVersion: 7,
      expectedCompanyKey: "acme-cnc",
      expectedVerdictRevisionId: "revision-2",
    });
    expect(stale.targets[0]).toMatchObject({
      state: "pending",
      reasons: ["industry_evidence_revision_mismatch"],
    });

    await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
      updates: [{ resumeId, ingestData: buildIngestData("revision-2") }],
    });
    const ready = await t.query(api.ingest_agent.getExactReingestReadiness, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
      resumeIds: [resumeId],
      dispatchedAt: 150,
      expectedSkillsVersion: 7,
      expectedCompanyKey: "acme-cnc",
      expectedVerdictRevisionId: "revision-2",
    });
    expect(ready).toMatchObject({ allReady: true, ready: 1, pending: 0 });
  });

  it("starts idempotently, reserves only stale targets, and marks the proposal applied only after completion", async () => {
    const t = createTest();
    await seedReviewedRevision(t);
    const staleResumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "resume-stale",
        content: {},
        hash: "hash-stale",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "hr",
      }),
    );
    const currentResumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "resume-current",
        content: {},
        hash: "hash-current",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "hr",
      }),
    );

    const companies = (api as any).companies;
    const first = await t.mutation(companies.startIndustryRecomputeRun, {
      runId: "run-1",
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      proposalId: "proposal-1",
      requestedBy: "operator",
      writeSecret: WRITE_SECRET,
    });
    const duplicate = await t.mutation(companies.startIndustryRecomputeRun, {
      runId: "run-other",
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      proposalId: "proposal-1",
      requestedBy: "operator",
      writeSecret: WRITE_SECRET,
    });
    expect(duplicate.runId).toBe(first.runId);

    const proposalBefore = await t.query(companies.getIndustryProposal, {
      proposalId: "proposal-1",
      writeSecret: WRITE_SECRET,
    });
    expect(proposalBefore).toMatchObject({
      recomputeRunId: "run-1",
      applicationState: "recompute_pending",
    });

    const reserved = await t.mutation(companies.reserveIndustryRecomputePage, {
      runId: "run-1",
      expectedCursor: "",
      items: [
        {
          resumeId: staleResumeId,
          currentVerdictRevisionId: "revision-1",
        },
        {
          resumeId: currentResumeId,
          currentVerdictRevisionId: "revision-2",
        },
      ],
      continueCursor: "cursor-2",
      isDone: true,
      writeSecret: WRITE_SECRET,
    });
    expect(reserved).toMatchObject({
      affectedCount: 2,
      alreadyCurrentCount: 1,
      sourceDone: true,
    });

    const batch = await t.query(companies.getNextIndustryRecomputeBatch, {
      runId: "run-1",
      writeSecret: WRITE_SECRET,
    });
    expect(batch.resumeIds).toEqual([staleResumeId]);

    await t.mutation(companies.recordIndustryRecomputeBatchDispatch, {
      runId: "run-1",
      batchId: batch.batchId,
      dispatchedAt: 150,
      expectedSkillsVersion: 7,
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(companies.recordIndustryRecomputeBatchReadiness, {
      runId: "run-1",
      batchId: batch.batchId,
      readyResumeIds: [staleResumeId],
      failures: [],
      writeSecret: WRITE_SECRET,
    });
    const completed = await t.mutation(
      companies.finalizeIndustryRecomputeRun,
      {
        runId: "run-1",
        writeSecret: WRITE_SECRET,
      },
    );
    expect(completed).toMatchObject({
      status: "completed",
      readyCount: 2,
      failureCount: 0,
    });

    const proposalAfter = await t.query(companies.getIndustryProposal, {
      proposalId: "proposal-1",
      writeSecret: WRITE_SECRET,
    });
    expect(proposalAfter).toMatchObject({
      applicationState: "applied",
      appliedRevisionId: "revision-2",
    });
  });

  it("records partial failure, retries the same run idempotently, and blocks retry after revision supersession", async () => {
    const t = createTest();
    await seedReviewedRevision(t);
    const resumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "resume-1",
        content: {},
        hash: "hash-1",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "hr",
      }),
    );
    const companies = (api as any).companies;

    await t.mutation(companies.startIndustryRecomputeRun, {
      runId: "run-1",
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      requestedBy: "operator",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(companies.reserveIndustryRecomputePage, {
      runId: "run-1",
      expectedCursor: "",
      items: [{ resumeId, currentVerdictRevisionId: "revision-1" }],
      continueCursor: "",
      isDone: true,
      writeSecret: WRITE_SECRET,
    });
    const batch = await t.query(companies.getNextIndustryRecomputeBatch, {
      runId: "run-1",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(companies.recordIndustryRecomputeBatchFailure, {
      runId: "run-1",
      batchId: batch.batchId,
      stage: "dispatch",
      message: "worker unavailable",
      writeSecret: WRITE_SECRET,
    });
    const partial = await t.mutation(
      companies.finalizeIndustryRecomputeRun,
      {
        runId: "run-1",
        writeSecret: WRITE_SECRET,
      },
    );
    expect(partial.status).toBe("failed");
    expect(partial.failures).toEqual([
      expect.objectContaining({
        resumeId: String(resumeId),
        stage: "dispatch",
        message: "worker unavailable",
      }),
    ]);

    const retried = await t.mutation(companies.retryIndustryRecomputeRun, {
      runId: "run-1",
      requestedBy: "operator",
      writeSecret: WRITE_SECRET,
    });
    expect(retried).toMatchObject({
      runId: "run-1",
      status: "queued",
      attempt: 2,
      failureCount: 0,
    });
    const duplicateRetry = await t.mutation(
      companies.retryIndustryRecomputeRun,
      {
        runId: "run-1",
        requestedBy: "operator",
        writeSecret: WRITE_SECRET,
      },
    );
    expect(duplicateRetry.attempt).toBe(2);

    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("company_industry_profiles")
        .withIndex("by_company_key", (q) => q.eq("companyKey", "acme-cnc"))
        .unique();
      await ctx.db.patch(profile!._id, {
        currentRevisionId: "revision-3",
        updatedAt: 300,
      });
    });

    const superseded = await t.mutation(
      companies.markIndustryRecomputeRunSuperseded,
      {
        runId: "run-1",
        observedRevisionId: "revision-3",
        writeSecret: WRITE_SECRET,
      },
    );
    expect(superseded.status).toBe("superseded");
    await expect(
      t.mutation(companies.retryIndustryRecomputeRun, {
        runId: "run-1",
        requestedBy: "operator",
        writeSecret: WRITE_SECRET,
      }),
    ).rejects.toThrow(/superseded revision/);
  });

  it("resets a waiting run to queued, clearing batches and progress counters", async () => {
    const t = createTest();
    await seedReviewedRevision(t);
    const resumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "resume-reset",
        content: {},
        hash: "hash-reset",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "hr",
      }),
    );
    const companies = (api as any).companies;

    await t.mutation(companies.startIndustryRecomputeRun, {
      runId: "run-1",
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      proposalId: "proposal-1",
      requestedBy: "operator",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(companies.reserveIndustryRecomputePage, {
      runId: "run-1",
      expectedCursor: "",
      items: [{ resumeId, currentVerdictRevisionId: "revision-1" }],
      continueCursor: "cursor-2",
      isDone: true,
      writeSecret: WRITE_SECRET,
    });
    const batch = await t.query(companies.getNextIndustryRecomputeBatch, {
      runId: "run-1",
      writeSecret: WRITE_SECRET,
    });
    const waiting = await t.mutation(
      companies.recordIndustryRecomputeBatchDispatch,
      {
        runId: "run-1",
        batchId: batch.batchId,
        dispatchedAt: 150,
        expectedSkillsVersion: 7,
        writeSecret: WRITE_SECRET,
      },
    );
    expect(waiting.status).toBe("waiting");

    const reset = await t.mutation(companies.resetIndustryRecomputeRun, {
      runId: "run-1",
      requestedBy: "operator-2",
      writeSecret: WRITE_SECRET,
    });
    expect(reset).toMatchObject({
      runId: "run-1",
      status: "queued",
      attempt: 2,
      requestedBy: "operator-2",
      sourceDone: false,
      pageCount: 0,
      affectedCount: 0,
      alreadyCurrentCount: 0,
      scheduledCount: 0,
      readyCount: 0,
      failureCount: 0,
      batchCount: 0,
      failures: [],
    });
    expect(reset.cursor).toBeUndefined();
    expect(reset.lastError).toBeUndefined();
    expect(reset.completedAt).toBeUndefined();

    const remainingBatches = await t.run(async (ctx) =>
      ctx.db
        .query("company_industry_recompute_batches")
        .withIndex("by_run", (q) => q.eq("runId", "run-1"))
        .collect(),
    );
    expect(remainingBatches).toEqual([]);
  });

  it("resets a completed run to queued (unlike retry, which is a no-op)", async () => {
    const t = createTest();
    await seedReviewedRevision(t);
    const resumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "resume-completed-reset",
        content: {},
        hash: "hash-completed-reset",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "hr",
      }),
    );
    const companies = (api as any).companies;

    await t.mutation(companies.startIndustryRecomputeRun, {
      runId: "run-1",
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      proposalId: "proposal-1",
      requestedBy: "operator",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(companies.reserveIndustryRecomputePage, {
      runId: "run-1",
      expectedCursor: "",
      items: [{ resumeId, currentVerdictRevisionId: "revision-1" }],
      continueCursor: "",
      isDone: true,
      writeSecret: WRITE_SECRET,
    });
    const batch = await t.query(companies.getNextIndustryRecomputeBatch, {
      runId: "run-1",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(companies.recordIndustryRecomputeBatchDispatch, {
      runId: "run-1",
      batchId: batch.batchId,
      dispatchedAt: 150,
      expectedSkillsVersion: 7,
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(companies.recordIndustryRecomputeBatchReadiness, {
      runId: "run-1",
      batchId: batch.batchId,
      readyResumeIds: [resumeId],
      failures: [],
      writeSecret: WRITE_SECRET,
    });
    const completed = await t.mutation(companies.finalizeIndustryRecomputeRun, {
      runId: "run-1",
      writeSecret: WRITE_SECRET,
    });
    expect(completed.status).toBe("completed");

    const reset = await t.mutation(companies.resetIndustryRecomputeRun, {
      runId: "run-1",
      requestedBy: "operator",
      writeSecret: WRITE_SECRET,
    });
    expect(reset).toMatchObject({
      runId: "run-1",
      status: "queued",
      attempt: 2,
      readyCount: 0,
      failureCount: 0,
      batchCount: 0,
    });
    expect(reset.completedAt).toBeUndefined();
  });

  it("blocks reset of a superseded run", async () => {
    const t = createTest();
    await seedReviewedRevision(t);
    const companies = (api as any).companies;

    await t.mutation(companies.startIndustryRecomputeRun, {
      runId: "run-1",
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      proposalId: "proposal-1",
      requestedBy: "operator",
      writeSecret: WRITE_SECRET,
    });
    const superseded = await t.mutation(
      companies.markIndustryRecomputeRunSuperseded,
      {
        runId: "run-1",
        observedRevisionId: "revision-3",
        writeSecret: WRITE_SECRET,
      },
    );
    expect(superseded.status).toBe("superseded");
    await expect(
      t.mutation(companies.resetIndustryRecomputeRun, {
        runId: "run-1",
        requestedBy: "operator",
        writeSecret: WRITE_SECRET,
      }),
    ).rejects.toThrow(/superseded revision/);
  });
});
