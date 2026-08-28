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
    enrichConcernsWithBrandSignals,
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
    it("returns 40 when brand hits exist", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }] },
        })).toBe(40);
    });

    it("returns 40 when company hits exist", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { companyHits: ["Acme"] },
        })).toBe(40);
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

    // Default direct-hit rule — brand-only = 40, company-only = 40, both = 50
    it("brand hit only → exactly 40", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }], companyHits: [], industryDbV2Raw: 0 },
        })).toBe(40);
    });

    it("company hit only → exactly 40", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { companyHits: ["Acme"], brandHits: [], industryDbV2Raw: 0 },
        })).toBe(40);
    });

    it("both brand and company hits → exactly 50 (full cap)", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }], companyHits: ["Acme"], industryDbV2Raw: 0 },
        })).toBe(50);
    });

    it("high raw industryDbV2Raw wins over direct-hit baseline when raw > baseline", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }], companyHits: [], industryDbV2Raw: 45 },
        })).toBe(45);
    });

    it("low raw is superseded by both-hit baseline (Math.max semantics)", () => {
        // raw = 10, both-hit = 50; baseline wins
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }], companyHits: ["Acme"], industryDbV2Raw: 10 },
        })).toBe(50);
    });

    it("keeps the direct score raw-only for MY resumes before market floor normalization", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            sourceKey: "seek",
            ingestData: { market: "MY", industryDbV2Raw: 0, brandHits: [], companyHits: [] },
        })).toBe(0);
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

    it("strips strong-match prose on low score bands (刘先生刀具 regression)", () => {
        const result = normalizeSummaryConsistency("刀具销售，较强匹配，建议重点推进", {
            score: 30,
            recommendation: "no_match",
        });
        expect(result).not.toMatch(/较强匹配/);
        expect(result).not.toMatch(/重点推进/);
        expect(result).toMatch(/匹配有限/);
    });

    it("keeps strong-match prose on high score bands", () => {
        const result = normalizeSummaryConsistency("较强匹配的机床销售", {
            score: 86,
            recommendation: "strong_match",
        });
        expect(result).toContain("较强匹配");
    });
});

