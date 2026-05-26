/**
 * Integration tests for candidate_status.ts using convex-test.
 *
 * Covers: list, listForBackup, getByIdentity, upsert (insert + update + history).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// ---------------------------------------------------------------------------
// upsert + getByIdentity
// ---------------------------------------------------------------------------

describe("candidate_status: upsert + getByIdentity", () => {
  it("inserts a new candidate status", async () => {
    const t = convexTest(schema, modules);

    const id = await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-1",
      status: "new",
      notes: "Initial entry",
      updatedBy: "recruiter@example.com",
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
    const t = convexTest(schema, modules);

    await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-2",
      status: "new",
    });

    const now = Date.now();
    await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-2",
      status: "contacted",
      notes: "Reached out via email",
      updatedBy: "recruiter@example.com",
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
    const t = convexTest(schema, modules);

    await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-3",
      status: "new",
    });

    await t.mutation(api.candidate_status.upsert, {
      identityKey: "candidate-3",
      status: "new",
      notes: "Updated notes only",
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
    const t = convexTest(schema, modules);

    const result = await t.query(api.candidate_status.getByIdentity, {
      identityKey: "nonexistent",
    });

    expect(result).toBeNull();
  });

  it("throws when identityKey is empty", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.candidate_status.upsert, {
        identityKey: "  ",
        status: "new",
      }),
    ).rejects.toThrow("identityKey is required");
  });

  it("defaults workspaceSlug to 'dev' when empty string", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "",
      identityKey: "candidate-empty-ws",
      status: "new",
    });

    const result = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "dev",
      identityKey: "candidate-empty-ws",
    });

    expect(result).not.toBeNull();
    expect(result!.identityKey).toBe("candidate-empty-ws");
  });

  it("returns null for empty identityKey in getByIdentity", async () => {
    const t = convexTest(schema, modules);

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
    const t = convexTest(schema, modules);

    const list = await t.query(api.candidate_status.list, {
      workspaceSlug: "ws-empty",
    });

    expect(list).toEqual([]);
  });

  it("lists candidate statuses for a workspace", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-list",
      identityKey: "c-1",
      status: "new",
    });
    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-list",
      identityKey: "c-2",
      status: "contacted",
    });
    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-other",
      identityKey: "c-3",
      status: "interviewing",
    });

    const list = await t.query(api.candidate_status.list, {
      workspaceSlug: "ws-list",
    });

    expect(list).toHaveLength(2);
    const keys = list.map((r) => r.identityKey).sort();
    expect(keys).toEqual(["c-1", "c-2"]);
  });

  it("listForBackup returns projected fields", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "ws-backup",
      identityKey: "c-backup",
      status: "interviewed_pass",
      notes: "Strong candidate",
      updatedBy: "reviewer",
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
});
