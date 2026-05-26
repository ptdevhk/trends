/**
 * Shared test utilities for Convex integration tests.
 */
import { convexTest } from "convex-test";
import schema from "../convex/schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

/**
 * Create a convexTest instance with the full schema and module glob.
 */
export function createTest() {
    return convexTest(schema, modules);
}

/**
 * Insert a minimal resume document into the database for testing.
 * Returns the resume ID.
 */
export function seedResume(t: ReturnType<typeof convexTest>, overrides: Record<string, unknown> = {}) {
    return t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
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
