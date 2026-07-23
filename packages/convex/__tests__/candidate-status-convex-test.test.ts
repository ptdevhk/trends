/**
 * Integration tests for candidate_status.ts using convex-test.
 *
 * Covers: list, listForBackup, getByIdentity, upsert (insert + update + history).
 */
import { createTest, seedResumeAnalysesColdRow } from "./test-helpers.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api.js";

const WRITE_SECRET = "test-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
    return;
  }
  process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
});

async function insertResumeWithIdentity(
  t: ReturnType<typeof createTest>,
  identityKey: string,
  workspaceSlug: string | null = "hr",
): Promise<string> {
  return await t.run(async (ctx) => {
    const resumeId = await ctx.db.insert("resumes", {
      externalId: `external:${identityKey}`,
      identityKey,
      content: { name: `Candidate ${identityKey}` },
      hash: `hash:${identityKey}`,
      tags: [],
      crawledAt: 1_700_000_000_000,
      source: "test",
      sourceKey: "test",
      ...(workspaceSlug ? { workspaceSlug } : {}),
    });
    return String(resumeId);
  });
}

async function seedBackfilledLegacyCandidateState(
  t: ReturnType<typeof createTest>,
  suffix: string,
  legacyNote: string,
) {
  const portableIdentityKey = `externalId:backfilled-${suffix}`;
  const resumeId = await t.run(async (ctx) => await ctx.db.insert("resumes", {
    externalId: `backfilled-${suffix}`,
    identityKey: portableIdentityKey,
    content: { name: `Backfilled Candidate ${suffix}` },
    hash: `backfilled-hash-${suffix}`,
    tags: [],
    crawledAt: 1_700_000_000_000,
    source: "test",
    sourceKey: "test",
    workspaceSlug: "dev",
  }));
  const legacyIdentityKey = String(resumeId);
  const legacyHistory = [{
    status: "new",
    updatedAt: 1_600_000_000_000,
    notes: "Initial review",
  }];
  const portableHistory = [{
    status: "contacted",
    updatedAt: 1_750_000_000_000,
    notes: "Portable duplicate history",
  }];

  await t.mutation(api.resumes_search.upsertResumeDigestForTest, { resumeId });
  await t.run(async (ctx) => {
    const digests = await ctx.db
      .query("resume_digests")
      .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
      .collect();
    for (const digest of digests) {
      await ctx.db.patch(digest._id, { identityKey: legacyIdentityKey });
    }
    await ctx.db.insert("candidate_status", {
      workspaceSlug: "dev",
      identityKey: legacyIdentityKey,
      status: "shortlisted",
      notes: legacyNote,
      updatedBy: "legacy-reviewer",
      updatedAt: 1_700_000_000_000,
      history: legacyHistory,
    });
    await ctx.db.insert("resume_digest_statuses", {
      resumeId,
      workspaceSlug: "dev",
      identityKey: legacyIdentityKey,
      status: "shortlisted",
      updatedAt: 1_700_000_000_000,
    });
    await ctx.db.insert("candidate_status", {
      workspaceSlug: "dev",
      identityKey: portableIdentityKey,
      status: "new",
      notes: "Portable duplicate note",
      updatedBy: "prior-importer",
      updatedAt: 1_800_000_000_000,
      history: [...legacyHistory, ...portableHistory],
    });
    await ctx.db.insert("resume_digest_statuses", {
      resumeId,
      workspaceSlug: "dev",
      identityKey: portableIdentityKey,
      status: "new",
      updatedAt: 1_800_000_000_000,
    });
  });

  return {
    resumeId,
    legacyIdentityKey,
    portableIdentityKey,
    mergedHistory: [...legacyHistory, ...portableHistory],
  };
}

// ---------------------------------------------------------------------------
// upsert + getByIdentity
// ---------------------------------------------------------------------------