describe("enrichConcernsWithBrandSignals", () => {
    it("appends domestic and tool concerns from ingest signals", () => {
        const concerns = enrichConcernsWithBrandSignals(
            ["电话未接通"],
            { ingestData: { brandOrigin: "domestic", productClass: "tool_accessory" } },
            "zh",
        );
        expect(concerns[0]).toBe("电话未接通");
        expect(concerns.some((c) => c.includes("国产"))).toBe(true);
        expect(concerns.some((c) => c.includes("刀具"))).toBe(true);
    });

    it("falls back to persisted hit-level signals when candidate-level fields are absent", () => {
        const concerns = enrichConcernsWithBrandSignals(
            [],
            {
                ingestData: {
                    brandHits: [{
                        brand: "蕙勒",
                        origin: "domestic",
                        productClass: "tool_accessory",
                    }],
                },
            },
            "zh",
        );
        expect(concerns.some((concern) => concern.includes("国产"))).toBe(true);
        expect(concerns.some((concern) => concern.includes("刀具"))).toBe(true);
    });

    it("prefers candidate-level signals over conflicting hit-level fallback values", () => {
        const concerns = enrichConcernsWithBrandSignals(
            [],
            {
                ingestData: {
                    brandOrigin: "international",
                    productClass: "complete_machine",
                    brandHits: [{
                        brand: "legacy-hit",
                        origin: "domestic",
                        productClass: "tool_accessory",
                    }],
                },
            },
            "zh",
        );
        expect(concerns).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// normalizeAnalysisResult
// ---------------------------------------------------------------------------
describe("normalizeAnalysisResult", () => {
    it("computes score as final AI score = round(related_exp * 0.5) + industry_db", () => {
        const result = normalizeAnalysisResult(
            { score: 80, summary: "Test", recommendation: "match", breakdown: { related_exp: 60 } },
            { ingestData: { industryDbV2Raw: 30 } },
        );
        // final score = round(60 * 0.5) + 30 = 60
        expect(result.score).toBe(60);
        expect(result.breakdown.related_exp).toBe(60);
        // industry_db is part of the final score formula
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

    it("clamps related_exp to 0-100, score = round(related_exp * 0.5) + industry_db", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 200 } },
            {},
        );
        // related_exp clamped to 100, no ingestData → industryDb=0 → score = round(100*0.5)+0 = 50
        expect(result.score).toBe(50);
        expect(result.breakdown.related_exp).toBe(100);
    });

    it("derives recommendation from final AI score", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 100 } },
            { ingestData: { industryDbV2Raw: 35 } },
        );
        // final score = round(100*0.5) + 35 = 85 → strong_match (≥85)
        expect(result.score).toBe(85);
        expect(result.recommendation).toBe("strong_match");
    });

    it("uses default summary when empty", () => {
        const result = normalizeAnalysisResult(
            { summary: "" },
            {},
        );
        expect(result.summary).toBe("No summary provided.");
    });

    it("enriches concerns from brandOrigin/productClass without changing formula", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "potential",
                summary: "刀具销售，较强匹配",
                breakdown: { related_exp: 30 },
                concerns: ["行业相关性不足"],
            },
            {
                ingestData: {
                    brandOrigin: "domestic",
                    productClass: "tool_accessory",
                    industryDbV2Raw: 0,
                },
            },
        );
        // formula: round(30*0.5)+0 = 15
        expect(result.score).toBe(15);
        expect(result.summary).not.toMatch(/较强匹配/);
        expect(result.concerns.some((c) => c.includes("国产") || c.includes("刀具") || c.includes("行业相关性不足"))).toBe(true);
        expect(result.concerns.length).toBeGreaterThanOrEqual(2);
    });

    it("applies authoritative MY industry_db floor when ingestData.market is MY", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 30 } },
            { sourceKey: "seek", ingestData: { market: "MY", industryDbV2Raw: 0, brandHits: [], companyHits: [] } },
        );
        expect(result.breakdown.industry_db).toBe(40);
        expect(result.score).toBe(55);
    });

    it("applies authoritative MY industry_db floor when market is missing but source resolves to seek", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 30 } },
            { sourceKey: "seek", ingestData: { industryDbV2Raw: 0, brandHits: [], companyHits: [] } },
        );
        expect(result.breakdown.industry_db).toBe(40);
        expect(result.score).toBe(55);
    });

    it("does not apply MY floor to CN resumes with missing hits", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 30 } },
            { sourceKey: "job5156", ingestData: { market: "CN", industryDbV2Raw: 0, brandHits: [], companyHits: [] } },
        );
        expect(result.breakdown.industry_db).toBe(0);
        expect(result.score).toBe(15);
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
            // related_exp clamped to 30 (no_match ceiling); score = round(30*0.5)+0 = 15
            expect(result.score).toBe(15);
        });

        it("null recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { recommendation: null as unknown as string, breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBe(15);
        });

        it("undefined recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBe(15);
        });

        it("empty-string recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "", breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBe(15);
        });

        it("numeric recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { recommendation: 42 as unknown as string, breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBe(15);
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
                // score = round(min(100, ceiling) * 0.5) + 0 = round(ceiling * 0.5)
                // strong_match/match: round(100*0.5)=50, potential: round(60*0.5)=30, no_match: round(30*0.5)=15
                const expectedScore = Math.round(ceiling * 0.5);
                expect(result.score).toBe(expectedScore);
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

        it("does not apply the legacy no_match cap to MY floor-scored resumes", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "no_match", breakdown: { related_exp: 35 } },
                { ingestData: { market: "MY", brandHits: [], companyHits: [], industryDbV2Raw: 0 } },
            );
            expect(result.score).toBe(55);
            expect(result.recommendation).toBe("potential");
            expect(result.breakdown).toMatchObject({
                related_exp: 30,
                industry_db: 40,
            });
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

// ---------------------------------------------------------------------------
// P1: relatedExpEvidence storage in normalizeAnalysisResult
// ---------------------------------------------------------------------------

