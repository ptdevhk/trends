import { describe, expect, it } from "vitest";

import {
    buildDiagnosticsSourceFacetRows,
    matchesDiagnosticsSourceKeys,
    projectIngestDiagnosticsRow,
    resolveDiagnosticsSourceKeyForResume,
    resolveListWithIngestWindow,
    resolveResumeScanBatchSize,
    resolveSearchWithTagExpansionTakeLimit,
} from "../resumes";

describe("resolveListWithIngestWindow", () => {
    it("uses the default list window when no limit is provided", () => {
        expect(resolveListWithIngestWindow(undefined)).toEqual({
            limit: 50,
            overfetchLimit: 150,
        });
    });

    it("clamps oversized requests to the safe ingest list window", () => {
        expect(resolveListWithIngestWindow(5_000)).toEqual({
            limit: 2000,
            overfetchLimit: 4000,
        });
    });
});

describe("resolveResumeScanBatchSize", () => {
    it("uses the default scan size when no limit is provided", () => {
        expect(resolveResumeScanBatchSize(undefined)).toBe(25);
    });

    it("clamps oversized scan batches to the safe maximum", () => {
        expect(resolveResumeScanBatchSize(5_000)).toBe(50);
    });

    it("clamps to minimum of 1", () => {
        expect(resolveResumeScanBatchSize(0)).toBe(1);
    });

    it("handles NaN", () => {
        expect(resolveResumeScanBatchSize(Number.NaN)).toBe(25);
    });
});

describe("resolveSearchWithTagExpansionTakeLimit", () => {
    it("keeps the default narrow overfetch for unconstrained keyword pages", () => {
        expect(resolveSearchWithTagExpansionTakeLimit({
            limit: 5,
            offset: 0,
            hasFilters: false,
        })).toBe(15);
    });

    it("widens the search take window for filtered job-scoped keyword pages", () => {
        expect(resolveSearchWithTagExpansionTakeLimit({
            limit: 5,
            offset: 0,
            hasFilters: true,
            jobDescriptionId: "jd-seek-malaysia-sales",
        })).toBe(250);
    });
});

describe("projectIngestDiagnosticsRow", () => {
    it("projects only the fields required by the ingest diagnostics page", () => {
        const row = projectIngestDiagnosticsRow({
            _id: "resume-1",
            externalId: "ext-1",
            source: "51job-manual",
            content: {
                name: "赵先生",
                jobIntention: "销售工程师",
                location: "东莞",
                selfIntro: "should stay out of the debug page payload",
            },
            ingestData: {
                evidenceText: "omit me",
                industryTags: ["sales"],
                synonymHits: ["sales engineer"],
                brandHits: [
                    {
                        brand: "fanuc",
                        role: "equipment",
                        source: "workHistory",
                        context: "technical",
                        companyId: 1,
                    },
                ],
                companyHits: ["fanuc"],
                ruleScores: {
                    jdA: 87,
                    jdB: 42,
                },
                experienceLevel: "mid",
                computedAt: 1_700_000_000_000,
                skillsVersion: 3,
                taggingEnvelope: {
                    schemaVersion: 1,
                    generatedAt: 1_700_000_000_000,
                    entries: Array.from({ length: 10 }, (_, index) => ({
                        tag: `tag-${index}`,
                        source: "ingest",
                        confidence: 90 - index,
                        version: 1,
                        provenance: {
                            stage: "ingest",
                            generatedBy: "test",
                            evidence: [`line-${index}`],
                        },
                    })),
                },
            },
        });

        expect(row).toEqual({
            resumeId: "resume-1",
            externalId: "ext-1",
            source: "51job-manual",
            sourceKey: "51job-manual",
            name: "赵先生",
            jobIntention: "销售工程师",
            location: "东莞",
            ingestData: {
                industryTags: ["sales"],
                companyHits: ["fanuc"],
                brandHits: [
                    {
                        brand: "fanuc",
                        role: "equipment",
                        source: "workHistory",
                        context: "technical",
                    },
                ],
                experienceLevel: "mid",
                ruleScoreCount: 2,
                computedAt: 1_700_000_000_000,
                skillsVersion: 3,
                taggingEntries: Array.from({ length: 8 }, (_, index) => ({
                    tag: `tag-${index}`,
                    source: "ingest",
                    confidence: 90 - index,
                    provenance: {
                        stage: "ingest",
                        evidence: [`line-${index}`],
                    },
                })),
            },
        });
        expect(row).not.toHaveProperty("content");
        expect(row).not.toHaveProperty("analysis");
    });

    it("derives a canonical location from raw resume fields when the explicit field is blank", () => {
        const row = projectIngestDiagnosticsRow({
            _id: "resume-2",
            externalId: "ext-2",
            source: "hr.job5156.com",
            content: {
                name: "赵先生",
                jobIntention: "销售工程师",
                location: "",
                workHistory: [
                    { raw: "2020-01~2024-01 东莞精密机械有限公司 销售工程师" },
                ],
            },
        });

        expect(row.location).toBe("广东东莞");
    });

    it("includes archive fields when isArchived is true", () => {
        const archivedAt = 1_700_000_000_000;
        const row = projectIngestDiagnosticsRow({
            _id: "resume-3",
            externalId: "ext-3",
            source: "seek",
            content: {},
            isArchived: true,
            archivedAt,
        });
        expect(row.isArchived).toBe(true);
        expect(row.archivedAt).toBe(archivedAt);
    });

    it("omits archive fields when isArchived is false", () => {
        const row = projectIngestDiagnosticsRow({
            _id: "resume-4",
            externalId: "ext-4",
            source: "seek",
            content: {},
            isArchived: false,
            archivedAt: 1_700_000_000_000,
        });
        expect(row).not.toHaveProperty("isArchived");
        expect(row).not.toHaveProperty("archivedAt");
    });
});

