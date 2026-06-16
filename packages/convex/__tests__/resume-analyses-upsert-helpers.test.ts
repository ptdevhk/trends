/**
 * Convex-test coverage for resume_analyses upsert helpers.
 *
 * Integration tests (convex-test) for:
 * - doUpsertResumeDigest (resume_digests hot-table sync)
 * - doUpsertResumeAnalysis (resume_analyses cold-table sync)
 *
 * See: projects/trends/work/2026-06-15-resume-analyses-phase3-completion-cleanup/plan.md
 */
import { describe, expect, it } from "vitest";
import { createTest, seedResume } from "./test-helpers.js";
import { internal } from "../convex/_generated/api.js";
import { doUpsertResumeDigest, doUpsertResumeAnalysis } from "../convex/resumes_search.js";

describe("doUpsertResumeDigest", () => {
    it("inserts a new row with all fields populated", async () => {
        const t = createTest();
        // Insert a resume directly — do NOT use seedResume (which pre-inserts a digest).
        const resumeId = await t.run(async (ctx) =>
            ctx.db.insert("resumes", {
                externalId: "digest-insert-1",
                identityKey: "profileUrl:example.com/candidates/d1",
                content: { name: "Digest Candidate" },
                hash: "hash-d1",
                source: "example.com",
                sourceKey: "test",
                tags: ["test"],
                crawledAt: Date.now(),
            })
        );

        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeDigest(ctx, resume!);
        });

        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_digests")
                .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
                .first(),
        );
        expect(row).not.toBeNull();
        expect(row!.resumeId).toBe(resumeId);
        expect(row!.source).toBe("example.com");
        expect(row!.externalId).toBe("digest-insert-1");
        expect(row!.updatedAt).toBeTypeOf("number");
    });

    it("patches an existing row in place", async () => {
        const t = createTest();
        // seedResume pre-inserts a digest row.
        const resumeId = await seedResume(t);
        const beforeId = await t.run(async (ctx) => {
            const row = await ctx.db
                .query("resume_digests")
                .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
                .first();
            return row?._id;
        });

        // Change the resume, then re-upsert the digest.
        await t.run(async (ctx) => {
            await ctx.db.patch(resumeId, { primaryRuleScore: 99 });
        });
        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeDigest(ctx, resume!);
        });

        const rows = await t.run(async (ctx) =>
            ctx.db
                .query("resume_digests")
                .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
                .collect(),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]._id).toBe(beforeId);
        expect(rows[0].primaryRuleScore).toBe(99);
    });

    it("is idempotent on re-upsert (same input → same end state)", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);

        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeDigest(ctx, resume!);
            await doUpsertResumeDigest(ctx, resume!);
        });

        const rows = await t.run(async (ctx) =>
            ctx.db
                .query("resume_digests")
                .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
                .collect(),
        );
        expect(rows).toHaveLength(1);
    });

    it("populates digest fields from a representative resume fixture", async () => {
        const t = createTest();
        const resumeId = await seedResume(t, {
            externalId: "digest-fixture-1",
            identityKey: "profileUrl:example.com/candidates/df1",
            analysis: {
                score: 88,
                summary: "Great candidate",
                highlights: [],
                recommendation: "proceed",
                breakdown: { fit: 90 },
            },
            primaryRuleScore: 77,
        });

        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_digests")
                .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
                .first(),
        );
        expect(row).not.toBeNull();
        // displayScore is derived from analysis.score.
        expect(row!.displayScore).toBe(88);
        expect(row!.displayRecommendation).toBe("proceed");
        expect(row!.displayBreakdown).toEqual({ fit: 90 });
        expect(row!.primaryRuleScore).toBe(77);
    });

    it("no-ops on a deleted resumeId (internal mutation guard)", async () => {
        const t = createTest();
        const doomedId = await seedResume(t, { externalId: "digest-doomed" });
        await t.run(async (ctx) => {
            await ctx.db.delete(doomedId);
        });

        // Guard: if (!resume) return; — resolves without throwing (void → null).
        await expect(
            t.mutation(internal.resumes_search.upsertResumeDigest, { resumeId: doomedId }),
        ).resolves.toBeNull();
    });

    it("maintains parity with resume_digests schema after upsert", async () => {
        const t = createTest();
        // Insert a resume without a digest, then upsert.
        const resumeId = await t.run(async (ctx) =>
            ctx.db.insert("resumes", {
                externalId: "schema-parity-1",
                identityKey: "profileUrl:example.com/candidates/sp1",
                content: { name: "Schema Parity" },
                hash: "hash-sp1",
                source: "example.com",
                sourceKey: "test",
                tags: ["test"],
                crawledAt: Date.now(),
            })
        );
        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeDigest(ctx, resume!);
        });

        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_digests")
                .withIndex("by_resumeId", (q) => q.eq("resumeId", resumeId))
                .first(),
        );
        expect(row).not.toBeNull();
        expect(row!.resumeId).toBe(resumeId);
        expect(row!.updatedAt).toBeTypeOf("number");
        expect(row).toHaveProperty("source");
        expect(row).toHaveProperty("crawledAt");
    });
});