describe("candidate_status: upsert + getByIdentity", () => {
  it("inserts a new candidate status", async () => {
    const t = createTest();

    const id = await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-1",
      status: "new",
      notes: "Initial entry",
      updatedBy: "recruiter@example.com",
      writeSecret: WRITE_SECRET,
    });

    expect(id).toBeDefined();

    const result = await t.query(api.candidate_status.getByIdentity, {
      identityKey: "candidate-1",
    });

    expect(result).not.toBeNull();
    expect(result!.identityKey).toBe("candidate-1");
    expect(result!.status).toBe("new");
    expect(result!.notes).toBe("Initial entry");
    expect(result!.updatedBy).toBe("recruiter@example.com");
    expect(result!.history).toEqual([]);
  });

  it("updates an existing candidate status and appends history", async () => {
    const t = createTest();

    await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-2",
      status: "new",
      writeSecret: WRITE_SECRET,
    });

    await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-2",
      status: "contacted",
      notes: "Reached out via email",
      updatedBy: "recruiter@example.com",
      writeSecret: WRITE_SECRET,
    });

    const result = await t.query(api.candidate_status.getByIdentity, {
      identityKey: "candidate-2",
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("contacted");
    expect(result!.notes).toBe("Reached out via email");
    expect(result!.history).toHaveLength(1);
    expect(result!.history![0].status).toBe("new");
  });

  it("does not append history when status unchanged", async () => {
    const t = createTest();

    await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-3",
      status: "new",
      writeSecret: WRITE_SECRET,
    });

    await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-3",
      status: "new",
      notes: "Updated notes only",
      writeSecret: WRITE_SECRET,
    });

    const result = await t.query(api.candidate_status.getByIdentity, {
      identityKey: "candidate-3",
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("new");
    expect(result!.notes).toBe("Updated notes only");
    expect(result!.history).toHaveLength(0);
  });

  it("returns null for nonexistent identityKey", async () => {
    const t = createTest();

    const result = await t.query(api.candidate_status.getByIdentity, {
      identityKey: "nonexistent",
    });

    expect(result).toBeNull();
  });

  it("throws when identityKey is empty", async () => {
    const t = createTest();

    await expect(
      t.mutation(api.candidate_status.upsert, {
        identityKey: "  ",
        status: "new",
        writeSecret: WRITE_SECRET,
      }),
    ).rejects.toThrow("identityKey is required");
  });

  it("defaults workspaceSlug to 'dev' when empty string", async () => {
    const t = createTest();

    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "",
      identityKey: "candidate-empty-ws",
      status: "new",
      writeSecret: WRITE_SECRET,
    });

    const result = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "dev",
      identityKey: "candidate-empty-ws",
    });

    expect(result).not.toBeNull();
    expect(result!.identityKey).toBe("candidate-empty-ws");
  });

  it("returns null for empty identityKey in getByIdentity", async () => {
    const t = createTest();

    const result = await t.query(api.candidate_status.getByIdentity, {
      identityKey: "",
    });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// list + listForBackup
// ---------------------------------------------------------------------------

describe("candidate_status: list + listForBackup", () => {
  it("returns empty array when no records exist", async () => {
    const t = createTest();

    const list = await t.query(api.candidate_status.list, {
      workspaceSlug: "ws-empty",
    });

    expect(list).toEqual([]);
  });

  it("lists candidate statuses for a workspace", async () => {
    const t = createTest();

    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-list",
      identityKey: "c-1",
      status: "new",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-list",
      identityKey: "c-2",
      status: "contacted",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-other",
      identityKey: "c-3",
      status: "interviewing",
      writeSecret: WRITE_SECRET,
    });

    const list = await t.query(api.candidate_status.list, {
      workspaceSlug: "ws-list",
    });

    expect(list).toHaveLength(2);
    const keys = list.map((r) => r.identityKey).sort();
    expect(keys).toEqual(["c-1", "c-2"]);
  });

  it("listForBackup returns projected fields", async () => {
    const t = createTest();

    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-backup",
      identityKey: "c-backup",
      status: "interviewed_pass",
      notes: "Strong candidate",
      updatedBy: "reviewer",
      writeSecret: WRITE_SECRET,
    });

    const rows = await t.query(api.candidate_status.listForBackup, {
      workspaceSlug: "ws-backup",
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.identityKey).toBe("c-backup");
    expect(row.status).toBe("interviewed_pass");
    expect(row.notes).toBe("Strong candidate");
    expect(row.updatedBy).toBe("reviewer");
    // Should not include internal fields like _id, _creationTime
    expect(row).not.toHaveProperty("_id");
  });

  // -------------------------------------------------------------------------
  // Phase 2: digest status propagation
  // -------------------------------------------------------------------------

  it("propagates status changes into resume_digest_statuses overlay", async () => {
    const t = createTest();
    await t.run(async (ctx) => {
      const resumeId = await ctx.db.insert("resumes", {
        externalId: "status-digest-resume",
        identityKey: "status-digest-identity",
        content: { name: "Status Digest Candidate" },
        hash: "status-digest-hash",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
      });
      await ctx.db.insert("resume_digests", {
        resumeId,
        identityKey: "status-digest-identity",
        externalId: "status-digest-resume",
        source: "test",
        sourceKey: "test",
        searchText: "status digest candidate",
        updatedAt: Date.now(),
      });
    });

    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "status-digest-ws",
      identityKey: "status-digest-identity",
      status: "contacted",
      writeSecret: WRITE_SECRET,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("resume_digest_statuses").collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].identityKey).toBe("status-digest-identity");
    expect(rows[0].workspaceSlug).toBe("status-digest-ws");
    expect(rows[0].status).toBe("contacted");
  });

  it("preserves independent workspace statuses in the digest overlay", async () => {
    const t = createTest();
    await t.run(async (ctx) => {
      const resumeId = await ctx.db.insert("resumes", {
        externalId: "multi-ws-resume",
        identityKey: "multi-ws-identity",
        content: { name: "Multi WS Candidate" },
        hash: "multi-ws-hash",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
      });
      await ctx.db.insert("resume_digests", {
        resumeId,
        identityKey: "multi-ws-identity",
        externalId: "multi-ws-resume",
        source: "test",
        sourceKey: "test",
        searchText: "multi ws candidate",
        updatedAt: Date.now(),
      });
    });

    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-a",
      identityKey: "multi-ws-identity",
      status: "shortlisted",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-b",
      identityKey: "multi-ws-identity",
      status: "rejected",
      writeSecret: WRITE_SECRET,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("resume_digest_statuses").collect()
    );
    expect(rows).toHaveLength(2);
    const wsA = rows.find((r) => r.workspaceSlug === "ws-a");
    const wsB = rows.find((r) => r.workspaceSlug === "ws-b");
    expect(wsA?.status).toBe("shortlisted");
    expect(wsB?.status).toBe("rejected");
  });
});

