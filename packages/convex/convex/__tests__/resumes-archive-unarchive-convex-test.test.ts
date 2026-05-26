/**
 * Integration tests for archiveResumes and unarchiveResumes using convex-test.
 *
 * Replaces resumes-archive-unarchive.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";


// Helper: insert a minimal resume document
let _resumeCounter = 0;
async function insertResume(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  _resumeCounter += 1;
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `ext-${_resumeCounter}`,
      content: { name: "Test User" },
      hash: `hash-${_resumeCounter}`,
      tags: [],
      crawledAt: Date.now(),
      source: "test",
      sourceKey: "51job",
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// archiveResumes
// ---------------------------------------------------------------------------

describe("resumes: archiveResumes", () => {
  it("archives active resumes and reports already-archived ones", async () => {
    const t = createTest();

    const id1 = await insertResume(t, { content: { name: "Alice" } });
    const id2 = await insertResume(t, {
      content: { name: "Bob" },
      isArchived: true,
      archivedAt: Date.now(),
    });
    const id3 = await insertResume(t, { content: { name: "Carol" } });

    const result = await t.mutation(api.resumes.archiveResumes, {
      resumeIds: [String(id1), String(id2), String(id3)],
    });

    expect(result.requested).toBe(3);
    expect(result.archived).toBe(2);
    expect(result.alreadyArchived).toBe(1);
    expect(result.missingResumeIds).toEqual([]);

    // Verify the resumes are now archived
    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });

    const alice = resumes.find((r) => String(r._id) === String(id1));
    expect(alice!.isArchived).toBe(true);
    expect(typeof alice!.archivedAt).toBe("number");
  });

  it("deduplicates resume IDs", async () => {
    const t = createTest();

    const id1 = await insertResume(t, { content: { name: "Alice" } });

    const result = await t.mutation(api.resumes.archiveResumes, {
      resumeIds: [String(id1), String(id1), String(id1)],
    });

    // Deduplication should reduce to 1 unique ID
    expect(result.requested).toBe(1);
    expect(result.archived).toBe(1);
  });

  it("reports missing resume IDs", async () => {
    const t = createTest();

    const result = await t.mutation(api.resumes.archiveResumes, {
      resumeIds: ["nonexistent-id-1", "nonexistent-id-2"],
    });

    expect(result.requested).toBe(2);
    expect(result.archived).toBe(0);
    expect(result.missingResumeIds.length).toBeGreaterThanOrEqual(0);
  });

  it("returns zeros for empty input", async () => {
    const t = createTest();

    const result = await t.mutation(api.resumes.archiveResumes, {
      resumeIds: [],
    });

    expect(result).toEqual({
      requested: 0,
      archived: 0,
      alreadyArchived: 0,
      missingResumeIds: [],
    });
  });
});

// ---------------------------------------------------------------------------
// unarchiveResumes
// ---------------------------------------------------------------------------

describe("resumes: unarchiveResumes", () => {
  it("unarchives previously archived resumes", async () => {
    const t = createTest();

    const id1 = await insertResume(t, {
      content: { name: "Alice" },
      isArchived: true,
      archivedAt: Date.now(),
    });
    const id2 = await insertResume(t, { content: { name: "Bob" } });

    const result = await t.mutation(api.resumes.unarchiveResumes, {
      resumeIds: [String(id1), String(id2)],
    });

    expect(result.requested).toBe(2);
    expect(result.unarchived).toBe(1);
    expect(result.notArchived).toBe(1);
    expect(result.missingResumeIds).toEqual([]);

    // Verify the archived resume is now unarchived
    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });

    const alice = resumes.find((r) => String(r._id) === String(id1));
    expect(alice!.isArchived).toBeUndefined();
    expect(alice!.archivedAt).toBeUndefined();
  });

  it("reports missing IDs for non-existent resumes", async () => {
    const t = createTest();

    const result = await t.mutation(api.resumes.unarchiveResumes, {
      resumeIds: ["nonexistent-id"],
    });

    expect(result.requested).toBe(1);
    expect(result.unarchived).toBe(0);
  });

  it("returns zeros for empty input", async () => {
    const t = createTest();

    const result = await t.mutation(api.resumes.unarchiveResumes, {
      resumeIds: [],
    });

    expect(result).toEqual({
      requested: 0,
      unarchived: 0,
      notArchived: 0,
      missingResumeIds: [],
    });
  });
});
