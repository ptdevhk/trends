/**
 * Integration tests for taxonomy_clusters.ts using convex-test.
 *
 * Covers: list, upsert (insert + update + validation), remove, suggest.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";


// ---------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------

describe("taxonomy_clusters: upsert", () => {
  it("inserts a new taxonomy cluster", async () => {
    const t = createTest();

    const result = await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-test",
      name: "Machine Tools",
      slug: "machine-tools",
      tags: ["CNC", "lathe", "milling"],
      source: "human",
      status: "active",
    });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("Machine Tools");
    expect(result!.slug).toBe("machine-tools");
    expect(result!.tags).toEqual(["CNC", "lathe", "milling"]);
    expect(result!.status).toBe("active");
  });

  it("updates an existing cluster by id", async () => {
    const t = createTest();

    const created = await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-test",
      name: "Software",
      slug: "software",
      tags: ["python", "java"],
      source: "ai",
      status: "draft",
    });

    const updated = await t.mutation(api.taxonomy_clusters.upsert, {
      id: created!._id,
      workspaceSlug: "ws-test",
      name: "Software Engineering",
      slug: "software",
      tags: ["python", "java", "typescript"],
      source: "merged",
      status: "active",
    });

    expect(updated!.name).toBe("Software Engineering");
    expect(updated!.tags).toEqual(["python", "java", "typescript"]);
    expect(updated!.status).toBe("active");
  });

  it("updates by slug when no id provided", async () => {
    const t = createTest();

    await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-test",
      name: "Sales",
      slug: "sales",
      tags: ["B2B"],
      source: "human",
      status: "active",
    });

    const updated = await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-test",
      name: "Sales & Marketing",
      slug: "sales",
      tags: ["B2B", "B2C"],
      source: "merged",
      status: "active",
    });

    expect(updated!.name).toBe("Sales & Marketing");
    expect(updated!.tags).toEqual(["B2B", "B2C"]);
  });

  it("throws when required fields are missing", async () => {
    const t = createTest();

    await expect(
      t.mutation(api.taxonomy_clusters.upsert, {
        workspaceSlug: "ws-test",
        name: "",
        slug: "",
        tags: [],
        source: "human" as const,
        status: "active" as const,
      }),
    ).rejects.toThrow("Missing taxonomy cluster fields");
  });

  it("deduplicates tags (case-insensitive)", async () => {
    const t = createTest();

    const result = await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-test",
      name: "Engineering",
      slug: "engineering",
      tags: ["Python", "python", "JAVA", "Java"],
      source: "human",
      status: "active",
    });

    // normalizeStringList deduplicates case-insensitively, keeps first occurrence
    expect(result!.tags).toEqual(["Python", "JAVA"]);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("taxonomy_clusters: list", () => {
  it("lists clusters for a workspace", async () => {
    const t = createTest();

    await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-list",
      name: "Active Cluster",
      slug: "active-cluster",
      tags: ["tag1"],
      source: "human",
      status: "active",
    });
    await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-list",
      name: "Draft Cluster",
      slug: "draft-cluster",
      tags: ["tag2"],
      source: "ai",
      status: "draft",
    });

    const all = await t.query(api.taxonomy_clusters.list, {
      workspaceSlug: "ws-list",
    });

    expect(all).toHaveLength(2);
    // Active should come before draft (sort by status then updatedAt desc)
    expect(all[0].status).toBe("active");
    expect(all[1].status).toBe("draft");
  });

  it("filters by status", async () => {
    const t = createTest();

    await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-filter",
      name: "Active",
      slug: "active",
      tags: ["tag"],
      source: "human",
      status: "active",
    });
    await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-filter",
      name: "Draft",
      slug: "draft",
      tags: ["tag"],
      source: "ai",
      status: "draft",
    });

    const active = await t.query(api.taxonomy_clusters.list, {
      workspaceSlug: "ws-filter",
      status: "active",
    });

    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe("taxonomy_clusters: remove", () => {
  it("deletes a cluster by id", async () => {
    const t = createTest();

    const created = await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-remove",
      name: "ToRemove",
      slug: "to-remove",
      tags: ["tag"],
      source: "human",
      status: "active",
    });

    const result = await t.mutation(api.taxonomy_clusters.remove, {
      id: created!._id,
      workspaceSlug: "ws-remove",
    });

    expect(result).toBe(true);

    const remaining = await t.query(api.taxonomy_clusters.list, {
      workspaceSlug: "ws-remove",
    });
    expect(remaining).toHaveLength(0);
  });

  it("returns false for wrong workspace", async () => {
    const t = createTest();

    const created = await t.mutation(api.taxonomy_clusters.upsert, {
      workspaceSlug: "ws-a",
      name: "Cluster",
      slug: "cluster",
      tags: ["tag"],
      source: "human",
      status: "active",
    });

    const result = await t.mutation(api.taxonomy_clusters.remove, {
      id: created!._id,
      workspaceSlug: "ws-b",
    });

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggest
// ---------------------------------------------------------------------------

describe("taxonomy_clusters: suggest", () => {
  it("suggests clusters from resume tags", async () => {
    const t = createTest();

    // Insert a resume with industryTags
    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "r-suggest",
        content: { name: "Test" },
        hash: "h-suggest",
        source: "test",
        tags: [],
        crawledAt: Date.now(),
        ingestData: {
          industryTags: ["CNC machining", "CNC programming", "metalworking", "lathe operation"],
          synonymHits: [],
          brandHits: [],
          companyHits: [],
          ruleScores: {},
          experienceLevel: "senior",
          computedAt: Date.now(),
          skillsVersion: 1,
        },
      });
    });

    const suggestions = await t.mutation(api.taxonomy_clusters.suggest, {
      workspaceSlug: "ws-suggest",
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    // Should group "CNC machining" and "CNC programming" under a "Cnc" key
    const cncSuggestion = suggestions.find((s) => s.slug === "cnc");
    expect(cncSuggestion).toBeDefined();
    expect(cncSuggestion!.tags.length).toBeGreaterThanOrEqual(1);
    expect(cncSuggestion!.status).toBe("draft");
  });

  it("returns empty when no resumes have tags", async () => {
    const t = createTest();

    const suggestions = await t.mutation(api.taxonomy_clusters.suggest, {
      workspaceSlug: "ws-empty",
    });

    expect(suggestions).toEqual([]);
  });
});
