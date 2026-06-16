/**
 * Phase 2+3 tests for resume_analyses cleanup paths.
 *
 * projectResumeDetailDoc tests are unit-level (mocked ctx).
 * deleteResumes / hardResetIngestData / clearAnalyses tests are
 * integration-level (convex-test).
 *
 * See: projects/trends/work/2026-06-15-resume-analyses-phase3-completion-cleanup/plan.md
 */
import { describe, expect, it } from "vitest";
import { projectResumeDetailDoc } from "../convex/lib/resumes_list_projections.js";
import type { Doc } from "../convex/_generated/dataModel.js";
import { createTest, seedResume } from "./test-helpers.js";
import { api, internal } from "../convex/_generated/api.js";
import { doUpsertResumeAnalysis } from "../convex/resumes_search.js";

// Helper: mock ctx.db.query chain for resume_analyses lookup.
function mockCtxWithColdRow(coldRow: Record<string, unknown> | null) {
    return {
        db: {
            query: () => ({
                withIndex: () => ({
                    unique: async () => coldRow,
                }),
            }),
        },
    } as any;
}

// Helper: minimal resume doc for projection tests.
function makeResume(overrides: Partial<Doc<"resumes">> = {}): Doc<"resumes"> {
    return {
        _id: "r1" as any,
        externalId: "ext-1",
        content: { name: "Test" },
        hash: "h1",
        source: "test",
        tags: [],
        crawledAt: Date.now(),
        ...overrides,
    } as Doc<"resumes">;
}

describe("projectResumeDetailDoc (async fetch)", () => {
    it("fetches analysis from resume_analyses via by_resume index (Phase 2)", async () => {
        const resume = makeResume();
        const coldRow = {
            _id: "ra1" as any,
            resumeId: resume._id,
            analysis: { jobDescriptionId: "jd1", score: 85, recommendation: "strong" } as any,
            analyses: undefined,
            status: "active",
            archivedAt: undefined,
            updatedAt: Date.now(),
        };
        const projected = await projectResumeDetailDoc(mockCtxWithColdRow(coldRow), resume);

        expect(projected.analysis).toBeDefined();
        expect((projected.analysis as any).score).toBe(85);
    });

    it("returns undefined analysis when no resume_analyses row exists", async () => {
        const resume = makeResume();
        const projected = await projectResumeDetailDoc(mockCtxWithColdRow(null), resume);

        expect(projected.analysis).toBeUndefined();
        expect(projected.analyses).toBeUndefined();
    });

    it("treats rows with undefined status as active (backwards-compat with pre-Phase-1 rows)", async () => {
        // Pre-existing rows created by PR #1269 before the status field was added
        // have status: undefined. They must be visible to the detail view.
        const resume = makeResume();
        const legacyRow = {
            _id: "ra1" as any,
            resumeId: resume._id,
            analysis: { jobDescriptionId: "jd1", score: 90 } as any,
            analyses: undefined,
            status: undefined,
            archivedAt: undefined,
            updatedAt: Date.now(),
        };
        const projected = await projectResumeDetailDoc(mockCtxWithColdRow(legacyRow), resume);

        expect(projected.analysis).toBeDefined();
        expect((projected.analysis as any).score).toBe(90);
    });

    it("filters out archived rows — only active rows reach the detail view", async () => {
        const resume = makeResume();
        const archivedRow = {
            _id: "ra1" as any,
            resumeId: resume._id,
            analysis: { jobDescriptionId: "jd1", score: 85 } as any,
            analyses: undefined,
            status: "archived",
            archivedAt: Date.now(),
            updatedAt: Date.now(),
        };
        const projected = await projectResumeDetailDoc(mockCtxWithColdRow(archivedRow), resume);

        // Archived row is invisible — analysis fields absent from projection.
        expect(projected.analysis).toBeUndefined();
        expect(projected.analyses).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Integration-level tests (convex-test)
// ---------------------------------------------------------------------------

describe("deleteResumes cleanup", () => {
    it("hard-deletes resume_analyses rows for deleted resumes", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);

        // Give it analysis data + a cold row.
        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 70,
                summary: "to be deleted",
                highlights: [],
                recommendation: "proceed",
            },
        });
        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resume!);
        });

        // Confirm cold row exists before delete.
        let row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique(),
        );
        expect(row).not.toBeNull();

        await t.mutation(api.resumes.deleteResumes, { resumeIds: [String(resumeId)] });

        // Cold row + resume are both gone.
        row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique(),
        );
        expect(row).toBeNull();

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume).toBeNull();
    });

    it("archives the cold resume_analyses row when resetting ingest data (soft-clear for audit)", async () => {
        const t = createTest();
        const resumeId = await seedResume(t, {
            analysis: {
                score: 80,
                summary: "reset-ingest",
                highlights: [],
                recommendation: "proceed",
            },
            searchText: "stale search text",
        });

        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resume!);
        });

        await t.mutation(api.resumes.hardResetIngestData, {});

        const rows = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .collect(),
        );
        // Row still exists (NOT hard-deleted) but is now archived.
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe("archived");
        expect(rows[0].archivedAt).toBeDefined();
    });
});