describe("normalizeAnalysisResult with relatedExpContext (P1)", () => {
    it("returns relatedExpEvidence when context is provided", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 84 } },
            { ingestData: { companyHits: [] } },
            {
                context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
                ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0 },
            },
        );
        expect(result.relatedExpEvidence).toBeDefined();
        expect(result.relatedExpEvidence?.coverage).toBe("none");
        expect(result.relatedExpEvidence?.evidenceBandMax).toBe(30);
        expect(result.relatedExpEvidence?.llmRaw).toBe(84);
        expect(typeof result.relatedExpEvidence?.contextHash).toBe("string");
        expect(typeof result.relatedExpEvidence?.rubricVersion).toBe("string");
    });

    it("breakdown.related_exp = effectiveRaw when context is provided", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 84 } },
            { ingestData: { companyHits: [] } },
            {
                context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
                // no directRoleMatch, no domain years → none coverage → evidenceBandMax=30
                ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0 },
            },
        );
        // effectiveRaw = min(84, 100 [match ceiling], 30 [evidenceBandMax]) = 30
        expect(result.breakdown.related_exp).toBe(30);
        // final score = round(30*0.5) + 0 = 15
        expect(result.score).toBe(15);
    });

    it("breakdown.related_exp = effectiveRaw for full coverage (no ceiling applied)", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 75 } },
            { ingestData: { companyHits: [] } },
            {
                context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
                ingestEvidence: { directRoleMatch: true, industryVerifiedRelevantYears: 3 },
            },
        );
        // full coverage → evidenceBandMax=100; effectiveRaw = min(75, 100, 100) = 75
        expect(result.breakdown.related_exp).toBe(75);
        // final score = round(75*0.5) + 0 = 38
        expect(result.score).toBe(38);
        expect(result.relatedExpEvidence?.coverage).toBe("full");
    });

    it("legacy path: no relatedExpContext → no relatedExpEvidence (backward compat)", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 60 } },
            { ingestData: { industryDbV2Raw: 30 } },
        );
        // relatedExpEvidence is absent — no third argument
        expect((result as Record<string, unknown>).relatedExpEvidence).toBeUndefined();
        // final score = round(60*0.5) + 30 = 60
        expect(result.score).toBe(60);
        expect(result.breakdown.related_exp).toBe(60);
    });

    it("relatedExpEvidence missingReasons is populated for partial/weak/none coverage", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 84 } },
            {},
            {
                context: { roleFilterType: "sales", minRoleYears: 2 },
                ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0 },
            },
        );
        expect(result.relatedExpEvidence?.missingReasons.length).toBeGreaterThan(0);
    });

    it("floors under-scored CN machine-tool sales to 60 when company-verified evidence is full (Yang-like)", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "potential",
                summary: "候选人核心经历集中在香港宝力机械有限公司东莞代表处，最近岗位为销售工程师，明确负责代理CNC机床在华南地区的客户开发与销售；此前还有同公司3年多的业务跟单经历，说明其在机床销售链条中有连续积累。整体看，她具备较明确的CNC销售相关背景，但当前材料对销售成果、指标达成和客户规模的描述不充分，因此更适合列为有潜力的候选人。",
                breakdown: { related_exp: 36 },
            },
            {
                ingestData: {
                    industryDbV2Raw: 10,
                    companyHits: ["宝力机械有限公司"],
                    roleSignals: [
                        {
                            type: "sales",
                            matchedSignals: ["销售工程师", "销售", "客户开发", "业务"],
                            signalCount: 7,
                            occurrences: 3,
                            years: 8.17,
                            industryVerifiedYears: 5.17,
                            roleRelevantYears: 8.17,
                            industryVerifiedRelevantYears: 5.17,
                            matchedWorkEntries: [
                                {
                                    companyName: "香港宝力机械有限公司东莞代表处",
                                    jobTitle: "销售工程师",
                                    years: 1.42,
                                    industryVerified: true,
                                    matchedSignals: ["销售工程师", "销售", "客户开发"],
                                    directRoleMatch: true,
                                },
                                {
                                    companyName: "莞市欣明五金制品有限公司",
                                    jobTitle: "销售助理",
                                    years: 3,
                                    industryVerified: false,
                                    matchedSignals: ["销售", "业务"],
                                    directRoleMatch: true,
                                },
                                {
                                    companyName: "香港宝力机械有限公司东莞代表处",
                                    jobTitle: "业务跟单",
                                    years: 3.75,
                                    industryVerified: true,
                                    matchedSignals: ["业务", "销售"],
                                    directRoleMatch: true,
                                },
                            ],
                            verifyIn: "workHistory",
                        },
                    ],
                },
                workHistory: [
                    {
                        companyName: "香港宝力机械有限公司东莞代表处",
                        jobTitle: "销售工程师",
                        description: "本人在宝力公司从销售跟单转到销售工程师，负责宝力公司代理的CNC机床在华南地区客户开发跟销售工作。",
                    },
                    {
                        companyName: "莞市欣明五金制品有限公司",
                        jobTitle: "销售助理",
                        description: "对接、报价核算、订单跟进全流程执行。",
                    },
                    {
                        companyName: "香港宝力机械有限公司东莞代表处",
                        jobTitle: "业务跟单",
                        description: "负责宝力公司代理的机床的业务销售跟单工作。",
                    },
                ],
            },
            {
                context: { roleFilterType: "sales", minRoleYears: 1, market: "CN", locale: "zh" },
                ingestEvidence: {
                    directRoleMatch: true,
                    industryVerifiedRelevantYears: 5.17,
                    matchedWorkEntries: [
                        "销售工程师 @ 香港宝力机械有限公司东莞代表处 (1.42y)",
                        "销售助理 @ 莞市欣明五金制品有限公司 (3y)",
                        "业务跟单 @ 香港宝力机械有限公司东莞代表处 (3.75y)",
                    ],
                },
            },
        );

        expect(result.breakdown.related_exp).toBe(60);
        expect(result.score).toBe(70);
        expect(result.recommendation).toBe("match");
        expect(result.relatedExpEvidence?.llmRaw).toBe(36);
        expect(result.relatedExpEvidence?.baseEffectiveRaw).toBe(36);
        expect(result.relatedExpEvidence?.adjustmentReason).toBe("cn_machine_tool_company_verified_sales_floor_v1");
        expect(result.summary).toContain("系统归一化结果：score 70，recommendation match。");
    });

    it("does not floor generic verified industrial sales when machine-tool domain text is absent (Ban-like)", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "potential",
                summary: "候选人最近一段经历为基恩士中国有限公司大客户销售，具备较完整的销售职责和持续6.75年的已验证销售经验。",
                breakdown: { related_exp: 36 },
            },
            {
                ingestData: {
                    industryDbV2Raw: 10,
                    companyHits: ["基恩士中国有限公司"],
                    roleSignals: [
                        {
                            type: "sales",
                            matchedSignals: ["销售", "大客户"],
                            signalCount: 4,
                            occurrences: 1,
                            years: 6.75,
                            industryVerifiedYears: 6.75,
                            roleRelevantYears: 6.75,
                            industryVerifiedRelevantYears: 6.75,
                            matchedWorkEntries: [
                                {
                                    companyName: "基恩士（中国）有限公司",
                                    jobTitle: "大客户销售",
                                    years: 6.75,
                                    industryVerified: true,
                                    matchedSignals: ["销售", "大客户"],
                                    directRoleMatch: true,
                                },
                            ],
                            verifyIn: "workHistory",
                        },
                    ],
                },
                workHistory: [
                    {
                        companyName: "基恩士（中国）有限公司",
                        jobTitle: "大客户销售",
                        description: "通过电话以及实地拜访的形式对区域内客户的关键项目推进，最终完成产品的销售。",
                    },
                ],
            },
            {
                context: { roleFilterType: "sales", minRoleYears: 1, market: "CN", locale: "zh" },
                ingestEvidence: {
                    directRoleMatch: true,
                    industryVerifiedRelevantYears: 6.75,
                    matchedWorkEntries: ["大客户销售 @ 基恩士（中国）有限公司 (6.75y)"],
                },
            },
        );

        expect(result.breakdown.related_exp).toBe(36);
        expect(result.score).toBe(58);
        expect(result.recommendation).toBe("potential");
        expect(result.relatedExpEvidence?.adjustmentReason).toBeUndefined();
        expect(result.summary).not.toContain("系统归一化结果：score 70，recommendation match。");
    });

    it("does not floor company-verified tool sales even when the text includes 数控 keywords", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "potential",
                summary: "候选人长期在数控刀具相关行业从事销售类工作，但更偏刀具与工艺方案方向。",
                breakdown: { related_exp: 36 },
            },
            {
                ingestData: {
                    industryDbV2Raw: 10,
                    companyHits: ["example-tooling-cn"],
                    roleSignals: [
                        {
                            type: "sales",
                            matchedSignals: ["销售工程师", "销售", "业务开发", "业务"],
                            signalCount: 6,
                            occurrences: 3,
                            years: 11.92,
                            industryVerifiedYears: 8.34,
                            roleRelevantYears: 5.42,
                            industryVerifiedRelevantYears: 5.42,
                            matchedWorkEntries: [
                                {
                                    companyName: "华北示例刀具有限公司",
                                    jobTitle: "销售工程师",
                                    years: 5.42,
                                    industryVerified: true,
                                    matchedSignals: ["销售工程师", "销售", "业务开发", "业务"],
                                    directRoleMatch: true,
                                },
                            ],
                            verifyIn: "workHistory",
                        },
                    ],
                },
                workHistory: [
                    {
                        companyName: "华北示例刀具有限公司",
                        jobTitle: "销售工程师",
                        description: "负责重庆地区刀具业务开发，配合代理商开发选型试切，促成订单。",
                    },
                    {
                        companyName: "西南示例工具有限公司",
                        jobTitle: "客户代表",
                        description: "公司主要经营各类进口、国产数控刀具，以及刀具整体方案设计。",
                    },
                ],
            },
            {
                context: { roleFilterType: "sales", minRoleYears: 1, market: "CN", locale: "zh" },
                ingestEvidence: {
                    directRoleMatch: true,
                    industryVerifiedRelevantYears: 5.42,
                    matchedWorkEntries: ["销售工程师 @ 华北示例刀具有限公司 (5.42y)"],
                },
            },
        );

        expect(result.breakdown.related_exp).toBe(36);
        expect(result.breakdown.industry_db).toBeLessThanOrEqual(20);
        expect(result.score).toBeLessThan(50);
        expect(result.relatedExpEvidence?.adjustmentReason).toBe("cn_adjacent_product_score_cap_v1");
    });
});

