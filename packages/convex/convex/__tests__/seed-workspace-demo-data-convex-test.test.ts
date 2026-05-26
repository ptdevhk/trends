/**
 * Integration tests for seedWorkspaceDemoData using convex-test.
 *
 * Replaces seed-workspace-demo-data.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";


describe("seed: seedWorkspaceDemoData", () => {
  it("does not seed demo resumes unless explicitly requested", async () => {
    const t = createTest();

    const result = await t.mutation(api.seed.seedWorkspaceDemoData, {});

    expect(result.resumes).toEqual({ inserted: 0, updated: 0 });

    // No resumes in the database
    const resumes = await t.run(async (ctx) => ctx.db.query("resumes").collect());
    expect(resumes).toHaveLength(0);
  });

  it("seeds search profiles without JD linkage for the four seed profiles", async () => {
    const t = createTest();

    const result = await t.mutation(api.seed.seedWorkspaceDemoData, {});

    expect(result.searchProfiles.inserted).toBe(4);
    expect(result.searchProfiles.updated).toBe(0);

    const profiles = await t.run(async (ctx) => ctx.db.query("search_profiles").collect());
    expect(profiles).toHaveLength(4);

    const seededProfiles = new Map(
      profiles.map((p) => [String((p.profile as Record<string, unknown>)?.id), p.profile ?? {}]),
    );

    const job5156Profile = seededProfiles.get("job5156-cn-cnc-sales") as {
      filters?: Record<string, unknown>;
      jobDescription?: string;
    } | undefined;
    expect(job5156Profile?.filters).toMatchObject({
      minAge: 25,
      maxAge: 40,
    });
    expect(job5156Profile?.jobDescription).toBe("lathe-sales");

    const job51Profile = seededProfiles.get("51job-cn-cnc-sales") as {
      filters?: Record<string, unknown>;
      jobDescription?: string;
    } | undefined;
    expect(job51Profile?.filters).toMatchObject({
      minAge: 25,
      maxAge: 40,
    });
    expect(job51Profile?.jobDescription).toBeUndefined();

    const seekProfile = seededProfiles.get("seek-malaysia-sales") as {
      jobDescription?: string;
    } | undefined;
    expect(seekProfile?.jobDescription).toBe("seek-malaysia-sales");

    const talentSearchProfile = seededProfiles.get("seek-malaysia-talent-search") as {
      jobDescription?: string;
    } | undefined;
    expect(talentSearchProfile?.jobDescription).toBe("seek-malaysia-sales");
  });
});

describe("seed: clearWorkspaceDemoResumes", () => {
  it("clears only workspace-demo resumes", async () => {
    const t = createTest();

    // Insert a demo resume (with workspace-demo tag)
    await t.run(async (ctx) => {
      await ctx.db.insert("resumes", {
        externalId: "my.employer.seek.com:profile:503033454",
        identityKey: "profileUrl:my.employer.seek.com/candidates/503033454",
        content: {
          name: "Yap Kae Wen",
          location: "Kuala Lumpur, Malaysia",
          jobIntention: "Sales Engineer / Sales Manager",
        },
        hash: "hash-demo",
        source: "my.employer.seek.com",
        sourceKey: "seek",
        tags: ["seed", "workspace-demo", "seek-malaysia-sales"],
        crawledAt: 1,
      });
      // Insert a real resume (no workspace-demo tag)
      await ctx.db.insert("resumes", {
        externalId: "real-seek-profile",
        identityKey: "profileUrl:my.employer.seek.com/candidates/real",
        content: {
          name: "Real Candidate",
        },
        hash: "hash-real",
        source: "my.employer.seek.com",
        sourceKey: "seek",
        tags: ["seek"],
        crawledAt: 1,
      });
    });

    const result = await t.mutation(api.seed.clearWorkspaceDemoResumes, {});

    expect(result.deleted).toBe(1);
    expect(result.tag).toBe("workspace-demo");

    // Only the real resume should remain
    const resumes = await t.run(async (ctx) => ctx.db.query("resumes").collect());
    expect(resumes).toHaveLength(1);
    expect(resumes[0].externalId).toBe("real-seek-profile");
  });
});