describe("doUpsertResumeAnalysis", () => {
    it("inserts a new row with analysis blob", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);
        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 85,
                summary: "Strong candidate",
                highlights: ["expertise"],
                recommendation: "proceed",
            },
        });

        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resumeId, resume!.analysis, resume!.analyses);
        });

        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique(),
        );
        expect(row).not.toBeNull();
        expect(row!.analysis).toBeDefined();
        expect(row!.analysis!.score).toBe(85);
        expect(row!.status).toBe("active");
        expect(row!.updatedAt).toBeTypeOf("number");
    });

    it("patches an existing row in place", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);
        // Set analysis directly on the hot doc — bypass updateAnalysis, which
        // would auto-upsert the cold row and defeat the "patches existing" check.
        await t.run(async (ctx) => {
            await ctx.db.patch(resumeId, {
                analysis: {
                    score: 70,
                    summary: "ok",
                    highlights: [],
                    recommendation: "skip",
                },
                analyses: { "jd:1": { score: 70 } },
            });
        });

        // Pre-insert an archived cold row.
        const preId = await t.run(async (ctx) =>
            ctx.db.insert("resume_analyses", {
                resumeId,
                analysis: undefined,
                analyses: {},
                status: "archived",
                archivedAt: Date.now(),
                updatedAt: Date.now(),
            })
        );

        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resumeId, resume!.analysis, resume!.analyses);
        });

        const rows = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .collect(),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]._id).toBe(preId);
        expect(rows[0].status).toBe("active");
        expect(rows[0].archivedAt).toBeUndefined();
    });

    it("is idempotent on re-upsert", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);
        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 60,
                summary: "idempotent",
                highlights: [],
                recommendation: "proceed",
            },
        });

        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resumeId, resume!.analysis, resume!.analyses);
            await doUpsertResumeAnalysis(ctx, resumeId, resume!.analysis, resume!.analyses);
        });

        const rows = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .collect(),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe("active");
    });

    it("populates analysis/analyses from a representative resume fixture", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);
        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 92,
                summary: "Fixture",
                highlights: ["a", "b"],
                recommendation: "proceed",
                jobDescriptionId: "jd-fixture",
            },
        });

        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resumeId, resume!.analysis, resume!.analyses);
        });

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique(),
        );
        expect(row!.analysis).toEqual(resume!.analysis);
        expect(row!.analyses).toEqual(resume!.analyses);
    });

    it("resets status to active and clears archivedAt on every upsert (Phase 3)", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);
        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 80,
                summary: "reset",
                highlights: [],
                recommendation: "proceed",
            },
        });

        // First upsert creates the row (active).
        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resumeId, resume!.analysis, resume!.analyses);
        });

        // Archive it (simulating a prior clearAnalyses soft-clear).
        await t.run(async (ctx) => {
            const row = await ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique();
            await ctx.db.patch(row!._id, { status: "archived", archivedAt: Date.now() });
        });

        // Re-upsert resets to active.
        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resumeId, resume!.analysis, resume!.analyses);
        });

        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique(),
        );
        expect(row!.status).toBe("active");
        expect(row!.archivedAt).toBeUndefined();
    });

    it("preserves analysis/analyses parity with hot doc (until Phase 4 removes hot fields)", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);
        const analysis = {
            score: 75,
            summary: "parity",
            highlights: ["z"],
            recommendation: "proceed",
            breakdown: { a: 1 },
        };
        const analyses = { "jd:1": { score: 75 }, "jd:2": { score: 80 } };

        await t.run(async (ctx) => {
            await ctx.db.patch(resumeId, { analysis, analyses });
        });
        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resumeId, resume!.analysis, resume!.analyses);
        });

        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique(),
        );
        expect(row!.analysis).toEqual(analysis);
        expect(row!.analyses).toEqual(analyses);
    });

    it("no-ops on a deleted resumeId (internal mutation guard)", async () => {
        const t = createTest();
        const doomedId = await seedResume(t, { externalId: "analysis-doomed" });
        await t.run(async (ctx) => {
            await ctx.db.delete(doomedId);
        });

        await expect(
            t.mutation(internal.resumes_search.upsertResumeAnalysis, { resumeId: doomedId }),
        ).resolves.toBeNull();
    });
});