describe("candidate_status: importNotesBatch", () => {
  it("round-trips legacy rows through a portable derived identity after resume ids change", async () => {
    const t = createTest();
    const legacyResumeId = await t.run(async (ctx) => await ctx.db.insert("resumes", {
      externalId: "legacy-external-id",
      content: { name: "Legacy Candidate" },
      hash: "legacy-hash",
      tags: [],
      crawledAt: 1_700_000_000_000,
      source: "test",
      sourceKey: "test",
      workspaceSlug: "dev",
    }));
    const resumeId = String(legacyResumeId);
    const portableIdentityKey = "externalId:legacy-external-id";

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "dev",
      items: [{ resumeId, comments: "Legacy note" }],
      writeSecret: WRITE_SECRET,
    });

    expect(result.results).toEqual([{
      resumeId,
      identityKey: portableIdentityKey,
      outcome: "applied",
    }]);
    const resumeBackup = await t.query(api.resumes.listForBackup, {
      paginationOpts: { cursor: null, numItems: 50 },
    });
    expect((resumeBackup.page[0] as Record<string, unknown>).identityKey).toBe(portableIdentityKey);
    const statusBackup = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "dev",
      identityKey: portableIdentityKey,
    });
    expect(statusBackup).toMatchObject({ notes: "Legacy note" });

    await t.run(async (ctx) => {
      const statuses = await ctx.db.query("candidate_status").collect();
      const overlays = await ctx.db.query("resume_digest_statuses").collect();
      for (const status of statuses) await ctx.db.delete(status._id);
      for (const overlay of overlays) await ctx.db.delete(overlay._id);
      await ctx.db.delete(legacyResumeId);
    });
    const reimportedResumeId = await t.run(async (ctx) => await ctx.db.insert("resumes", {
      externalId: "legacy-external-id",
      identityKey: portableIdentityKey,
      content: { name: "Legacy Candidate" },
      hash: "legacy-hash",
      tags: [],
      crawledAt: 1_800_000_000_000,
      source: "test",
      sourceKey: "test",
      workspaceSlug: "dev",
    }));
    expect(String(reimportedResumeId)).not.toBe(resumeId);

    await expect(t.mutation(api.candidate_status.restoreBatch, {
      workspaceSlug: "dev",
      items: [{
        identityKey: portableIdentityKey,
        status: statusBackup!.status,
        notes: statusBackup!.notes,
        updatedBy: statusBackup!.updatedBy,
        updatedAt: statusBackup!.updatedAt,
        history: statusBackup!.history,
      }],
      writeSecret: WRITE_SECRET,
    })).resolves.toMatchObject({ requested: 1, restored: 1, unresolvedIdentityKeys: [] });
    expect(await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "dev",
      identityKey: portableIdentityKey,
    })).toMatchObject({ notes: "Legacy note" });
  });

  it("migrates legacy document-id lifecycle state into one visible portable identity", async () => {
    const t = createTest();
    const legacyResumeId = await t.run(async (ctx) => await ctx.db.insert("resumes", {
      externalId: "legacy-lifecycle-external-id",
      content: { name: "Legacy Lifecycle Candidate" },
      hash: "legacy-lifecycle-hash",
      tags: [],
      crawledAt: 1_700_000_000_000,
      source: "test",
      sourceKey: "test",
      workspaceSlug: "dev",
    }));
    const legacyIdentityKey = String(legacyResumeId);
    const portableIdentityKey = "externalId:legacy-lifecycle-external-id";
    const lifecycleHistory = [{
      status: "new",
      updatedAt: 1_600_000_000_000,
      notes: "Initial review",
    }];
    const portableOnlyHistory = [{
      status: "contacted",
      updatedAt: 1_750_000_000_000,
      notes: "Portable duplicate history",
    }];

    await t.mutation(api.resumes_search.upsertResumeDigestForTest, { resumeId: legacyResumeId });
    await t.run(async (ctx) => {
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "dev",
        identityKey: legacyIdentityKey,
        status: "shortlisted",
        notes: "Legacy lifecycle note",
        updatedBy: "legacy-reviewer",
        updatedAt: 1_700_000_000_000,
        history: lifecycleHistory,
      });
      await ctx.db.insert("resume_digest_statuses", {
        resumeId: legacyResumeId,
        workspaceSlug: "dev",
        identityKey: legacyIdentityKey,
        status: "shortlisted",
        updatedAt: 1_700_000_000_000,
      });

      // Reproduce the duplicate left by the pre-migration note-import path.
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "dev",
        identityKey: portableIdentityKey,
        status: "new",
        notes: "Prior imported note",
        updatedBy: "prior-importer",
        updatedAt: 1_800_000_000_000,
        history: [...lifecycleHistory, ...portableOnlyHistory],
      });
      await ctx.db.insert("resume_digest_statuses", {
        resumeId: legacyResumeId,
        workspaceSlug: "dev",
        identityKey: portableIdentityKey,
        status: "new",
        updatedAt: 1_800_000_000_000,
      });

      // Identity migration must not rewrite another workspace's lifecycle rows.
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "other",
        identityKey: legacyIdentityKey,
        status: "rejected",
        notes: "Other workspace note",
        updatedAt: 1_650_000_000_000,
        history: [],
      });
      await ctx.db.insert("resume_digest_statuses", {
        resumeId: legacyResumeId,
        workspaceSlug: "other",
        identityKey: legacyIdentityKey,
        status: "rejected",
        updatedAt: 1_650_000_000_000,
      });
    });
    vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "dev",
      items: [{ resumeId: legacyIdentityKey, comments: "Final HR note" }],
      updatedBy: "current-reviewer",
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({ requested: 1, applied: 1, unchanged: 0, notFound: 0 });
    expect(result.results).toEqual([{
      resumeId: legacyIdentityKey,
      identityKey: portableIdentityKey,
      outcome: "applied",
    }]);

    const state = await t.run(async (ctx) => ({
      resume: await ctx.db.get(legacyResumeId),
      digests: await ctx.db
        .query("resume_digests")
        .withIndex("by_resumeId", (q) => q.eq("resumeId", legacyResumeId))
        .collect(),
      statuses: await ctx.db.query("candidate_status").collect(),
      overlays: await ctx.db.query("resume_digest_statuses").collect(),
    }));
    expect(state.resume?.identityKey).toBe(portableIdentityKey);
    expect(state.digests).toHaveLength(1);
    expect(state.digests[0]?.identityKey).toBe(portableIdentityKey);

    const devStatuses = state.statuses.filter((row) => row.workspaceSlug === "dev");
    expect(devStatuses).toHaveLength(1);
    expect(devStatuses[0]).toMatchObject({
      identityKey: portableIdentityKey,
      status: "shortlisted",
      notes: "Final HR note",
      updatedBy: "current-reviewer",
      updatedAt: 1_900_000_000_000,
      history: [...lifecycleHistory, ...portableOnlyHistory],
    });
    const devOverlays = state.overlays.filter((row) => row.workspaceSlug === "dev");
    expect(devOverlays).toHaveLength(1);
    expect(devOverlays[0]).toMatchObject({
      resumeId: legacyResumeId,
      identityKey: portableIdentityKey,
      status: "shortlisted",
      updatedAt: 1_900_000_000_000,
    });

    expect(state.statuses.filter((row) => row.workspaceSlug === "other")).toEqual([
      expect.objectContaining({
        identityKey: legacyIdentityKey,
        status: "rejected",
        notes: "Other workspace note",
      }),
    ]);
    expect(state.overlays.filter((row) => row.workspaceSlug === "other")).toEqual([
      expect.objectContaining({
        identityKey: legacyIdentityKey,
        status: "rejected",
      }),
    ]);

    const activeResumes = await t.query(api.resumes.list, { limit: 10 });
    expect(activeResumes.find((resume) => resume._id === legacyResumeId)?.identityKey)
      .toBe(portableIdentityKey);
    const projectedResumes = await t.query(api.resumes_search.getResumeDocsByIds, {
      ids: [legacyResumeId],
    });
    expect(projectedResumes).toEqual([
      expect.objectContaining({ identityKey: portableIdentityKey }),
    ]);
    const digestProjection = await t.query(api.resumes_search.scanResumeDigestPage, { numItems: 10 });
    expect(digestProjection.docs).toEqual([
      expect.objectContaining({ resumeId: legacyResumeId, identityKey: portableIdentityKey }),
    ]);
  });

  it("migrates lingering document-id lifecycle state after resume identity backfill", async () => {
    const t = createTest();
    const fixture = await seedBackfilledLegacyCandidateState(t, "changed-note", "Legacy note");
    vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "dev",
      items: [{ resumeId: fixture.legacyIdentityKey, comments: "Changed HR note" }],
      updatedBy: "current-reviewer",
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({ requested: 1, applied: 1, unchanged: 0, notFound: 0 });
    const state = await t.run(async (ctx) => ({
      resume: await ctx.db.get(fixture.resumeId),
      digests: await ctx.db
        .query("resume_digests")
        .withIndex("by_resumeId", (q) => q.eq("resumeId", fixture.resumeId))
        .collect(),
      statuses: await ctx.db.query("candidate_status").collect(),
      overlays: await ctx.db.query("resume_digest_statuses").collect(),
    }));

    expect(state.resume?.identityKey).toBe(fixture.portableIdentityKey);
    expect(state.digests).toEqual([
      expect.objectContaining({ identityKey: fixture.portableIdentityKey }),
    ]);
    expect(state.statuses).toHaveLength(1);
    expect(state.statuses[0]).toMatchObject({
      identityKey: fixture.portableIdentityKey,
      status: "shortlisted",
      notes: "Changed HR note",
      updatedBy: "current-reviewer",
      updatedAt: 1_900_000_000_000,
      history: fixture.mergedHistory,
    });
    expect(state.overlays).toHaveLength(1);
    expect(state.overlays[0]).toMatchObject({
      resumeId: fixture.resumeId,
      identityKey: fixture.portableIdentityKey,
      status: "shortlisted",
      updatedAt: 1_900_000_000_000,
    });
  });

  it("repairs unchanged legacy notes without lifecycle or overlay timestamp churn", async () => {
    const t = createTest();
    const fixture = await seedBackfilledLegacyCandidateState(
      t,
      "unchanged-note",
      "Authoritative legacy note",
    );
    vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "dev",
      items: [{
        resumeId: fixture.legacyIdentityKey,
        comments: "  Authoritative legacy note  ",
      }],
      updatedBy: "must-not-replace-actor",
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({ requested: 1, applied: 0, unchanged: 1, notFound: 0 });
    expect(result.results).toEqual([{
      resumeId: fixture.legacyIdentityKey,
      identityKey: fixture.portableIdentityKey,
      outcome: "unchanged",
    }]);
    const state = await t.run(async (ctx) => ({
      resume: await ctx.db.get(fixture.resumeId),
      digests: await ctx.db
        .query("resume_digests")
        .withIndex("by_resumeId", (q) => q.eq("resumeId", fixture.resumeId))
        .collect(),
      statuses: await ctx.db.query("candidate_status").collect(),
      overlays: await ctx.db.query("resume_digest_statuses").collect(),
    }));

    expect(state.resume?.identityKey).toBe(fixture.portableIdentityKey);
    expect(state.digests).toEqual([
      expect.objectContaining({ identityKey: fixture.portableIdentityKey }),
    ]);
    expect(state.statuses).toHaveLength(1);
    expect(state.statuses[0]).toMatchObject({
      identityKey: fixture.portableIdentityKey,
      status: "shortlisted",
      notes: "Authoritative legacy note",
      updatedBy: "legacy-reviewer",
      updatedAt: 1_700_000_000_000,
      history: fixture.mergedHistory,
    });
    expect(state.overlays).toHaveLength(1);
    expect(state.overlays[0]).toMatchObject({
      resumeId: fixture.resumeId,
      identityKey: fixture.portableIdentityKey,
      status: "shortlisted",
      updatedAt: 1_700_000_000_000,
    });
  });

  it("blocks foreign workspace resume ids but allows unscoped shared bodies for hr notes", async () => {
    const t = createTest();
    const hrResumeId = await insertResumeWithIdentity(t, "hr-identity", "hr");
    const otherResumeId = await insertResumeWithIdentity(t, "other-identity", "other");
    const unscopedResumeId = await insertResumeWithIdentity(t, "legacy-unscoped", null);

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [
        { resumeId: hrResumeId, comments: "Allowed" },
        { resumeId: otherResumeId, comments: "Must not leak" },
        { resumeId: unscopedResumeId, comments: "Shared public body" },
      ],
      writeSecret: WRITE_SECRET,
    });

    // Explicit hr + unscoped shared corpus are writable from hr; foreign workspace is not.
    expect(result).toMatchObject({ requested: 3, applied: 2, notFound: 1 });
    expect(result.results).toEqual([
      { resumeId: hrResumeId, identityKey: "hr-identity", outcome: "applied" },
      { resumeId: otherResumeId, outcome: "notFound", reason: "resume_not_found" },
      { resumeId: unscopedResumeId, identityKey: "legacy-unscoped", outcome: "applied" },
    ]);
    const statuses = await t.run(async (ctx) => ctx.db.query("candidate_status").collect());
    expect(statuses).toHaveLength(2);
    expect(statuses.every((row) => row.workspaceSlug === "hr")).toBe(true);

    const devResult = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "dev",
      items: [{ resumeId: unscopedResumeId, comments: "Legacy dev note" }],
      writeSecret: WRITE_SECRET,
    });
    expect(devResult).toMatchObject({ applied: 1, notFound: 0 });
  });

  it("resolves raw resume ids to stored identities and inserts new candidate notes", async () => {
    const t = createTest();
    const resumeId = await insertResumeWithIdentity(t, "stored-identity-1");
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [{ resumeId: `  ${resumeId}  `, comments: "  Durable HR note  " }],
      updatedBy: "user-123",
      writeSecret: WRITE_SECRET,
    });

    expect(result).toEqual({
      requested: 1,
      applied: 1,
      unchanged: 0,
      notFound: 0,
      skipped: 0,
      results: [{
        resumeId,
        identityKey: "stored-identity-1",
        outcome: "applied",
      }],
    });
    const status = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: "stored-identity-1",
    });
    expect(status).toMatchObject({
      workspaceSlug: "hr",
      identityKey: "stored-identity-1",
      status: "new",
      notes: "Durable HR note",
      updatedBy: "user-123",
      updatedAt: 1_800_000_000_000,
      history: [],
    });
    const overlays = await t.run(async (ctx) => ctx.db.query("resume_digest_statuses").collect());
    expect(overlays).toEqual([
      expect.objectContaining({
        resumeId,
        workspaceSlug: "hr",
        identityKey: "stored-identity-1",
        status: "new",
        updatedAt: 1_800_000_000_000,
      }),
    ]);
  });

  it("preserves status and history while avoiding timestamp churn for an identical note", async () => {
    const t = createTest();
    const resumeId = await insertResumeWithIdentity(t, "stored-identity-2");
    await t.run(async (ctx) => {
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "hr",
        identityKey: "stored-identity-2",
        status: "shortlisted",
        notes: "Old note",
        updatedBy: "old-user",
        updatedAt: 1_700_000_000_000,
        history: [{ status: "new", updatedAt: 1_600_000_000_000, notes: "Initial" }],
      });
    });
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

    const changed = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [{ resumeId, comments: "New note" }],
      updatedBy: "user-456",
      writeSecret: WRITE_SECRET,
    });
    expect(changed.applied).toBe(1);

    vi.mocked(Date.now).mockReturnValue(1_900_000_000_000);
    const unchanged = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [{ resumeId, comments: " New note " }],
      updatedBy: "different-user",
      writeSecret: WRITE_SECRET,
    });
    expect(unchanged).toMatchObject({ applied: 0, unchanged: 1 });
    expect(unchanged.results).toEqual([{ resumeId, identityKey: "stored-identity-2", outcome: "unchanged" }]);

    const status = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: "stored-identity-2",
    });
    expect(status).toMatchObject({
      status: "shortlisted",
      notes: "New note",
      updatedBy: "user-456",
      updatedAt: 1_800_000_000_000,
      history: [{ status: "new", updatedAt: 1_600_000_000_000, notes: "Initial" }],
    });
    const overlay = await t.run(async (ctx) => ctx.db.query("resume_digest_statuses").first());
    expect(overlay?.updatedAt).toBe(1_800_000_000_000);
  });

  it("uses the last nonempty duplicate and keeps outcomes in original row order", async () => {
    const t = createTest();
    const resumeId = await insertResumeWithIdentity(t, "duplicate-identity");

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [
        { resumeId, comments: "First note" },
        { resumeId, comments: "Final note" },
        { resumeId, comments: "   " },
        { resumeId: "not-a-convex-id", comments: "Missing" },
      ],
      updatedBy: "user-789",
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({
      requested: 4,
      applied: 1,
      unchanged: 0,
      notFound: 1,
      skipped: 2,
    });
    expect(result.results).toEqual([
      { resumeId, outcome: "skipped", reason: "superseded_by_later_duplicate" },
      { resumeId, identityKey: "duplicate-identity", outcome: "applied" },
      { resumeId, outcome: "skipped", reason: "empty_comments" },
      { resumeId: "not-a-convex-id", outcome: "notFound", reason: "resume_not_found" },
    ]);
    const status = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: "duplicate-identity",
    });
    expect(status?.notes).toBe("Final note");
  });

  it("imports notes for unscoped (shared) resumes under the hr workspace", async () => {
    const t = createTest();
    const resumeId = await t.run(async (ctx) => {
      return String(await ctx.db.insert("resumes", {
        externalId: "250533275",
        identityKey: "profileUrl:ehire.51job.com/revision/talent/resume/detail?contenttype=&resumeid=250533275",
        content: { name: "舒先生" },
        hash: "hash-unscoped-hr-note",
        tags: [],
        crawledAt: 1_700_000_000_000,
        source: "ehire.51job.com",
        sourceKey: "ehire.51job.com",
        // no workspaceSlug — public shared corpus
      }));
    });

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [{ resumeId, comments: "半导体，行业不匹配" }],
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({
      requested: 1,
      applied: 1,
      notFound: 0,
    });
    const status = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: "profileUrl:ehire.51job.com/revision/talent/resume/detail?contenttype=&resumeid=250533275",
    });
    expect(status?.notes).toBe("半导体，行业不匹配");
  });

  it("resolves notes by profile URL / externalId when export Convex resume ids no longer exist after restore", async () => {
    const t = createTest();
    const profileUrl =
      "https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=250533275";
    const externalId = "250533275";
    const currentResumeId = await t.run(async (ctx) => {
      return String(await ctx.db.insert("resumes", {
        externalId,
        identityKey: `profileUrl:ehire.51job.com/revision/talent/resume/detail?contenttype=&resumeid=${externalId}`,
        content: { name: "舒先生", profileUrl },
        hash: "hash-restore-1",
        tags: [],
        crawledAt: 1_700_000_000_000,
        source: "ehire.51job.com",
        sourceKey: "ehire.51job.com",
        workspaceSlug: "hr",
      }));
    });
    expect(currentResumeId).not.toBe("k172ydnrexaqrhq66myhqqd1r18885k3");

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [{
        resumeId: "k172ydnrexaqrhq66myhqqd1r18885k3",
        profileUrl,
        comments: "半导体，行业不匹配",
      }],
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({
      requested: 1,
      applied: 1,
      notFound: 0,
    });
    expect(result.results[0]?.outcome).toBe("applied");
    const status = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: `profileUrl:ehire.51job.com/revision/talent/resume/detail?contenttype=&resumeid=${externalId}`,
    });
    expect(status?.notes).toBe("半导体，行业不匹配");
  });

  it("prefers the existing portable analyzed resume over a legacy duplicate when resolving by profile URL", async () => {
    const t = createTest();
    const profileUrl =
      "https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=250533275";
    const portableIdentityKey =
      "profileUrl:ehire.51job.com/revision/talent/resume/detail?contenttype=&resumeid=250533275";
    const externalId = "250533275";

    const legacyResumeId = await t.run(async (ctx) => {
      return await ctx.db.insert("resumes", {
        externalId,
        content: { name: "Legacy Duplicate", profileUrl },
        hash: "hash-legacy-duplicate",
        tags: [],
        crawledAt: 1_700_000_000_000,
        source: "ehire.51job.com",
        sourceKey: "ehire.51job.com",
        workspaceSlug: "hr",
      });
    });
    await t.mutation(api.resumes_search.upsertResumeDigestForTest, { resumeId: legacyResumeId });

    const portableResumeId = await t.run(async (ctx) => {
      return await ctx.db.insert("resumes", {
        externalId,
        identityKey: portableIdentityKey,
        content: { name: "Portable Canonical", profileUrl },
        hash: "hash-portable-canonical",
        tags: [],
        crawledAt: 1_699_000_000_000,
        source: "ehire.51job.com",
        sourceKey: "ehire.51job.com",
        workspaceSlug: "hr",
      });
    });
    await seedResumeAnalysesColdRow(t, portableResumeId, {
      analysis: {
        score: 88,
        summary: "Keep the analyzed canonical duplicate",
        highlights: ["CNC sales background"],
        recommendation: "match",
      },
    });
    await t.mutation(api.resumes_search.upsertResumeDigestForTest, { resumeId: portableResumeId });

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [{
        resumeId: "k172ydnrexaqrhq66myhqqd1r18885k3",
        profileUrl,
        comments: "半导体，行业不匹配",
      }],
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({
      requested: 1,
      applied: 1,
      notFound: 0,
      results: [{
        identityKey: portableIdentityKey,
        outcome: "applied",
      }],
    });

    const state = await t.run(async (ctx) => ({
      legacyResume: await ctx.db.get(legacyResumeId),
      portableResume: await ctx.db.get(portableResumeId),
      digests: await ctx.db.query("resume_digests").collect(),
      overlays: await ctx.db.query("resume_digest_statuses").collect(),
    }));

    expect(state.legacyResume?.identityKey).toBeUndefined();
    expect(state.portableResume?.identityKey).toBe(portableIdentityKey);
    expect(state.digests.find((digest) => digest.resumeId === legacyResumeId)?.identityKey).toBeUndefined();
    expect(state.digests.find((digest) => digest.resumeId === portableResumeId)?.identityKey).toBe(portableIdentityKey);
    expect(state.overlays).toEqual([
      expect.objectContaining({
        resumeId: portableResumeId,
        identityKey: portableIdentityKey,
        workspaceSlug: "hr",
        status: "new",
      }),
    ]);

    const status = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: portableIdentityKey,
    });
    expect(status?.notes).toBe("半导体，行业不匹配");

    const detail = await t.query(api.resumes_search.getResumeDocsByIds, {
      ids: [portableResumeId],
    });
    expect(detail).toEqual([
      expect.objectContaining({
        _id: portableResumeId,
        identityKey: portableIdentityKey,
        analysis: expect.objectContaining({
          score: 88,
          summary: "Keep the analyzed canonical duplicate",
        }),
      }),
    ]);
  });

  it("rejects 101 note items atomically without changing status or overlays", async () => {
    const t = createTest();
    const resumeId = await insertResumeWithIdentity(t, "atomic-import-identity");
    await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [{ resumeId, comments: "Original note" }],
      writeSecret: WRITE_SECRET,
    });
    const before = await t.run(async (ctx) => ({
      statuses: await ctx.db.query("candidate_status").collect(),
      overlays: await ctx.db.query("resume_digest_statuses").collect(),
    }));

    await expect(t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: Array.from({ length: 101 }, () => ({ resumeId, comments: "Replacement" })),
      writeSecret: WRITE_SECRET,
    })).rejects.toThrow("at most 100");

    expect(await t.run(async (ctx) => ({
      statuses: await ctx.db.query("candidate_status").collect(),
      overlays: await ctx.db.query("resume_digest_statuses").collect(),
    }))).toEqual(before);
  });
});

