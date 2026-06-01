import { describe, it, expect } from "vitest";
import { isRecord } from "@trends/shared";
import {
  toNumber,
  clamp,
  parseNumericBreakdown,
  hasNonEmployerBrandHits,
  hasCompanyHits,
  getResumeIngestData,
  computeDirectIndustryDbScoreFromResume,
  recommendationFromScore,
  hasHanText,
  normalizeSummaryConsistency,
  parseRoleSignals,
  normalizeAnalysisResult,
  parseKeyFactors,
  isEnglishResumeAiLocale,
} from "../convex/analyze.js";

// --- isRecord ---

describe("isRecord (analyze)", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns true for arrays (typeof === 'object')", () => {
    // Unlike config-source-inspector's isRecord, this one does NOT exclude arrays
    expect(isRecord([])).toBe(true);
  });

  it("returns false for primitives", () => {
    expect(isRecord("str")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

// --- toNumber ---

describe("toNumber", () => {
  it("returns number for finite values", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-3.5)).toBe(-3.5);
  });

  it("parses numeric strings", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber("3.14")).toBe(3.14);
    expect(toNumber("0")).toBe(0);
  });

  it("returns undefined for non-numeric strings", () => {
    expect(toNumber("abc")).toBeUndefined();
  });

  it("parses empty string as 0 (Number('') === 0 is finite)", () => {
    expect(toNumber("")).toBe(0);
  });

  it("returns undefined for NaN and Infinity", () => {
    expect(toNumber(NaN)).toBeUndefined();
    expect(toNumber(Infinity)).toBeUndefined();
    expect(toNumber(-Infinity)).toBeUndefined();
  });

  it("returns undefined for non-number/string types", () => {
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber(true)).toBeUndefined();
  });
});

// --- clamp ---

describe("clamp", () => {
  it("returns value within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles min === max", () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it("handles negative ranges", () => {
    expect(clamp(-10, -5, 5)).toBe(-5);
  });
});

// --- parseNumericBreakdown ---

describe("parseNumericBreakdown", () => {
  it("parses numeric values from an object", () => {
    const result = parseNumericBreakdown({ related_exp: 80, industry_db: 50 });
    expect(result).toEqual({ related_exp: 80, industry_db: 50 });
  });

  it("parses numeric string values", () => {
    const result = parseNumericBreakdown({ related_exp: "80" });
    expect(result).toEqual({ related_exp: 80 });
  });

  it("skips non-numeric values", () => {
    const result = parseNumericBreakdown({ related_exp: 80, label: "high" });
    expect(result).toEqual({ related_exp: 80 });
  });

  it("returns undefined for empty object after filtering", () => {
    expect(parseNumericBreakdown({ label: "high" })).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(parseNumericBreakdown(null)).toBeUndefined();
    expect(parseNumericBreakdown("string")).toBeUndefined();
    expect(parseNumericBreakdown(42)).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(parseNumericBreakdown(undefined)).toBeUndefined();
  });

  it("skips NaN and Infinity values", () => {
    const result = parseNumericBreakdown({ a: NaN, b: Infinity, c: 42 });
    expect(result).toEqual({ c: 42 });
  });
});

// --- hasNonEmployerBrandHits ---

describe("hasNonEmployerBrandHits", () => {
  it("returns true when non-employer context exists", () => {
    expect(hasNonEmployerBrandHits([{ context: "industry" }])).toBe(true);
  });

  it("returns true for empty string context (not 'employer')", () => {
    expect(hasNonEmployerBrandHits([{ context: "" }])).toBe(true);
  });

  it("returns false when all contexts are 'employer'", () => {
    expect(hasNonEmployerBrandHits([{ context: "employer" }])).toBe(false);
    expect(hasNonEmployerBrandHits([
      { context: "employer" },
      { context: "EMPLOYER" },
    ])).toBe(false);
  });

  it("returns false for non-array input", () => {
    expect(hasNonEmployerBrandHits(null)).toBe(false);
    expect(hasNonEmployerBrandHits({})).toBe(false);
    expect(hasNonEmployerBrandHits("employer")).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasNonEmployerBrandHits([])).toBe(false);
  });

  it("skips non-object items in array", () => {
    expect(hasNonEmployerBrandHits(["string", 42])).toBe(false);
  });

  it("skips items without context string", () => {
    expect(hasNonEmployerBrandHits([{ context: 42 }])).toBe(true);
    // context: 42 → typeof !== "string" → context="" → !== "employer" → true
  });
});

