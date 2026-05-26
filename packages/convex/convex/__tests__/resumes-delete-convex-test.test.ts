/**
 * Integration tests for deleteResumes using convex-test.
 *
 * Replaces resumes-delete.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";


// Helper: insert a minimal resume
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

describe("resumes: deleteResumes", () => {
  it("deletes targeted resumes and reports results", async () => {
    const t = createTest();

    const resumeId1 = await insertResume(t, { content: { name: "Alice" } });
    const resumeId2 = await insertResume(t, { content: { name: "Bob" } });

    // Insert screening session referencing resume1
    await t.run(async (ctx) => {
      await ctx.db.insert("screening_sessions", {
        sessionKey: "session-1",
        workspaceSlug: "dev",
        status: "active",
        config: { location: "", keywords: [], filters: {} },
        lastActive: Date.now(),
        reviewedResumeIds: [String(resumeId1), "keep-me"],
      });
    });

    const result = await t.mutation(api.resumes.deleteResumes, {
      resumeIds: [String(resumeId1)],
    });

    expect(result.requested).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.missingResumeIds).toEqual([]);
    expect(result.patchedScreeningSessions).toBe(1);

    // Verify the resume is gone
    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });
    expect(resumes.find((r) => String(r._id) === String(resumeId1))).toBeUndefined();
    expect(resumes.find((r) => String(r._id) === String(resumeId2))).toBeDefined();

    // Verify screening session was patched (resumeId1 removed from reviewedResumeIds)
    const sessions = await t.run(async (ctx) => {
      return ctx.db.query("screening_sessions").collect();
    });
    expect(sessions[0].reviewedResumeIds).not.toContain(String(resumeId1));
  });

  it("reports missing resume IDs for non-existent resumes", async () => {
    const t = createTest();

    const result = await t.mutation(api.resumes.deleteResumes, {
      resumeIds: ["nonexistent-id"],
    });

    expect(result.requested).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.deletedAiTaggingResults).toBe(0);
    expect(result.patchedScreeningSessions).toBe(0);
  });

  it("returns zeros for empty input", async () => {
    const t = createTest();

    const result = await t.mutation(api.resumes.deleteResumes, {
      resumeIds: [],
    });

    expect(result).toEqual({
      requested: 0,
      deleted: 0,
      missingResumeIds: [],
      deletedAiTaggingResults: 0,
      patchedScreeningSessions: 0,
    });
  });
});
