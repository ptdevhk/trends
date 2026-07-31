import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEntry,
  importEntries,
  type AdminServiceDeps,
  type IndustryDataEntry,
} from "./industry-data-admin-service.js";

function makeDeps(overrides: Partial<AdminServiceDeps> = {}): AdminServiceDeps & {
  store: Map<string, IndustryDataEntry>;
  changes: Array<Record<string, unknown>>;
  gitShas: Array<{ changeId: string; gitSha: string }>;
} {
  const store = new Map<string, IndustryDataEntry>();
  const changes: Array<Record<string, unknown>> = [];
  const gitShas: Array<{ changeId: string; gitSha: string }> = [];
  const base: AdminServiceDeps = {
    upsertEntry: async (input) => {
      store.set(input.entryId, {
        entryType: input.entryType,
        entryId: input.entryId,
        data: input.data,
        sortOrder: input.sortOrder,
        updatedBy: input.actor,
      });
      return { entryId: input.entryId };
    },
    deleteEntry: async (input) => {
      store.delete(input.entryId);
      return { ok: true as const };
    },
    getEntry: async (entryId) => store.get(entryId) ?? null,
    listEntries: async (entryType) =>
      [...store.values()].filter((e) => !entryType || e.entryType === entryType),
    appendChange: async (input) => {
      changes.push(input);
      return { changeId: input.changeId };
    },
    setChangeGitSha: async (input) => {
      gitShas.push(input);
      return { ok: true as const };
    },
    regenerateAndCommit: async () => ({
      sha: "abc123",
      written: ["brands.json", "keywords-structured.md", "company-urls.md"],
    }),
  };
  return { ...base, ...overrides, store, changes, gitShas };
}

const brandPayload = {
  id: 1,
  nameCn: "发那科",
  nameEn: "FANUC",
  type: "加工中心",
  origin: "international" as const,
};

describe("IndustryDataAdminService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createEntry writes entry + change (create) + regenerateAndCommit + setChangeGitSha", async () => {
    const deps = makeDeps();
    const result = await createEntry(
      {
        entryType: "brand",
        entryId: "brand-1",
        data: brandPayload,
        actor: "admin-1",
      },
      deps,
    );

    expect(result.entry?.entryId).toBe("brand-1");
    expect(result.gitSha).toBe("abc123");
    expect(deps.store.has("brand-1")).toBe(true);
    expect(deps.changes).toHaveLength(1);
    expect(deps.changes[0]).toMatchObject({
      entryId: "brand-1",
      action: "create",
      actor: "admin-1",
    });
    expect(deps.gitShas).toEqual([{ changeId: result.changeId, gitSha: "abc123" }]);
  });

  it("git-fail path surfaces warning + gitSha: null and never throws", async () => {
    const deps = makeDeps({
      regenerateAndCommit: async () => ({
        sha: null,
        warning: "git commit failed: dirty tree",
        written: ["brands.json"],
      }),
    });
    const result = await createEntry(
      {
        entryType: "brand",
        entryId: "brand-2",
        data: brandPayload,
        actor: "admin-1",
      },
      deps,
    );
    expect(result.gitSha).toBeNull();
    expect(result.warning).toMatch(/git/i);
    expect(deps.store.has("brand-2")).toBe(true);
    expect(deps.gitShas).toHaveLength(0);
  });

  it("importEntries is all-or-nothing: invalid entry rejects whole batch, no upsert", async () => {
    const deps = makeDeps();
    await expect(
      importEntries(
        {
          actor: "admin-1",
          entries: [
            {
              entryType: "brand",
              entryId: "brand-ok",
              data: brandPayload,
            },
            {
              entryType: "brand",
              entryId: "brand-bad",
              data: { id: "not-a-number", nameCn: "" },
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow();
    expect(deps.store.size).toBe(0);
    expect(deps.changes).toHaveLength(0);
  });

  it("importEntries upserts all valid entries and shares one gitSha", async () => {
    const deps = makeDeps();
    const result = await importEntries(
      {
        actor: "admin-1",
        entries: [
          {
            entryType: "brand",
            entryId: "brand-1",
            data: brandPayload,
          },
          {
            entryType: "brand",
            entryId: "brand-2",
            data: { ...brandPayload, id: 2, nameCn: "牧野", nameEn: "MAKINO" },
          },
        ],
      },
      deps,
    );
    expect(result.imported).toBe(2);
    expect(result.gitSha).toBe("abc123");
    expect(deps.store.size).toBe(2);
    expect(deps.changes).toHaveLength(2);
    expect(deps.gitShas).toHaveLength(2);
    expect(deps.gitShas.every((g) => g.gitSha === "abc123")).toBe(true);
  });
});
