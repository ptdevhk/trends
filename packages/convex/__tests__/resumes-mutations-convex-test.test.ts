/**
 * Convex-test coverage for resume mutations and queries:
 * - updateAnalysis / updateAnalysisBatch
 * - fieldCoverage
 * - archiveResumes / unarchiveResumes
 * - getResume / getResumeDetail
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import { seedResume } from "./test-helpers.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

describe("resumes: updateAnalysis", () => {
    it("stores analysis on an existing resume", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 85,
                summary: "Strong candidate",
                highlights: ["5 years experience", "CNC expertise"],
                recommendation: "proceed",
                jobDescriptionId: "jd-123",
            },
        });

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.analysis?.score).toBe(85);
        expect(resume?.analysis?.summary).toBe("Strong candidate");
        expect(resume?.analysis?.recommendation).toBe("proceed");
        expect(resume?.analyses).toBeDefined();
    });

    it("throws for non-existent resume ID", async () => {
        const t = convexTest(schema, modules);
        const fakeId = "00000000000000000000000000" as any;

        await expect(
            t.mutation(internal.resumes.updateAnalysis, {
                resumeId: fakeId,
                analysis: {
                    score: 50,
                    summary: "Test",
                    highlights: [],
                    recommendation: "skip",
                },
            })
        ).rejects.toThrow();
    });
});

describe("resumes: updateAnalysisBatch", () => {
    it("updates multiple resumes in one call", async () => {
        const t = convexTest(schema, modules);
        const id1 = await seedResume(t, { externalId: "batch-1" });
        const id2 = await seedResume(t, { externalId: "batch-2" });

        await t.mutation(internal.resumes.updateAnalysisBatch, {
            updates: [
                {
                    resumeId: id1,
                    analysis: {
                        score: 90,
                        summary: "Excellent",
                        highlights: ["Leadership"],
                        recommendation: "proceed",
                    },
                },
                {
                    resumeId: id2,
                    analysis: {
                        score: 40,
                        summary: "Weak",
                        highlights: [],
                        recommendation: "skip",
                    },
                },
            ],
        });

        const r1 = await t.run(async (ctx) => ctx.db.get(id1));
        const r2 = await t.run(async (ctx) => ctx.db.get(id2));
        expect(r1?.analysis?.score).toBe(90);
        expect(r2?.analysis?.score).toBe(40);
    });

    it("skips non-existent resume IDs gracefully", async () => {
        const t = convexTest(schema, modules);
        const id1 = await seedResume(t, { externalId: "batch-ok" });
        // Create then delete a resume to get a valid but non-existent ID
        const doomedId = await seedResume(t, { externalId: "batch-doomed" });
        await t.run(async (ctx) => { await ctx.db.delete(doomedId); });

        // Should not throw — just skips the missing one
        await t.mutation(internal.resumes.updateAnalysisBatch, {
            updates: [
                {
                    resumeId: id1,
                    analysis: {
                        score: 75,
                        summary: "Good",
                        highlights: [],
                        recommendation: "proceed",
                    },
                },
                {
                    resumeId: doomedId,
                    analysis: {
                        score: 0,
                        summary: "Missing",
                        highlights: [],
                        recommendation: "skip",
                    },
                },
            ],
        });

        const r1 = await t.run(async (ctx) => ctx.db.get(id1));
        expect(r1?.analysis?.score).toBe(75);
    });
});

describe("resumes: fieldCoverage", () => {
    it("returns zero counts for empty database", async () => {
        const t = convexTest(schema, modules);
        const result = await t.query(api.resumes.fieldCoverage, {});
        expect(result.scanned).toBe(0);
        expect(result.missingSearchText).toBe(0);
        expect(result.hasMore).toBe(false);
    });

    it("counts resumes missing searchText", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, { searchText: undefined });
        await seedResume(t, { searchText: "engineer cnc machining", externalId: "test-2", identityKey: "profileUrl:example.com/candidates/2" });

        const result = await t.query(api.resumes.fieldCoverage, {});
        expect(result.scanned).toBe(2);
        expect(result.missingSearchText).toBe(1);
    });

    it("counts role signals and verified role years", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "role-sig-1",
            identityKey: "profileUrl:example.com/candidates/rs1",
            searchText: "test",
            ingestData: {
                industryTags: [],
                synonymHits: [],
                ruleScores: {},
                experienceLevel: "senior",
                computedAt: Date.now(),
                skillsVersion: 2,
                roleSignals: [{
                    type: "CNC Operator",
                    years: 3,
                    matchedSignals: ["CNC"],
                    signalCount: 1,
                    occurrences: 1,
                    verifyIn: "workHistory",
                }],
                verifiedRoleYears: { "cnc operator": 3 },
            },
        });

        const result = await t.query(api.resumes.fieldCoverage, {});
        expect(result.scanned).toBe(1);
        expect(result.hasRoleSignals).toBe(1);
        expect(result.hasVerifiedRoleYears).toBe(1);
    });
});

describe("resumes: archiveResumes", () => {
    it("archives a resume by ID", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        const result = await t.mutation(api.resumes.archiveResumes, {
            resumeIds: [String(resumeId)],
        });

        expect(result.archived).toBe(1);
        expect(result.alreadyArchived).toBe(0);

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.isArchived).toBe(true);
        expect(resume?.archivedAt).toBeDefined();
    });

    it("reports alreadyArchived for previously archived resumes", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        await t.mutation(api.resumes.archiveResumes, { resumeIds: [String(resumeId)] });
        const result = await t.mutation(api.resumes.archiveResumes, { resumeIds: [String(resumeId)] });

        expect(result.archived).toBe(0);
        expect(result.alreadyArchived).toBe(1);
    });

    it("reports missing IDs for invalid resume IDs", async () => {
        const t = convexTest(schema, modules);
        const result = await t.mutation(api.resumes.archiveResumes, {
            resumeIds: ["not-a-valid-id"],
        });
        expect(result.missingResumeIds).toContain("not-a-valid-id");
    });
});

describe("resumes: unarchiveResumes", () => {
    it("unarchives a previously archived resume", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        await t.mutation(api.resumes.archiveResumes, { resumeIds: [String(resumeId)] });
        const result = await t.mutation(api.resumes.unarchiveResumes, { resumeIds: [String(resumeId)] });

        expect(result.unarchived).toBe(1);

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.isArchived).toBeFalsy();
        expect(resume?.archivedAt).toBeUndefined();
    });

    it("reports notArchived for non-archived resumes", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        const result = await t.mutation(api.resumes.unarchiveResumes, { resumeIds: [String(resumeId)] });

        expect(result.unarchived).toBe(0);
        expect(result.notArchived).toBe(1);
    });
});

describe("resumes: getResume / getResumeDetail", () => {
    it("getResume returns resume by ID", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        const result = await t.query(internal.resumes.getResume, { resumeId });
        expect(result).not.toBeNull();
        expect(result!.externalId).toBe("test-resume-1");
    });

    it("getResume returns null for non-existent ID", async () => {
        const t = convexTest(schema, modules);
        // Create then delete a resume to get a valid but non-existent ID
        const doomedId = await seedResume(t, { externalId: "doomed" });
        await t.run(async (ctx) => { await ctx.db.delete(doomedId); });

        const result = await t.query(internal.resumes.getResume, { resumeId: doomedId });
        expect(result).toBeNull();
    });
});
