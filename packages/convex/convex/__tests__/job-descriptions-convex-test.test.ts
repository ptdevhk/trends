/**
 * Integration tests using convex-test for job_descriptions.ts.
 *
 * Covers: list, create, update, get, list_all, listAllForWorkspace,
 * delete_jd, delete_batch, list_with_usage (deprecated), list_with_usage_action.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a system JD directly. */
async function insertSystemJD(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
): Promise<Id<"job_descriptions">> {
  return t.run(async (ctx) => {
    return ctx.db.insert("job_descriptions", {
      title: "System JD",
      content: "System job description content",
      type: "system",
      workspaceSlug: "default",
      enabled: true,
      lastModified: Date.now(),
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("job_descriptions: list", () => {
  it("returns system JDs and workspace-specific custom JDs", async () => {
    const t = createTest();

    await insertSystemJD(t, { title: "System A" });

    await t.mutation(api.job_descriptions.create, {
      title: "Custom A",
      content: "Custom content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    const result = await t.query(api.job_descriptions.list, {
      workspaceSlug: "ws1",
    });

    expect(result.length).toBe(2);
    const titles = result.map((jd) => jd.title);
    expect(titles).toContain("System A");
    expect(titles).toContain("Custom A");
  });

  it("filters custom JDs by userId when provided", async () => {
    const t = createTest();

    await t.mutation(api.job_descriptions.create, {
      title: "User1 JD",
      content: "Content",
      type: "custom",
      userId: "user1",
      workspaceSlug: "ws1",
    });

    await t.mutation(api.job_descriptions.create, {
      title: "User2 JD",
      content: "Content",
      type: "custom",
      userId: "user2",
      workspaceSlug: "ws1",
    });

    await t.mutation(api.job_descriptions.create, {
      title: "No-user JD",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    const result = await t.query(api.job_descriptions.list, {
      workspaceSlug: "ws1",
      userId: "user1",
    });

    const titles = result.map((jd) => jd.title);
    // user1 should see their own JDs + no-user JDs, but not user2's
    expect(titles).toContain("User1 JD");
    expect(titles).toContain("No-user JD");
    expect(titles).not.toContain("User2 JD");
  });

  it("excludes disabled JDs", async () => {
    const t = createTest();

    await insertSystemJD(t, { title: "Enabled", enabled: true });
    await insertSystemJD(t, { title: "Disabled", enabled: false });

    const result = await t.query(api.job_descriptions.list, {});

    const titles = result.map((jd) => jd.title);
    expect(titles).toContain("Enabled");
    expect(titles).not.toContain("Disabled");
  });

  it("sorts by lastModified descending", async () => {
    const t = createTest();

    await insertSystemJD(t, { title: "First", lastModified: 1000 });
    await insertSystemJD(t, { title: "Second", lastModified: 2000 });

    const result = await t.query(api.job_descriptions.list, {});

    expect(result[0].title).toBe("Second");
    expect(result[1].title).toBe("First");
  });

  it("defaults workspaceSlug to default when empty/undefined", async () => {
    const t = createTest();

    await t.mutation(api.job_descriptions.create, {
      title: "Default WS JD",
      content: "Content",
      type: "custom",
      // No workspaceSlug → should default to "default"
    });

    const result = await t.query(api.job_descriptions.list, {});
    const titles = result.map((jd) => jd.title);
    expect(titles).toContain("Default WS JD");
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("job_descriptions: create", () => {
  it("creates a custom JD with all fields", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "Senior Developer",
      content: "We need a senior developer...",
      type: "custom",
      userId: "user1",
      workspaceSlug: "ws1",
      location: "Shanghai",
      industryTags: ["machinery", "sales"],
      customKeywords: ["typescript", "react"],
      minExperience: 3,
      maxExperience: 10,
      minAge: 25,
      maxAge: 45,
    });

    expect(id).toBeDefined();

    const jd = await t.query(api.job_descriptions.get, { id });
    expect(jd).not.toBeNull();
    expect(jd!.title).toBe("Senior Developer");
    expect(jd!.content).toBe("We need a senior developer...");
    expect(jd!.type).toBe("custom");
    expect(jd!.userId).toBe("user1");
    expect(jd!.workspaceSlug).toBe("ws1");
    expect(jd!.enabled).toBe(true);
    expect(jd!.location).toBe("Shanghai");
    expect(jd!.industryTags).toEqual(["machinery", "sales"]);
    expect(jd!.customKeywords).toEqual(["typescript", "react"]);
    expect(jd!.minExperience).toBe(3);
    expect(jd!.maxExperience).toBe(10);
  });

  it("sanitizes non-canonical industry tags", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "CNC Operator",
      content: "CNC machining role",
      type: "custom",
      workspaceSlug: "ws1",
      industryTags: ["machinery", "cnc", "automation"],
    });

    const jd = await t.query(api.job_descriptions.get, { id });
    // "cnc" maps to "machinery", "automation" is stripped by normalizeIndustryTags
    expect(jd!.industryTags).toEqual(["machinery"]);
  });

  it("sets industryTags to undefined when all tags are non-canonical", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "Test JD",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
      industryTags: ["automation", "nonexistent"],
    });

    const jd = await t.query(api.job_descriptions.get, { id });
    // "automation" and "nonexistent" are both stripped by normalizeIndustryTags
    expect(jd!.industryTags).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("job_descriptions: update", () => {
  it("updates provided fields and sets lastModified", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "Original",
      content: "Original content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    await t.mutation(api.job_descriptions.update, {
      id,
      title: "Updated",
      location: "Beijing",
    });

    const jd = await t.query(api.job_descriptions.get, { id });
    expect(jd!.title).toBe("Updated");
    expect(jd!.content).toBe("Original content"); // unchanged
    expect(jd!.location).toBe("Beijing");
  });

  it("clears optional fields when null is passed", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "With Location",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
      location: "Shanghai",
    });

    await t.mutation(api.job_descriptions.update, {
      id,
      location: null,
    });

    const jd = await t.query(api.job_descriptions.get, { id });
    expect(jd!.location).toBeUndefined();
  });

  it("disables a JD via enabled: false", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "Active",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    await t.mutation(api.job_descriptions.update, {
      id,
      enabled: false,
    });

    const jd = await t.query(api.job_descriptions.get, { id });
    expect(jd!.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("job_descriptions: get", () => {
  it("returns the JD by ID", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "Fetchable",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    const jd = await t.query(api.job_descriptions.get, { id });
    expect(jd).not.toBeNull();
    expect(jd!.title).toBe("Fetchable");
  });

  it("returns null for non-existent ID", async () => {
    const t = createTest();

    // Create and delete a JD to get a valid but non-existent ID
    const id = await t.mutation(api.job_descriptions.create, {
      title: "Temporary",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    await t.mutation(api.job_descriptions.delete_jd, {
      id,
      workspaceSlug: "ws1",
    });

    const jd = await t.query(api.job_descriptions.get, { id });
    expect(jd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// list_all + listAllForWorkspace
// ---------------------------------------------------------------------------

describe("job_descriptions: list_all", () => {
  it("returns all JDs including disabled ones", async () => {
    const t = createTest();

    await insertSystemJD(t, { title: "Sys Enabled", enabled: true });
    await insertSystemJD(t, { title: "Sys Disabled", enabled: false });

    const result = await t.query(api.job_descriptions.list_all, {});

    const titles = result.map((jd) => jd.title);
    expect(titles).toContain("Sys Enabled");
    expect(titles).toContain("Sys Disabled");
  });
});

describe("job_descriptions: listAllForWorkspace (internal)", () => {
  it("returns system JDs + workspace custom JDs", async () => {
    const t = createTest();

    await insertSystemJD(t, { title: "Sys JD" });

    await t.mutation(api.job_descriptions.create, {
      title: "Custom WS1",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    await t.mutation(api.job_descriptions.create, {
      title: "Custom WS2",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws2",
    });

    const result = await t.query(internal.job_descriptions.listAllForWorkspace, {
      workspaceSlug: "ws1",
    });

    const titles = result.map((jd) => jd.title);
    expect(titles).toContain("Sys JD");
    expect(titles).toContain("Custom WS1");
    expect(titles).not.toContain("Custom WS2");
  });
});

// ---------------------------------------------------------------------------
// delete_jd
// ---------------------------------------------------------------------------

describe("job_descriptions: delete_jd", () => {
  it("deletes a custom JD in the correct workspace", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "Deletable",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    await t.mutation(api.job_descriptions.delete_jd, {
      id,
      workspaceSlug: "ws1",
    });

    const jd = await t.query(api.job_descriptions.get, { id });
    expect(jd).toBeNull();
  });

  it("throws when deleting a system JD", async () => {
    const t = createTest();

    const id = await insertSystemJD(t);

    await expect(
      t.mutation(api.job_descriptions.delete_jd, { id, workspaceSlug: "default" }),
    ).rejects.toThrow("Cannot delete system job descriptions");
  });

  it("throws when deleting from another workspace", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "WS1 JD",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    await expect(
      t.mutation(api.job_descriptions.delete_jd, { id, workspaceSlug: "ws2" }),
    ).rejects.toThrow("Cannot delete job descriptions from another workspace");
  });

  it("allows default workspace to delete JDs without workspaceSlug", async () => {
    const t = createTest();

    const id = await t.mutation(api.job_descriptions.create, {
      title: "Default WS JD",
      content: "Content",
      type: "custom",
      // No workspaceSlug → defaults to "default"
    });

    await t.mutation(api.job_descriptions.delete_jd, { id });
    const jd = await t.query(api.job_descriptions.get, { id });
    expect(jd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete_batch
// ---------------------------------------------------------------------------

describe("job_descriptions: delete_batch", () => {
  it("deletes multiple custom JDs in the same workspace", async () => {
    const t = createTest();

    const id1 = await t.mutation(api.job_descriptions.create, {
      title: "Batch 1",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });
    const id2 = await t.mutation(api.job_descriptions.create, {
      title: "Batch 2",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });

    const result = await t.mutation(api.job_descriptions.delete_batch, {
      ids: [id1, id2],
      workspaceSlug: "ws1",
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);

    const jd1 = await t.query(api.job_descriptions.get, { id: id1 });
    const jd2 = await t.query(api.job_descriptions.get, { id: id2 });
    expect(jd1).toBeNull();
    expect(jd2).toBeNull();
  });

  it("throws if any JD is a system JD", async () => {
    const t = createTest();

    const systemId = await insertSystemJD(t);
    const customId = await t.mutation(api.job_descriptions.create, {
      title: "Custom",
      content: "Content",
      type: "custom",
      workspaceSlug: "default",
    });

    await expect(
      t.mutation(api.job_descriptions.delete_batch, {
        ids: [systemId, customId],
        workspaceSlug: "default",
      }),
    ).rejects.toThrow(/Cannot delete System JD/);
  });

  it("throws if any JD belongs to another workspace", async () => {
    const t = createTest();

    const id1 = await t.mutation(api.job_descriptions.create, {
      title: "WS1",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws1",
    });
    const id2 = await t.mutation(api.job_descriptions.create, {
      title: "WS2",
      content: "Content",
      type: "custom",
      workspaceSlug: "ws2",
    });

    await expect(
      t.mutation(api.job_descriptions.delete_batch, {
        ids: [id1, id2],
        workspaceSlug: "ws1",
      }),
    ).rejects.toThrow(/Cannot delete JD from another workspace/);
  });
});

// ---------------------------------------------------------------------------
// list_with_usage (deprecated)
// ---------------------------------------------------------------------------

describe("job_descriptions: list_with_usage (deprecated)", () => {
  it("throws a deprecation error", async () => {
    const t = createTest();

    await expect(
      t.query(api.job_descriptions.list_with_usage, {}),
    ).rejects.toThrow("no longer available");
  });
});