describe("matchesDiagnosticsSourceKeys", () => {
    it("matches grouped keys and keeps 51job-manual separate", () => {
        expect(matchesDiagnosticsSourceKeys({
            source: "51job-manual",
            content: { profileType: "51job-manual" },
        }, new Set(["51job-manual"]))).toBe(true);

        expect(matchesDiagnosticsSourceKeys({
            source: "51job-manual",
            content: { profileType: "51job-manual" },
        }, new Set(["job5156"]))).toBe(false);

        expect(matchesDiagnosticsSourceKeys({
            source: "hr.job5156.com",
            content: { profileType: "job5156" },
        }, new Set(["job5156"]))).toBe(true);
    });

    it("uses stored sourceKey when available instead of deriving from content", () => {
        expect(matchesDiagnosticsSourceKeys({
            source: "hr.job5156.com",
            content: {},
            sourceKey: "job5156",
        }, new Set(["job5156"]))).toBe(true);

        expect(matchesDiagnosticsSourceKeys({
            source: "some-host.com",
            content: {},
            sourceKey: "seek",
        }, new Set(["seek"]))).toBe(true);
    });

    it("returns true when sourceKeys is undefined", () => {
        expect(matchesDiagnosticsSourceKeys({
            source: "seek",
            content: {},
        }, undefined)).toBe(true);
    });

    it("returns true when sourceKeys is empty set", () => {
        expect(matchesDiagnosticsSourceKeys({
            source: "seek",
            content: {},
        }, new Set())).toBe(true);
    });
});

describe("resolveDiagnosticsSourceKeyForResume", () => {
    it("returns 'seek' for seek source without profileType", () => {
        expect(resolveDiagnosticsSourceKeyForResume({
            source: "seek",
            content: {},
        })).toBe("seek");
    });

    it("handles null content gracefully", () => {
        expect(resolveDiagnosticsSourceKeyForResume({
            source: "seek",
            content: null,
        })).toBe("seek");
    });

    it("returns 'job5156' for job5156 source", () => {
        expect(resolveDiagnosticsSourceKeyForResume({
            source: "job5156",
            content: {},
        })).toBe("job5156");
    });
});

describe("buildDiagnosticsSourceFacetRows", () => {
    it("groups rows by diagnostics source key and sorts by count desc then key", () => {
        const rows = buildDiagnosticsSourceFacetRows([
            { source: "51job-manual", content: { profileType: "51job-manual" } },
            { source: "hr.job5156.com", content: { profileType: "job5156" } },
            { source: "hr.job5156.com", content: { profileType: "job5156" } },
            { source: "my.employer.seek.com", content: { profileType: "seek" } },
            { source: "unknown-host.local", content: {} },
        ]);

        expect(rows).toEqual([
            { key: "job5156", label: "Job5156", count: 2 },
            { key: "51job-manual", label: "51job manual", count: 1 },
            { key: "seek", label: "SEEK", count: 1 },
            { key: "unknown", label: "Unknown", count: 1 },
        ]);
    });

    it("builds facet rows from existing Map", () => {
        const counts = new Map<string, number>([
            ["seek", 5],
            ["51job", 3],
        ]);
        const rows = buildDiagnosticsSourceFacetRows(counts);
        expect(rows).toEqual([
            { key: "seek", label: "SEEK", count: 5 },
            { key: "51job", label: "51job", count: 3 },
        ]);
    });
});