describe("candidate_status: restoreBatch", () => {
  it("restores an explicit orphan status without creating a digest overlay", async () => {
    const t = createTest();
    const history = [{ status: "new", updatedAt: 1_700_000_000_000, notes: "Archived note" }];

    const firstResult = await t.mutation(api.candidate_status.restoreBatch, {
      workspaceSlug: "dev",
      allowOrphan: true,
      items: [{
        identityKey: "smoke-nonhr",
        status: "rejected",
        notes: "Archived note",
        updatedBy: "backup-user",
        updatedAt: 1_782_291_761_290,
        history,
      }],
      writeSecret: WRITE_SECRET,
    });

    expect(firstResult).toEqual({
      requested: 1,
      restored: 1,
      inserted: 1,
      updated: 0,
      unresolvedIdentityKeys: [],
    });
    expect(await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "dev",
      identityKey: "smoke-nonhr",
    })).toMatchObject({
      status: "rejected",
      notes: "Archived note",
      updatedBy: "backup-user",
      updatedAt: 1_782_291_761_290,
      history,
    });
    expect(await t.run(async (ctx) => ctx.db.query("resume_digest_statuses").collect())).toEqual([]);

    const updatedHistory = [
      ...history,
      { status: "rejected", updatedAt: 1_782_291_761_290, notes: "Archived note" },
    ];
    const secondResult = await t.mutation(api.candidate_status.restoreBatch, {
      workspaceSlug: "dev",
      allowOrphan: true,
      items: [{
        identityKey: "smoke-nonhr",
        status: "withdrawn",
        notes: "Replacement archive note",
        updatedBy: "recovery-user",
        updatedAt: 1_782_291_761_291,
        history: updatedHistory,
      }],
      writeSecret: WRITE_SECRET,
    });

    expect(secondResult).toEqual({
      requested: 1,
      restored: 1,
      inserted: 0,
      updated: 1,
      unresolvedIdentityKeys: [],
    });
    expect(await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "dev",
      identityKey: "smoke-nonhr",
    })).toMatchObject({
      status: "withdrawn",
      notes: "Replacement archive note",
      updatedBy: "recovery-user",
      updatedAt: 1_782_291_761_291,
      history: updatedHistory,
    });
    expect(await t.run(async (ctx) => ctx.db.query("resume_digest_statuses").collect())).toEqual([]);
  });

  it("keeps a foreign-workspace identity collision as an explicit orphan without an overlay", async () => {
    const t = createTest();
    const identityKey = "restore-foreign-orphan-identity";
    await insertResumeWithIdentity(t, identityKey, "hr");

    const result = await t.mutation(api.candidate_status.restoreBatch, {
      workspaceSlug: "dev",
      allowOrphan: true,
      items: [{
        identityKey,
        status: "rejected",
        notes: "Portable status",
        updatedBy: "backup-user",
        updatedAt: 1_782_291_761_300,
        history: [],
      }],
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({
      restored: 1,
      inserted: 1,
      unresolvedIdentityKeys: [],
    });
    expect(await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "dev",
      identityKey,
    })).toMatchObject({
      status: "rejected",
      notes: "Portable status",
    });
    expect(await t.run(async (ctx) => ctx.db.query("resume_digest_statuses").collect())).toEqual([]);
  });

  it("leaves a foreign-workspace identity collision unresolved without allowOrphan", async () => {
    const t = createTest();
    const identityKey = "restore-foreign-unresolved-identity";
    await insertResumeWithIdentity(t, identityKey, "hr");

    const result = await t.mutation(api.candidate_status.restoreBatch, {
      workspaceSlug: "dev",
      items: [{
        identityKey,
        status: "shortlisted",
        updatedAt: 1_782_291_761_301,
        history: [],
      }],
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({
      restored: 0,
      inserted: 0,
      updated: 0,
      unresolvedIdentityKeys: [identityKey],
    });
    expect(await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "dev",
      identityKey,
    })).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("resume_digest_statuses").collect())).toEqual([]);
  });

  it("restores exact candidate state and rebuilds the digest status overlay", async () => {
    const t = createTest();
    const restoredResumeId = await insertResumeWithIdentity(t, "restore-identity");
    const insertedResumeId = await insertResumeWithIdentity(t, "inserted-identity");
    await insertResumeWithIdentity(t, "clear-optionals-identity");
    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "hr",
      identityKey: "restore-identity",
      status: "new",
      notes: "State to replace",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "hr",
      identityKey: "clear-optionals-identity",
      status: "new",
      notes: "Remove this note",
      updatedBy: "remove-this-user",
      writeSecret: WRITE_SECRET,
    });
    const restoredHistory = [
      { status: "new", updatedAt: 1_500_000_000_000, notes: "Initial" },
      { status: "contacted", updatedAt: 1_600_000_000_000 },
    ];

    const result = await t.mutation(api.candidate_status.restoreBatch, {
      workspaceSlug: "hr",
      items: [
        {
          identityKey: "restore-identity",
          status: "withdrawn",
          notes: "Archived operational note",
          updatedBy: "backup-user",
          updatedAt: 1_700_000_000_000,
          history: restoredHistory,
        },
        {
          identityKey: "inserted-identity",
          status: "shortlisted",
          notes: "Restored new row",
          updatedBy: "backup-user",
          updatedAt: 1_700_000_000_001,
          history: [],
        },
        {
          identityKey: "clear-optionals-identity",
          status: "contacted",
          updatedAt: 1_700_000_000_002,
          history: [],
        },
        {
          identityKey: "missing-identity",
          status: "shortlisted",
          updatedAt: 1_700_000_000_003,
          history: [],
        },
      ],
      writeSecret: WRITE_SECRET,
    });

    expect(result).toEqual({
      requested: 4,
      restored: 3,
      inserted: 1,
      updated: 2,
      unresolvedIdentityKeys: ["missing-identity"],
    });
    const status = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: "restore-identity",
    });
    expect(status).toMatchObject({
      status: "withdrawn",
      notes: "Archived operational note",
      updatedBy: "backup-user",
      updatedAt: 1_700_000_000_000,
      history: restoredHistory,
    });
    expect(await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: "missing-identity",
    })).toBeNull();
    const inserted = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: "inserted-identity",
    });
    expect(inserted).toMatchObject({
      status: "shortlisted",
      notes: "Restored new row",
      updatedBy: "backup-user",
      updatedAt: 1_700_000_000_001,
      history: [],
    });
    const cleared = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: "clear-optionals-identity",
    });
    expect(cleared).not.toHaveProperty("notes");
    expect(cleared).not.toHaveProperty("updatedBy");
    expect(cleared).toMatchObject({
      status: "contacted",
      updatedAt: 1_700_000_000_002,
      history: [],
    });
    const overlays = await t.run(async (ctx) => ctx.db.query("resume_digest_statuses").collect());
    expect(overlays).toHaveLength(3);
    expect(overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resumeId: restoredResumeId,
        workspaceSlug: "hr",
        identityKey: "restore-identity",
        status: "withdrawn",
        updatedAt: 1_700_000_000_000,
      }),
      expect.objectContaining({
        resumeId: insertedResumeId,
        workspaceSlug: "hr",
        identityKey: "inserted-identity",
        status: "shortlisted",
        updatedAt: 1_700_000_000_001,
      }),
    ]));
  });

  it("rejects 101 restore items atomically without changing status or overlays", async () => {
    const t = createTest();
    const resumeId = await insertResumeWithIdentity(t, "atomic-restore-identity");
    await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [{ resumeId, comments: "Original note" }],
      writeSecret: WRITE_SECRET,
    });
    const before = await t.run(async (ctx) => ({
      statuses: await ctx.db.query("candidate_status").collect(),
      overlays: await ctx.db.query("resume_digest_statuses").collect(),
    }));

    await expect(t.mutation(api.candidate_status.restoreBatch, {
      workspaceSlug: "hr",
      items: Array.from({ length: 101 }, () => ({
        identityKey: "atomic-restore-identity",
        status: "withdrawn" as const,
        notes: "Replacement",
        updatedAt: 2_000_000_000_000,
        history: [],
      })),
      writeSecret: WRITE_SECRET,
    })).rejects.toThrow("at most 100");

    expect(await t.run(async (ctx) => ({
      statuses: await ctx.db.query("candidate_status").collect(),
      overlays: await ctx.db.query("resume_digest_statuses").collect(),
    }))).toEqual(before);
  });
});

