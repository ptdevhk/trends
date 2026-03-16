import { describe, expect, it } from "vitest";

import {
  bumpIndustryDbV2Raw,
  clampIndustryDbV2RawScore,
  computeBatchStats,
  computeEffectiveIndustryDbV2Raw,
  normalizeIndustryDbScore,
} from "./industry-db-batch-stats.js";

describe("industry-db-batch-stats", () => {
  it("computes deterministic batch statistics and histogram buckets", () => {
    const stats = computeBatchStats([-5, 10, 20, 20, 60]);

    expect(stats).toEqual({
      size: 5,
      min: 0,
      max: 50,
      p50: 20,
      p80: 26,
      mean: 20,
      stddev: 16.73,
      histogram50: Array.from({ length: 51 }, (_, index) => {
        if (index === 0) return 1;
        if (index === 10) return 1;
        if (index === 20) return 2;
        if (index === 50) return 1;
        return 0;
      }),
    });
  });

  it("mirrors the UI normalization formula for strong cohorts", () => {
    const normalized = normalizeIndustryDbScore(25, {
      size: 50,
      p80: 20,
      histogram50: Array.from({ length: 51 }, (_, index) => {
        if (index === 20) return 40;
        if (index === 25) return 10;
        return 0;
      }),
      min: 0,
      max: 25,
      p50: 20,
      mean: 21,
      stddev: 2,
    });

    expect(normalized.normalized).toBe(45);
    expect(normalized.guardRailApplied).toBe(false);
    expect(normalized.percentileRank).toBeGreaterThan(0.8);
  });

  it("falls back to raw score when cohort guard rails are not met", () => {
    expect(normalizeIndustryDbScore(12, {
      size: 10,
      p80: 12,
      histogram50: Array.from({ length: 51 }, () => 0),
    })).toEqual({
      raw: 12,
      normalized: 12,
      percentileRank: 0,
      guardRailApplied: true,
    });
  });

  it("normalizes sparse batches using non-zero p80 for meaningful discrimination", () => {
    const histogram50 = Array.from({ length: 51 }, (_, i) => {
      if (i === 0) return 77;
      if (i === 6) return 1;
      if (i === 8) return 3;
      if (i === 10) return 1;
      if (i === 12) return 1;
      if (i === 20) return 1;
      if (i === 30) return 1;
      return 0;
    });
    const stats = { size: 85, p80: 0, histogram50 };

    const zero = normalizeIndustryDbScore(0, stats);
    expect(zero.normalized).toBe(0);
    expect(zero.guardRailApplied).toBe(false);

    const six = normalizeIndustryDbScore(6, stats);
    expect(six.normalized).toBe(20);
    expect(six.guardRailApplied).toBe(false);

    const thirty = normalizeIndustryDbScore(30, stats);
    expect(thirty.normalized).toBe(50);
    expect(thirty.normalized - six.normalized).toBeGreaterThan(20);
  });

  it("bumps raw score to section max when brand or company hits are present", () => {
    expect(bumpIndustryDbV2Raw(5, true, false)).toBe(30);
    expect(bumpIndustryDbV2Raw(5, false, true)).toBe(20);
    expect(bumpIndustryDbV2Raw(5, true, true)).toBe(50);
    expect(bumpIndustryDbV2Raw(40, true, false)).toBe(40);
    expect(bumpIndustryDbV2Raw(undefined, true, true)).toBe(50);
    expect(bumpIndustryDbV2Raw(0, false, false)).toBe(0);
  });

  it("derives effective raw from ingest data shape", () => {
    expect(computeEffectiveIndustryDbV2Raw({ brandHits: [{}], companyHits: [], industryDbV2Raw: 5 })).toBe(30);
    expect(computeEffectiveIndustryDbV2Raw({ brandHits: [], companyHits: ['star'], industryDbV2Raw: 5 })).toBe(20);
    expect(computeEffectiveIndustryDbV2Raw({ brandHits: [{}], companyHits: ['star'], industryDbV2Raw: 5 })).toBe(50);
    expect(computeEffectiveIndustryDbV2Raw({ brandHits: [], companyHits: [], industryDbV2Raw: 25 })).toBe(25);
    expect(computeEffectiveIndustryDbV2Raw(undefined)).toBe(0);
    expect(computeEffectiveIndustryDbV2Raw(null)).toBe(0);
  });

  it("ignores employer-context brand hits when computing the bump", () => {
    // employer-only brandHits → only company bump applies
    expect(computeEffectiveIndustryDbV2Raw({
      brandHits: [{ brand: "fanuc", role: "employer", source: "workHistory", context: "employer" }],
      companyHits: ["fanuc"],
      industryDbV2Raw: 5,
    })).toBe(20);
    // employer brandHit + no companyHits → no bump
    expect(computeEffectiveIndustryDbV2Raw({
      brandHits: [{ brand: "fanuc", role: "employer", source: "workHistory", context: "employer" }],
      companyHits: [],
      industryDbV2Raw: 5,
    })).toBe(5);
    // mixed: employer + non-employer brandHit → brand bump applies
    expect(computeEffectiveIndustryDbV2Raw({
      brandHits: [
        { brand: "fanuc", role: "employer", source: "workHistory", context: "employer" },
        { brand: "fanuc", role: "equipment", source: "selfIntro", context: "equipment" },
      ],
      companyHits: ["fanuc"],
      industryDbV2Raw: 5,
    })).toBe(50);
  });

  it("coerces invalid raw inputs to the supported score range", () => {
    expect(clampIndustryDbV2RawScore(undefined)).toBe(0);
    expect(clampIndustryDbV2RawScore(Number.NaN)).toBe(0);
    expect(clampIndustryDbV2RawScore(-3)).toBe(0);
    expect(clampIndustryDbV2RawScore(88)).toBe(50);
  });
});
