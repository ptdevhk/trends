/**
 * Phase 0 scaffolding for resume_analyses cleanup path coverage.
 *
 * Stubs `it.skip()` placeholder tests for:
 * - deleteResumes / hardResetIngestData orphan cleanup
 * - clearAnalyses soft-clear semantics (status: archived)
 * - projectResumeDetailDoc async fetch via by_resume index
 *
 * Tests will be un-skipped incrementally as Phases 2-3 of the
 * resume-analyses-phase3-completion-cleanup bundle land. See:
 *   projects/trends/work/2026-06-15-resume-analyses-phase3-completion-cleanup/plan.md
 *
 * TDD discipline: RED phase establishes the test skeleton before any
 * production code changes. Skipped tests are intentional — they document
 * the coverage matrix the bundle will fill in.
 */
import { describe, it } from "vitest";

describe("deleteResumes cleanup", () => {
    it.skip("hard-deletes resume_analyses rows for deleted resumes");
    it.skip("hard-deletes resume_analyses rows in hardResetIngestData");
});

describe("clearAnalyses soft-clear", () => {
    it.skip("flips cold row to status:archived with archivedAt when clearing all analyses");
    it.skip("keeps cold row active when surgical (jobDescriptionId) clear leaves keys in analyses map");
    it.skip("flips cold row to archived when surgical clear empties the analyses map AND clears current analysis");
});

describe("projectResumeDetailDoc (async fetch)", () => {
    it.skip("fetches analysis from resume_analyses via by_resume index (Phase 2)");
    it.skip("returns undefined analysis when no resume_analyses row exists");
    it.skip("filters out archived rows — only active rows reach the detail view");
});