describe("candidate_status: paginated server reads", () => {
  it("reads all status rows beyond the legacy 500-row limit", async () => {
    const t = createTest();
    await t.run(async (ctx) => {
      for (let index = 0; index < 501; index += 1) {
        await ctx.db.insert("candidate_status", {
          workspaceSlug: "large-workspace",
          identityKey: `candidate-${String(index).padStart(3, "0")}`,
          status: "new",
          updatedAt: index,
          history: [],
        });
      }
    });

    const first = await t.query(api.candidate_status.listPage, {
      workspaceSlug: "large-workspace",
      paginationOpts: { cursor: null, numItems: 500 },
      writeSecret: WRITE_SECRET,
    });
    const second = await t.query(api.candidate_status.listPage, {
      workspaceSlug: "large-workspace",
      paginationOpts: { cursor: first.continueCursor, numItems: 500 },
      writeSecret: WRITE_SECRET,
    });

    expect(first.page).toHaveLength(500);
    expect(first.isDone).toBe(false);
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
  });

  it("reads requested identities once and keeps workspace boundaries", async () => {
    const t = createTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "hr",
        identityKey: "candidate-a",
        status: "shortlisted",
        updatedAt: 1,
        history: [],
      });
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "hr",
        identityKey: "candidate-b",
        status: "contacted",
        updatedAt: 2,
        history: [],
      });
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "other",
        identityKey: "candidate-c",
        status: "rejected",
        updatedAt: 3,
        history: [],
      });
    });

    const rows = await t.query(api.candidate_status.getByIdentities, {
      workspaceSlug: "hr",
      identityKeys: [" candidate-a ", "candidate-a", "missing", "candidate-b", "candidate-c"],
      writeSecret: WRITE_SECRET,
    });

    expect(rows.map((row) => row.identityKey)).toEqual(["candidate-a", "candidate-b"]);
  });
});
