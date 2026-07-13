/**
 * Convex-test coverage for resume mutations — extended:
 * - updateIngestDataBatch
 * - listResumeScanBatch
 * - listResumeUsageBatch
 * - clearAnalyses
 * - deleteResumes
 * - hardResetIngestData
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import { seedResume, MINIMAL_INGEST_DATA, getResumeAnalysesColdRow } from "./test-helpers.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// ---------------------------------------------------------------------------
// updateIngestDataBatch
// ---------------------------------------------------------------------------

describe("resumes_mutations: updateIngestDataBatch", () => {
    it("persists Phase 2 brand signals through Convex validation", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
            updates: [{
                resumeId,
                ingestData: {
                    ...MINIMAL_INGEST_DATA,
                    brandHits: [{
                        brand: "蕙勒",
                        role: "sales",
                        source: "workHistory",
                        context: "employer",
                        origin: "domestic",
                        productClass: "complete_machine",
                    }],
                    brandOrigin: "domestic",
                    productClass: "complete_machine",
                },
            }],
        });

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.ingestData).toMatchObject({
            brandOrigin: "domestic",
            productClass: "complete_machine",
            brandHits: [{
                brand: "蕙勒",
                origin: "domestic",
                productClass: "complete_machine",
            }],
        });
    });

    it("updates ingestData and rebuilds searchText", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
            updates: [{
                resumeId,
                ingestData: MINIMAL_INGEST_DATA,
                primaryRuleScore: 42,
            }],
        });

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.ingestData).toBeDefined();
        expect(resume?.primaryRuleScore).toBe(42);
        // searchText should be rebuilt from content + ingest tokens
        expect(resume?.searchText).toContain("cnc");
    });

    it("merges ingest tokens into existing searchText", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, { searchText: "existing engineer" });

        await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
            updates: [{
                resumeId,
                ingestData: {
                    ...MINIMAL_INGEST_DATA,
                    industryTags: ["manufacturing", "aerospace"],
                },
                companyPatternAliasTokens: "boeing",
            }],
        });

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        // Should preserve existing searchText base and merge new tokens
        expect(resume?.searchText).toContain("engineer");
        expect(resume?.searchText).toContain("aerospace");
        expect(resume?.searchText).toContain("boeing");
    });

    it("skips non-existent resume IDs gracefully", async () => {
        const t = convexTest(schema, modules);
        const id1 = await seedResume(t, { externalId: "batch-ok" });
        const doomedId = await seedResume(t, { externalId: "batch-doomed" });
        await t.run(async (ctx) => { await ctx.db.delete(doomedId); });

        // Should not throw — just skips the missing one
        await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
            updates: [
                { resumeId: id1, ingestData: MINIMAL_INGEST_DATA, primaryRuleScore: 10 },
                { resumeId: doomedId, ingestData: MINIMAL_INGEST_DATA },
            ],
        });

        const r1 = await t.run(async (ctx) => ctx.db.get(id1));
        expect(r1?.primaryRuleScore).toBe(10);
    });

    it("defaults primaryRuleScore to 0 when omitted", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
            updates: [{ resumeId, ingestData: MINIMAL_INGEST_DATA }],
        });

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.primaryRuleScore).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// listResumeScanBatch
// ---------------------------------------------------------------------------

describe("resumes_mutations: listResumeScanBatch", () => {
    it("returns empty page when no resumes exist", async () => {
        const t = convexTest(schema, modules);
        const result = await t.query(internal.resumes_mutations.listResumeScanBatch, {});
        expect(result.page).toHaveLength(0);
        expect(result.isDone).toBe(true);
    });

    it("returns projected scan rows with selected fields", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, { searchText: "engineer", primaryRuleScore: 30 });

        const result = await t.query(internal.resumes_mutations.listResumeScanBatch, {});
        expect(result.page).toHaveLength(1);
        const row = result.page[0];
        expect(row).toHaveProperty("_id");
        expect(row).toHaveProperty("content");
        expect(row).toHaveProperty("primaryRuleScore");
        expect(row).toHaveProperty("searchText");
        expect(row.searchText).toBe("engineer");
        expect(row.primaryRuleScore).toBe(30);
    });

    it("paginates with cursor", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, { externalId: "scan-1", identityKey: "profileUrl:example.com/candidates/s1" });
        await seedResume(t, { externalId: "scan-2", identityKey: "profileUrl:example.com/candidates/s2" });

        const page1 = await t.query(internal.resumes_mutations.listResumeScanBatch, { limit: 1 });
        expect(page1.page).toHaveLength(1);
        expect(page1.isDone).toBe(false);
        expect(page1.continueCursor).toBeTruthy();

        const page2 = await t.query(internal.resumes_mutations.listResumeScanBatch, {
            cursor: page1.continueCursor,
            limit: 1,
        });
        expect(page2.page).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// listResumeUsageBatch
// ---------------------------------------------------------------------------

describe("resumes_mutations: listResumeUsageBatch", () => {
    it("returns empty page when no resumes exist", async () => {
        const t = convexTest(schema, modules);
        const result = await t.query(internal.resumes_mutations.listResumeUsageBatch, {});
        expect(result.page).toHaveLength(0);
        expect(result.isDone).toBe(true);
    });

    it("returns analysis and analyses fields only", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        // Set up analysis data
        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 75,
                summary: "Good candidate",
                highlights: ["experienced"],
                recommendation: "proceed",
                jobDescriptionId: "jd-1",
            },
        });

        const result = await t.query(internal.resumes_mutations.listResumeUsageBatch, {});
        expect(result.page).toHaveLength(1);
        const row = result.page[0];
        expect(row).toHaveProperty("analysis");
        expect(row).toHaveProperty("analyses");
        expect(row.analysis).toBeDefined();
        // Should NOT have content, searchText, etc.
        expect(row).not.toHaveProperty("content");
        expect(row).not.toHaveProperty("searchText");
    });
});

// ---------------------------------------------------------------------------
// clearAnalyses
// ---------------------------------------------------------------------------

describe("resumes_mutations: clearAnalyses", () => {
    it("clears all analyses when no jobDescriptionId specified", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 80,
                summary: "Strong",
                highlights: ["experienced"],
                recommendation: "proceed",
                jobDescriptionId: "jd-1",
            },
        });

        const result = await t.mutation(api.resumes_mutations.clearAnalyses, {
            resumeIds: [resumeId],
        });

        expect(result.cleared).toBe(1);
        expect(result.hasMore).toBe(false);

        // Phase 4 Step 3a: updateAnalysis wrote cold, so the hot doc never
        // carried analysis. Assert the clear archived the cold row instead.
        const coldRow = await getResumeAnalysesColdRow(t, resumeId);
        expect(coldRow).not.toBeNull();
        expect(coldRow?.status).toBe("archived");
    });

    it("clears only matching JD analyses when jobDescriptionId specified", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        // Add analysis for jd-1
        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 80,
                summary: "For JD1",
                highlights: [],
                recommendation: "proceed",
                jobDescriptionId: "jd-1",
            },
        });

        // Add analysis for jd-2 (this will become the current analysis)
        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 60,
                summary: "For JD2",
                highlights: [],
                recommendation: "potential",
                jobDescriptionId: "jd-2",
            },
        });

        // Clear only jd-1 analyses
        const result = await t.mutation(api.resumes_mutations.clearAnalyses, {
            resumeIds: [resumeId],
            jobDescriptionId: "jd-1",
        });

        expect(result.cleared).toBe(1);

        // Phase 4 Step 3a: surgical clear updates the cold row. jd-2 analysis
        // should remain as current; the jd-1 entry should be removed from the
        // cold analyses map.
        const coldRow = await getResumeAnalysesColdRow(t, resumeId);
        expect(coldRow).not.toBeNull();
        expect(coldRow?.analysis?.jobDescriptionId).toBe("jd-2");
        const analysesKeys = Object.keys(coldRow?.analyses ?? {});
        const jd1Key = analysesKeys.find((k) => k.includes("jd-1"));
        expect(jd1Key).toBeUndefined();
    });

    it("skips resumes that have no analysis data", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        const result = await t.mutation(api.resumes_mutations.clearAnalyses, {
            resumeIds: [resumeId],
        });

        expect(result.cleared).toBe(0);
    });

    it("paginates when no resumeIds provided", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, { externalId: "clear-1", identityKey: "profileUrl:example.com/candidates/c1" });
        await seedResume(t, {
            externalId: "clear-2",
            identityKey: "profileUrl:example.com/candidates/c2",
            analysis: { score: 50, summary: "Test", highlights: [], recommendation: "skip" },
        });

        const result = await t.mutation(api.resumes_mutations.clearAnalyses, {
            batchSize: 1,
        });

        // Only the second resume has analysis data to clear
        expect(result.cleared).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// deleteResumes
// ---------------------------------------------------------------------------

describe("resumes_mutations: deleteResumes", () => {
    it("deletes a resume and returns correct counts", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        const result = await t.mutation(api.resumes_mutations.deleteResumes, {
            resumeIds: [String(resumeId)],
        });

        expect(result.requested).toBe(1);
        expect(result.deleted).toBe(1);
        expect(result.missingResumeIds).toHaveLength(0);

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume).toBeNull();
    });

    it("reports missing IDs for invalid resume IDs", async () => {
        const t = convexTest(schema, modules);
        const result = await t.mutation(api.resumes_mutations.deleteResumes, {
            resumeIds: ["not-a-valid-id"],
        });

        expect(result.requested).toBe(1);
        expect(result.deleted).toBe(0);
        expect(result.missingResumeIds).toContain("not-a-valid-id");
    });

    it("deletes associated ai_tagging_results", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        // Insert an ai_tagging_result linked to this resume
        await t.run(async (ctx) => {
            await ctx.db.insert("ai_tagging_results", {
                resumeId,
                identityKey: "profileUrl:example.com/candidates/1",
                workspaceSlug: "dev",
                profileKey: "test-profile",
                evidenceHash: "hash-123",
                promptVersion: "v1",
                model: "test-model",
                idempotencyKey: "idem-123",
                status: "completed",
                result: {
                    roleFit: "high",
                    recommendation: "proceed",
                    confidence: 0.9,
                    tags: ["skilled"],
                    evidenceLines: ["5 years CNC"],
                },
                createdAt: Date.now(),
            });
        });

        const result = await t.mutation(api.resumes_mutations.deleteResumes, {
            resumeIds: [String(resumeId)],
        });

        expect(result.deleted).toBe(1);
        expect(result.deletedAiTaggingResults).toBe(1);
    });

    it("patches screening_sessions to remove deleted resume IDs", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        // Insert a screening session referencing this resume
        await t.run(async (ctx) => {
            await ctx.db.insert("screening_sessions", {
                sessionKey: "test-session",
                status: "active",
                config: {
                    location: "Shanghai",
                    keywords: ["engineer"],
                    filters: {},
                },
                reviewedResumeIds: [String(resumeId), "other-resume-id"],
                lastActive: Date.now(),
            });
        });

        const result = await t.mutation(api.resumes_mutations.deleteResumes, {
            resumeIds: [String(resumeId)],
        });

        expect(result.deleted).toBe(1);
        expect(result.patchedScreeningSessions).toBe(1);

        // Verify the session no longer references the deleted resume
        const session = await t.run(async (ctx) => {
            const page = await ctx.db.query("screening_sessions").first();
            return page;
        });
        expect(session?.reviewedResumeIds).not.toContain(String(resumeId));
        expect(session?.reviewedResumeIds).toContain("other-resume-id");
    });

    it("deduplicates and trims resume IDs", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t);

        const result = await t.mutation(api.resumes_mutations.deleteResumes, {
            resumeIds: [String(resumeId), String(resumeId), "  ", ""],
        });

        expect(result.deleted).toBe(1);
        // Duplicates and empty strings should be normalized away
        expect(result.requested).toBe(1);
    });

    it("returns zero counts for empty input", async () => {
        const t = convexTest(schema, modules);
        const result = await t.mutation(api.resumes_mutations.deleteResumes, {
            resumeIds: [],
        });

        expect(result.requested).toBe(0);
        expect(result.deleted).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// hardResetIngestData
// ---------------------------------------------------------------------------

describe("resumes_mutations: hardResetIngestData", () => {
    it("clears ingestData, analysis, analyses, primaryRuleScore, and searchText", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            ingestData: MINIMAL_INGEST_DATA,
            searchText: "engineer cnc",
            primaryRuleScore: 42,
        });

        await t.mutation(internal.resumes.updateAnalysis, {
            resumeId,
            analysis: {
                score: 80,
                summary: "Test",
                highlights: [],
                recommendation: "proceed",
            },
        });

        const result = await t.mutation(api.resumes_mutations.hardResetIngestData, {});

        expect(result.cleared).toBe(1);

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        expect(resume?.ingestData).toBeUndefined();
        expect(resume?.primaryRuleScore).toBeUndefined();
        expect(resume?.searchText).toBeUndefined();
        // Phase 4 Step 3a: analysis is cleared by ARCHIVING the cold row
        // (updateAnalysis wrote cold; the hot doc never carried it).
        const coldRow = await getResumeAnalysesColdRow(t, resumeId);
        expect(coldRow).not.toBeNull();
        expect(coldRow?.status).toBe("archived");
    });

    it("skips resumes with no computed fields", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t); // No ingestData, no analysis, no searchText

        const result = await t.mutation(api.resumes_mutations.hardResetIngestData, {});
        expect(result.cleared).toBe(0);
    });

    it("returns hasMore and cursor for pagination", async () => {
        const t = convexTest(schema, modules);
        // Create 2 resumes with computed fields
        await seedResume(t, {
            externalId: "reset-1",
            identityKey: "profileUrl:example.com/candidates/r1",
            searchText: "engineer",
        });
        await seedResume(t, {
            externalId: "reset-2",
            identityKey: "profileUrl:example.com/candidates/r2",
            ingestData: MINIMAL_INGEST_DATA,
        });

        // Request batch size 1 to force pagination
        const page1 = await t.mutation(api.resumes_mutations.hardResetIngestData, { batchSize: 1 });
        expect(page1.cleared).toBe(1);
        expect(page1.hasMore).toBe(true);
        expect(page1.cursor).toBeTruthy();

        const page2 = await t.mutation(api.resumes_mutations.hardResetIngestData, {
            cursor: page1.cursor ?? undefined,
            batchSize: 1,
        });
        expect(page2.cleared).toBe(1);
    });

    it("preserves non-computed fields like content and sourceKey", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            ingestData: MINIMAL_INGEST_DATA,
            searchText: "engineer",
        });

        await t.mutation(api.resumes_mutations.hardResetIngestData, {});

        const resume = await t.run(async (ctx) => ctx.db.get(resumeId));
        // Non-computed fields should be preserved
        expect(resume?.content).toBeDefined();
        expect(resume?.sourceKey).toBe("test");
        expect(resume?.externalId).toBe("test-resume-1");
    });
});
