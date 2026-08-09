import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api.js";
import { createTest, seedResume } from "./test-helpers.js";

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
  vi.useRealTimers();
});

async function seedCompany(
  t: ReturnType<typeof createTest>,
  companyKey = "seco-tools-sdn-bhd",
  displayName = "SECO TOOLS (M) SDN BHD",
) {
  await t.mutation(api.companies.upsert, {
    companyKey,
    displayName,
    status: "confirmed",
    writeSecret: WRITE_SECRET,
  });
  await t.mutation(api.companies.addAlias, {
    companyKey,
    alias: "SECO TOOLS (M) SDN. BHD.",
    source: "operator",
    writeSecret: WRITE_SECRET,
  });
  await t.mutation(api.companies.addAlias, {
    companyKey,
    alias: "Seco Tools",
    source: "operator",
    writeSecret: WRITE_SECRET,
  });
}

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
    writeSecret: WRITE_SECRET,
  });
}

function ingestDataWithCompany(
  companyKey: string,
  companyName: string,
  verdictRevisionId: string,
) {
  return {
    industryTags: [],
    synonymHits: [],
    brandHits: [],
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
            companyKey,
            companyName,
            jobTitle: "Sales Manager",
            verdictRevisionId,
            years: 1,
            industryVerified: true,
            matchedSignals: ["sales"],
            directRoleMatch: true,
            workEntryFingerprint: "seco-1",
          },
        ],
        verifyIn: "workHistory",
      },
    ],
    ruleScores: {},
    experienceLevel: "senior",
    computedAt: 1,
    skillsVersion: 1,
    evidenceProjectionVersion: 1,
  };
}

function scheduledBackfillNames(t: ReturnType<typeof createTest>) {
  return t.run((ctx) =>
    ctx.db.system
      .query("_scheduled_functions")
      .collect()
      .then((rows) => rows.map((row) => String(row.name))),
  );
}

