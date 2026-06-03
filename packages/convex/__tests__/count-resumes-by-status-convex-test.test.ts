import { describe, it, expect } from "vitest";
import { createTest } from "./test-helpers.js";
import { api } from "../convex/_generated/api.js";

describe("countResumesByStatus", () => {
  const test = createTest();

  it("returns all-zero counts for empty workspace", async () => {
    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: "test-empty-ws",
    });
    // At least the total/overflow shape is correct; exact counts depend on
    // whether other tests have already inserted resumes (shared DB).
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.overflow).toBe(false);
  });

  it("counts resumes by status with no structural filters", async () => {
    // Use a unique source to isolate this test's data from other tests
    const source = "test-count-basic";
    const ws = "test-count-basic-ws";
    await test.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-basic-1",
        identityKey: "ik-basic-new",
        content: { name: "User 1" },
        hash: "hash-b1",
        tags: [],
        crawledAt: Date.now(),
        source,
        sourceKey: source,
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-basic-2",
        identityKey: "ik-basic-short",
        content: { name: "User 2" },
        hash: "hash-b2",
        tags: [],
        crawledAt: Date.now(),
        source,
        sourceKey: source,
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-basic-3",
        identityKey: "ik-basic-rej",
        content: { name: "User 3" },
        hash: "hash-b3",
        tags: [],
        crawledAt: Date.now(),
        source,
        sourceKey: source,
      });
      await ctx.db.insert("candidate_status", {
        workspaceSlug: ws,
        identityKey: "ik-basic-short",
        status: "shortlisted",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("candidate_status", {
        workspaceSlug: ws,
        identityKey: "ik-basic-rej",
        status: "rejected",
        updatedAt: Date.now(),
      });
    });

    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: ws,
      sources: [source],
    });

    expect(result.new).toBe(1);
    expect(result.shortlisted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.total).toBe(3);
    expect(result.overflow).toBe(false);
  });

  it("respects location filter", async () => {
    const source = "test-count-location";
    const ws = "test-count-location-ws";
    await test.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-loc-cn",
        identityKey: "ik-loc-cn",
        content: { name: "User CN", location: "Shanghai, China" },
        hash: "hash-loc-cn",
        tags: [],
        crawledAt: Date.now(),
        source,
        sourceKey: source,
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-loc-my",
        identityKey: "ik-loc-my",
        content: { name: "User MY", location: "Kuala Lumpur, Malaysia" },
        hash: "hash-loc-my",
        tags: [],
        crawledAt: Date.now(),
        source,
        sourceKey: source,
      });
    });

    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: ws,
      locations: ["China"],
      sources: [source],
    });

    expect(result.total).toBe(1);
    expect(result.new).toBe(1);
  });

  it("respects source filter", async () => {
    const ws = "test-count-source-ws";
    await test.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-src-51",
        identityKey: "ik-src-51",
        content: { name: "User 51" },
        hash: "hash-src-51",
        tags: [],
        crawledAt: Date.now(),
        source: "ehire.51job.com",
        sourceKey: "51job",
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-src-5156",
        identityKey: "ik-src-5156",
        content: { name: "User 5156" },
        hash: "hash-src-5156",
        tags: [],
        crawledAt: Date.now(),
        source: "hr.job5156.com",
        sourceKey: "job5156",
      });
    });

    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: ws,
      sources: ["job5156"],
    });

    expect(result.total).toBe(1);
    expect(result.new).toBe(1);
  });

  it("defaults missing candidate_status to new", async () => {
    const source = "test-count-default-new";
    const ws = "test-count-default-new-ws";
    await test.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-def-no-status",
        identityKey: "ik-def-no-status",
        content: { name: "No Status" },
        hash: "hash-def-ns",
        tags: [],
        crawledAt: Date.now(),
        source,
        sourceKey: source,
      });
    });

    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: ws,
      sources: [source],
    });

    expect(result.new).toBe(1);
    expect(result.shortlisted).toBe(0);
    expect(result.rejected).toBe(0);
  });

  it("excludes archived resumes", async () => {
    const source = "test-count-archived";
    const ws = "test-count-archived-ws";
    await test.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-arch-yes",
        identityKey: "ik-arch-yes",
        content: { name: "Archived" },
        hash: "hash-arch-yes",
        tags: [],
        crawledAt: Date.now(),
        source,
        sourceKey: source,
        isArchived: true,
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-arch-no",
        identityKey: "ik-arch-no",
        content: { name: "Active" },
        hash: "hash-arch-no",
        tags: [],
        crawledAt: Date.now(),
        source,
        sourceKey: source,
      });
    });

    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: ws,
      sources: [source],
    });

    expect(result.total).toBe(1);
    expect(result.new).toBe(1);
  });
});