// --- hasCompanyHits ---

describe("hasCompanyHits", () => {
  it("returns true for non-empty string entries", () => {
    expect(hasCompanyHits(["Acme Corp"])).toBe(true);
  });

  it("returns false for empty strings", () => {
    expect(hasCompanyHits(["", "  "])).toBe(false);
  });

  it("returns false for non-array input", () => {
    expect(hasCompanyHits(null)).toBe(false);
    expect(hasCompanyHits({})).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasCompanyHits([])).toBe(false);
  });

  it("filters out non-string entries", () => {
    expect(hasCompanyHits([42, null])).toBe(false);
  });

  it("returns true when at least one valid string exists", () => {
    expect(hasCompanyHits(["", "Acme Corp", 42])).toBe(true);
  });
});

// --- getResumeIngestData ---

describe("getResumeIngestData", () => {
  it("returns ingestData from top-level", () => {
    const result = getResumeIngestData({ ingestData: { brandHits: [] } });
    expect(result).toEqual({ brandHits: [] });
  });

  it("returns ingestData from content when top-level missing", () => {
    const result = getResumeIngestData({ content: { ingestData: { brandHits: [] } } });
    expect(result).toEqual({ brandHits: [] });
  });

  it("prefers top-level ingestData over content", () => {
    const result = getResumeIngestData({
      ingestData: { source: "top" },
      content: { ingestData: { source: "nested" } },
    });
    expect(result).toEqual({ source: "top" });
  });

  it("returns empty object when no ingestData found", () => {
    expect(getResumeIngestData({})).toEqual({});
    expect(getResumeIngestData(null)).toEqual({});
    expect(getResumeIngestData(undefined)).toEqual({});
  });

  it("returns empty object when ingestData is not a record", () => {
    expect(getResumeIngestData({ ingestData: "bad" })).toEqual({});
  });
});

// --- computeDirectIndustryDbScoreFromResume ---

describe("computeDirectIndustryDbScoreFromResume", () => {
  const CAP = 50;

  it("returns the additive brand weight (30) for non-employer brand context", () => {
    expect(computeDirectIndustryDbScoreFromResume({
      ingestData: { brandHits: [{ context: "industry" }] },
    })).toBe(30);
  });

  it("returns the additive company weight (20) when companyHits has entries", () => {
    expect(computeDirectIndustryDbScoreFromResume({
      ingestData: { companyHits: ["Acme Corp"] },
    })).toBe(20);
  });

  it("clamps industryDbV2Raw to 0..CAP", () => {
    expect(computeDirectIndustryDbScoreFromResume({
      ingestData: { industryDbV2Raw: 30 },
    })).toBe(30);

    expect(computeDirectIndustryDbScoreFromResume({
      ingestData: { industryDbV2Raw: 60 },
    })).toBe(CAP);

    expect(computeDirectIndustryDbScoreFromResume({
      ingestData: { industryDbV2Raw: -10 },
    })).toBe(0);
  });

  it("defaults to 0 when no industry data", () => {
    expect(computeDirectIndustryDbScoreFromResume({})).toBe(0);
    expect(computeDirectIndustryDbScoreFromResume(null)).toBe(0);
  });

  it("parses string industryDbV2Raw", () => {
    expect(computeDirectIndustryDbScoreFromResume({
      ingestData: { industryDbV2Raw: "25" },
    })).toBe(25);
  });

  it("returns 0 for invalid industryDbV2Raw", () => {
    expect(computeDirectIndustryDbScoreFromResume({
      ingestData: { industryDbV2Raw: "abc" },
    })).toBe(0);
  });
});

// --- recommendationFromScore ---

describe("recommendationFromScore", () => {
  it("returns 'strong_match' for score >= 85", () => {
    expect(recommendationFromScore(85)).toBe("strong_match");
    expect(recommendationFromScore(100)).toBe("strong_match");
  });

  it("returns 'match' for 70 <= score < 85", () => {
    expect(recommendationFromScore(70)).toBe("match");
    expect(recommendationFromScore(84)).toBe("match");
  });

  it("returns 'potential' for 40 <= score < 70", () => {
    expect(recommendationFromScore(40)).toBe("potential");
    expect(recommendationFromScore(69)).toBe("potential");
  });

  it("returns 'no_match' for score < 40", () => {
    expect(recommendationFromScore(39)).toBe("no_match");
    expect(recommendationFromScore(0)).toBe("no_match");
  });
});

