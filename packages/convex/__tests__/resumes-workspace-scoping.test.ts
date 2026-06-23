/**
 * Tests for workspace-scoped guards on Convex mutations.
 *
 * Defense-in-depth: mutations verify workspace membership even when
 * called directly (not through BFF middleware).
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

let _counter = 0;
async function insertResume(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  _counter += 1;
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `ext-${_counter}`,
      content: { name: `User ${_counter}` },
      hash: `hash-${_counter}`,
      tags: [],
      crawledAt: Date.now(),
      source: "test",
      sourceKey: "51job",
      ...overrides,
    });
  });
}

describe("resumes: workspace-scoped mutations", () => {
  describe("deleteResumes", () => {
    it("rejects when workspaceSlug mismatches resume workspace", async () => {
      const t = createTest();
      const id = await insertResume(t, { workspaceSlug: "hr" });

      await expect(
        t.mutation(api.resumes.deleteResumes, {
          resumeIds: [String(id)],
          workspaceSlug: "dev",
        }),
      ).rejects.toThrow(/Workspace access denied/);

      // Resume should still exist
      const resume = await t.run(async (ctx) => ctx.db.get(id));
      expect(resume).not.toBeNull();
    });

    it("succeeds when workspaceSlug matches resume workspace", async () => {
      const t = createTest();
      const id = await insertResume(t, { workspaceSlug: "hr" });

      const result = await t.mutation(api.resumes.deleteResumes, {
        resumeIds: [String(id)],
        workspaceSlug: "hr",
      });

      expect(result.deleted).toBe(1);
    });

    it("succeeds without workspaceSlug (backward compat)", async () => {
      const t = createTest();
      const id = await insertResume(t);

      const result = await t.mutation(api.resumes.deleteResumes, {
        resumeIds: [String(id)],
      });

      expect(result.deleted).toBe(1);
    });

    it("allows access when resume has no workspaceSlug even if caller provides one", async () => {
      const t = createTest();
      const id = await insertResume(t); // no workspaceSlug on resume

      const result = await t.mutation(api.resumes.deleteResumes, {
        resumeIds: [String(id)],
        workspaceSlug: "hr",
      });

      // Guard skips when resume.workspaceSlug is undefined (unassigned resume)
      expect(result.deleted).toBe(1);
    });
  });

  describe("archiveResumes", () => {
    it("rejects when workspaceSlug mismatches", async () => {
      const t = createTest();
      const id = await insertResume(t, { workspaceSlug: "hr" });

      await expect(
        t.mutation(api.resumes.archiveResumes, {
          resumeIds: [String(id)],
          workspaceSlug: "dev",
        }),
      ).rejects.toThrow(/Workspace access denied/);
    });

    it("succeeds when workspaceSlug matches", async () => {
      const t = createTest();
      const id = await insertResume(t, { workspaceSlug: "hr" });

      const result = await t.mutation(api.resumes.archiveResumes, {
        resumeIds: [String(id)],
        workspaceSlug: "hr",
      });

      expect(result.archived).toBe(1);
    });
  });

  describe("unarchiveResumes", () => {
    it("rejects when workspaceSlug mismatches", async () => {
      const t = createTest();
      const id = await insertResume(t, {
        workspaceSlug: "hr",
        isArchived: true,
        archivedAt: Date.now(),
      });

      await expect(
        t.mutation(api.resumes.unarchiveResumes, {
          resumeIds: [String(id)],
          workspaceSlug: "dev",
        }),
      ).rejects.toThrow(/Workspace access denied/);
    });
  });
});