describe("normalizeAnalysisResult adjacent-product score cap", () => {
    const overscoreLlm = {
        recommendation: "match" as const,
        summary: "相关销售经验较完整。",
        breakdown: { related_exp: 60 },
    };
    const relatedExpCtx = {
        context: { roleFilterType: "sales", minRoleYears: 1, market: "CN", locale: "zh" },
        ingestEvidence: {
            directRoleMatch: true,
            industryVerifiedRelevantYears: 6,
            matchedWorkEntries: ["销售工程师 @ 华东示例机械有限公司 (6y)"],
        },
    };

    function inventedSalesResume(description: string) {
        return {
            ingestData: {
                market: "CN",
                industryDbV2Raw: 40,
                companyHits: ["华东示例机械有限公司"],
                brandHits: [{ context: "client", brand: "ExampleBrand" }],
                roleSignals: [
                    {
                        type: "sales",
                        matchedSignals: ["销售"],
                        signalCount: 2,
                        occurrences: 1,
                        years: 6,
                        industryVerifiedYears: 6,
                        industryVerifiedRelevantYears: 6,
                        matchedWorkEntries: [
                            {
                                companyName: "华东示例机械有限公司",
                                jobTitle: "销售工程师",
                                years: 6,
                                industryVerified: true,
                                matchedSignals: ["销售"],
                                directRoleMatch: true,
                            },
                        ],
                        verifyIn: "workHistory",
                    },
                ],
            },
            workHistory: [
                {
                    companyName: "华东示例机械有限公司",
                    jobTitle: "销售工程师",
                    description,
                },
            ],
        };
    }

    it.each([
        { label: "injection-molding", description: "负责华东注塑机销售与经销商开发" },
        { label: "gear-machine", description: "齿轮机区域销售，跟进渠道订单" },
        { label: "tools-parts-electrical-pneumatic", description: "刀具、配件、电气柜与气动元件销售" },
    ])("caps $label adjacent product out of the whole-machine overscore band", ({ description }) => {
        const result = normalizeAnalysisResult(overscoreLlm, inventedSalesResume(description), relatedExpCtx);
        expect(result.breakdown.related_exp).toBeLessThanOrEqual(45);
        expect(result.breakdown.industry_db).toBeLessThanOrEqual(20);
        expect(result.score).toBeLessThan(60);
        expect(result.relatedExpEvidence?.adjustmentReason).toBe("cn_adjacent_product_score_cap_v1");
    });

    it("does not cap a real 整机数控机床销售 profile", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", summary: "整机销售经验完整。", breakdown: { related_exp: 80 } },
            inventedSalesResume("负责进口数控机床整机销售与加工中心客户开发"),
            relatedExpCtx,
        );
        expect(result.breakdown.related_exp).toBe(80);
        expect(result.breakdown.industry_db).toBe(50);
        expect(result.score).toBe(90);
        expect(result.relatedExpEvidence?.adjustmentReason).toBeUndefined();
    });

    it("does not let pay / location / 不考虑 / wechat-phone change the numeric score", () => {
        const work = "齿轮机销售，覆盖华东经销渠道";
        const base = normalizeAnalysisResult(overscoreLlm, inventedSalesResume(work), relatedExpCtx);
        const filtered = normalizeAnalysisResult(
            overscoreLlm,
            inventedSalesResume(`${work}。不考虑出差，期望薪资面议，地区无需求，电话微信同号`),
            relatedExpCtx,
        );
        expect(filtered.score).toBe(base.score);
        expect(filtered.breakdown.related_exp).toBe(base.breakdown.related_exp);
        expect(filtered.breakdown.industry_db).toBe(base.breakdown.industry_db);
    });

    it("does not add a 女性 scoring feature", () => {
        const work = "电气配件销售";
        const base = normalizeAnalysisResult(overscoreLlm, inventedSalesResume(work), relatedExpCtx);
        const gendered = normalizeAnalysisResult(
            overscoreLlm,
            inventedSalesResume(`${work}，女性`),
            relatedExpCtx,
        );
        expect(gendered.score).toBe(base.score);
        expect(gendered.breakdown).toEqual(base.breakdown);
    });
});