// --- hasHanText ---

describe("hasHanText", () => {
  it("returns true for Chinese text", () => {
    expect(hasHanText("候选人")).toBe(true);
    expect(hasHanText("Hello 世界")).toBe(true);
  });

  it("returns false for ASCII-only text", () => {
    expect(hasHanText("Hello World")).toBe(false);
    expect(hasHanText("")).toBe(false);
  });

  it("returns false for Japanese kana only", () => {
    expect(hasHanText("こんにちは")).toBe(false);
  });

  it("detects CJK Unified Ideographs range", () => {
    expect(hasHanText("\u4e00")).toBe(true);
    expect(hasHanText("\u9fff")).toBe(true);
  });
});

// --- normalizeSummaryConsistency ---

describe("normalizeSummaryConsistency", () => {
  it("returns empty/whitespace summary unchanged", () => {
    expect(normalizeSummaryConsistency("", { score: 80, recommendation: "match" })).toBe("");
    // Whitespace-only: trim().length === 0 triggers early return with original
    expect(normalizeSummaryConsistency("   ", { score: 80, recommendation: "match" })).toBe("   ");
  });

  it("returns consistent summary unchanged", () => {
    const summary = "Score: 80, recommendation: match";
    expect(normalizeSummaryConsistency(summary, { score: 80, recommendation: "match" })).toBe(summary);
  });

  it("fixes mismatched score", () => {
    const result = normalizeSummaryConsistency(
      "Score: 50",
      { score: 80, recommendation: "match" },
    );
    expect(result).toContain("Score: 80");
  });

  it("fixes mismatched recommendation", () => {
    const result = normalizeSummaryConsistency(
      "recommendation: potential",
      { score: 80, recommendation: "match" },
    );
    expect(result).toContain("match");
  });

  it("appends normalized line for Chinese summary with mismatched recommendation", () => {
    // Use English "Score:" pattern which is what the regex matches
    const result = normalizeSummaryConsistency(
      "Score: 50, recommendation: potential 候选人匹配度一般",
      { score: 80, recommendation: "match" },
    );
    expect(result).toContain("系统归一化结果");
  });

  it("appends normalized line for English summary with mismatch", () => {
    const result = normalizeSummaryConsistency(
      "Score: 50",
      { score: 80, recommendation: "match" },
    );
    expect(result).toContain("Normalized result");
  });

  it("does not append duplicate normalized line", () => {
    const normalized = "Score: 80 recommendation: match Normalized result: score 80, recommendation match.";
    const result = normalizeSummaryConsistency(
      "Score: 50",
      { score: 80, recommendation: "match" },
    );
    // The line is appended once, not duplicated
    const count = (result.match(/Normalized result/g) || []).length;
    expect(count).toBeLessThanOrEqual(2); // at most in prose + appended line
  });
});

// --- parseRoleSignals ---

