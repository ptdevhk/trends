import { describe, expect, it } from "vitest";

import {
    ingestDataValidator,
    collectionTaskResultsValidator,
    analysisResultValidator,
    resumeAnalysisValidator,
    resumeFiltersValidator,
    matchingRulesValidator,
} from "../validators.js";

// ---------------------------------------------------------------------------
// Structural tests: verify validators exist and have correct kind
// Convex validators expose .kind, .isOptional, .fields (for objects),
// .members (for unions).
// ---------------------------------------------------------------------------

describe("validators", () => {
    describe("ingestDataValidator", () => {
        it("is defined and not null", () => {
            expect(ingestDataValidator).toBeDefined();
            expect(ingestDataValidator).not.toBeNull();
        });

        it("is a Convex VType with expected shape", () => {
            expect(typeof ingestDataValidator).toBe("object");
        });

        it("is an object validator", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            expect(ingestDataValidator.kind).toBe("object");
        });

        it("has expected required fields", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            const fields = Object.keys(ingestDataValidator.fields);
            expect(fields).toContain("industryTags");
            expect(fields).toContain("synonymHits");
            expect(fields).toContain("ruleScores");
            expect(fields).toContain("experienceLevel");
            expect(fields).toContain("computedAt");
            expect(fields).toContain("skillsVersion");
        });
    });

    describe("collectionTaskResultsValidator", () => {
        it("is defined and not null", () => {
            expect(collectionTaskResultsValidator).toBeDefined();
            expect(collectionTaskResultsValidator).not.toBeNull();
        });

        it("is a Convex VType with expected shape", () => {
            expect(typeof collectionTaskResultsValidator).toBe("object");
        });

        it("is an object validator", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            expect(collectionTaskResultsValidator.kind).toBe("object");
        });

        it("has expected required fields", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            const fields = Object.keys(collectionTaskResultsValidator.fields);
            expect(fields).toContain("extracted");
            expect(fields).toContain("submitted");
            expect(fields).toContain("deduped");
            expect(fields).toContain("inserted");
            expect(fields).toContain("updated");
            expect(fields).toContain("unchanged");
        });
    });

    describe("analysisResultValidator", () => {
        it("is defined", () => {
            expect(analysisResultValidator).toBeDefined();
        });

        it("is an object validator", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            expect(analysisResultValidator.kind).toBe("object");
        });

        it("has score as required field", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            const fields = Object.keys(analysisResultValidator.fields);
            expect(fields).toContain("score");
        });
    });

    describe("resumeAnalysisValidator", () => {
        it("is defined", () => {
            expect(resumeAnalysisValidator).toBeDefined();
        });

        it("is an object validator", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            expect(resumeAnalysisValidator.kind).toBe("object");
        });

        it("has summary and highlights as required fields", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            const fields = Object.keys(resumeAnalysisValidator.fields);
            expect(fields).toContain("score");
            expect(fields).toContain("summary");
            expect(fields).toContain("highlights");
            expect(fields).toContain("recommendation");
        });
    });

    describe("resumeFiltersValidator", () => {
        it("is defined", () => {
            expect(resumeFiltersValidator).toBeDefined();
        });

        it("is an object validator (v.optional wraps object, still kind=object)", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            expect(resumeFiltersValidator.kind).toBe("object");
        });

        it("is marked as optional", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            expect(resumeFiltersValidator.isOptional).toBe("optional");
        });
    });

    describe("matchingRulesValidator", () => {
        it("is defined", () => {
            expect(matchingRulesValidator).toBeDefined();
        });

        it("is a union validator", () => {
            // v.optional(v.union(...)) flattens to kind=union
            // @ts-ignore -- accessing internal Convex validator properties for testing
            expect(matchingRulesValidator.kind).toBe("union");
        });

        it("has members (string + record + array wrapped by optional)", () => {
            // @ts-ignore -- accessing internal Convex validator properties for testing
            expect(matchingRulesValidator.members.length).toBeGreaterThanOrEqual(2);
        });
    });
});
