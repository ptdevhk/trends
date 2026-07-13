/**
 * Integration tests for candidate_status.ts using convex-test.
 *
 * Covers: list, listForBackup, getByIdentity, upsert (insert + update + history).
 */
import { createTest } from "./test-helpers.js";
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

  it("treats cross-workspace and non-dev unscoped resume ids as not found", async () => {
    const t = createTest();
    const hrResumeId = await insertResumeWithIdentity(t, "hr-identity", "hr");
    const otherResumeId = await insertResumeWithIdentity(t, "other-identity", "other");
    const unscopedResumeId = await insertResumeWithIdentity(t, "legacy-unscoped", null);

    const result = await t.mutation(api.candidate_status.importNotesBatch, {
      workspaceSlug: "hr",
      items: [
        { resumeId: hrResumeId, comments: "Allowed" },
        { resumeId: otherResumeId, comments: "Must not leak" },
        { resumeId: unscopedResumeId, comments: "Dev only" },
      ],
      writeSecret: WRITE_SECRET,
    });

    expect(result).toMatchObject({ requested: 3, applied: 1, notFound: 2 });
    expect(result.results).toEqual([
      { resumeId: hrResumeId, identityKey: "hr-identity", outcome: "applied" },
      { resumeId: otherResumeId, outcome: "notFound", reason: "resume_not_found" },
      { resumeId: unscopedResumeId, outcome: "notFound", reason: "resume_not_found" },
    ]);
    expect(await t.run(async (ctx) => ctx.db.query("candidate_status").collect())).toHaveLength(1);
    expect(await t.run(async (ctx) => ctx.db.query("resume_digest_statuses").collect())).toHaveLength(1);

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
