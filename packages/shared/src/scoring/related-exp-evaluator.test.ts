/**
 * Unit tests for evaluateRelatedExpEvidence() — P1 evidence band ceiling.
 *
 * TDD RED phase: all tests import from a module that does not yet exist.
 * These tests define the full behavioral contract of the evaluator before
 * any implementation code is written.
 */
import { describe, expect, it } from "vitest";
import {
    evaluateRelatedExpEvidence,
    type RelatedExpEvidenceInput,
    type RelatedExpEvidenceResult,
} from "./related-exp-evaluator.js";

// ---------------------------------------------------------------------------
// Coverage band mapping
// ---------------------------------------------------------------------------

describe("evaluateRelatedExpEvidence: coverage bands", () => {
    it("full coverage: directRoleMatch=true AND domainYears >= minRoleYears → evidenceBandMax=100", () => {
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
            llmRaw: 75,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: true, industryVerifiedRelevantYears: 3, matchedWorkEntries: ["cnc sales 2y"] },
        });
        expect(result.coverage).toBe("full");
        expect(result.evidenceBandMax).toBe(100);
        expect(result.missingReasons).toHaveLength(0);
    });

    it("partial coverage: directRoleMatch=false AND domainYears >= minRoleYears → evidenceBandMax=65", () => {
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
            llmRaw: 84,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 2, matchedWorkEntries: [] },
        });
        expect(result.coverage).toBe("partial");
        expect(result.evidenceBandMax).toBe(65);
        expect(result.missingReasons.length).toBeGreaterThan(0);
    });

    it("weak coverage: directRoleMatch=false AND domainYears > 0 (< minRoleYears) → evidenceBandMax=45", () => {
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales", minRoleYears: 3, market: "CN" },
            llmRaw: 80,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 1, matchedWorkEntries: [] },
        });
        expect(result.coverage).toBe("weak");
        expect(result.evidenceBandMax).toBe(45);
        expect(result.missingReasons.length).toBeGreaterThan(0);
    });

    it("no coverage: directRoleMatch=false AND domainYears=0 → evidenceBandMax=30", () => {
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
            llmRaw: 84,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0, matchedWorkEntries: [] },
        });
        expect(result.coverage).toBe("none");
        expect(result.evidenceBandMax).toBe(30);
        expect(result.missingReasons.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// effectiveRaw = min(llmRaw, recommendationMax, evidenceBandMax)
// ---------------------------------------------------------------------------

describe("evaluateRelatedExpEvidence: effectiveRaw ceiling", () => {
    it("effectiveRaw is suppressed when llmRaw > evidenceBandMax", () => {
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
            llmRaw: 84,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0 },
        });
        expect(result.effectiveRaw).toBeLessThanOrEqual(30);  // evidenceBandMax=30
        expect(result.effectiveRaw).toBeLessThanOrEqual(result.llmRaw);
    });

    it("effectiveRaw = llmRaw when llmRaw < evidenceBandMax (full coverage)", () => {
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
            llmRaw: 75,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: true, industryVerifiedRelevantYears: 3 },
        });
        expect(result.effectiveRaw).toBe(75);  // llmRaw < 100 (evidenceBandMax), no suppression
    });

    it("effectiveRaw respects recommendationMax ceiling (potential → 60)", () => {
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
            llmRaw: 80,
            llmRecommendation: "potential",
            ingestEvidence: { directRoleMatch: true, industryVerifiedRelevantYears: 3 },
        });
        // recommendationMax for potential=60; evidenceBandMax=100 (full coverage)
        // effectiveRaw = min(80, 60, 100) = 60
        expect(result.effectiveRaw).toBeLessThanOrEqual(60);
        expect(result.recommendationMax).toBe(60);
    });

    it("effectiveRaw respects recommendationMax for no_match (ceiling=30)", () => {
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
            llmRaw: 20,
            llmRecommendation: "no_match",
            ingestEvidence: { directRoleMatch: true, industryVerifiedRelevantYears: 5 },
        });
        // recommendationMax for no_match=30; effectiveRaw = min(20, 30, 100) = 20
        expect(result.effectiveRaw).toBeLessThanOrEqual(30);
        expect(result.recommendationMax).toBe(30);
    });
});

// ---------------------------------------------------------------------------
// Never-boosts contract
// ---------------------------------------------------------------------------

describe("evaluateRelatedExpEvidence: never-boosts invariant", () => {
    it("effectiveRaw is always <= llmRaw (no boosting)", () => {
        const cases: RelatedExpEvidenceInput[] = [
            {
                context: { roleFilterType: "sales", market: "CN" },
                llmRaw: 30,
                llmRecommendation: "potential",
                ingestEvidence: { directRoleMatch: true, industryVerifiedRelevantYears: 5 },
            },
            {
                context: { roleFilterType: "any" },
                llmRaw: 0,
                llmRecommendation: "no_match",
                ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0 },
            },
            {
                context: {},
                llmRaw: 100,
                llmRecommendation: "strong_match",
                ingestEvidence: { directRoleMatch: true, industryVerifiedRelevantYears: 10 },
            },
        ];
        for (const input of cases) {
            const result = evaluateRelatedExpEvidence(input);
            expect(result.effectiveRaw).toBeLessThanOrEqual(input.llmRaw);
        }
    });
});

// ---------------------------------------------------------------------------
// Output shape completeness
// ---------------------------------------------------------------------------

describe("evaluateRelatedExpEvidence: output shape", () => {
    it("returns all required fields", () => {
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
            llmRaw: 80,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0 },
        });

        expect(typeof result.evidenceBandMax).toBe("number");
        expect(["full", "partial", "weak", "none"]).toContain(result.coverage);
        expect(Array.isArray(result.missingReasons)).toBe(true);
        expect(typeof result.effectiveRaw).toBe("number");
        expect(typeof result.llmRaw).toBe("number");
        expect(typeof result.recommendationMax).toBe("number");
        expect(typeof result.contextHash).toBe("string");
        expect(typeof result.rubricVersion).toBe("string");
        expect(result.contextHash.length).toBeGreaterThan(0);
        expect(result.rubricVersion.length).toBeGreaterThan(0);
    });

    it("llmRaw is echoed back unchanged", () => {
        const result = evaluateRelatedExpEvidence({
            context: {},
            llmRaw: 77,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0 },
        });
        expect(result.llmRaw).toBe(77);
    });
});

// ---------------------------------------------------------------------------
// Missing minRoleYears defaults
// ---------------------------------------------------------------------------

describe("evaluateRelatedExpEvidence: missing context defaults", () => {
    it("missing minRoleYears treats minRoleYears as 0 (any years qualifies)", () => {
        // directRoleMatch=false, domainYears=1, minRoleYears=undefined → partial (domainYears >= 0)
        const result = evaluateRelatedExpEvidence({
            context: { roleFilterType: "sales" },
            llmRaw: 80,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 1 },
        });
        // domainYears(1) >= defaultMinRoleYears(0) → partial coverage at most
        expect(["partial"]).toContain(result.coverage);
        expect(result.evidenceBandMax).toBe(65);
    });

    it("empty context with no ingest evidence → no coverage band", () => {
        const result = evaluateRelatedExpEvidence({
            context: {},
            llmRaw: 80,
            llmRecommendation: "match",
            ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0 },
        });
        expect(result.coverage).toBe("none");
        expect(result.evidenceBandMax).toBe(30);
    });
});
