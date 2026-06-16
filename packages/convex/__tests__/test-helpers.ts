/**
 * Shared test utilities for Convex integration tests.
 */
import { convexTest } from "convex-test";
import schema from "../convex/schema.js";
import { buildResumeDigest } from "../convex/lib/resume_digests.js";
import type { Id } from "../convex/_generated/dataModel.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

/**
 * Create a convexTest instance with the full schema and module glob.
 */
export function createTest() {
    return convexTest(schema, modules);
}

/**
 * Insert a minimal resume document into the database for testing.
 * Also upserts a resume_digests row to mirror production behavior
 * (every resume insert triggers a digest upsert via internal mutation).
 * Returns the resume ID.
 */
export function seedResume(t: ReturnType<typeof convexTest>, overrides: Record<string, unknown> = {}) {
    return t.run(async (ctx) => {
        const resumeId = await ctx.db.insert("resumes", {
            externalId: "test-resume-1",
            identityKey: "profileUrl:example.com/candidates/1",
            content: { name: "Test Candidate" },
            hash: "hash-test",
            source: "example.com",
            sourceKey: "test",
            tags: ["test"],
            crawledAt: Date.now(),
            ...overrides,
        });
        const resume = await ctx.db.get(resumeId);
        if (resume) {
            const digest = buildResumeDigest(resume, Date.now());
            await ctx.db.insert("resume_digests", digest as any);
        }
        return resumeId;
    });
}

/**
 * Insert a resume_analyses (cold-table) row for a resume. Mirrors the Phase 3
 * cold write path so tests can exercise readers (JD-usage, backup, migration
 * validators) that have migrated off the hot resume.analysis/analyses fields.
 *
 * `status` defaults to omitted (treated as active by readers per the Phase 3
 * back-compat contract). Pass `{ status: "archived" }` to seed a cleared row.
 */
export function seedResumeAnalysesColdRow(
    t: ReturnType<typeof convexTest>,
    resumeId: Id<"resumes">,
    overrides: Record<string, unknown> = {},
) {
    return t.run(async (ctx) => {
        return ctx.db.insert("resume_analyses", {
            resumeId,
            updatedAt: Date.now(),
            ...overrides,
        });
    });
}

/**
 * Read the cold resume_analyses row for a resume (by_resume unique).
 * Phase 4 Step 3a: analysis/analyses now live here (active = status
 * undefined or "active"); the hot resume.analysis/analyses are no longer
 * written. Tests assert on this row instead of the hot doc.
 */
export function getResumeAnalysesColdRow(
    t: ReturnType<typeof convexTest>,
    resumeId: Id<"resumes">,
) {
    return t.run(async (ctx) => {
        return ctx.db
            .query("resume_analyses")
            .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
            .unique();
    });
}

/**
 * Minimal valid ingestData for test seeding.
 */
export const MINIMAL_INGEST_DATA = {
    industryTags: ["manufacturing"],
    synonymHits: ["cnc"],
    ruleScores: { skills: 10 },
    experienceLevel: "senior",
    computedAt: Date.now(),
    skillsVersion: 2,
};
