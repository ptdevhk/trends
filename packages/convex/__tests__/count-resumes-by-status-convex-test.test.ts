/**
 * Integration tests for countResumesByStatus query.
 *
 * Covers: empty workspace, counting by status, respecting filters (location, source, role),
 * defaulting missing status to "new", excluding archived resumes.
 */
import { describe, expect, it } from "vitest";
import { createTest } from "./test-helpers.js";
import { api } from "../convex/_generated/api.js";

describe("countResumesByStatus", () => {
  it("returns all-zero counts for empty workspace", async () => {
    const t = createTest();
    const result = await t.query(api.resumes.countResumesByStatus, {
      workspaceSlug: "test",
    });
    expect(result).toEqual({
      new: 0,
      shortlisted: 0,
      rejected: 0,
      total: 0,
      overflow: false,
    });
  });

  it("counts resumes by status with no filters", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-1",
        identityKey: "ik-new",
        content: { name: "User 1" },
        hash: "hash-1",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-2",
        identityKey: "ik-short",
        content: { name: "User 2" },
        hash: "hash-2",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-3",
        identityKey: "ik-rej",
        content: { name: "User 3" },
        hash: "hash-3",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
      });
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "test",
        identityKey: "ik-short",
        status: "shortlisted",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "test",
        identityKey: "ik-rej",
        status: "rejected",
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(api.resumes.countResumesByStatus, {
      workspaceSlug: "test",
    });

    expect(result.new).toBe(1);
    expect(result.shortlisted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.total).toBe(3);
    expect(result.overflow).toBe(false);
  });

  it("respects location filter", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-cn",
        identityKey: "ik-cn",
        content: { name: "User CN", location: "Shanghai, China" },
        hash: "hash-cn",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-my",
        identityKey: "ik-my",
        content: { name: "User MY", location: "Kuala Lumpur, Malaysia" },
        hash: "hash-my",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
      });
    });

    const result = await t.query(api.resumes.countResumesByStatus, {
      workspaceSlug: "test",
      locations: ["China"],
    });

    expect(result.total).toBe(1);
    expect(result.new).toBe(1);
  });

  it("respects source filter", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-51",
        identityKey: "ik-51",
        content: { name: "User 51" },
        hash: "hash-51",
        tags: [],
        crawledAt: Date.now(),
        source: "ehire.51job.com",
        sourceKey: "51job",
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-5156",
        identityKey: "ik-5156",
        content: { name: "User 5156" },
        hash: "hash-5156",
        tags: [],
        crawledAt: Date.now(),
        source: "hr.job5156.com",
        sourceKey: "job5156",
      });
    });

    const result = await t.query(api.resumes.countResumesByStatus, {
      workspaceSlug: "test",
      sources: ["51job"],
    });

    expect(result.total).toBe(1);
    expect(result.new).toBe(1);
  });

  it("respects roleFilterType via ingestData.roleSignals", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-sales",
        identityKey: "ik-sales",
        content: { name: "Sales User" },
        hash: "hash-sales",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
        ingestData: {
          industryTags: [],
          synonymHits: [],
          ruleScores: { skills: 10 },
          experienceLevel: "senior",
          computedAt: Date.now(),
          skillsVersion: 2,
          roleSignals: [{ type: "sales", matchedSignals: ["sales"], signalCount: 1, occurrences: 1, years: 3, verifyIn: "workHistory" }],
        },
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-eng",
        identityKey: "ik-eng",
        content: { name: "Engineer" },
        hash: "hash-eng",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
        ingestData: {
          industryTags: [],
          synonymHits: [],
          ruleScores: { skills: 10 },
          experienceLevel: "mid",
          computedAt: Date.now(),
          skillsVersion: 2,
          roleSignals: [{ type: "engineering", matchedSignals: ["engineering"], signalCount: 1, occurrences: 1, years: 4, verifyIn: "workHistory" }],
        },
      });
    });

    const result = await t.query(api.resumes.countResumesByStatus, {
      workspaceSlug: "test",
      roleFilterType: "sales",
    });

    expect(result.total).toBe(1);
    expect(result.new).toBe(1);
  });

  it("defaults missing candidate_status to new", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-no-status",
        identityKey: "ik-no-status",
        content: { name: "No Status" },
        hash: "hash-ns",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
      });
    });

    const result = await t.query(api.resumes.countResumesByStatus, {
      workspaceSlug: "test",
    });

    expect(result.new).toBe(1);
    expect(result.shortlisted).toBe(0);
    expect(result.rejected).toBe(0);
  });

  it("excludes archived resumes", async () => {
    const t = createTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "ext-archived",
        identityKey: "ik-arch",
        content: { name: "Archived" },
        hash: "hash-arch",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
        isArchived: true,
      });
      await ctx.db.insert("resumes", {
        externalId: "ext-active",
        identityKey: "ik-active",
        content: { name: "Active" },
        hash: "hash-active",
        tags: [],
        crawledAt: Date.now(),
        source: "test",
        sourceKey: "test",
      });
    });

    const result = await t.query(api.resumes.countResumesByStatus, {
      workspaceSlug: "test",
    });

    expect(result.total).toBe(1);
    expect(result.new).toBe(1);
  });
});
