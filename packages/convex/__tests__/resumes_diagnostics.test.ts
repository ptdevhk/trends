/**
 * Unit tests for lib/resumes_diagnostics.ts
 */
import { describe, expect, it } from "vitest";
import {
    resolveDiagnosticsSourceKeyForResume,
    normalizeDiagnosticsSourceFilterValues,
    matchesDiagnosticsSourceKeys,
    buildDiagnosticsSourceFacetRows,
    projectIngestDiagnosticsRow,
    MAX_INGEST_DIAGNOSTICS_PAGE_SIZE,
    MAX_INGEST_DIAGNOSTICS_TAGGING_ENTRIES,
    DIAGNOSTICS_SOURCE_FILTER_BATCH_MULTIPLIER,
} from "../convex/lib/resumes_diagnostics.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("constants", () => {
    it("has expected values", () => {
        expect(MAX_INGEST_DIAGNOSTICS_PAGE_SIZE).toBe(100);
        expect(MAX_INGEST_DIAGNOSTICS_TAGGING_ENTRIES).toBe(8);
        expect(DIAGNOSTICS_SOURCE_FILTER_BATCH_MULTIPLIER).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// resolveDiagnosticsSourceKeyForResume
// ---------------------------------------------------------------------------
describe("resolveDiagnosticsSourceKeyForResume", () => {
    it("uses content.profileType when available", () => {
        const result = resolveDiagnosticsSourceKeyForResume({
            source: "51job",
            content: { profileType: "seek" },
        });
        expect(result).toBe("seek");
    });

    it("falls back to source when no profileType", () => {
        const result = resolveDiagnosticsSourceKeyForResume({
            source: "51job",
            content: {},
        });
        expect(result).toBe("51job");
    });

    it("handles non-record content", () => {
        const result = resolveDiagnosticsSourceKeyForResume({
            source: "51job",
            content: null,
        });
        expect(result).toBe("51job");
    });
});

// ---------------------------------------------------------------------------
// normalizeDiagnosticsSourceFilterValues
// ---------------------------------------------------------------------------
describe("normalizeDiagnosticsSourceFilterValues", () => {
    it("returns undefined for non-array input", () => {
        expect(normalizeDiagnosticsSourceFilterValues(undefined)).toBeUndefined();
        expect(normalizeDiagnosticsSourceFilterValues(null as any)).toBeUndefined();
    });

    it("normalizes and deduplicates values", () => {
        const result = normalizeDiagnosticsSourceFilterValues(["51job", " 51job ", "seek"]);
        expect(result).toBeDefined();
        expect(new Set(result).size).toBe(result!.length);
    });

    it("returns undefined for all-empty values", () => {
        expect(normalizeDiagnosticsSourceFilterValues(["", "  "])).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// matchesDiagnosticsSourceKeys
// ---------------------------------------------------------------------------
describe("matchesDiagnosticsSourceKeys", () => {
    it("returns true when no sourceKeys filter", () => {
        expect(matchesDiagnosticsSourceKeys(
            { source: "51job", content: {} },
            undefined
        )).toBe(true);
        expect(matchesDiagnosticsSourceKeys(
            { source: "51job", content: {} },
            new Set()
        )).toBe(true);
    });

    it("returns true when sourceKey matches", () => {
        expect(matchesDiagnosticsSourceKeys(
            { source: "51job", content: {}, sourceKey: "51job" },
            new Set(["51job", "seek"])
        )).toBe(true);
    });

    it("returns false when sourceKey does not match", () => {
        expect(matchesDiagnosticsSourceKeys(
            { source: "51job", content: {}, sourceKey: "51job" },
            new Set(["seek"])
        )).toBe(false);
    });

    it("derives sourceKey when not present on resume", () => {
        expect(matchesDiagnosticsSourceKeys(
            { source: "51job", content: {} },
            new Set(["51job"])
        )).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// buildDiagnosticsSourceFacetRows
// ---------------------------------------------------------------------------
describe("buildDiagnosticsSourceFacetRows", () => {
    it("builds facets from resume array", () => {
        const resumes = [
            { source: "51job", content: {} },
            { source: "51job", content: {} },
            { source: "seek", content: {} },
        ];
        const facets = buildDiagnosticsSourceFacetRows(resumes);
        expect(facets).toHaveLength(2);
        expect(facets[0].count).toBe(2); // 51job has 2, sorted first
    });

    it("builds facets from Map", () => {
        const counts = new Map([["51job", 5], ["seek", 3]]);
        const facets = buildDiagnosticsSourceFacetRows(counts);
        expect(facets).toHaveLength(2);
        expect(facets[0].key).toBe("51job");
        expect(facets[0].count).toBe(5);
    });

    it("sorts by count descending then key ascending", () => {
        const counts = new Map([["b-source", 3], ["a-source", 3]]);
        const facets = buildDiagnosticsSourceFacetRows(counts);
        expect(facets[0].key).toBe("a-source");
        expect(facets[1].key).toBe("b-source");
    });

    it("provides human-readable labels", () => {
        const counts = new Map([["job5156", 1], ["seek", 1]]);
        const facets = buildDiagnosticsSourceFacetRows(counts);
        const job5156 = facets.find((f) => f.key === "job5156");
        const seek = facets.find((f) => f.key === "seek");
        expect(job5156?.label).toBe("Job5156");
        expect(seek?.label).toBe("SEEK");
    });
});

// ---------------------------------------------------------------------------
// projectIngestDiagnosticsRow
// ---------------------------------------------------------------------------
describe("projectIngestDiagnosticsRow", () => {
    it("projects a resume without ingestData", () => {
        const row = projectIngestDiagnosticsRow({
            _id: "r1",
            externalId: "ext1",
            source: "51job",
            content: { name: "Test User", location: "Shanghai" },
        });
        expect(row.resumeId).toBe("r1");
        expect(row.name).toBe("Test User");
        expect(row.ingestData).toBeUndefined();
    });

    it("projects a resume with ingestData", () => {
        const row = projectIngestDiagnosticsRow({
            _id: "r2",
            externalId: "ext2",
            source: "seek",
            content: {},
            ingestData: {
                industryTags: ["CNC"],
                companyHits: ["Acme"],
                brandHits: [],
                synonymHits: [],
                ruleScores: {},
                experienceLevel: "senior",
                computedAt: Date.now(),
                skillsVersion: 2,
                taggingEnvelope: {
                    entries: [
                        { tag: "CNC", source: "rule", confidence: 0.9, version: 1, provenance: { stage: "rule", generatedBy: "rule-engine", evidence: ["keyword"] } },
                    ],
                    schemaVersion: 1,
                    generatedAt: Date.now(),
                },
            },
        });
        expect(row.ingestData).toBeDefined();
        expect(row.ingestData!.industryTags).toEqual(["CNC"]);
        expect(row.ingestData!.companyHits).toEqual(["Acme"]);
        expect(row.ingestData!.taggingEntries).toHaveLength(1);
    });

    it("includes archive fields when archived", () => {
        const row = projectIngestDiagnosticsRow({
            _id: "r3",
            externalId: "ext3",
            source: "51job",
            content: {},
            isArchived: true,
            archivedAt: 1700000000000,
        });
        expect(row.isArchived).toBe(true);
        expect(row.archivedAt).toBe(1700000000000);
    });

    it("omits archive fields when not archived", () => {
        const row = projectIngestDiagnosticsRow({
            _id: "r4",
            externalId: "ext4",
            source: "51job",
            content: {},
        });
        expect(row.isArchived).toBeUndefined();
    });

    it("limits tagging entries to MAX_INGEST_DIAGNOSTICS_TAGGING_ENTRIES", () => {
        const manyEntries = Array.from({ length: 15 }, (_, i) => ({
            tag: `tag-${i}`,
            source: "rule",
            confidence: 0.8,
            version: 1,
            provenance: { stage: "rule", generatedBy: "rule-engine", evidence: [] },
        }));
        const row = projectIngestDiagnosticsRow({
            _id: "r5",
            externalId: "ext5",
            source: "51job",
            content: {},
            ingestData: {
                industryTags: [],
                companyHits: [],
                brandHits: [],
                synonymHits: [],
                ruleScores: {},
                experienceLevel: "mid",
                computedAt: Date.now(),
                skillsVersion: 1,
                taggingEnvelope: { entries: manyEntries, schemaVersion: 1, generatedAt: Date.now() },
            },
        });
        expect(row.ingestData!.taggingEntries.length).toBeLessThanOrEqual(MAX_INGEST_DIAGNOSTICS_TAGGING_ENTRIES);
    });
});
