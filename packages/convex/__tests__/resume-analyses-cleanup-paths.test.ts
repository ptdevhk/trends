/**
 * Phase 2+3 tests for resume_analyses cleanup paths.
 *
 * projectResumeDetailDoc tests are unit-level (mocked ctx) — un-skipped
 * in this file. clearAnalyses/deleteResumes tests are integration-level
 * (convex-test) — stubs remain, to be un-skipped when fixture setup is
 * streamlined.
 *
 * See: projects/trends/work/2026-06-15-resume-analyses-phase3-completion-cleanup/plan.md
 */
import { describe, expect, it } from "vitest";
import { projectResumeDetailDoc } from "../convex/lib/resumes_list_projections.js";
import type { Doc } from "../convex/_generated/dataModel.js";

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
// Integration-level stubs (need convex-test fixture setup)
// ---------------------------------------------------------------------------

describe("deleteResumes cleanup", () => {
    it.skip("hard-deletes resume_analyses rows for deleted resumes");
    it.skip("hard-deletes resume_analyses rows in hardResetIngestData");
});

describe("clearAnalyses soft-clear", () => {
    it.skip("flips cold row to status:archived with archivedAt when clearing all analyses");
    it.skip("keeps cold row active when surgical (jobDescriptionId) clear leaves keys in analyses map");
    it.skip("flips cold row to archived when surgical clear empties the analyses map AND clears current analysis");
});
