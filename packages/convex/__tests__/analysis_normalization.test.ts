/**
 * Unit tests for lib/analysis_normalization.ts
 *
 * Covers all exported pure functions with edge cases.
 */
import { describe, expect, it } from "vitest";
import {
    clamp,
    computeDirectIndustryDbScoreFromResume,
    getResumeIngestData,
    hasCompanyHits,
    hasHanText,
    hasNonEmployerBrandHits,
    normalizeAnalysisResult,
    normalizeSummaryConsistency,
    parseKeyFactors,
    parseNumericBreakdown,
    parseRoleSignals,
    recommendationFromScore,
    toNumber,
    INDUSTRY_DB_SCORE_CAP,
    RELATED_EXP_WEIGHT,
} from "../convex/lib/analysis_normalization.js";

// ---------------------------------------------------------------------------
// toNumber
// ---------------------------------------------------------------------------
describe("toNumber", () => {
    it("returns finite numbers unchanged", () => {
        expect(toNumber(42)).toBe(42);
        expect(toNumber(0)).toBe(0);
        expect(toNumber(-3.5)).toBe(-3.5);
    });

    it("parses numeric strings", () => {
        expect(toNumber("7")).toBe(7);
        expect(toNumber("3.14")).toBe(3.14);
    });

    it("returns undefined for non-finite numbers", () => {
        expect(toNumber(Infinity)).toBeUndefined();
        expect(toNumber(NaN)).toBeUndefined();
        expect(toNumber(-Infinity)).toBeUndefined();
    });

    it("returns undefined for non-numeric strings", () => {
        expect(toNumber("abc")).toBeUndefined();
    });

    it("parses empty string as 0", () => {
        expect(toNumber("")).toBe(0);
    });

    it("returns undefined for non-number/non-string types", () => {
        expect(toNumber(true)).toBeUndefined();
        expect(toNumber(null)).toBeUndefined();
        expect(toNumber(undefined)).toBeUndefined();
        expect(toNumber({})).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------
describe("clamp", () => {
    it("clamps to min", () => {
        expect(clamp(-5, 0, 100)).toBe(0);
    });

    it("clamps to max", () => {
        expect(clamp(200, 0, 100)).toBe(100);
    });

    it("returns value within range unchanged", () => {
        expect(clamp(50, 0, 100)).toBe(50);
    });
});

// ---------------------------------------------------------------------------
// recommendationFromScore
// ---------------------------------------------------------------------------
describe("recommendationFromScore", () => {
    it("returns strong_match for score >= 85", () => {
        expect(recommendationFromScore(85)).toBe("strong_match");
        expect(recommendationFromScore(100)).toBe("strong_match");
    });

    it("returns match for score 70-84", () => {
        expect(recommendationFromScore(70)).toBe("match");
        expect(recommendationFromScore(84)).toBe("match");
    });

    it("returns potential for score 40-69", () => {
        expect(recommendationFromScore(40)).toBe("potential");
        expect(recommendationFromScore(69)).toBe("potential");
    });

    it("returns no_match for score < 40", () => {
        expect(recommendationFromScore(39)).toBe("no_match");
        expect(recommendationFromScore(0)).toBe("no_match");
    });
});

// ---------------------------------------------------------------------------
// hasHanText
// ---------------------------------------------------------------------------
describe("hasHanText", () => {
    it("detects Chinese characters", () => {
        expect(hasHanText("候选人")).toBe(true);
    });

    it("returns false for ASCII-only text", () => {
        expect(hasHanText("Hello World")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// parseKeyFactors
// ---------------------------------------------------------------------------
describe("parseKeyFactors", () => {
    it("parses valid key factors", () => {
        const result = parseKeyFactors([
            { factor: "experience", weight: 0.6, value: "7 years" },
            { factor: "education", value: "BS" },
        ]);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ factor: "experience", weight: 0.6, value: "7 years" });
        expect(result[1]).toEqual({ factor: "education", weight: undefined, value: "BS" });
    });

    it("filters out unknown factors with empty values", () => {
        const result = parseKeyFactors([{ factor: "unknown" }]);
        expect(result).toHaveLength(0);
    });

    it("keeps unknown factors with non-empty values", () => {
        const result = parseKeyFactors([{ factor: "unknown", value: "some detail" }]);
        expect(result).toHaveLength(1);
    });

    it("returns empty for non-array input", () => {
        expect(parseKeyFactors(null)).toEqual([]);
        expect(parseKeyFactors(undefined)).toEqual([]);
        expect(parseKeyFactors("string")).toEqual([]);
    });

    it("skips non-record items", () => {
        expect(parseKeyFactors([42, "str"])).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// parseNumericBreakdown
// ---------------------------------------------------------------------------
describe("parseNumericBreakdown", () => {
    it("parses numeric values from record", () => {
        expect(parseNumericBreakdown({ related_exp: 60, industry_db: 30 }))
            .toEqual({ related_exp: 60, industry_db: 30 });
    });

    it("skips non-numeric values", () => {
        expect(parseNumericBreakdown({ a: "bad", b: 10 })).toEqual({ b: 10 });
    });

    it("returns undefined for non-record input", () => {
        expect(parseNumericBreakdown(null)).toBeUndefined();
        expect(parseNumericBreakdown([])).toBeUndefined();
    });

    it("returns undefined when all values are non-numeric", () => {
        expect(parseNumericBreakdown({ a: "bad" })).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// parseRoleSignals
// ---------------------------------------------------------------------------
describe("parseRoleSignals", () => {
    it("parses valid role signals", () => {
        const result = parseRoleSignals([
            { type: "CNC", years: 5, verifyIn: "workHistory", matchedSignals: ["CNC milling"] },
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("CNC");
        expect(result[0].years).toBe(5);
        expect(result[0].verifyIn).toBe("workHistory");
        expect(result[0].matchedSignals).toEqual(["CNC milling"]);
    });

    it("defaults verifyIn to workHistory", () => {
        const result = parseRoleSignals([{ type: "Python", years: 3 }]);
        expect(result[0].verifyIn).toBe("workHistory");
    });

    it("accepts verifyIn searchText", () => {
        const result = parseRoleSignals([{ type: "Python", years: 3, verifyIn: "searchText" }]);
        expect(result[0].verifyIn).toBe("searchText");
    });

    it("skips items without type or years", () => {
        expect(parseRoleSignals([{ type: "", years: 3 }])).toHaveLength(0);
        expect(parseRoleSignals([{ type: "X" }])).toHaveLength(0);
    });

    it("parses matchedWorkEntries", () => {
        const result = parseRoleSignals([{
            type: "CNC",
            years: 5,
            matchedWorkEntries: [{
                companyName: "Acme",
                jobTitle: "Operator",
                years: 3,
                industryVerified: true,
                matchedSignals: ["CNC"],
                directRoleMatch: true,
            }],
        }]);
        expect(result[0].matchedWorkEntries).toHaveLength(1);
        expect(result[0].matchedWorkEntries![0].companyName).toBe("Acme");
        expect(result[0].matchedWorkEntries![0].directRoleMatch).toBe(true);
    });

    it("skips work entries without years", () => {
        const result = parseRoleSignals([{
            type: "CNC",
            years: 5,
            matchedWorkEntries: [{ companyName: "Acme" }],
        }]);
        expect(result[0].matchedWorkEntries).toBeUndefined();
    });

    it("returns empty for non-array input", () => {
        expect(parseRoleSignals(null)).toEqual([]);
        expect(parseRoleSignals("str")).toEqual([]);
    });

    it("computes signalCount and occurrences from matchedSignals when not provided", () => {
        const result = parseRoleSignals([{
            type: "CNC",
            years: 5,
            matchedSignals: ["a", "b"],
        }]);
        expect(result[0].signalCount).toBe(2);
        expect(result[0].occurrences).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// hasNonEmployerBrandHits
// ---------------------------------------------------------------------------
describe("hasNonEmployerBrandHits", () => {
    it("returns true for non-employer context", () => {
        expect(hasNonEmployerBrandHits([{ context: "client" }])).toBe(true);
    });

    it("returns false for employer-only context", () => {
        expect(hasNonEmployerBrandHits([{ context: "employer" }])).toBe(false);
    });

    it("returns true for mixed contexts", () => {
        expect(hasNonEmployerBrandHits([{ context: "employer" }, { context: "client" }])).toBe(true);
    });

    it("returns false for non-array input", () => {
        expect(hasNonEmployerBrandHits(null)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// hasCompanyHits
// ---------------------------------------------------------------------------
describe("hasCompanyHits", () => {
    it("returns true for non-empty string entries", () => {
        expect(hasCompanyHits(["Acme Corp"])).toBe(true);
    });

    it("returns false for empty strings", () => {
        expect(hasCompanyHits(["  "])).toBe(false);
    });

    it("returns false for non-array input", () => {
        expect(hasCompanyHits(null)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// getResumeIngestData
// ---------------------------------------------------------------------------
describe("getResumeIngestData", () => {
    it("reads ingestData from root level", () => {
        const result = getResumeIngestData({ ingestData: { brandHits: [] } });
        expect(result).toEqual({ brandHits: [] });
    });

    it("reads ingestData from content level", () => {
        const result = getResumeIngestData({ content: { ingestData: { companyHits: ["X"] } } });
        expect(result).toEqual({ companyHits: ["X"] });
    });

    it("prefers root-level ingestData", () => {
        const result = getResumeIngestData({
            ingestData: { source: "root" },
            content: { ingestData: { source: "content" } },
        });
        expect(result).toEqual({ source: "root" });
    });

    it("returns empty for non-record input", () => {
        expect(getResumeIngestData(null)).toEqual({});
        expect(getResumeIngestData(42)).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// computeDirectIndustryDbScoreFromResume
// ---------------------------------------------------------------------------
describe("computeDirectIndustryDbScoreFromResume", () => {
    it("returns 30 when brand hits exist (additive weight, not flat cap)", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }] },
        })).toBe(30);
    });

    it("returns 20 when company hits exist (additive weight, not flat cap)", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { companyHits: ["Acme"] },
        })).toBe(20);
    });

    it("returns clamped industryDbV2Raw", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { industryDbV2Raw: 30 },
        })).toBe(30);
    });

    it("clamps industryDbV2Raw to cap", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { industryDbV2Raw: 80 },
        })).toBe(INDUSTRY_DB_SCORE_CAP);
    });

    it("returns 0 when no data", () => {
        expect(computeDirectIndustryDbScoreFromResume({})).toBe(0);
    });

    // Phase 1: additive weight model — brand-only = 30, company-only = 20, both = 50
    it("brand hit only → exactly 30 (additive weight)", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }], companyHits: [], industryDbV2Raw: 0 },
        })).toBe(30);
    });

    it("company hit only → exactly 20 (additive weight)", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { companyHits: ["Acme"], brandHits: [], industryDbV2Raw: 0 },
        })).toBe(20);
    });

    it("both brand and company hits → exactly 50 (full cap)", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }], companyHits: ["Acme"], industryDbV2Raw: 0 },
        })).toBe(50);
    });

    it("high raw industryDbV2Raw wins over additive when raw > additive total", () => {
        // brand-only additive = 30, but raw = 45 > 30; raw wins, clamped to cap
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }], companyHits: [], industryDbV2Raw: 45 },
        })).toBe(45);
    });

    it("low raw is superseded by additive total (Math.max semantics)", () => {
        // raw = 10, additive (brand+company) = 50; additive wins
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }], companyHits: ["Acme"], industryDbV2Raw: 10 },
        })).toBe(50);
    });
});

