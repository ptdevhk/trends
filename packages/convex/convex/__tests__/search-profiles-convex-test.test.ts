/**
 * Integration tests for search_profiles CRUD operations using convex-test.
 *
 * Covers all 5 exported functions:
 * - list (workspace-scoped query, sorted by updatedAt)
 * - getById (fast-path Convex ID + slow-path profileId lookup)
 * - create (profile normalization, criteria extraction)
 * - update (profile merge, workspace guard)
 * - remove (workspace guard, boolean return)
 *
 * Uses convex-test with real schema validation — no mocks.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("search_profiles: list", () => {
  it("returns profiles for the default workspace", async () => {
    const t = convexTest(schema, modules);

    // Create a profile in the default workspace
    await t.mutation(api.search_profiles.create, {
      profile: { name: "Test Profile", id: "prof-1", keywords: ["python"], location: "Shanghai" },
    });

    const results = await t.query(api.search_profiles.list, {});

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Test Profile");
  });

  it("returns profiles sorted by updatedAt descending", async () => {
    const t = convexTest(schema, modules);

    const older = await t.mutation(api.search_profiles.create, {
      profile: { name: "Older", id: "prof-old" },
    });
    const newer = await t.mutation(api.search_profiles.create, {
      profile: { name: "Newer", id: "prof-new" },
    });

    // Update the newer profile to ensure a later updatedAt
    await t.mutation(api.search_profiles.update, {
      id: newer!._id,
      profile: { name: "Newer Updated" },
    });

    const results = await t.query(api.search_profiles.list, {});

    expect(results).toHaveLength(2);
    // Updated profile has a later updatedAt, should come first
    expect(results[0].name).toBe("Newer Updated");
    expect(results[1].name).toBe("Older");
  });

  it("isolates workspaces", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.search_profiles.create, {
      profile: { name: "Default WS", id: "prof-default" },
    });
    await t.mutation(api.search_profiles.create, {
      profile: { name: "Other WS", id: "prof-other" },
      workspaceSlug: "other",
    });

    const defaultResults = await t.query(api.search_profiles.list, {});
    const otherResults = await t.query(api.search_profiles.list, { workspaceSlug: "other" });

    expect(defaultResults).toHaveLength(1);
    expect(defaultResults[0].name).toBe("Default WS");
    expect(otherResults).toHaveLength(1);
    expect(otherResults[0].name).toBe("Other WS");
  });

  it("returns empty array when no profiles exist", async () => {
    const t = convexTest(schema, modules);

    const results = await t.query(api.search_profiles.list, {});

    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe("search_profiles: getById", () => {
  it("finds a profile by Convex _id", async () => {
    const t = convexTest(schema, modules);

    const created = await t.mutation(api.search_profiles.create, {
      profile: { name: "Find Me", id: "prof-find" },
    });

    const found = await t.query(api.search_profiles.getById, {
      id: created!._id,
    });

    expect(found).not.toBeNull();
    expect(found!.name).toBe("Find Me");
  });

  it("finds a profile by profileId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.search_profiles.create, {
      profile: { name: "By ProfileId", id: "prof-lookup" },
    });

    const found = await t.query(api.search_profiles.getById, {
      id: "prof-lookup",
    });

    expect(found).not.toBeNull();
    expect(found!.name).toBe("By ProfileId");
  });

  it("returns null for nonexistent id", async () => {
    const t = convexTest(schema, modules);

    const found = await t.query(api.search_profiles.getById, {
      id: "nonexistent",
    });

    expect(found).toBeNull();
  });

  it("does not return profiles from other workspaces", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.search_profiles.create, {
      profile: { name: "Other WS", id: "prof-cross" },
      workspaceSlug: "other",
    });

    const found = await t.query(api.search_profiles.getById, {
      id: "prof-cross",
    });

    // Default workspace should not see "other" workspace profile
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("search_profiles: create", () => {
  it("creates a profile with name and criteria", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.search_profiles.create, {
      profile: {
        name: "Python Dev",
        id: "prof-1",
        keywords: ["python", "react"],
        location: "Shanghai",
      },
    });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("Python Dev");
    expect(result!.profileId).toBe("prof-1");
    expect(result!.criteria.keywords).toEqual(["python", "react"]);
    expect(result!.criteria.locations).toEqual(["Shanghai"]); // normalizeCriteria extracts locations
  });

  it("defaults name to 'Profile' when not provided", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.search_profiles.create, {
      profile: { id: "prof-noname" },
    });

    expect(result!.name).toBe("Profile");
  });

  it("sets createdAt and updatedAt", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.search_profiles.create, {
      profile: { name: "Timestamped" },
    });

    expect(result!.createdAt).toBeDefined();
    expect(result!.updatedAt).toBeDefined();
    expect(result!.createdAt).toBe(result!.updatedAt);
  });

  it("extracts criteria from profile.filters.locations", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.search_profiles.create, {
      profile: {
        name: "With Filters",
        filters: { locations: ["Beijing", "Shanghai"] },
      },
    });

    expect(result!.criteria.locations).toEqual(["Beijing", "Shanghai"]);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("search_profiles: update", () => {
  it("updates a profile by Convex _id", async () => {
    const t = convexTest(schema, modules);

    const created = await t.mutation(api.search_profiles.create, {
      profile: { name: "Original", id: "prof-update" },
    });

    const updated = await t.mutation(api.search_profiles.update, {
      id: created!._id,
      profile: { name: "Updated", id: "prof-update", keywords: ["golang"] },
    });

    expect(updated!.name).toBe("Updated");
    expect(updated!.criteria.keywords).toEqual(["golang"]);
    expect(updated!.updatedAt!).toBeGreaterThanOrEqual(created!.updatedAt!);
  });

  it("updates a profile by profileId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.search_profiles.create, {
      profile: { name: "Original", id: "prof-update-pid" },
    });

    const updated = await t.mutation(api.search_profiles.update, {
      id: "prof-update-pid",
      profile: { name: "Updated via profileId" },
    });

    expect(updated!.name).toBe("Updated via profileId");
  });

  it("throws for nonexistent profile", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.search_profiles.update, {
        id: "nonexistent",
        profile: { name: "Ghost" },
      }),
    ).rejects.toThrow("Search profile not found");
  });

  it("preserves existing name when not provided", async () => {
    const t = convexTest(schema, modules);

    const created = await t.mutation(api.search_profiles.create, {
      profile: { name: "Keep Name", id: "prof-keep-name" },
    });

    const updated = await t.mutation(api.search_profiles.update, {
      id: created!._id,
      profile: { keywords: ["rust"] },
    });

    expect(updated!.name).toBe("Keep Name");
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe("search_profiles: remove", () => {
  it("deletes a profile by Convex _id", async () => {
    const t = convexTest(schema, modules);

    const created = await t.mutation(api.search_profiles.create, {
      profile: { name: "Delete Me", id: "prof-delete" },
    });

    const result = await t.mutation(api.search_profiles.remove, {
      id: created!._id,
    });

    expect(result).toBe(true);

    // Verify it's gone
    const list = await t.query(api.search_profiles.list, {});
    expect(list).toHaveLength(0);
  });

  it("deletes a profile by profileId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.search_profiles.create, {
      profile: { name: "Delete By PID", id: "prof-delete-pid" },
    });

    const result = await t.mutation(api.search_profiles.remove, {
      id: "prof-delete-pid",
    });

    expect(result).toBe(true);

    const list = await t.query(api.search_profiles.list, {});
    expect(list).toHaveLength(0);
  });

  it("returns false for nonexistent id", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.search_profiles.remove, {
      id: "nonexistent",
    });

    expect(result).toBe(false);
  });

  it("does not delete profiles from other workspaces", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.search_profiles.create, {
      profile: { name: "Other WS", id: "prof-cross-del" },
      workspaceSlug: "other",
    });

    const result = await t.mutation(api.search_profiles.remove, {
      id: "prof-cross-del",
    });

    // Default workspace cannot delete "other" workspace profile
    expect(result).toBe(false);

    // Still exists in other workspace
    const otherList = await t.query(api.search_profiles.list, { workspaceSlug: "other" });
    expect(otherList).toHaveLength(1);
  });
});