// ---------------------------------------------------------------------------
// RED TESTS: Full-score audit integration — final AI score storage
// ---------------------------------------------------------------------------
// These tests define the contract BEFORE implementation:
// - Convex stores analysis.score as final AI score (not raw related_exp)
// - breakdown.related_exp remains the audit factor
// - industry_db is deterministic system value, not LLM-provided
// - recommendation is derived from final AI score
// - relatedExpEvidence.effectiveRaw remains the audit factor

describe("full-score audit integration — final AI score (RED)", () => {
    it("relatedExp=78 + industryDb=40 → stored analysis.score becomes 79", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "match",
                breakdown: { related_exp: 78, industry_db: 10 },
            },
            {
                ingestData: {
                    brandHits: [{ context: "client" }],
                    companyHits: [],
                    industryDbV2Raw: 0,
                },
            },
        );
        expect(result.score).toBe(79);
    });

    it("stored breakdown.related_exp remains the audit factor, not the contribution", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "match",
                breakdown: { related_exp: 78, industry_db: 10 },
            },
            {
                ingestData: {
                    brandHits: [{ context: "client" }],
                    companyHits: [],
                    industryDbV2Raw: 0,
                },
            },
        );
        // breakdown.related_exp must remain 78 (the raw/effective audit factor)
        expect(result.breakdown.related_exp).toBe(78);
    });

    it("stored breakdown.industry_db is deterministic system value, not LLM-provided", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "match",
                breakdown: { related_exp: 78, industry_db: 10 },
            },
            {
                ingestData: {
                    brandHits: [{ context: "client" }],
                    companyHits: ["Acme"],
                    industryDbV2Raw: 0,
                },
            },
        );
        // LLM provided industry_db=10 but system has both brand+company hits → 50
        expect(result.breakdown.industry_db).toBe(50);
    });

    it("stored recommendation is derived from final AI score", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "match",
                breakdown: { related_exp: 90, industry_db: 10 },
            },
            {
                ingestData: {
                    brandHits: [{ context: "client" }],
                    companyHits: ["Acme"],
                    industryDbV2Raw: 0,
                },
            },
        );
        // final score = round(90*0.5) + 50 = 45 + 50 = 95 → strong_match
        expect(result.recommendation).toBe("strong_match");
    });

    it("relatedExpEvidence.effectiveRaw remains the audit factor, not final AI score", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "match",
                breakdown: { related_exp: 84 },
            },
            { ingestData: { companyHits: [] } },
            {
                context: { roleFilterType: "sales", minRoleYears: 1, market: "CN" },
                ingestEvidence: { directRoleMatch: false, industryVerifiedRelevantYears: 0 },
            },
        );
        // effectiveRaw = min(84, 100, 30) = 30 (evidence ceiling applied)
        expect(result.relatedExpEvidence?.effectiveRaw).toBe(30);
        // effectiveRaw must NOT be final AI score (which would add industry_db)
        expect(result.relatedExpEvidence?.effectiveRaw).toBeLessThan(100);
    });

    it("legacy no-match gate: LLM no_match still caps final score ≤ 39", () => {
        const result = normalizeAnalysisResult(
            {
                recommendation: "no_match",
                breakdown: { related_exp: 80 },
            },
            {
                ingestData: {
                    brandHits: [{ context: "client" }],
                    companyHits: ["Acme"],
                    industryDbV2Raw: 0,
                },
            },
        );
        // relatedExp factor = 30 (no_match ceiling), contribution = 15
        // industryDb = 50 (both hits)
        // final score = 15 + 50 = 65, but no_match gate caps at 39
        expect(result.score).toBeLessThanOrEqual(39);
    });
});
