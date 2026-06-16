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
import { seedResume, seedResumeAnalysesColdRow } from "./test-helpers.js";

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

// ---------------------------------------------------------------------------
// updateIngestDataBatch
// ---------------------------------------------------------------------------

describe("resumes: updateIngestDataBatch", () => {
    it("updates ingestData and searchText for batch of resumes", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, { content: { name: "Alice" } });

        await t.mutation(internal.resumes.updateIngestDataBatch, {
            updates: [{
                resumeId,
                ingestData: {
                    industryTags: ["machinery"],
                    synonymHits: ["CNC"],
                    brandHits: [],
                    companyHits: [],
                    ruleScores: { jd1: 80 },
                    experienceLevel: "senior",
                    computedAt: Date.now(),
                    skillsVersion: 1,
                },
                primaryRuleScore: 80,
            }],
        });

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.ingestData?.industryTags).toEqual(["machinery"]);
        expect(resume?.primaryRuleScore).toBe(80);
        expect(resume?.searchText).toBeDefined();
    });

    it("skips non-existent resume IDs gracefully", async () => {
        const t = convexTest(schema, modules);
        // Create then delete to get a valid but non-existent ID
        const doomedId = await seedResume(t, { externalId: "doomed" });
        await t.run(async (ctx) => { await ctx.db.delete(doomedId); });

        // Should not throw
        await t.mutation(internal.resumes.updateIngestDataBatch, {
            updates: [{
                resumeId: doomedId,
                ingestData: {
                    industryTags: [],
                    synonymHits: [],
                    brandHits: [],
                    companyHits: [],
                    ruleScores: {},
                    experienceLevel: "junior",
                    computedAt: Date.now(),
                    skillsVersion: 1,
                },
            }],
        });
    });
});

// ---------------------------------------------------------------------------
// listResumeScanBatch
// ---------------------------------------------------------------------------

describe("resumes: listResumeScanBatch", () => {
    it("returns paginated resume rows with content and ingestData", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, { content: { name: "Bob" } });

        const result = await t.query(internal.resumes.listResumeScanBatch, { limit: 10 });

        expect(result.page.length).toBeGreaterThanOrEqual(1);
        expect(result.page[0]).toHaveProperty("_id");
        expect(result.page[0]).toHaveProperty("content");
        expect(result.isDone).toBe(true);
    });

    it("returns empty page when no resumes exist", async () => {
        const t = convexTest(schema, modules);

        const result = await t.query(internal.resumes.listResumeScanBatch, { limit: 10 });

        expect(result.page).toHaveLength(0);
        expect(result.isDone).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// listResumeUsageBatch
// ---------------------------------------------------------------------------

describe("resumes: listResumeUsageBatch", () => {
    it("sources analysis/analyses from the cold resume_analyses row", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);
        await seedResumeAnalysesColdRow(t, resumeId, {
            analysis: { score: 70, summary: "ok", highlights: [], recommendation: "proceed" },
            analyses: { "jd:test": { score: 70 } },
        });

        const result = await t.query(internal.resumes.listResumeUsageBatch, { limit: 10 });

        expect(result.page.length).toBeGreaterThanOrEqual(1);
        expect(result.page[0].analysis).toEqual({ score: 70, summary: "ok", highlights: [], recommendation: "proceed" });
        expect(result.page[0].analyses).toEqual({ "jd:test": { score: 70 } });
    });

    it("excludes analysis/analyses from archived cold rows (active-only)", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);
        // An archived row retains stale analysis/analyses (mirrors non-surgical
        // clearAnalyses), but must NOT contribute — reading without the active
        // guard would over-count cleared resumes.
        await seedResumeAnalysesColdRow(t, resumeId, {
            status: "archived",
            analysis: { score: 70, summary: "stale", highlights: [], recommendation: "proceed" },
            analyses: { "jd:test": { score: 70 } },
        });

        const result = await t.query(internal.resumes.listResumeUsageBatch, { limit: 10 });

        expect(result.page[0].analysis).toBeUndefined();
        expect(result.page[0].analyses).toBeUndefined();
    });

    it("returns undefined analysis/analyses for resumes with no cold row", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t);

        const result = await t.query(internal.resumes.listResumeUsageBatch, { limit: 10 });

        expect(result.page.length).toBeGreaterThanOrEqual(1);
        expect(result.page[0].analysis).toBeUndefined();
        expect(result.page[0].analyses).toBeUndefined();
    });

    it("returns empty page when no resumes exist", async () => {
        const t = convexTest(schema, modules);

        const result = await t.query(internal.resumes.listResumeUsageBatch, { limit: 10 });

        expect(result.page).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// clearAnalyses
// ---------------------------------------------------------------------------

describe("resumes: clearAnalyses", () => {
    it("clears all analysis data for specified resume IDs", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            analysis: { score: 80, summary: "good", highlights: [], recommendation: "proceed" },
            analyses: { "jd:1": { score: 80 } },
        });

        const result = await t.mutation(api.resumes.clearAnalyses, {
            resumeIds: [String(resumeId)],
        });

        expect(result.cleared).toBe(1);
        expect(result.hasMore).toBe(false);

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.analysis).toBeUndefined();
        expect(resume?.analyses).toBeUndefined();
    });

    it("skips resumes without analysis data", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t); // no analysis

        const result = await t.mutation(api.resumes.clearAnalyses, {
            resumeIds: [String(await t.run(async (ctx) => {
                const resumes = await ctx.db.query("resumes").collect();
                return resumes[0]._id;
            }))],
        });

        expect(result.cleared).toBe(0);
    });

    it("returns pagination info when clearing all resumes", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            analysis: { score: 50, summary: "", highlights: [], recommendation: "skip" },
        });

        const result = await t.mutation(api.resumes.clearAnalyses, {});

        expect(result.cleared).toBeGreaterThanOrEqual(1);
        expect(typeof result.hasMore).toBe("boolean");
    });
});

