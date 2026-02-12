import { describe, expect, it } from "vitest";

import { buildAnalysisDispatchIdempotencyKey } from "../analysis_tasks";

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
});
