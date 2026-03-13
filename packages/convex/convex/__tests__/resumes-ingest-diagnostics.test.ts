import { describe, expect, it } from "vitest";

import { projectIngestDiagnosticsRow, resolveListWithIngestWindow } from "../resumes";

describe("resolveListWithIngestWindow", () => {
    it("uses the default list window when no limit is provided", () => {
        expect(resolveListWithIngestWindow(undefined)).toEqual({
            limit: 50,
            overfetchLimit: 150,
        });
    });

    it("clamps oversized requests to the safe ingest list window", () => {
        expect(resolveListWithIngestWindow(5_000)).toEqual({
            limit: 200,
            overfetchLimit: 400,
        });
    });
});

describe("projectIngestDiagnosticsRow", () => {
    it("projects only the fields required by the ingest diagnostics page", () => {
        const row = projectIngestDiagnosticsRow({
            _id: "resume-1",
            externalId: "ext-1",
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
                    invalid: "bad",
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
});