describe("clearAnalyses soft-clear", () => {
    it("flips cold row to status:archived with archivedAt when clearing all analyses", async () => {
        const t = createTest();
        const resumeId = await seedResume(t, {
            analysis: {
                score: 85,
                summary: "clear-all",
                highlights: [],
                recommendation: "proceed",
            },
            analyses: { "jd:1": { score: 85 } },
        });

        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resume!);
        });

        // Non-surgical clear (no jobDescriptionId) → archive.
        await t.mutation(api.resumes.clearAnalyses, { resumeIds: [resumeId] });

        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique(),
        );
        expect(row!.status).toBe("archived");
        expect(row!.archivedAt).toBeDefined();
    });

    it("keeps cold row active when surgical (jobDescriptionId) clear leaves keys in analyses map", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);

        // Two distinct JD keys; current analysis for a JD that is NOT cleared.
        await t.run(async (ctx) => {
            await ctx.db.patch(resumeId, {
                analysis: {
                    score: 80,
                    summary: "surgical-keep",
                    highlights: [],
                    recommendation: "proceed",
                    jobDescriptionId: "jd-keep",
                },
                analyses: { "jd-clear": { score: 70 }, "jd-keep": { score: 80 } },
            });
        });
        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resume!);
        });

        // Surgical clear of one JD — the other remains.
        await t.mutation(api.resumes.clearAnalyses, {
            resumeIds: [resumeId],
            jobDescriptionId: "jd-clear",
        });

        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique(),
        );
        expect(row!.status).toBe("active");
        expect(row!.analyses).toHaveProperty("jd-keep");
        expect(row!.analyses).not.toHaveProperty("jd-clear");
    });

    it("flips cold row to archived when surgical clear empties the analyses map AND clears current analysis", async () => {
        const t = createTest();
        const resumeId = await seedResume(t);

        // Exactly one key that matches the cleared JD; current analysis for same JD.
        await t.run(async (ctx) => {
            await ctx.db.patch(resumeId, {
                analysis: {
                    score: 80,
                    summary: "surgical-empty",
                    highlights: [],
                    recommendation: "proceed",
                    jobDescriptionId: "jd-only",
                },
                analyses: { "jd-only": { score: 80 } },
            });
        });
        await t.run(async (ctx) => {
            const resume = await ctx.db.get(resumeId);
            await doUpsertResumeAnalysis(ctx, resume!);
        });

        // Surgical clear empties the map AND clears current analysis → archive.
        await t.mutation(api.resumes.clearAnalyses, {
            resumeIds: [resumeId],
            jobDescriptionId: "jd-only",
        });

        const row = await t.run(async (ctx) =>
            ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
                .unique(),
        );
        expect(row!.status).toBe("archived");
        expect(row!.archivedAt).toBeDefined();
    });
});
