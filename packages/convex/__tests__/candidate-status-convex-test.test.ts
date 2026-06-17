/**
 * Integration tests for candidate_status.ts using convex-test.
 *
 * Covers: list, listForBackup, getByIdentity, upsert (insert + update + history).
 */
import { createTest } from "./test-helpers.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

const WRITE_SECRET = "test-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
    return;
  }
  process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
});

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
