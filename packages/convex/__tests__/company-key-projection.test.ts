/**
 * T3: durable companyKey projection snapshot on resume docs.
 *
 * Covers the pure projection builder, the recompute drain (dry-run + real
 * run with scheduled chunk execution via convex-test's scheduler), the scan
 * batch carrying the column, and the updateIngestDataBatch write path that
 * re-reads the doc after link sync (stamps land in the DB, not memory).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../convex/_generated/api.js";
import { CURRENT_COMPANY_KEY_PROJECTION_EPOCH } from "@trends/shared";
import { computeCompanyKeyProjection } from "../convex/lib/resume_identity.js";
import { createTest, MINIMAL_INGEST_DATA, seedResume } from "./test-helpers.js";

// ---------------------------------------------------------------------------
// computeCompanyKeyProjection (pure)
// ---------------------------------------------------------------------------

describe("company_key_projection: computeCompanyKeyProjection (pure)", () => {
  const CURRENT = CURRENT_COMPANY_KEY_PROJECTION_EPOCH;

  it("stamps deduped, order-preserving companyKeys from workHistory", () => {
    const content = {
      workHistory: [
        { companyKey: "acme-cnc", companyName: "ACME CNC" },
        { companyKey: "polywell", companyName: "Polywell" },
        { companyKey: "acme-cnc", companyName: "Acme CNC Ltd" },
      ],
    };
    const projection = computeCompanyKeyProjection(content);
    expect(projection.epoch).toBe(CURRENT);
    expect(projection.companyKeys).toEqual(["acme-cnc", "polywell"]);
    expect(projection.companyTokens).toEqual(expect.arrayContaining(["acme", "cnc", "polywell"]));
  });

  it("mirrors the codebase first-non-null work-history key precedence", () => {
    const projection = computeCompanyKeyProjection({
      experience: [{ companyKey: "delta" }],
      workExperience: [{ companyKey: "echo" }],
      companyName: "Alpha Beta Corp",
    });
    expect(projection.companyKeys).toEqual(["delta"]);
    // Top-level company name still contributes tokens.
    expect(projection.companyTokens).toEqual(expect.arrayContaining(["alpha", "beta"]));
  });

  it("falls back to workExperience when workHistory and experience are absent", () => {
    expect(
      computeCompanyKeyProjection({ workExperience: [{ companyKey: "echo" }] }).companyKeys,
    ).toEqual(["echo"]);
  });

  it("honors an explicit epoch argument", () => {
    expect(computeCompanyKeyProjection({ workHistory: [] }, 7).epoch).toBe(7);
  });

  it("tolerates non-object content", () => {
    expect(computeCompanyKeyProjection(undefined)).toEqual({
      epoch: CURRENT,
      companyKeys: [],
      companyTokens: [],
    });
    expect(computeCompanyKeyProjection(null)).toEqual({
      epoch: CURRENT,
      companyKeys: [],
      companyTokens: [],
    });
    expect(computeCompanyKeyProjection([{ companyKey: "x" }])).toEqual({
      epoch: CURRENT,
      companyKeys: [],
      companyTokens: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Drain + write path (convex integration)
// ---------------------------------------------------------------------------

describe("company_key_projection: drain + write path", () => {
  const CURRENT = CURRENT_COMPANY_KEY_PROJECTION_EPOCH;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dry-run counts stale rows without patching anything", async () => {
    const t = createTest();
    const staleId = await seedResume(t, {
      externalId: "proj-stale-1",
      content: { workHistory: [{ companyKey: "acme-cnc", companyName: "ACME CNC" }] },
    });
    const freshId = await seedResume(t, {
      externalId: "proj-fresh-1",
      content: { workHistory: [] },
      companyKeyProjection: { epoch: CURRENT, companyKeys: [], companyTokens: [] },
    });

    const result = await t.action(
      internal.company_key_projection.recomputeCompanyKeyProjections,
      { limit: 50, dryRun: true },
    );

    expect(result).toMatchObject({
      dryRun: true,
      scheduled: 0,
      batches: 0,
      staleCount: 1,
      scannedRows: 2,
      hasMore: false,
      currentEpoch: CURRENT,
    });

    const stale = await t.run(async (ctx) => ctx.db.get(staleId));
    expect(stale?.companyKeyProjection).toBeUndefined();
    const fresh = await t.run(async (ctx) => ctx.db.get(freshId));
    expect(fresh?.companyKeyProjection).toEqual({ epoch: CURRENT, companyKeys: [], companyTokens: [] });
  });

  it("real run schedules chunks and drains to patched docs", async () => {
    vi.useFakeTimers();
    const t = createTest();
    const staleId = await seedResume(t, {
      externalId: "proj-stale-2",
      content: { workHistory: [{ companyKey: "acme-cnc", companyName: "ACME CNC" }] },
    });
    await seedResume(t, {
      externalId: "proj-fresh-2",
      content: { workHistory: [] },
      companyKeyProjection: { epoch: CURRENT, companyKeys: [], companyTokens: [] },
    });

    const result = await t.action(
      internal.company_key_projection.recomputeCompanyKeyProjections,
      { limit: 50 },
    );

    expect(result).toMatchObject({
      dryRun: false,
      scheduled: 1,
      batches: 1,
      staleCount: 1,
      scannedRows: 2,
      hasMore: false,
      currentEpoch: CURRENT,
    });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const stamped = await t.run(async (ctx) => ctx.db.get(staleId));
    expect(stamped?.companyKeyProjection).toMatchObject({
      epoch: CURRENT,
      companyKeys: ["acme-cnc"],
      companyTokens: expect.arrayContaining(["acme", "cnc"]),
    });
  });

  it("drain ignores archived rows so stale can settle to 0", async () => {
    vi.useFakeTimers();
    const t = createTest();
    const archivedId = await seedResume(t, {
      externalId: "proj-archived-1",
      content: { workHistory: [{ companyKey: "delta", companyName: "Delta" }] },
      isArchived: true,
    });

    const dry = await t.action(
      internal.company_key_projection.recomputeCompanyKeyProjections,
      { limit: 50, dryRun: true },
    );
    expect(dry).toMatchObject({ dryRun: true, staleCount: 0, scannedRows: 1, scheduled: 0 });

    const real = await t.action(
      internal.company_key_projection.recomputeCompanyKeyProjections,
      { limit: 50 },
    );
    expect(real).toMatchObject({ staleCount: 0, scheduled: 0, batches: 0 });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const archived = await t.run(async (ctx) => ctx.db.get(archivedId));
    expect(archived?.companyKeyProjection).toBeUndefined();
  });

  it("recomputeCompanyKeyProjectionForResume patches docs and skips missing/archived", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "proj-mut-1",
      content: { workHistory: [{ companyKey: "polywell", companyName: "Polywell" }] },
    });
    const archivedId = await seedResume(t, {
      externalId: "proj-mut-2",
      content: { workHistory: [{ companyKey: "delta" }] },
      isArchived: true,
    });
    const deletedId = await seedResume(t, { externalId: "proj-mut-3", content: {} });
    await t.run(async (ctx) => {
      await ctx.db.delete(deletedId);
    });

    const result = await t.mutation(
      internal.company_key_projection.recomputeCompanyKeyProjectionForResume,
      { resumeIds: [resumeId, archivedId, deletedId] },
    );
    expect(result).toEqual({ patched: 1 });

    const stamped = await t.run(async (ctx) => ctx.db.get(resumeId));
    expect(stamped?.companyKeyProjection).toMatchObject({
      epoch: CURRENT,
      companyKeys: ["polywell"],
    });
    const archived = await t.run(async (ctx) => ctx.db.get(archivedId));
    expect(archived?.companyKeyProjection).toBeUndefined();
  });

  it("listResumeScanBatch carries companyKeyProjection", async () => {
    const t = createTest();
    const withProj = await seedResume(t, {
      externalId: "proj-scan-1",
      content: {},
      companyKeyProjection: { epoch: CURRENT, companyKeys: ["acme-cnc"], companyTokens: ["acme"] },
    });
    await seedResume(t, { externalId: "proj-scan-2", content: {} });

    const page = await t.run(async (ctx) =>
      ctx.runQuery(internal.resumes.listResumeScanBatch, { limit: 10 }),
    );
    const row = page.page.find((r) => r._id === withProj);
    expect(row?.companyKeyProjection).toEqual({
      epoch: CURRENT,
      companyKeys: ["acme-cnc"],
      companyTokens: ["acme"],
    });
    const noProj = page.page.find((r) => r.externalId === "proj-scan-2");
    expect(noProj?.companyKeyProjection).toBeUndefined();
  });

  it("updateIngestDataBatch stamps the projection from the re-read doc after link sync", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "proj-write-1",
      content: {
        // No companyKey in memory — the write path must re-read the doc after
        // stampWorkHistoryCompanyKeys patches the DB row.
        workHistory: [{ companyName: "ACME CNC", startDate: "2020-01" }],
      },
    });

    const ingestData = {
      ...MINIMAL_INGEST_DATA,
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
              verdictRevisionId: "revision-1",
              workEntryFingerprint: "entry-1",
              matchedSignals: ["sales"],
              directRoleMatch: true,
            },
          ],
          verifyIn: "workHistory",
        },
      ],
    };
    await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
      updates: [{ resumeId, ingestData }],
    });

    const stamped = await t.run(async (ctx) => ctx.db.get(resumeId));
    expect(stamped?.companyKeyProjection).toMatchObject({
      epoch: CURRENT,
      companyKeys: ["acme-cnc"],
      companyTokens: expect.arrayContaining(["acme", "cnc"]),
    });
  });
});
