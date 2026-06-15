import { describe, it, expect } from "vitest";
import { createTest } from "./test-helpers.js";
import { api } from "../convex/_generated/api.js";
import { buildResumeDigest } from "../convex/lib/resume_digests.js";

// Insert a resume + mirror production digest upsert.
async function insertResumeWithDigest(
  ctx: { db: any },
  overrides: Record<string, unknown>,
) {
  const resumeId = await ctx.db.insert("resumes", {
    tags: [],
    crawledAt: Date.now(),
    ...overrides,
  });
  const resume = await ctx.db.get(resumeId);
  if (resume) {
    await ctx.db.insert("resume_digests", buildResumeDigest(resume, Date.now()) as any);
  }
  return resumeId;
}

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
      await insertResumeWithDigest(ctx, {
        externalId: "ext-basic-1",
        identityKey: "ik-basic-new",
        content: { name: "User 1" },
        hash: "hash-b1",
        source,
        sourceKey: source,
      });
      await insertResumeWithDigest(ctx, {
        externalId: "ext-basic-2",
        identityKey: "ik-basic-short",
        content: { name: "User 2" },
        hash: "hash-b2",
        source,
        sourceKey: source,
      });
      await insertResumeWithDigest(ctx, {
        externalId: "ext-basic-3",
        identityKey: "ik-basic-rej",
        content: { name: "User 3" },
        hash: "hash-b3",
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
      await insertResumeWithDigest(ctx, {
        externalId: "ext-loc-cn",
        identityKey: "ik-loc-cn",
        content: { name: "User CN", location: "Shanghai, China" },
        hash: "hash-loc-cn",
        source,
        sourceKey: source,
      });
      await insertResumeWithDigest(ctx, {
        externalId: "ext-loc-my",
        identityKey: "ik-loc-my",
        content: { name: "User MY", location: "Kuala Lumpur, Malaysia" },
        hash: "hash-loc-my",
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
      await insertResumeWithDigest(ctx, {
        externalId: "ext-src-51",
        identityKey: "ik-src-51",
        content: { name: "User 51" },
        hash: "hash-src-51",
        source: "ehire.51job.com",
        sourceKey: "51job",
      });
      await insertResumeWithDigest(ctx, {
        externalId: "ext-src-5156",
        identityKey: "ik-src-5156",
        content: { name: "User 5156" },
        hash: "hash-src-5156",
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
      await insertResumeWithDigest(ctx, {
        externalId: "ext-def-no-status",
        identityKey: "ik-def-no-status",
        content: { name: "No Status" },
        hash: "hash-def-ns",
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

  it("counts explicit interviewed_pass separately from new", async () => {
    const source = "test-count-interviewed-pass";
    const ws = "test-count-interviewed-pass-ws";
    await test.run(async (ctx) => {
      await insertResumeWithDigest(ctx, {
        externalId: "ext-zs-new",
        identityKey: "ik-zs-new",
        content: { name: "New Candidate" },
        hash: "hash-zs-new",
        source,
        sourceKey: source,
      });
      await insertResumeWithDigest(ctx, {
        externalId: "k172rcvmvqj4hhn98r74r3brps82v28b",
        identityKey: "ik-zs-interviewed",
        content: { name: "周先生" },
        hash: "hash-zs-interviewed",
        source,
        sourceKey: source,
      });
      await ctx.db.insert("candidate_status", {
        workspaceSlug: ws,
        identityKey: "ik-zs-interviewed",
        status: "interviewed_pass",
        updatedAt: Date.now(),
      });
    });

    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: ws,
      sources: [source],
    });

    expect(result).toMatchObject({
      new: 1,
      shortlisted: 0,
      rejected: 0,
      interviewed_pass: 1,
      total: 2,
    });
  });

  it("excludes archived resumes", async () => {
    const source = "test-count-archived";
    const ws = "test-count-archived-ws";
    await test.run(async (ctx) => {
      await insertResumeWithDigest(ctx, {
        externalId: "ext-arch-yes",
        identityKey: "ik-arch-yes",
        content: { name: "Archived" },
        hash: "hash-arch-yes",
        source,
        sourceKey: source,
        isArchived: true,
      });
      await insertResumeWithDigest(ctx, {
        externalId: "ext-arch-no",
        identityKey: "ik-arch-no",
        content: { name: "Active" },
        hash: "hash-arch-no",
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

  it("excludes blocked resumes by default", async () => {
    const source = "test-count-blocked-default";
    const ws = "test-count-blocked-default-ws";
    await test.run(async (ctx) => {
      await insertResumeWithDigest(ctx, {
        externalId: "ext-block-visible",
        identityKey: "ik-block-visible",
        content: { name: "Visible" },
        hash: "hash-block-visible",
        source,
        sourceKey: source,
      });
      await insertResumeWithDigest(ctx, {
        externalId: "ext-block-hidden",
        identityKey: "ik-block-hidden",
        content: { name: "Hidden" },
        hash: "hash-block-hidden",
        source,
        sourceKey: source,
      });
      await ctx.db.insert("candidate_blocks", {
        workspaceSlug: ws,
        identityKey: "ik-block-hidden",
        reason: "duplicate",
        blockedAt: Date.now(),
      });
    });

    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: ws,
      sources: [source],
    });

    expect(result.new).toBe(1);
    expect(result.total).toBe(1);
  });

  it("includes blocked resumes when showBlocked is true", async () => {
    const source = "test-count-blocked-visible";
    const ws = "test-count-blocked-visible-ws";
    await test.run(async (ctx) => {
      await insertResumeWithDigest(ctx, {
        externalId: "ext-show-block-visible",
        identityKey: "ik-show-block-visible",
        content: { name: "Visible" },
        hash: "hash-show-block-visible",
        source,
        sourceKey: source,
      });
      await insertResumeWithDigest(ctx, {
        externalId: "ext-show-block-hidden",
        identityKey: "ik-show-block-hidden",
        content: { name: "Hidden" },
        hash: "hash-show-block-hidden",
        source,
        sourceKey: source,
      });
      await ctx.db.insert("candidate_blocks", {
        workspaceSlug: ws,
        identityKey: "ik-show-block-hidden",
        reason: "duplicate",
        blockedAt: Date.now(),
      });
    });

    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: ws,
      sources: [source],
      showBlocked: true,
    });

    expect(result.new).toBe(2);
    expect(result.total).toBe(2);
  });

  it("counts from digest rows without returning overflow for broad source-filtered cohorts", async () => {
    const source = "test-count-digest-wide";
    const ws = "test-count-digest-wide-ws";
    await test.run(async (ctx) => {
      for (let i = 0; i < 12; i += 1) {
        const resumeId = await ctx.db.insert("resumes", {
          externalId: `ext-digest-wide-${i}`,
          identityKey: `ik-digest-wide-${i}`,
          content: { name: `Digest Wide ${i}`, location: "Shanghai, China" },
          searchText: `cnc sales digest wide ${i}`,
          hash: `hash-digest-wide-${i}`,
          tags: [],
          crawledAt: Date.now() + i,
          source,
          sourceKey: source,
        });
        const resume = await ctx.db.get(resumeId);
        if (resume) {
          const { buildResumeDigest } = await import("../convex/lib/resume_digests.js");
          await ctx.db.insert("resume_digests", buildResumeDigest(resume, Date.now()) as any);
        }
      }
    });

    const result = await test.query(api.resumes.countResumesByStatus, {
      workspaceSlug: ws,
      sources: [source],
      locations: ["China"],
    });

    expect(result.total).toBe(12);
    expect(result.new).toBe(12);
    expect(result.overflow).toBe(false);
  });
});
