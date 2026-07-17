/**
 * Regression: Reset AI Analyses must never wipe HR candidate status / notes.
 *
 * clearAnalyses is an AI-only reset for re-scoring. HR shortlist/reject/
 * interview decisions and notes live on candidate_status (+ overlay) and
 * must survive the clear, including digest.identityKey join keys.
 */
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import {
  createTest,
  seedResume,
  seedResumeAnalysesColdRow,
  getResumeAnalysesColdRow,
} from "./test-helpers.js";

describe("clearAnalyses preserves HR status", () => {
  it("clears AI fields while preserving candidate_status, notes, overlay, and identityKey", async () => {
    const t = createTest();
    const identityKey = "profileUrl:ehire.example.com/resume/hr-status-1";
    const analysis = {
      score: 88,
      summary: "Strong match",
      highlights: ["cnc"],
      recommendation: "proceed",
      jobDescriptionId: "jd-hr-demo",
    };
    const analyses = {
      "source:test|analysis:jd-hr-demo": {
        score: 88,
        summary: "Strong match",
        highlights: ["cnc"],
        recommendation: "proceed",
        jobDescriptionId: "jd-hr-demo",
      },
    };

    const resumeId = await seedResume(t, {
      externalId: "hr-status-1",
      identityKey,
      analysis,
      analyses,
      confirmedScore: 91,
      confirmedAt: Date.now(),
      content: { name: "HR Preserved Candidate", profileUrl: "https://ehire.example.com/resume/hr-status-1" },
    });
    await seedResumeAnalysesColdRow(t, resumeId, { analysis, analyses });

    // seedResume already inserts a digest — stamp display AI fields on it.
    await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("resume_digests")
        .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
        .first();
      if (digest) {
        await ctx.db.patch(digest._id, {
          identityKey,
          displayScore: 88,
          displayRecommendation: "proceed",
          updatedAt: Date.now(),
        });
      }
    });

    const statusId = await t.run(async (ctx) =>
      ctx.db.insert("candidate_status", {
        workspaceSlug: "hr",
        identityKey,
        status: "shortlisted",
        notes: "面试通过意向，HR 备注必须保留",
        updatedBy: "hr-demo",
        updatedAt: Date.now(),
        history: [{ status: "new", updatedAt: Date.now() - 10_000 }],
      }),
    );
    const overlayId = await t.run(async (ctx) =>
      ctx.db.insert("resume_digest_statuses", {
        resumeId,
        workspaceSlug: "hr",
        identityKey,
        status: "shortlisted",
        updatedAt: Date.now(),
      }),
    );

    const result = await t.mutation(api.resumes.clearAnalyses, {
      resumeIds: [resumeId],
    });
    expect(result.cleared).toBe(1);

    const after = await t.run(async (ctx) => {
      const resume = await ctx.db.get(resumeId);
      const cold = await ctx.db
        .query("resume_analyses")
        .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
        .unique();
      const digest = await ctx.db
        .query("resume_digests")
        .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
        .first();
      const status = await ctx.db.get(statusId);
      const overlay = await ctx.db.get(overlayId);
      return { resume, cold, digest, status, overlay };
    });

    // AI cleared (hot + cold + confirm + digest display).
    expect(after.resume?.analysis).toBeUndefined();
    expect(after.resume?.analyses).toBeUndefined();
    expect(after.resume?.confirmedScore).toBeUndefined();
    expect(after.resume?.confirmedAt).toBeUndefined();
    expect(after.cold?.status).toBe("archived");
    expect(after.digest?.displayScore).toBeUndefined();
    expect(after.digest?.displayRecommendation).toBeUndefined();

    // HR status + identity join preserved.
    expect(after.resume?.identityKey).toBe(identityKey);
    expect(after.digest?.identityKey).toBe(identityKey);
    expect(after.status?.status).toBe("shortlisted");
    expect(after.status?.notes).toBe("面试通过意向，HR 备注必须保留");
    expect(after.status?.history).toHaveLength(1);
    expect(after.overlay?.status).toBe("shortlisted");
    expect(after.overlay?.identityKey).toBe(identityKey);

    // Content body untouched.
    expect(after.resume?.content).toMatchObject({ name: "HR Preserved Candidate" });
  });

  it("preserves digest identityKey when resume.identityKey is missing", async () => {
    const t = createTest();
    const identityKey = "profileUrl:ehire.example.com/resume/orphan-key";
    const analysis = {
      score: 70,
      summary: "ok",
      highlights: [],
      recommendation: "maybe",
    };
    // Resume without identityKey — digest still has the key used by HR status.
    const resumeId = await seedResume(t, {
      externalId: "orphan-key-1",
      analysis,
      analyses: { default: analysis },
    });
    await seedResumeAnalysesColdRow(t, resumeId, {
      analysis,
      analyses: { default: analysis },
    });
    await t.run(async (ctx) => {
      // Explicitly clear identityKey on resume so digest is the sole key source.
      await ctx.db.patch(resumeId, { identityKey: undefined });
      const digest = await ctx.db
        .query("resume_digests")
        .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
        .first();
      if (digest) {
        await ctx.db.patch(digest._id, {
          identityKey,
          displayScore: 70,
          updatedAt: Date.now(),
        });
      }
      await ctx.db.insert("candidate_status", {
        workspaceSlug: "hr",
        identityKey,
        status: "rejected",
        notes: "已拒绝",
        updatedAt: Date.now(),
      });
    });

    await t.mutation(api.resumes.clearAnalyses, { resumeIds: [resumeId] });

    const digest = await t.run(async (ctx) =>
      ctx.db
        .query("resume_digests")
        .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
        .first(),
    );
    expect(digest?.identityKey).toBe(identityKey);
    expect(digest?.displayScore).toBeUndefined();

    const status = await t.run(async (ctx) =>
      ctx.db
        .query("candidate_status")
        .withIndex("by_workspace_identity", (q) =>
          q.eq("workspaceSlug", "hr").eq("identityKey", identityKey),
        )
        .unique(),
    );
    expect(status?.status).toBe("rejected");
    expect(status?.notes).toBe("已拒绝");
  });

  it("archives cold analysis so active read path has no analysis after clear", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      analysis: {
        score: 99,
        summary: "hot leftover",
        highlights: [],
        recommendation: "proceed",
      },
    });
    await seedResumeAnalysesColdRow(t, resumeId, {
      analysis: {
        score: 99,
        summary: "cold",
        highlights: [],
        recommendation: "proceed",
      },
      analyses: { default: { score: 99 } },
    });

    await t.mutation(api.resumes.clearAnalyses, { resumeIds: [resumeId] });

    const cold = await getResumeAnalysesColdRow(t, resumeId);
    expect(cold?.status).toBe("archived");

    const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
    expect(resume?.analysis).toBeUndefined();
    expect(resume?.analyses).toBeUndefined();
  });
});