// ---------------------------------------------------------------------------
// deleteResumes
// ---------------------------------------------------------------------------

describe("resumes: deleteResumes", () => {
    it("deletes specified resumes and returns counts", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        const result = await t.mutation(api.resumes.deleteResumes, {
            resumeIds: [String(resumeId)],
        });

        expect(result.requested).toBe(1);
        expect(result.deleted).toBe(1);
        expect(result.missingResumeIds).toHaveLength(0);

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume).toBeNull();
    });

    it("reports missing resume IDs for invalid IDs", async () => {
        const t = convexTest(schema, modules);

        const result = await t.mutation(api.resumes.deleteResumes, {
            resumeIds: ["junk-id-that-does-not-exist"],
        });

        expect(result.requested).toBe(1);
        expect(result.deleted).toBe(0);
        expect(result.missingResumeIds.length).toBeGreaterThanOrEqual(1);
    });

    it("returns zero counts for empty input", async () => {
        const t = convexTest(schema, modules);

        const result = await t.mutation(api.resumes.deleteResumes, {
            resumeIds: [],
        });

        expect(result.requested).toBe(0);
        expect(result.deleted).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// hardResetIngestData
// ---------------------------------------------------------------------------

describe("resumes: hardResetIngestData", () => {
    it("clears all computed fields from resumes", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            ingestData: {
                industryTags: ["tech"],
                synonymHits: [],
                brandHits: [],
                companyHits: [],
                ruleScores: {},
                experienceLevel: "senior",
                computedAt: Date.now(),
                skillsVersion: 1,
            },
            primaryRuleScore: 75,
            searchText: "some search text",
            analysis: { score: 80, summary: "", highlights: [], recommendation: "proceed" },
        });

        const result = await t.mutation(api.resumes.hardResetIngestData, {});

        expect(result.cleared).toBeGreaterThanOrEqual(1);

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.ingestData).toBeUndefined();
        expect(resume?.primaryRuleScore).toBeUndefined();
        expect(resume?.searchText).toBeUndefined();
        expect(resume?.analysis).toBeUndefined();
        expect(resume?.analyses).toBeUndefined();
    });

    it("skips resumes with no computed fields", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t); // minimal — no computed fields

        const result = await t.mutation(api.resumes.hardResetIngestData, {});

        expect(result.cleared).toBe(0);
    });

    it("returns hasMore: false when all resumes fit in one batch", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, { searchText: "stale" });

        const result = await t.mutation(api.resumes.hardResetIngestData, { batchSize: 100 });

        expect(result.hasMore).toBe(false);
        expect(result.cursor).toBeNull();
    });
});
