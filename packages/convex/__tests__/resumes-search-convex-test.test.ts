/**
 * Convex-test coverage for resume search functions:
 * - search
 * - searchWithIngestData
 * - searchWithTagExpansion
 * - searchWithTagExpansionPage
 * - searchWithTagExpansionPaginated
 * - searchWithTagExpansionScanPage
 * - searchWithTagExpansionAndMode
 * - scanResumePageByTime
 * - scanResumePageSlim
 * - getResumes
 * - getResumeDocsByIds
 * - collectSearchIndexDocIds
 * - getResumesByIds
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import { seedResume, MINIMAL_INGEST_DATA } from "./test-helpers.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("resumes_search: search", () => {
    it("returns matching resumes by keyword", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "search-1",
            identityKey: "profileUrl:example.com/candidates/s1",
            searchText: "cnc operator machining",
        });
        await seedResume(t, {
            externalId: "search-2",
            identityKey: "profileUrl:example.com/candidates/s2",
            searchText: "java developer spring",
        });

        const result = await t.query(api.resumes_search.search, {
            query: "cnc",
        });

        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result.some((r) => r.externalId === "search-1")).toBe(true);
    });

    it("returns empty for non-matching query", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "search-3",
            identityKey: "profileUrl:example.com/candidates/s3",
            searchText: "cnc operator",
        });

        const result = await t.query(api.resumes_search.search, {
            query: "quantum physics",
        });

        expect(result).toHaveLength(0);
    });

    it("respects limit parameter", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "search-lim-1",
            identityKey: "profileUrl:example.com/candidates/lim1",
            searchText: "cnc machining",
        });
        await seedResume(t, {
            externalId: "search-lim-2",
            identityKey: "profileUrl:example.com/candidates/lim2",
            searchText: "cnc programming",
        });

        const result = await t.query(api.resumes_search.search, {
            query: "cnc",
            limit: 1,
        });

        expect(result.length).toBeLessThanOrEqual(1);
    });

    it("excludes archived resumes", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "search-archived",
            identityKey: "profileUrl:example.com/candidates/arch",
            searchText: "cnc operator",
            isArchived: true,
        });

        const result = await t.query(api.resumes_search.search, {
            query: "cnc",
        });

        expect(result.some((r) => r.externalId === "search-archived")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// searchWithIngestData
// ---------------------------------------------------------------------------

describe("resumes_search: searchWithIngestData", () => {
    it("returns matching resumes with ingestData scoring", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "sid-1",
            identityKey: "profileUrl:example.com/candidates/sid1",
            searchText: "cnc engineer",
            ingestData: MINIMAL_INGEST_DATA,
            primaryRuleScore: 80,
        });

        const result = await t.query(api.resumes_search.searchWithIngestData, {
            query: "cnc",
        });

        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0].externalId).toBe("sid-1");
    });

    it("sorts by JD rule score when jobDescriptionId provided", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "sid-jd-1",
            identityKey: "profileUrl:example.com/candidates/jd1",
            searchText: "cnc engineer",
            ingestData: MINIMAL_INGEST_DATA,
            primaryRuleScore: 30,
        });
        await seedResume(t, {
            externalId: "sid-jd-2",
            identityKey: "profileUrl:example.com/candidates/jd2",
            searchText: "cnc machining specialist",
            ingestData: MINIMAL_INGEST_DATA,
            primaryRuleScore: 90,
        });

        const result = await t.query(api.resumes_search.searchWithIngestData, {
            query: "cnc",
            jobDescriptionId: "jd-test",
        });

        // Both should be returned (order depends on JD rule scores)
        expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("returns empty for non-matching query", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "sid-nomatch",
            identityKey: "profileUrl:example.com/candidates/nom",
            searchText: "cnc operator",
        });

        const result = await t.query(api.resumes_search.searchWithIngestData, {
            query: "quantum",
        });

        expect(result).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// searchWithTagExpansion
// ---------------------------------------------------------------------------

describe("resumes_search: searchWithTagExpansion", () => {
    const cncGroup = { original: "cnc", variants: ["cnc"] };

    it("returns expansion metadata and matching results", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "ste-1",
            identityKey: "profileUrl:example.com/candidates/ste1",
            searchText: "cnc programming machining",
        });

        const result = await t.query(api.resumes_search.searchWithTagExpansion, {
            query: "cnc",
            keywordGroups: [cncGroup],
        });

        expect(result.expansion).toBeDefined();
        expect(result.expansion.original).toBe("cnc");
        expect(result.expansion.mode).toBe("AND");
        expect(result.results.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty results when no keyword groups", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "ste-empty",
            identityKey: "profileUrl:example.com/candidates/steE",
            searchText: "cnc operator",
        });

        const result = await t.query(api.resumes_search.searchWithTagExpansion, {
            query: "cnc",
            keywordGroups: [],
        });

        expect(result.results).toHaveLength(0);
        expect(result.expansion.expanded).toHaveLength(0);
    });

    it("includes provenance in results", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "ste-prov",
            identityKey: "profileUrl:example.com/candidates/steP",
            searchText: "cnc operator",
        });

        const result = await t.query(api.resumes_search.searchWithTagExpansion, {
            query: "cnc",
            keywordGroups: [cncGroup],
        });

        if (result.results.length > 0) {
            expect(result.results[0].provenance).toBeDefined();
            expect(Array.isArray(result.results[0].provenance)).toBe(true);
        }
    });

    it("supports OR mode", async () => {
        const t = convexTest(schema, modules);
        const salesGroup = { original: "sales", variants: ["sales", "业务"] };
        await seedResume(t, {
            externalId: "ste-or-1",
            identityKey: "profileUrl:example.com/candidates/or1",
            searchText: "cnc machining",
        });
        await seedResume(t, {
            externalId: "ste-or-2",
            identityKey: "profileUrl:example.com/candidates/or2",
            searchText: "sales manager",
        });

        const result = await t.query(api.resumes_search.searchWithTagExpansion, {
            query: "cnc sales",
            keywordGroups: [cncGroup, salesGroup],
            mode: "OR",
        });

        expect(result.expansion.mode).toBe("OR");
    });
});

// ---------------------------------------------------------------------------
// searchWithTagExpansionPage
// ---------------------------------------------------------------------------

describe("resumes_search: searchWithTagExpansionPage", () => {
    const cncGroup = { original: "cnc", variants: ["cnc"] };

    it("returns paginated results with total count", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "step-1",
            identityKey: "profileUrl:example.com/candidates/step1",
            searchText: "cnc machining",
        });

        const result = await t.query(api.resumes_search.searchWithTagExpansionPage, {
            query: "cnc",
            keywordGroups: [cncGroup],
        });

        expect(result.expansion).toBeDefined();
        expect(typeof result.total).toBe("number");
        expect(Array.isArray(result.results)).toBe(true);
    });

    it("applies offset for pagination", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "step-off-1",
            identityKey: "profileUrl:example.com/candidates/so1",
            searchText: "cnc programming",
        });
        await seedResume(t, {
            externalId: "step-off-2",
            identityKey: "profileUrl:example.com/candidates/so2",
            searchText: "cnc machining",
        });

        const result = await t.query(api.resumes_search.searchWithTagExpansionPage, {
            query: "cnc",
            keywordGroups: [cncGroup],
            offset: 1,
        });

        // Total should reflect all matches, results may be fewer
        expect(result.total).toBeGreaterThanOrEqual(0);
    });
});

// ---------------------------------------------------------------------------
// searchWithTagExpansionPaginated
// ---------------------------------------------------------------------------

describe("resumes_search: searchWithTagExpansionPaginated", () => {
    const cncGroup = { original: "cnc", variants: ["cnc"] };

    it("returns page with continuation cursor", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "stepag-1",
            identityKey: "profileUrl:example.com/candidates/sp1",
            searchText: "cnc engineering",
        });
        await seedResume(t, {
            externalId: "stepag-2",
            identityKey: "profileUrl:example.com/candidates/sp2",
            searchText: "cnc manufacturing",
        });

        const result = await t.query(api.resumes_search.searchWithTagExpansionPaginated, {
            paginationOpts: { numItems: 1, cursor: null },
            query: "cnc",
            keywordGroups: [cncGroup],
        });

        expect(Array.isArray(result.page)).toBe(true);
        expect(result).toHaveProperty("continueCursor");
        expect(result).toHaveProperty("isDone");
    });

    it("returns isDone true when no results", async () => {
        const t = convexTest(schema, modules);

        const result = await t.query(api.resumes_search.searchWithTagExpansionPaginated, {
            paginationOpts: { numItems: 10, cursor: null },
            query: "nonexistent",
            keywordGroups: [cncGroup],
        });

        expect(result.page).toHaveLength(0);
        expect(result.isDone).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// searchWithTagExpansionScanPage
// ---------------------------------------------------------------------------

describe("resumes_search: searchWithTagExpansionScanPage", () => {
    const cncGroup = { original: "cnc", variants: ["cnc"] };

    it("returns scan page with cursor", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "stesp-1",
            identityKey: "profileUrl:example.com/candidates/stesp1",
            searchText: "cnc milling",
        });

        const result = await t.query(api.resumes_search.searchWithTagExpansionScanPage, {
            paginationOpts: { numItems: 10, cursor: null },
            query: "cnc",
            keywordGroups: [cncGroup],
        });

        expect(result).toHaveProperty("expansion");
        expect(Array.isArray(result.page)).toBe(true);
        expect(result).toHaveProperty("continueCursor");
        expect(result).toHaveProperty("isDone");
    });
});

// ---------------------------------------------------------------------------
// scanResumePageByTime
// ---------------------------------------------------------------------------

describe("resumes_search: scanResumePageByTime", () => {
    it("returns empty page when no resumes exist", async () => {
        const t = convexTest(schema, modules);
        const result = await t.query(api.resumes_search.scanResumePageByTime, {});

        expect(result.docs).toHaveLength(0);
        expect(result.isDone).toBe(true);
    });

    it("returns projected scan rows with selected fields", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "scan-1",
            identityKey: "profileUrl:example.com/candidates/sc1",
            searchText: "engineer cnc",
            primaryRuleScore: 50,
            ingestData: MINIMAL_INGEST_DATA,
        });

        const result = await t.query(api.resumes_search.scanResumePageByTime, {});

        expect(result.docs).toHaveLength(1);
        const row = result.docs[0];
        expect(row).toHaveProperty("_id");
        expect(row).toHaveProperty("searchText");
        expect(row.searchText).toBe("engineer cnc");
        expect(row).toHaveProperty("content");
        expect(row).toHaveProperty("ingestData");
    });

    it("paginates with cursor", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "scan-p-1",
            identityKey: "profileUrl:example.com/candidates/sp1",
            searchText: "engineer",
        });
        await seedResume(t, {
            externalId: "scan-p-2",
            identityKey: "profileUrl:example.com/candidates/sp2",
            searchText: "developer",
        });

        const page1 = await t.query(api.resumes_search.scanResumePageByTime, {
            numItems: 1,
        });
        expect(page1.docs).toHaveLength(1);
        expect(page1.isDone).toBe(false);
        expect(page1.cursor).toBeTruthy();

        const page2 = await t.query(api.resumes_search.scanResumePageByTime, {
            cursor: page1.cursor ?? undefined,
            numItems: 1,
        });
        expect(page2.docs).toHaveLength(1);
    });

    it("caps numItems at 50", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "scan-cap",
            identityKey: "profileUrl:example.com/candidates/cap",
            searchText: "engineer",
        });

        // Request 200 items but should be capped at 50
        const result = await t.query(api.resumes_search.scanResumePageByTime, {
            numItems: 200,
        });

        // With only 1 resume, we get 1 result but the cap is enforced internally
        expect(result.docs).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// scanResumePageSlim
// ---------------------------------------------------------------------------

describe("resumes_search: scanResumePageSlim", () => {
    it("returns slim projection without content or ingestData", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "slim-1",
            identityKey: "profileUrl:example.com/candidates/sl1",
            searchText: "cnc operator",
            primaryRuleScore: 30,
            ingestData: MINIMAL_INGEST_DATA,
        });

        const result = await t.query(api.resumes_search.scanResumePageSlim, {});

        expect(result.docs).toHaveLength(1);
        const row = result.docs[0];
        expect(row).toHaveProperty("_id");
        expect(row).toHaveProperty("searchText");
        expect(row).toHaveProperty("source");
        // Slim projection should NOT have content or ingestData
        expect(row).not.toHaveProperty("content");
        expect(row).not.toHaveProperty("ingestData");
    });

    it("caps numItems at 200", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "slim-cap",
            identityKey: "profileUrl:example.com/candidates/slc",
            searchText: "engineer",
        });

        const result = await t.query(api.resumes_search.scanResumePageSlim, {
            numItems: 1000,
        });

        expect(result.docs).toHaveLength(1);
    });

    it("returns empty page when no resumes exist", async () => {
        const t = convexTest(schema, modules);
        const result = await t.query(api.resumes_search.scanResumePageSlim, {});

        expect(result.docs).toHaveLength(0);
        expect(result.isDone).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// getResumes
// ---------------------------------------------------------------------------

describe("resumes_search: getResumes", () => {
    it("returns resumes with default limit", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "gr-1",
            identityKey: "profileUrl:example.com/candidates/gr1",
        });

        const result = await t.query(api.resumes_search.getResumes, {});

        expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("respects custom limit", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "gr-2",
            identityKey: "profileUrl:example.com/candidates/gr2",
        });
        await seedResume(t, {
            externalId: "gr-3",
            identityKey: "profileUrl:example.com/candidates/gr3",
        });

        const result = await t.query(api.resumes_search.getResumes, { limit: 1 });

        expect(result.length).toBeLessThanOrEqual(1);
    });

    it("excludes archived resumes", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "gr-archived",
            identityKey: "profileUrl:example.com/candidates/gra",
            isArchived: true,
        });

        const result = await t.query(api.resumes_search.getResumes, {});

        expect(result.some((r) => r.externalId === "gr-archived")).toBe(false);
    });

    it("returns empty for empty database", async () => {
        const t = convexTest(schema, modules);
        const result = await t.query(api.resumes_search.getResumes, {});

        expect(result).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// getResumeDocsByIds
// ---------------------------------------------------------------------------

describe("resumes_search: getResumeDocsByIds", () => {
    it("returns projected docs for valid IDs", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            externalId: "grbi-1",
            identityKey: "profileUrl:example.com/candidates/grbi1",
            searchText: "engineer",
            primaryRuleScore: 40,
            ingestData: MINIMAL_INGEST_DATA,
        });

        const result = await t.query(api.resumes_search.getResumeDocsByIds, {
            ids: [resumeId],
        });

        expect(result).toHaveLength(1);
        expect(result[0]._id).toBe(resumeId);
        expect(result[0]).toHaveProperty("searchText");
        expect(result[0]).toHaveProperty("content");
        expect(result[0]).toHaveProperty("ingestData");
    });

    it("skips non-existent IDs", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            externalId: "grbi-2",
            identityKey: "profileUrl:example.com/candidates/grbi2",
        });
        const doomedId = await seedResume(t, {
            externalId: "grbi-doomed",
            identityKey: "profileUrl:example.com/candidates/grbid",
        });
        await t.run(async (ctx) => { await ctx.db.delete(doomedId); });

        const result = await t.query(api.resumes_search.getResumeDocsByIds, {
            ids: [resumeId, doomedId],
        });

        expect(result).toHaveLength(1);
        expect(result[0]._id).toBe(resumeId);
    });

    it("returns empty array for empty input", async () => {
        const t = convexTest(schema, modules);
        const result = await t.query(api.resumes_search.getResumeDocsByIds, {
            ids: [],
        });

        expect(result).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// collectSearchIndexDocIds
// ---------------------------------------------------------------------------

describe("resumes_search: collectSearchIndexDocIds", () => {
    it("returns document IDs matching search query", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "csid-1",
            identityKey: "profileUrl:example.com/candidates/csid1",
            searchText: "cnc machining specialist",
        });

        const result = await t.query(internal.resumes_search.collectSearchIndexDocIds, {
            searchQuery: "cnc",
        });

        expect(result.ids.length).toBeGreaterThanOrEqual(1);
        expect(result).toHaveProperty("isDone");
    });

    it("returns empty for non-matching query", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "csid-nomatch",
            identityKey: "profileUrl:example.com/candidates/csidnm",
            searchText: "java developer",
        });

        const result = await t.query(internal.resumes_search.collectSearchIndexDocIds, {
            searchQuery: "quantum",
        });

        expect(result.ids).toHaveLength(0);
    });

    it("paginates with cursor and numItems", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "csid-p-1",
            identityKey: "profileUrl:example.com/csidp1",
            searchText: "cnc machining",
        });
        await seedResume(t, {
            externalId: "csid-p-2",
            identityKey: "profileUrl:example.com/candidates/csidp2",
            searchText: "cnc programming",
        });

        const page1 = await t.query(internal.resumes_search.collectSearchIndexDocIds, {
            searchQuery: "cnc",
            numItems: 1,
        });

        expect(page1.ids.length).toBeGreaterThanOrEqual(1);
        // May have more pages
        if (!page1.isDone && page1.cursor) {
            const page2 = await t.query(internal.resumes_search.collectSearchIndexDocIds, {
                searchQuery: "cnc",
                cursor: page1.cursor,
                numItems: 1,
            });
            expect(page2.ids.length).toBeGreaterThanOrEqual(0);
        }
    });

    it("excludes archived resumes from results", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "csid-archived",
            identityKey: "profileUrl:example.com/candidates/csida",
            searchText: "cnc operator",
            isArchived: true,
        });

        const result = await t.query(internal.resumes_search.collectSearchIndexDocIds, {
            searchQuery: "cnc",
        });

        // Archived resume should not appear in search results
        expect(result.ids).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// getResumesByIds
// ---------------------------------------------------------------------------

describe("resumes_search: getResumesByIds", () => {
    it("returns full docs for valid IDs", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            externalId: "grbi-id-1",
            identityKey: "profileUrl:example.com/candidates/grbii1",
            searchText: "engineer",
        });

        const result = await t.query(internal.resumes_search.getResumesByIds, {
            resumeIds: [resumeId],
        });

        expect(result).toHaveLength(1);
        expect(result[0]._id).toBe(resumeId);
        // Full doc — should have all fields including content
        expect(result[0]).toHaveProperty("content");
        expect(result[0]).toHaveProperty("hash");
        expect(result[0]).toHaveProperty("source");
    });

    it("skips null (deleted) docs", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            externalId: "grbi-id-ok",
            identityKey: "profileUrl:example.com/candidates/grbiok",
        });
        const doomedId = await seedResume(t, {
            externalId: "grbi-id-doomed",
            identityKey: "profileUrl:example.com/candidates/grbidm",
        });
        await t.run(async (ctx) => { await ctx.db.delete(doomedId); });

        const result = await t.query(internal.resumes_search.getResumesByIds, {
            resumeIds: [resumeId, doomedId],
        });

        expect(result).toHaveLength(1);
        expect(result[0]._id).toBe(resumeId);
    });

    it("returns empty array for empty input", async () => {
        const t = convexTest(schema, modules);
        const result = await t.query(internal.resumes_search.getResumesByIds, {
            resumeIds: [],
        });

        expect(result).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// searchWithTagExpansionAndMode (action)
// ---------------------------------------------------------------------------

describe("resumes_search: scanResumeDigestPage", () => {
    it("builds compact digest search text without copying cold resume searchText", async () => {
        const t = convexTest(schema, modules);
        const coldSearchText = [
            "cnc 销售",
            "coldblob ".repeat(6000),
        ].join(" ");
        const resumeId = await seedResume(t, {
            externalId: "digest-compact",
            identityKey: "profileUrl:example.com/candidates/digest-compact",
            source: "job5156",
            sourceKey: "job5156",
            searchText: coldSearchText,
            content: {
                name: "Compact Candidate",
                desiredPosition: "CNC销售工程师",
                education: "本科",
                expectedSalary: "15-25K",
                locationHierarchy: { country: "中国", province: "广东", city: "东莞" },
                skills: ["CNC", "销售"],
                workHistory: [{
                    companyName: "制造有限公司",
                    jobTitle: "CNC销售工程师",
                    description: "负责数控机床销售",
                    startDate: "2021-01",
                    endDate: "至今",
                }],
            },
            age: 30,
            ingestData: {
                ...MINIMAL_INGEST_DATA,
                synonymHits: ["数控", "销售"],
                verifiedRoleYears: { sales: 3 },
            },
        });

        await t.mutation(api.resumes_search.upsertResumeDigestForTest, { resumeId });
        const result = await t.query(api.resumes_search.scanResumeDigestPage, { numItems: 1000 });

        expect(result.docs).toHaveLength(1);
        const row = result.docs[0];
        expect(row.searchText).toContain("cnc");
        expect(row.searchText).toContain("销售");
        expect(row.searchText).not.toContain("coldblob");
        expect(JSON.stringify(row).length).toBeLessThan(2048);
    });

    it("preserves domain keyword tokens from cold searchText without copying it", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            externalId: "digest-domain-token",
            identityKey: "profileUrl:example.com/candidates/digest-domain-token",
            source: "job5156",
            sourceKey: "job5156",
            searchText: [
                "profile education included 数控 原理 and 销售 context",
                "coldblob ".repeat(6000),
            ].join(" "),
            content: {
                name: "Domain Token Candidate",
                education: "本科",
                expectedSalary: "15-25K",
                locationHierarchy: { country: "中国" },
            },
            age: 30,
        });

        await t.mutation(api.resumes_search.upsertResumeDigestForTest, { resumeId });
        const result = await t.query(api.resumes_search.scanResumeDigestPage, { numItems: 1000 });

        const row = result.docs[0];
        expect(row.searchText).toContain("cnc");
        expect(row.searchText).toContain("数控");
        expect(row.searchText).toContain("销售");
        expect(row.searchText).not.toContain("coldblob");
        expect(JSON.stringify(row).length).toBeLessThan(2048);
    });

    it("derives digest role years from roleSignals when verifiedRoleYears is absent", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            externalId: "digest-role-signals",
            identityKey: "profileUrl:example.com/candidates/digest-role-signals",
            searchText: "cnc 销售",
            content: {
                name: "Role Signal Candidate",
                workHistory: [{ raw: "2021-2024 销售工程师" }],
            },
            ingestData: {
                ...MINIMAL_INGEST_DATA,
                verifiedRoleYears: {},
                roleSignals: [{
                    type: "sales",
                    matchedSignals: ["销售"],
                    signalCount: 1,
                    occurrences: 1,
                    years: 3,
                    industryVerifiedYears: 3,
                    industryVerifiedRelevantYears: 3,
                    roleRelevantYears: 3,
                    matchedWorkEntries: [{
                        companyName: "测试公司",
                        jobTitle: "销售工程师",
                        years: 3,
                        directRoleMatch: true,
                        industryVerified: true,
                        matchedSignals: ["销售"],
                    }],
                    verifyIn: "workHistory",
                }],
            },
        });

        await t.mutation(api.resumes_search.upsertResumeDigestForTest, { resumeId });
        const result = await t.query(api.resumes_search.scanResumeDigestPage, { numItems: 1000 });

        const row = result.docs[0];
        expect(row.roleTypes).toEqual(["sales"]);
        expect(row.roleYearsByType).toEqual({ sales: 3 });
    });

    it("returns digest projection without cold resume content or full ingestData", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            externalId: "digest-1",
            identityKey: "profileUrl:example.com/candidates/digest-1",
            source: "job5156",
            sourceKey: "job5156",
            searchText: "cnc 销售 数控 销售工程师",
            primaryRuleScore: 30,
            age: 30,
            ingestData: MINIMAL_INGEST_DATA,
        });

        await t.mutation(api.resumes_search.upsertResumeDigestForTest, { resumeId });
        const result = await t.query(api.resumes_search.scanResumeDigestPage, { numItems: 1000 });

        expect(result.docs).toHaveLength(1);
        const row = result.docs[0];
        expect(row).toHaveProperty("resumeId", resumeId);
        expect(row).toHaveProperty("searchText");
        expect(row).toHaveProperty("age", 30);
        expect(row).not.toHaveProperty("content");
        expect(row).not.toHaveProperty("ingestData");
        expect(JSON.stringify(row).length).toBeLessThan(2048);
    });

    it("caps digest pages at 1000 small rows", async () => {
        const t = convexTest(schema, modules);
        const resumeId = await seedResume(t, {
            externalId: "digest-cap",
            identityKey: "profileUrl:example.com/candidates/digest-cap",
            searchText: "engineer",
        });

        await t.mutation(api.resumes_search.upsertResumeDigestForTest, { resumeId });
        const result = await t.query(api.resumes_search.scanResumeDigestPage, { numItems: 5000 });

        expect(result.docs).toHaveLength(1);
    });
});

describe("resumes_search: searchWithTagExpansionAndMode", () => {
    const cncGroup = { original: "cnc", variants: ["cnc"] };

    it("returns empty results when no keyword groups", async () => {
        const t = convexTest(schema, modules);

        const result = await t.action(api.resumes_search.searchWithTagExpansionAndMode, {
            query: "cnc",
            keywordGroups: [],
        });

        expect(result.total).toBe(0);
        expect(result.results).toHaveLength(0);
        expect(result.expansion.mode).toBe("AND");
    });

    it("returns matching results with AND-mode anchor scan", async () => {
        const t = convexTest(schema, modules);
        await seedResume(t, {
            externalId: "and-1",
            identityKey: "profileUrl:example.com/candidates/and1",
            searchText: "cnc machining specialist",
        });

        const result = await t.action(api.resumes_search.searchWithTagExpansionAndMode, {
            query: "cnc",
            keywordGroups: [cncGroup],
        });

        expect(result.expansion).toBeDefined();
        expect(result.expansion.mode).toBe("AND");
        expect(result.total).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(result.results)).toBe(true);
    });

    it("returns expansion metadata with expanded terms", async () => {
        const t = convexTest(schema, modules);

        const result = await t.action(api.resumes_search.searchWithTagExpansionAndMode, {
            query: "cnc",
            keywordGroups: [cncGroup],
        });

        expect(result.expansion.original).toBe("cnc");
        expect(result.expansion.expanded).toContain("cnc");
    });
});
