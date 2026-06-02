import { describe, expect, it } from "vitest";

import { buildAnalysisDispatchIdempotencyKey } from "../convex/analysis_tasks";

describe("buildAnalysisDispatchIdempotencyKey", () => {
    it("is stable for repeated dispatches with reordered resume IDs", () => {
        const keyA = buildAnalysisDispatchIdempotencyKey({
            derivedJobDescriptionId: "jd-lathe-sales",
            keywords: ["CNC", "Sales"],
            resumeIds: ["resume:3", "resume:1", "resume:2"],
        });
        const keyB = buildAnalysisDispatchIdempotencyKey({
            derivedJobDescriptionId: "jd-lathe-sales",
            keywords: ["sales", "cnc"],
            resumeIds: ["resume:2", "resume:1", "resume:3"],
        });

        expect(keyA).toBe(keyB);
    });

    it("changes when the candidate set changes", () => {
        const base = buildAnalysisDispatchIdempotencyKey({
            derivedJobDescriptionId: "jd-lathe-sales",
            keywords: ["cnc"],
            resumeIds: ["resume:1", "resume:2"],
        });
        const changed = buildAnalysisDispatchIdempotencyKey({
            derivedJobDescriptionId: "jd-lathe-sales",
            keywords: ["cnc"],
            resumeIds: ["resume:1", "resume:3"],
        });

        expect(base).not.toBe(changed);
    });

    it("changes for different job scopes with the same resumes", () => {
        const keywordJob = buildAnalysisDispatchIdempotencyKey({
            keywords: ["cnc", "sales"],
            resumeIds: ["resume:1"],
        });
        const explicitJob = buildAnalysisDispatchIdempotencyKey({
            derivedJobDescriptionId: "jd-sales-engineer",
            keywords: ["cnc", "sales"],
            resumeIds: ["resume:1"],
        });

        expect(keywordJob).not.toBe(explicitJob);
    });

    it("changes when location or prompt version changes", () => {
        const base = buildAnalysisDispatchIdempotencyKey({
            keywords: ["cnc", "sales"],
            location: "广东",
            promptVersion: 2,
            resumeIds: ["resume:1"],
        });
        const differentLocation = buildAnalysisDispatchIdempotencyKey({
            keywords: ["cnc", "sales"],
            location: "江苏",
            promptVersion: 2,
            resumeIds: ["resume:1"],
        });
        const differentVersion = buildAnalysisDispatchIdempotencyKey({
            keywords: ["cnc", "sales"],
            location: "广东",
            promptVersion: 3,
            resumeIds: ["resume:1"],
        });

        expect(base).not.toBe(differentLocation);
        expect(base).not.toBe(differentVersion);
    });

    it("changes when related experience context is added or changed", () => {
        const base = buildAnalysisDispatchIdempotencyKey({
            keywords: ["cnc", "sales"],
            resumeIds: ["resume:1"],
        });
        const salesContext = buildAnalysisDispatchIdempotencyKey({
            keywords: ["cnc", "sales"],
            relatedExpContext: {
                roleFilterType: "sales",
                minRoleYears: 1,
                market: "CN",
            },
            resumeIds: ["resume:1"],
        });
        const technicalContext = buildAnalysisDispatchIdempotencyKey({
            keywords: ["cnc", "sales"],
            relatedExpContext: {
                roleFilterType: "technical",
                minRoleYears: 1,
                market: "CN",
            },
            resumeIds: ["resume:1"],
        });

        expect(base).not.toBe(salesContext);
        expect(salesContext).not.toBe(technicalContext);
    });

    it("normalizes related experience context formatting in keys", () => {
        const keyA = buildAnalysisDispatchIdempotencyKey({
            keywords: ["cnc", "sales"],
            relatedExpContext: {
                roleFilterType: " Sales ",
                minRoleYears: 1,
                market: "cn",
            },
            resumeIds: ["resume:1"],
        });
        const keyB = buildAnalysisDispatchIdempotencyKey({
            keywords: ["cnc", "sales"],
            relatedExpContext: {
                roleFilterType: "sales",
                minRoleYears: 1,
                market: "CN",
            },
            resumeIds: ["resume:1"],
        });

        expect(keyA).toBe(keyB);
    });
});
