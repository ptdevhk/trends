/**
 * Red tests for resume-score-semantics shared helpers.
 *
 * These tests define the contract before implementation:
 * - relatedExp=78 → contribution 39
 * - relatedExp=78, industryDb=40 → final AI score 79
 * - Invalid/missing values clamp safely
 * - Recommendation is derived from final AI score
 */
import { describe, expect, it } from "vitest";
import {
  applyMarketIndustryDbFloor,
  computeIndustryDbDirectHitScore,
  computeRelatedExpContribution,
  computeFinalAiScore,
  recommendationFromFinalAiScore,
  TH_INDUSTRY_DB_FLOOR,
  MY_INDUSTRY_DB_FLOOR,
  RELATED_EXP_DISPLAY_WEIGHT,
  INDUSTRY_DB_DISPLAY_CAP,
  INDUSTRY_DB_SINGLE_HIT_SCORE,
  summarizeNonEmployerBrandHits,
} from "./resume-score-semantics.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("constants", () => {
  it("RELATED_EXP_DISPLAY_WEIGHT is 0.5", () => {
    expect(RELATED_EXP_DISPLAY_WEIGHT).toBe(0.5);
  });

  it("INDUSTRY_DB_DISPLAY_CAP is 50", () => {
    expect(INDUSTRY_DB_DISPLAY_CAP).toBe(50);
  });

  it("INDUSTRY_DB_SINGLE_HIT_SCORE is 40", () => {
    expect(INDUSTRY_DB_SINGLE_HIT_SCORE).toBe(40);
  });

  it("MY_INDUSTRY_DB_FLOOR is 40", () => {
    expect(MY_INDUSTRY_DB_FLOOR).toBe(40);
  });

  it("TH_INDUSTRY_DB_FLOOR is 40", () => {
    expect(TH_INDUSTRY_DB_FLOOR).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// deterministic industry_db helpers
// ---------------------------------------------------------------------------
describe("computeIndustryDbDirectHitScore", () => {
  it("returns 40 for a brand-only hit", () => {
    expect(computeIndustryDbDirectHitScore(true, false)).toBe(40);
  });

  it("returns 40 for a company-only hit", () => {
    expect(computeIndustryDbDirectHitScore(false, true)).toBe(40);
  });

  it("returns 50 when both hit types exist", () => {
    expect(computeIndustryDbDirectHitScore(true, true)).toBe(50);
  });

  it("returns 0 when no hit exists", () => {
    expect(computeIndustryDbDirectHitScore(false, false)).toBe(0);
  });
});

describe("applyMarketIndustryDbFloor", () => {
  it("applies the MY floor when no hits exist", () => {
    expect(applyMarketIndustryDbFloor("MY", 0)).toBe(40);
  });

  it("applies the TH floor when no hits exist", () => {
    expect(applyMarketIndustryDbFloor("TH", 0)).toBe(40);
  });

  it("preserves the 50-point hit score for MY resumes", () => {
    expect(applyMarketIndustryDbFloor("MY", 50)).toBe(50);
  });

  it("leaves CN scores untouched", () => {
    expect(applyMarketIndustryDbFloor("CN", 0)).toBe(0);
  });
});

describe("summarizeNonEmployerBrandHits", () => {
  it("returns only non-employer brand names", () => {
    expect(summarizeNonEmployerBrandHits([
      { brand: "FANUC", context: "employer" },
      { brand: "STAR", context: "industry" },
      { brand: "OKK", context: "client" },
    ])).toEqual(["STAR", "OKK"]);
  });

  it("deduplicates empty or repeated brand hits", () => {
    expect(summarizeNonEmployerBrandHits([
      { brand: "STAR", context: "industry" },
      { brand: "STAR", context: "client" },
      { brand: " ", context: "industry" },
      null,
    ])).toEqual(["STAR"]);
  });
});

// ---------------------------------------------------------------------------
// computeRelatedExpContribution
// ---------------------------------------------------------------------------
describe("computeRelatedExpContribution", () => {
  it("relatedExp=78 → contribution 39", () => {
    expect(computeRelatedExpContribution(78)).toBe(39);
  });

  it("relatedExp=100 → contribution 50", () => {
    expect(computeRelatedExpContribution(100)).toBe(50);
  });

  it("relatedExp=0 → contribution 0", () => {
    expect(computeRelatedExpContribution(0)).toBe(0);
  });

  it("relatedExp=undefined → contribution 0 (safe clamp)", () => {
    expect(computeRelatedExpContribution(undefined)).toBe(0);
  });

  it("relatedExp=NaN → contribution 0 (safe clamp)", () => {
    expect(computeRelatedExpContribution(NaN)).toBe(0);
  });

  it("relatedExp negative → contribution 0 (clamped)", () => {
    expect(computeRelatedExpContribution(-10)).toBe(0);
  });

  it("relatedExp > 100 → still uses formula (caller clamps)", () => {
    // The helper rounds the input as-is; clamping is the caller's job
    expect(computeRelatedExpContribution(120)).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// computeFinalAiScore
// ---------------------------------------------------------------------------
describe("computeFinalAiScore", () => {
  it("relatedExp=78, industryDb=40 → final AI score 79", () => {
    expect(computeFinalAiScore(78, 40)).toBe(79);
  });

  it("relatedExp=100, industryDb=50 → final AI score 100", () => {
    expect(computeFinalAiScore(100, 50)).toBe(100);
  });

  it("relatedExp=0, industryDb=0 → final AI score 0", () => {
    expect(computeFinalAiScore(0, 0)).toBe(0);
  });

  it("relatedExp=undefined → contribution 0 + industryDb", () => {
    expect(computeFinalAiScore(undefined, 40)).toBe(40);
  });

  it("industryDb=undefined → contribution only", () => {
    expect(computeFinalAiScore(78, undefined)).toBe(39);
  });

  it("both undefined → 0", () => {
    expect(computeFinalAiScore(undefined, undefined)).toBe(0);
  });

  it("NaN inputs → 0 safe", () => {
    expect(computeFinalAiScore(NaN, NaN)).toBe(0);
  });

  it("caps at 100 even with high inputs", () => {
    expect(computeFinalAiScore(200, 50)).toBe(100);
  });

  it("floors at 0 even with negative inputs", () => {
    expect(computeFinalAiScore(-10, -5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// recommendationFromFinalAiScore
// ---------------------------------------------------------------------------
describe("recommendationFromFinalAiScore", () => {
  it("score >= 85 → strong_match", () => {
    expect(recommendationFromFinalAiScore(85)).toBe("strong_match");
    expect(recommendationFromFinalAiScore(100)).toBe("strong_match");
  });

  it("score >= 70 → match", () => {
    expect(recommendationFromFinalAiScore(70)).toBe("match");
    expect(recommendationFromFinalAiScore(84)).toBe("match");
  });

  it("score >= 40 → potential", () => {
    expect(recommendationFromFinalAiScore(40)).toBe("potential");
    expect(recommendationFromFinalAiScore(69)).toBe("potential");
  });

  it("score < 40 → no_match", () => {
    expect(recommendationFromFinalAiScore(39)).toBe("no_match");
    expect(recommendationFromFinalAiScore(0)).toBe("no_match");
  });

  it("score = 79 (relatedExp=78, industryDb=40) → match", () => {
    expect(recommendationFromFinalAiScore(79)).toBe("match");
  });
});
