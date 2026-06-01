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
    it("returns cap when brand hits exist", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { brandHits: [{ context: "client" }] },
        })).toBe(INDUSTRY_DB_SCORE_CAP);
    });

    it("returns cap when company hits exist", () => {
        expect(computeDirectIndustryDbScoreFromResume({
            ingestData: { companyHits: ["Acme"] },
        })).toBe(INDUSTRY_DB_SCORE_CAP);
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
    it("computes score from related_exp * weight + industry_db", () => {
        const result = normalizeAnalysisResult(
            { score: 80, summary: "Test", recommendation: "match", breakdown: { related_exp: 60 } },
            { ingestData: { industryDbV2Raw: 30 } },
        );
        expect(result.score).toBe(Math.round(60 * RELATED_EXP_WEIGHT) + 30);
        expect(result.breakdown.related_exp).toBe(60);
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

    it("clamps related_exp to 0-100 before weighting", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 200 } },
            {},
        );
        // related_exp clamped to 100, then score = round(100 * 0.5) + 0 = 50
        expect(result.score).toBe(50);
        expect(result.breakdown.related_exp).toBe(100);
    });

    it("derives recommendation from score", () => {
        const result = normalizeAnalysisResult(
            { recommendation: "match", breakdown: { related_exp: 100 } },
            { ingestData: { industryDbV2Raw: 35 } },
        );
        // score = round(100 * 0.5) + 35 = 85 → strong_match
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

    describe("CNC sales related_exp evidence gate", () => {
        it("caps generic industrial sales for CNC sales target", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "match", summary: "ok", breakdown: { related_exp: 95 } },
                {
                    ingestData: {
                        companyHits: ["基恩士中国有限公司"],
                        brandHits: [],
                        evidenceText: "2019-2026 基恩士中国有限公司 大客户销售 负责传感器和检测设备销售",
                        roleSignals: [{
                            type: "sales",
                            verifyIn: "workHistory",
                            matchedSignals: ["销售", "大客户"],
                            matchedWorkEntries: [{
                                companyName: "基恩士中国有限公司",
                                jobTitle: "大客户销售",
                                years: 6.75,
                                industryVerified: true,
                                directRoleMatch: true,
                                matchedSignals: ["销售", "大客户"],
                            }],
                        }],
                    },
                },
                { target: { keywords: ["CNC", "销售"] } },
            );

            expect(result.breakdown.related_exp).toBe(30);
            expect(result.breakdown.related_exp_llm).toBe(95);
            expect(result.breakdown.related_exp_evidence_ceiling).toBe(30);
            expect(result.score).toBe(65);
        });

        it("caps adjacent spindle sales below the 80 bucket", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "match", summary: "ok", breakdown: { related_exp: 90 } },
                {
                    ingestData: {
                        brandHits: [{ context: "sales" }],
                        companyHits: [],
                        evidenceText: "2020-2024 某主轴公司 销售工程师 负责CNC电主轴销售",
                        roleSignals: [{
                            type: "sales",
                            verifyIn: "workHistory",
                            matchedSignals: ["销售工程师"],
                            matchedWorkEntries: [{
                                companyName: "某主轴公司",
                                jobTitle: "销售工程师",
                                years: 4,
                                industryVerified: true,
                                directRoleMatch: true,
                                matchedSignals: ["销售工程师"],
                            }],
                        }],
                    },
                },
                { target: { keywords: ["CNC", "销售"] } },
            );

            expect(result.breakdown.related_exp).toBe(55);
            expect(result.score).toBe(78);
        });

        it("keeps direct machine-tool sales eligible for high score", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "strong_match", summary: "ok", breakdown: { related_exp: 90 } },
                {
                    ingestData: {
                        companyHits: [],
                        brandHits: [{ context: "sales" }],
                        evidenceText: "2022-2024 东莞翔亚机械设备有限公司 销售工程师 销售沙迪克慢走丝、火花机、现代威亚CNC数控车床",
                        roleSignals: [{
                            type: "sales",
                            verifyIn: "workHistory",
                            matchedSignals: ["销售工程师"],
                            matchedWorkEntries: [{
                                companyName: "东莞翔亚机械设备有限公司",
                                jobTitle: "销售工程师",
                                years: 2,
                                industryVerified: false,
                                directRoleMatch: true,
                                matchedSignals: ["销售工程师"],
                            }],
                        }],
                    },
                },
                { target: { keywords: ["CNC", "销售"] } },
            );

            expect(result.breakdown.related_exp).toBe(90);
            expect(result.score).toBe(95);
        });

        it("does not apply evidence cap outside CNC sales target", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "match", summary: "ok", breakdown: { related_exp: 95 } },
                {
                    ingestData: {
                        companyHits: ["基恩士中国有限公司"],
                        evidenceText: "2019-2026 基恩士中国有限公司 大客户销售",
                        roleSignals: [],
                    },
                },
                { target: { keywords: ["CNC"] } },
            );

            expect(result.breakdown.related_exp).toBe(95);
        });
    });

    describe("recommendation ceiling — fail-closed defaults", () => {
        it("unknown recommendation string clamps related_exp to no_match ceiling (30)", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "weak_potential", breakdown: { related_exp: 100 } },
                {},
            );
            // related_exp clamped to 30 → score = round(30 * 0.5) + 0 = 15
            expect(result.score).toBeLessThanOrEqual(15);
        });

        it("null recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { recommendation: null as unknown as string, breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBeLessThanOrEqual(15);
        });

        it("undefined recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBeLessThanOrEqual(15);
        });

        it("empty-string recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { recommendation: "", breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBeLessThanOrEqual(15);
        });

        it("numeric recommendation clamps to no_match ceiling", () => {
            const result = normalizeAnalysisResult(
                { recommendation: 42 as unknown as string, breakdown: { related_exp: 100 } },
                {},
            );
            expect(result.score).toBeLessThanOrEqual(15);
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
                expect(result.score).toBe(Math.round(ceiling * RELATED_EXP_WEIGHT));
            }
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