describe("company-link backfill (F1)", () => {
  it("auto-approve lane schedules the backfill and links surface-matching resumes", async () => {
    vi.useFakeTimers();
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await seedRegistrySource(t, "source-1", "proposal-1");

    const matching = await seedResume(t, {
      content: { workHistory: [{ companyName: "ACME CNC Sdn Bhd" }] },
      externalId: "matching-1",
      identityKey: "id:matching-1",
    });
    const other = await seedResume(t, {
      content: { workHistory: [{ companyName: "Other Industrial Sdn Bhd" }] },
      externalId: "other-1",
      identityKey: "id:other-1",
    });

    await t.mutation(api.companies.autoApproveIndustryProposal, {
      proposalId: "proposal-1",
      industryClass: "cnc",
      approvedSourceIds: ["source-1"],
      evidenceSummary: "Registry evidence: CNC machining company.",
      decisionReason:
        "Governed Lane A auto-approval: structured registry evidence with explicit CNC text.",
      taxonomyVersion: "industry-v1",
      expectedInputFingerprint: "convex-test-fingerprint",
      writeSecret: WRITE_SECRET,
    });

    const scheduled = await scheduledBackfillNames(t);
    expect(
      scheduled.some((name) => name.includes("backfillCompanyResumeLinksByCompany")),
    ).toBe(true);

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const affected = await t.query(api.companies.listAffectedResumesByCompany, {
      workspaceSlug: "dev",
      companyKey: "acme-cnc",
      limit: 50,
      writeSecret: WRITE_SECRET,
    });
    expect(affected.items.map((item) => String(item.resumeId))).toEqual([
      String(matching),
    ]);
    expect(affected.items[0]?.matchedEmployerSurfaces).toEqual([
      "ACME CNC Sdn Bhd",
    ]);
    // Non-matching resume stays untouched (no link, no recompute target).
    expect(
      affected.items.some((item) => String(item.resumeId) === String(other)),
    ).toBe(false);
  });

  it("human approve lane schedules the backfill after a verified verdict commits", async () => {
    vi.useFakeTimers();
    const t = createTest();
    await seedCompanyAndProposal(t, "proposal-1");
    await seedRegistrySource(t, "source-1", "proposal-1");

    const matching = await seedResume(t, {
      content: { workHistory: [{ companyName: "ACME CNC" }] },
      externalId: "matching-human",
      identityKey: "id:matching-human",
    });

    await t.mutation(api.companies.approveIndustryProposal, {
      proposalId: "proposal-1",
      revisionId: "human-revision-1",
      verificationLevel: "verified",
      industryClass: "cnc",
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
    });

    const scheduled = await scheduledBackfillNames(t);
    expect(
      scheduled.some((name) => name.includes("backfillCompanyResumeLinksByCompany")),
    ).toBe(true);

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const affected = await t.query(api.companies.listAffectedResumesByCompany, {
      workspaceSlug: "dev",
      companyKey: "acme-cnc",
      limit: 50,
      writeSecret: WRITE_SECRET,
    });
    expect(affected.items.map((item) => String(item.resumeId))).toEqual([
      String(matching),
    ]);
  });

  it("backfill matches case/suffix variants, skips non-matching, stamps only computed revisions, and is idempotent", async () => {
    const t = createTest();
    await seedCompany(t);

    const exact = await seedResume(t, {
      content: { workHistory: [{ companyName: "SECO TOOLS (M) SDN. BHD." }] },
      externalId: "exact-1",
      identityKey: "id:exact-1",
    });
    const variant = await seedResume(t, {
      content: { workHistory: [{ companyName: "seco tools m sdn bhd" }] },
      externalId: "variant-1",
      identityKey: "id:variant-1",
    });
    const nonMatching = await seedResume(t, {
      content: { workHistory: [{ companyName: "Some Other Company Sdn Bhd" }] },
      externalId: "non-matching-1",
      identityKey: "id:non-matching-1",
    });
    const computed = await seedResume(t, {
      content: {
        workHistory: [
          { companyName: "SECO TOOLS (M) SDN BHD", jobTitle: "Sales Manager" },
        ],
      },
      ingestData: ingestDataWithCompany(
        "seco-tools-sdn-bhd",
        "SECO TOOLS (M) SDN BHD",
        "revision-seco-1",
      ),
      externalId: "computed-1",
      identityKey: "id:computed-1",
    });

    const result = await t.action(
      api.companies.backfillCompanyResumeLinksByCompany,
      { companyKey: "seco-tools-sdn-bhd" },
    );
    expect(result).toMatchObject({
      status: "completed",
      scannedRows: 4,
      matchedRows: 3,
      linkedRows: 3,
      isDone: true,
    });

    const affected = await t.query(api.companies.listAffectedResumesByCompany, {
      workspaceSlug: "dev",
      companyKey: "seco-tools-sdn-bhd",
      limit: 50,
      writeSecret: WRITE_SECRET,
    });
    expect(affected.items.map((item) => String(item.resumeId)).sort()).toEqual(
      [String(exact), String(variant), String(computed)].sort(),
    );
    expect(
      affected.items.some((item) => String(item.resumeId) === String(nonMatching)),
    ).toBe(false);

    const computedRow = affected.items.find(
      (item) => String(item.resumeId) === String(computed),
    );
    expect(computedRow?.currentVerdictRevisionId).toBe("revision-seco-1");
    const exactRow = affected.items.find(
      (item) => String(item.resumeId) === String(exact),
    );
    // Never computed under the company's verdict → stays stale so a targeted
    // recompute picks the resume up.
    expect(exactRow?.currentVerdictRevisionId).toBeUndefined();

    // Idempotent re-run: same links, no duplicates.
    const again = await t.action(
      api.companies.backfillCompanyResumeLinksByCompany,
      { companyKey: "seco-tools-sdn-bhd" },
    );
    expect(again).toMatchObject({ status: "completed", matchedRows: 3, linkedRows: 3 });
    const affectedAgain = await t.query(
      api.companies.listAffectedResumesByCompany,
      {
        workspaceSlug: "dev",
        companyKey: "seco-tools-sdn-bhd",
        limit: 50,
        writeSecret: WRITE_SECRET,
      },
    );
    expect(affectedAgain.items).toHaveLength(3);
  });

  it("bounded invocations self-chain via the scheduler cursor until the corpus is done", async () => {
    vi.useFakeTimers();
    const t = createTest();
    await seedCompany(t);

    // > 100 rows so a single 100-row page cannot finish the corpus
    // (scan pages are capped at MAX_RESUME_SCAN_BATCH_SIZE = 100).
    for (let index = 0; index < 130; index += 1) {
      await seedResume(t, {
        content: {
          workHistory: [{ companyName: `SECO TOOLS (M) SDN. BHD. #${index}` }],
        },
        externalId: `bulk-${index}`,
        identityKey: `id:bulk-${index}`,
      });
    }

    const first = await t.action(
      api.companies.backfillCompanyResumeLinksByCompany,
      { companyKey: "seco-tools-sdn-bhd", maxPages: 1 },
    );
    expect(first).toMatchObject({
      status: "continued",
      scannedRows: 100,
      matchedRows: 100,
      isDone: false,
    });
    expect(first.cursor).toBeTruthy();

    const second = await t.action(
      api.companies.backfillCompanyResumeLinksByCompany,
      { companyKey: "seco-tools-sdn-bhd", cursor: first.cursor ?? undefined },
    );
    expect(second).toMatchObject({
      status: "completed",
      scannedRows: 30,
      matchedRows: 30,
      isDone: true,
    });

    // Drain the leftover self-chained invocation (idempotent no-op).
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const affected = await t.query(api.companies.listAffectedResumesByCompany, {
      workspaceSlug: "dev",
      companyKey: "seco-tools-sdn-bhd",
      limit: 200,
      writeSecret: WRITE_SECRET,
    });
    expect(affected.items).toHaveLength(130);
    expect(affected.isDone).toBe(true);
  });

  it("public sync action backfills without the scheduler and rejects bad secrets or unknown companies", async () => {
    const t = createTest();
    await seedCompany(t);

    const matching = await seedResume(t, {
      content: { workHistory: [{ companyName: "SECO TOOLS (M) SDN. BHD." }] },
      externalId: "sync-matching-1",
      identityKey: "id:sync-matching-1",
    });

    const result = await t.action(
      api.companies.backfillCompanyResumeLinksByCompanySync,
      { companyKey: "seco-tools-sdn-bhd", writeSecret: WRITE_SECRET },
    );
    expect(result.status).toBe("completed");
    expect(result.isDone).toBe(true);
    expect(result.matchedRows).toBeGreaterThanOrEqual(1);
    expect(result.linkedRows).toBeGreaterThanOrEqual(1);

    // The sync action must not self-chain via the scheduler.
    const scheduled = await scheduledBackfillNames(t);
    expect(
      scheduled.some((name) => name.includes("backfillCompanyResumeLinksByCompany")),
    ).toBe(false);

    const links = await t.run((ctx) =>
      ctx.db.query("company_resume_links").collect(),
    );
    expect(links.map((link) => String(link.resumeId))).toEqual([String(matching)]);
    expect(links[0]?.matchedEmployerSurfaces).toEqual([
      "SECO TOOLS (M) SDN. BHD.",
    ]);

    const missing = await t.action(
      api.companies.backfillCompanyResumeLinksByCompanySync,
      { companyKey: "ghost-company", writeSecret: WRITE_SECRET },
    );
    expect(missing).toMatchObject({
      status: "not_found",
      scannedRows: 0,
      matchedRows: 0,
      linkedRows: 0,
      cursor: null,
      isDone: true,
    });

    await expect(
      t.action(api.companies.backfillCompanyResumeLinksByCompanySync, {
        companyKey: "seco-tools-sdn-bhd",
        writeSecret: "wrong-secret",
      }),
    ).rejects.toThrow("Unauthorized Convex write");
  });

  it("public sync action continues from a cursor across invocations until done, without scheduling", async () => {
    const t = createTest();
    await seedCompany(t);

    // > 1000 rows: the default 10-page budget cannot finish the corpus in one
    // invocation, so the first sync call must return "continued" with a cursor.
    for (let index = 0; index < 1001; index += 1) {
      await seedResume(t, {
        content: {
          workHistory: [{ companyName: `SECO TOOLS (M) SDN. BHD. #${index}` }],
        },
        externalId: `sync-bulk-${index}`,
        identityKey: `id:sync-bulk-${index}`,
      });
    }

    const first = await t.action(
      api.companies.backfillCompanyResumeLinksByCompanySync,
      { companyKey: "seco-tools-sdn-bhd", writeSecret: WRITE_SECRET },
    );
    expect(first.status).toBe("continued");
    expect(first.isDone).toBe(false);
    expect(first.cursor).toBeTruthy();
    expect(first.scannedRows).toBe(1000);
    expect(first.matchedRows).toBe(1000);

    // No self-chained scheduler jobs after the continued invocation.
    const scheduled = await scheduledBackfillNames(t);
    expect(
      scheduled.some((name) => name.includes("backfillCompanyResumeLinksByCompany")),
    ).toBe(false);

    const second = await t.action(
      api.companies.backfillCompanyResumeLinksByCompanySync,
      {
        companyKey: "seco-tools-sdn-bhd",
        cursor: first.cursor ?? undefined,
        writeSecret: WRITE_SECRET,
      },
    );
    expect(second.status).toBe("completed");
    expect(second.isDone).toBe(true);
    expect(second.scannedRows).toBe(1);
    expect(second.matchedRows).toBe(1);

    const links = await t.run((ctx) =>
      ctx.db.query("company_resume_links").collect(),
    );
    expect(links).toHaveLength(1001);
  });

  it("write-secret ops mutation schedules the backfill and rejects bad secret or unknown company", async () => {
    vi.useFakeTimers();
    const t = createTest();
    await seedCompany(t);

    const result = await t.mutation(api.companies.backfillCompanyResumeLinks, {
      companyKey: "seco-tools-sdn-bhd",
      writeSecret: WRITE_SECRET,
    });
    expect(result).toEqual({
      scheduled: true,
      companyKey: "seco-tools-sdn-bhd",
    });

    await expect(
      t.mutation(api.companies.backfillCompanyResumeLinks, {
        companyKey: "seco-tools-sdn-bhd",
        writeSecret: "wrong-secret",
      }),
    ).rejects.toThrow("Unauthorized Convex write");

    await expect(
      t.mutation(api.companies.backfillCompanyResumeLinks, {
        companyKey: "ghost-company",
        writeSecret: WRITE_SECRET,
      }),
    ).rejects.toThrow("Unknown companyKey: ghost-company");

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });

  it("targeted recompute reserves planned batches from backfilled stale links", async () => {
    const t = createTest();
    await seedCompany(t);

    await t.mutation(api.companies.upsertIndustryProfile, {
      companyKey: "seco-tools-sdn-bhd",
      industryClass: "cnc",
      verificationLevel: "verified",
      evidenceSource: "manual",
      summary: "Official registry evidence.",
      currentRevisionId: "revision-seco-1",
      reviewedBy: "reviewer@example.com",
      writeSecret: WRITE_SECRET,
    });

    const staleResume = await seedResume(t, {
      content: { workHistory: [{ companyName: "SECO TOOLS (M) SDN BHD" }] },
      externalId: "stale-1",
      identityKey: "id:stale-1",
    });

    await t.action(api.companies.backfillCompanyResumeLinksByCompany, {
      companyKey: "seco-tools-sdn-bhd",
    });

    const affected = await t.query(api.companies.listAffectedResumesByCompany, {
      workspaceSlug: "dev",
      companyKey: "seco-tools-sdn-bhd",
      limit: 200,
      writeSecret: WRITE_SECRET,
    });
    expect(affected.items.map((item) => String(item.resumeId))).toEqual([
      String(staleResume),
    ]);
    expect(affected.items[0]?.currentVerdictRevisionId).toBeUndefined();

    // Drive the same inputs the BFF recompute driver consumes: start the run,
    // reserve the affected page (no revision → stale → batch), then read the
    // planned batch that will be dispatched for recompute.
    const started = await t.mutation(api.companies.startIndustryRecomputeRun, {
      writeSecret: WRITE_SECRET,
      runId: "run-f1-1",
      workspaceSlug: "dev",
      companyKey: "seco-tools-sdn-bhd",
      targetRevisionId: "revision-seco-1",
      requestedBy: "test",
    });
    expect(started).toMatchObject({ status: "queued", affectedCount: 0 });

    const run = await t.mutation(api.companies.reserveIndustryRecomputePage, {
      writeSecret: WRITE_SECRET,
      runId: "run-f1-1",
      items: affected.items.map((item) => ({
        resumeId: String(item.resumeId),
        ...(item.currentVerdictRevisionId
          ? { currentVerdictRevisionId: item.currentVerdictRevisionId }
          : {}),
      })),
      continueCursor: affected.continueCursor,
      isDone: affected.isDone,
    });
    expect(run).toMatchObject({ status: "running", affectedCount: 1 });

    const batch = await t.query(api.companies.getNextIndustryRecomputeBatch, {
      runId: "run-f1-1",
      writeSecret: WRITE_SECRET,
    });
    expect(batch?.resumeIds).toEqual([String(staleResume)]);
  });
});