// ---------------------------------------------------------------------------
// normalizeSummaryConsistency
// ---------------------------------------------------------------------------
describe("normalizeSummaryConsistency", () => {
    it("leaves consistent summary unchanged", () => {
        const result = normalizeSummaryConsistency("Score: 85, strong_match", {
            score: 85,
            recommendation: "strong_match",
        });
        expect(result).toBe("Score: 85, strong_match");
    });

    it("fixes score mismatch", () => {
        const result = normalizeSummaryConsistency("Score: 70", {
            score: 85,
            recommendation: "strong_match",
        });
        expect(result).toContain("85");
        expect(result).toContain("Normalized result");
    });

    it("fixes recommendation mismatch", () => {
        const result = normalizeSummaryConsistency("Result: match", {
            score: 85,
            recommendation: "strong_match",
        });
        expect(result).toContain("strong_match");
    });

    it("handles empty summary", () => {
        expect(normalizeSummaryConsistency("", { score: 50, recommendation: "potential" })).toBe("");
    });

    it("uses Chinese normalization line for Han text", () => {
        const result = normalizeSummaryConsistency("分数: 70, match", {
            score: 85,
            recommendation: "strong_match",
        });
        expect(result).toContain("系统归一化结果");
    });
});

// ---------------------------------------------------------------------------
// normalizeAnalysisResult
// ---------------------------------------------------------------------------
describe("normalizeAnalysisResult", () => {
    it("computes score from the related_exp factor alone (industry_db excluded from score)", () => {
        const result = normalizeAnalysisResult(
            { score: 80, summary: "Test", recommendation: "match", breakdown: { related_exp: 60 } },
            { ingestData: { industryDbV2Raw: 30 } },
        );
        // score = cappedRelatedExp (match ceiling 100); industry_db is NOT added.
        expect(result.score).toBe(60);
        expect(result.breakdown.related_exp).toBe(60);
        // industry_db remains in the breakdown for display only.
        expect(result.breakdown.industry_db).toBe(30);
    });

    it("falls back to related_exp=0 when breakdown is missing", () => {
        const result = normalizeAnalysisResult(
            { score: 80, summary: "Test" },
            {},
        );
        expect(result.score).toBe(0);
        expect(result.breakdown.related_exp).toBe(0);
    });

    it("clamps related_exp to 0-100", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 200 } },
            {},
        );
        // related_exp clamped to 100, match ceiling 100 → score = 100
        expect(result.score).toBe(100);
        expect(result.breakdown.related_exp).toBe(100);
    });

    it("derives recommendation from score", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 100 } },
            { ingestData: { industryDbV2Raw: 35 } },
        );
        // score = cappedRelatedExp = 100 → strong_match (industry_db excluded from score)
        expect(result.score).toBe(100);
        expect(result.recommendation).toBe("strong_match");
    });

    it("uses default summary when empty", () => {
        const result = normalizeAnalysisResult(
            { summary: "" },
            {},
        );
        expect(result.summary).toBe("No summary provided.");
    });

    it("filters highlights and concerns to strings", () => {
        const result = normalizeAnalysisResult(
            { highlights: ["a", 42], concerns: ["b", null] },
            {},
        );
        expect(result.highlights).toEqual(["a"]);
        expect(result.concerns).toEqual(["b"]);
    });

    it("parses keyFactors", () => {
        const result = normalizeAnalysisResult(
            { keyFactors: [{ factor: "exp", weight: 0.5, value: "10yr" }] },
            {},
        );
        expect(result.keyFactors).toHaveLength(1);
        expect(result.keyFactors[0].factor).toBe("exp");
    });

    describe("recommendation ceiling — fail-closed defaults", () => {
        it("unknown recommendation string clamps related_exp to no_match ceiling (30)", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "weak_potential", breakdown: { related_exp: 100 } },
                {},
            );
            // related_exp clamped to 30 (no_match ceiling); score = 30 (industry_db excluded)
            expect(result.score).toBe(30);
        });

        it("null recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { recommendation: null as unknown as string, breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBe(30);
        });

        it("undefined recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBe(30);
        });

        it("empty-string recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "", breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBe(30);
        });

        it("numeric recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { recommendation: 42 as unknown as string, breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBe(30);
        });

        it("valid recommendation values use their ceiling, not the fallback", () => {
            const cases: Array<[string, number]> = [
                ["strong_match", 100],
                ["match", 100],
                ["potential", 60],
                ["no_match", 30],
            ];
            for (const [rec, ceiling] of cases) {
                const result = normalizeAnalysisResult(
                    { recommendation: rec, breakdown: { related_exp: 100 } },
                    {},
                );
                // score = cappedRelatedExp = min(100, ceiling) = ceiling (industry_db excluded)
                expect(result.score).toBe(ceiling);
            }
        });
    });

    // Phase 2: no_match gate — LLM no_match must not be overridden by industryDb
    describe("no_match gate — LLM rejection is preserved", () => {
        it("LLM no_match + high industryDb still produces score ≤ 39 and no_match recommendation", () => {
            // Simulate: brand+company hit → industryDb=50, LLM no_match related_exp=20
            const result = normalizeAnalysisResult(
                { recommendation: "no_match", breakdown: { related_exp: 20 } },
                { ingestData: { brandHits: [{ context: "client" }], companyHits: ["Acme"], industryDbV2Raw: 0 } },
            );
            expect(result.score).toBeLessThanOrEqual(39);
            expect(result.recommendation).toBe("no_match");
        });

        it("LLM no_match with related_exp=0 and max industryDb produces score ≤ 39", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "no_match", breakdown: { related_exp: 0 } },
                { ingestData: { brandHits: [{ context: "client" }], companyHits: ["Acme"], industryDbV2Raw: 0 } },
            );
            expect(result.score).toBeLessThanOrEqual(39);
            expect(result.recommendation).toBe("no_match");
        });

        it("LLM match recommendation is not affected by the no_match gate", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "match", breakdown: { related_exp: 60 } },
                { ingestData: { industryDbV2Raw: 20 } },
            );
            expect(result.score).toBeGreaterThanOrEqual(40);
            expect(result.recommendation).not.toBe("no_match");
        });

        it("LLM strong_match is not affected by the no_match gate", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "strong_match", breakdown: { related_exp: 90 } },
                { ingestData: { industryDbV2Raw: 20 } },
            );
            expect(result.score).toBeGreaterThanOrEqual(60);
        });
    });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("constants", () => {
    it("INDUSTRY_DB_SCORE_CAP is 50", () => {
        expect(INDUSTRY_DB_SCORE_CAP).toBe(50);
    });

    it("RELATED_EXP_WEIGHT is cap/100", () => {
        expect(RELATED_EXP_WEIGHT).toBe(INDUSTRY_DB_SCORE_CAP / 100);
    });
});