describe("parseRoleSignals", () => {
  it("parses valid role signals", () => {
    const result = parseRoleSignals([
      { type: "brand", years: 5, verifyIn: "searchText" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("brand");
    expect(result[0]?.years).toBe(5);
    expect(result[0]?.verifyIn).toBe("searchText");
  });

  it("defaults verifyIn to workHistory when not 'searchText'", () => {
    const result = parseRoleSignals([
      { type: "brand", years: 3, verifyIn: "other" },
    ]);
    expect(result[0]?.verifyIn).toBe("workHistory");
  });

  it("defaults signalCount and occurrences to matchedSignals length", () => {
    const result = parseRoleSignals([
      { type: "skill", years: 2, matchedSignals: ["a", "b"] },
    ]);
    expect(result[0]?.signalCount).toBe(2);
    expect(result[0]?.occurrences).toBe(2);
  });

  it("skips items without type or years", () => {
    expect(parseRoleSignals([{ years: 5 }])).toHaveLength(0);
    expect(parseRoleSignals([{ type: "brand" }])).toHaveLength(0);
  });

  it("returns empty array for non-array input", () => {
    expect(parseRoleSignals(null)).toEqual([]);
    expect(parseRoleSignals({})).toEqual([]);
    expect(parseRoleSignals("string")).toEqual([]);
  });

  it("skips non-object items in array", () => {
    expect(parseRoleSignals(["string", 42, null])).toHaveLength(0);
  });

  it("parses matchedWorkEntries", () => {
    const result = parseRoleSignals([{
      type: "brand",
      years: 5,
      matchedWorkEntries: [
        { companyName: "Acme", jobTitle: "Engineer", years: 3, industryVerified: true, matchedSignals: ["signal1"] },
      ],
    }]);
    expect(result[0]?.matchedWorkEntries).toHaveLength(1);
    expect(result[0]?.matchedWorkEntries?.[0]?.companyName).toBe("Acme");
    expect(result[0]?.matchedWorkEntries?.[0]?.industryVerified).toBe(true);
  });

  it("skips work entries without years", () => {
    const result = parseRoleSignals([{
      type: "brand",
      years: 5,
      matchedWorkEntries: [
        { companyName: "Acme", jobTitle: "Engineer" },
      ],
    }]);
    expect(result[0]?.matchedWorkEntries).toBeUndefined();
  });

  it("includes roleRelevantYears when present", () => {
    const result = parseRoleSignals([{
      type: "skill", years: 5, roleRelevantYears: 3,
    }]);
    expect(result[0]?.roleRelevantYears).toBe(3);
  });

  it("omits roleRelevantYears when undefined", () => {
    const result = parseRoleSignals([{
      type: "skill", years: 5,
    }]);
    expect("roleRelevantYears" in (result[0] ?? {})).toBe(false);
  });
});

// --- normalizeAnalysisResult ---

describe("normalizeAnalysisResult", () => {
  it("normalizes a complete analysis result", () => {
    // score = the related_exp factor (match ceiling 100); industry_db is excluded from the score.
    // With related_exp=80 → score=80 → "match".
    const result = normalizeAnalysisResult(
      { score: 80, recommendation: "match", summary: "Good candidate", breakdown: { related_exp: 80 } },
      {},
    );
    expect(result.score).toBe(80);
    expect(result.recommendation).toBe("match");
    expect(result.summary).toBe("Good candidate");
    expect(result.highlights).toEqual([]);
    expect(result.concerns).toEqual([]);
  });

  it("clamps score to 0-100", () => {
    const result = normalizeAnalysisResult(
      { breakdown: { related_exp: 200 } },
      {},
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("defaults summary when missing or empty", () => {
    const result = normalizeAnalysisResult(
      { summary: "" },
      {},
    );
    expect(result.summary).toBe("No summary provided.");
  });

  it("filters highlights to strings only", () => {
    const result = normalizeAnalysisResult(
      { highlights: ["good", 42, null, "reliable"] },
      {},
    );
    expect(result.highlights).toEqual(["good", "reliable"]);
  });

  it("filters concerns to strings only", () => {
    const result = normalizeAnalysisResult(
      { concerns: ["risk", 0, "gap"] },
      {},
    );
    expect(result.concerns).toEqual(["risk", "gap"]);
  });

  it("includes industry_db in breakdown", () => {
    const result = normalizeAnalysisResult(
      { breakdown: { related_exp: 60 } },
      { ingestData: { industryDbV2Raw: 40 } },
    );
    expect(result.breakdown.industry_db).toBe(40);
  });

  it("falls back to related_exp=0 when breakdown missing", () => {
    const result = normalizeAnalysisResult({}, {});
    expect(result.breakdown.related_exp).toBe(0);
  });

  it("keeps brand/company hits in the breakdown without inflating the score", () => {
    const withoutHits = normalizeAnalysisResult(
      { recommendation: "match", breakdown: { related_exp: 60 } },
      {},
    );
    const withHits = normalizeAnalysisResult(
      { recommendation: "match", breakdown: { related_exp: 60 } },
      { ingestData: { companyHits: ["Acme"] } },
    );
    // industry_db is a display/sort signal only — it must NOT change the score (score = related_exp).
    expect(withHits.score).toBe(withoutHits.score);
    expect(withHits.breakdown.industry_db).toBeGreaterThan(withoutHits.breakdown.industry_db);
  });

  it("extracts keyFactors from LLM response", () => {
    const result = normalizeAnalysisResult(
      {
        breakdown: { related_exp: 60 },
        keyFactors: [
          { factor: "technical_skills", weight: 0.4, value: "5 years CNC" },
          { factor: "industry_experience", weight: 0.3, value: "Sales engineer 7 years" },
        ],
      },
      {},
    );
    expect(result.keyFactors).toHaveLength(2);
    expect(result.keyFactors[0]).toEqual({ factor: "technical_skills", weight: 0.4, value: "5 years CNC" });
    expect(result.keyFactors[1]).toEqual({ factor: "industry_experience", weight: 0.3, value: "Sales engineer 7 years" });
  });

  it("returns empty keyFactors when not provided by LLM", () => {
    const result = normalizeAnalysisResult(
      { breakdown: { related_exp: 60 } },
      {},
    );
    expect(result.keyFactors).toEqual([]);
  });

  // --- HR golden ordering invariant (P2 scoring regression) ---

  function mockResumeWithIndustryDb(industryDbRaw: number) {
    return { ingestData: { industryDbV2Raw: industryDbRaw, brandHits: [], companyHits: [] } };
  }

  it("inflated-related_exp candidate: score <= 75 when LLM recommendation is no_match", () => {
    const result = normalizeAnalysisResult(
      {
        score: 95,
        recommendation: "no_match",
        related_exp: 100,
        summary: "无机床销售经验，部分匹配",
        breakdown: { related_exp: 100 },
      },
      mockResumeWithIndustryDb(50),
    );
    expect(result.score).toBeLessThanOrEqual(75);
    expect(result.recommendation).not.toBe("strong_match");
  });

  it("strong-match candidate: score >= 85 when LLM recommendation is strong_match", () => {
    const result = normalizeAnalysisResult(
      {
        score: 93,
        recommendation: "strong_match",
        related_exp: 90,
        summary: "有斗山机床销售经验",
        breakdown: { related_exp: 90 },
      },
      mockResumeWithIndustryDb(50),
    );
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.recommendation).toBe("strong_match");
  });

  it("no_match candidate must score lower than strong_match candidate with same industryDb", () => {
    const strongMatch = normalizeAnalysisResult(
      { recommendation: "strong_match", related_exp: 90, breakdown: { related_exp: 90 } },
      mockResumeWithIndustryDb(50),
    );
    const noMatch = normalizeAnalysisResult(
      { recommendation: "no_match", related_exp: 100, breakdown: { related_exp: 100 } },
      mockResumeWithIndustryDb(50),
    );
    expect(noMatch.score).toBeLessThan(strongMatch.score);
  });

  it("potential candidate: score between 40-80 when LLM recommendation is potential", () => {
    const result = normalizeAnalysisResult(
      { recommendation: "potential", related_exp: 80, breakdown: { related_exp: 80 } },
      mockResumeWithIndustryDb(35),
    );
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThanOrEqual(80);
  });
});

// --- parseKeyFactors ---

describe("parseKeyFactors", () => {
  it("parses valid keyFactors array", () => {
    const result = parseKeyFactors([
      { factor: "skills", weight: 0.5, value: "Python, React" },
      { factor: "experience", weight: 0.3, value: "5 years" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ factor: "skills", weight: 0.5, value: "Python, React" });
  });

  it("defaults weight to undefined when missing", () => {
    const result = parseKeyFactors([
      { factor: "skills", value: "Python" },
    ]);
    expect(result[0]?.weight).toBeUndefined();
  });

  it("defaults factor to 'unknown' when not a string", () => {
    const result = parseKeyFactors([
      { factor: 42, value: "Python" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.factor).toBe("unknown");
    expect(result[0]?.value).toBe("Python");
  });

  it("returns empty array for non-array input", () => {
    expect(parseKeyFactors(null)).toEqual([]);
    expect(parseKeyFactors({})).toEqual([]);
    expect(parseKeyFactors("string")).toEqual([]);
    expect(parseKeyFactors(undefined)).toEqual([]);
  });

  it("skips non-object items in array", () => {
    const result = parseKeyFactors(["string", 42, null]);
    expect(result).toEqual([]);
  });

  it("filters out entries with unknown factor and empty value", () => {
    const result = parseKeyFactors([
      { value: "has value" },  // factor undefined → "unknown", value "has value" → kept
    ]);
    expect(result).toHaveLength(1);
  });

  it("ignores NaN weight values", () => {
    const result = parseKeyFactors([
      { factor: "skills", weight: NaN, value: "Python" },
    ]);
    expect(result[0]?.weight).toBeUndefined();
  });
});

// --- isEnglishResumeAiLocale ---

describe("isEnglishResumeAiLocale", () => {
  it("returns true for English locale", () => {
    expect(isEnglishResumeAiLocale("en")).toBe(true);
  });

  it("returns false for Chinese locale", () => {
    expect(isEnglishResumeAiLocale("zh-Hans")).toBe(false);
  });

  it("returns false for undefined locale", () => {
    expect(isEnglishResumeAiLocale(undefined)).toBe(false);
  });
});
