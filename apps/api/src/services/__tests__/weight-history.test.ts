import { describe, it, expect } from "vitest";
import {
  isFiniteNumber,
  parseCategoryWeights,
  parseEntry,
} from "../weight-history.js";

describe("isFiniteNumber", () => {
  it("returns true for finite numbers", () => {
    expect(isFiniteNumber(42)).toBe(true);
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1.5)).toBe(true);
  });

  it("returns false for NaN", () => {
    expect(isFiniteNumber(NaN)).toBe(false);
  });

  it("returns false for Infinity", () => {
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);
  });

  it("returns false for non-numbers", () => {
    expect(isFiniteNumber("42")).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
  });
});

describe("parseCategoryWeights", () => {
  const validWeights = {
    skillMatch: 0.3,
    roleMatch: 0.2,
    experienceMatch: 0.15,
    educationMatch: 0.1,
    locationMatch: 0.1,
    industryMatch: 0.1,
    brandRelevance: 0.05,
  };

  it("parses valid category weights", () => {
    const result = parseCategoryWeights(validWeights);
    expect(result).toEqual(validWeights);
  });

  it("returns null for non-object input", () => {
    expect(parseCategoryWeights(null)).toBeNull();
    expect(parseCategoryWeights("string")).toBeNull();
    expect(parseCategoryWeights(42)).toBeNull();
  });

  it("returns null when any weight is non-finite", () => {
    const withNaN = { ...validWeights, skillMatch: NaN };
    expect(parseCategoryWeights(withNaN)).toBeNull();

    const withInfinity = { ...validWeights, roleMatch: Infinity };
    expect(parseCategoryWeights(withInfinity)).toBeNull();
  });

  it("defaults missing weights to NaN, making result null", () => {
    const partial = { skillMatch: 0.3 };
    expect(parseCategoryWeights(partial)).toBeNull();
  });

  it("handles zero values as valid", () => {
    const allZero = {
      skillMatch: 0,
      roleMatch: 0,
      experienceMatch: 0,
      educationMatch: 0,
      locationMatch: 0,
      industryMatch: 0,
      brandRelevance: 0,
    };
    expect(parseCategoryWeights(allZero)).toEqual(allZero);
  });
});

describe("parseEntry", () => {
  const validEntry = {
    ts: "2026-05-25T10:00:00Z",
    reason: "auto-tune",
    before: {
      skillMatch: 0.3,
      roleMatch: 0.2,
      experienceMatch: 0.15,
      educationMatch: 0.1,
      locationMatch: 0.1,
      industryMatch: 0.1,
      brandRelevance: 0.05,
    },
    after: {
      skillMatch: 0.35,
      roleMatch: 0.2,
      experienceMatch: 0.15,
      educationMatch: 0.1,
      locationMatch: 0.1,
      industryMatch: 0.05,
      brandRelevance: 0.05,
    },
  };

  it("parses a valid entry", () => {
    const result = parseEntry(validEntry);
    expect(result).not.toBeNull();
    expect(result!.ts).toBe("2026-05-25T10:00:00Z");
    expect(result!.reason).toBe("auto-tune");
    expect(result!.before.skillMatch).toBe(0.3);
    expect(result!.after.skillMatch).toBe(0.35);
  });

  it("returns null for non-object input", () => {
    expect(parseEntry(null)).toBeNull();
    expect(parseEntry("string")).toBeNull();
  });

  it("returns null when ts is missing", () => {
    const noTs = { ...validEntry, ts: "" };
    expect(parseEntry(noTs)).toBeNull();
  });

  it("returns null when reason is missing", () => {
    const noReason = { ...validEntry, reason: "" };
    expect(parseEntry(noReason)).toBeNull();
  });

  it("returns null when before weights are invalid", () => {
    const invalidBefore = { ...validEntry, before: { skillMatch: NaN } };
    expect(parseEntry(invalidBefore)).toBeNull();
  });

  it("returns null when after weights are invalid", () => {
    const invalidAfter = { ...validEntry, after: { skillMatch: NaN } };
    expect(parseEntry(invalidAfter)).toBeNull();
  });

  it("parses entry with optional jobDescriptionId", () => {
    const withJd = { ...validEntry, jobDescriptionId: "jd_123" };
    const result = parseEntry(withJd);
    expect(result).not.toBeNull();
    expect(result!.jobDescriptionId).toBe("jd_123");
  });

  it("parses entry with optional metrics", () => {
    const withMetrics = {
      ...validEntry,
      metrics: {
        currentNdcgAtK: 0.5,
        projectedNdcgAtK: 0.6,
        currentShortlistAtK: 10,
        projectedShortlistAtK: 12,
      },
    };
    const result = parseEntry(withMetrics);
    expect(result).not.toBeNull();
    expect(result!.metrics?.currentNdcgAtK).toBe(0.5);
    expect(result!.metrics?.projectedNdcgAtK).toBe(0.6);
  });

  it("omits non-finite metric values", () => {
    const withBadMetrics = {
      ...validEntry,
      metrics: {
        currentNdcgAtK: 0.5,
        projectedNdcgAtK: NaN,
      },
    };
    const result = parseEntry(withBadMetrics);
    expect(result).not.toBeNull();
    expect(result!.metrics?.currentNdcgAtK).toBe(0.5);
    expect(result!.metrics?.projectedNdcgAtK).toBeUndefined();
  });

  it("omits metrics when not an object", () => {
    const withBadMetrics = { ...validEntry, metrics: "invalid" };
    const result = parseEntry(withBadMetrics);
    expect(result).not.toBeNull();
    expect(result!.metrics).toBeUndefined();
  });
});
