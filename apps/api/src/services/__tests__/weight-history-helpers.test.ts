import { describe, expect, it } from "vitest";

import { isFiniteNumber, parseCategoryWeights, parseEntry } from "../weight-history.js";

import type { RuleCategoryWeights } from "../rule-scoring.js";

const VALID_WEIGHTS: RuleCategoryWeights = {
  skillMatch: 15,
  roleMatch: 10,
  experienceMatch: 25,
  educationMatch: 15,
  locationMatch: 15,
  industryMatch: 10,
  brandRelevance: 10,
};

describe("isFiniteNumber", () => {
  it("returns true for finite numbers", () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(42)).toBe(true);
    expect(isFiniteNumber(-1.5)).toBe(true);
  });

  it("returns false for NaN and Infinity", () => {
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);
  });

  it("returns false for non-number types", () => {
    expect(isFiniteNumber("42")).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
    expect(isFiniteNumber(true)).toBe(false);
  });
});

describe("parseCategoryWeights", () => {
  it("parses valid category weights object", () => {
    const result = parseCategoryWeights(VALID_WEIGHTS);
    expect(result).toEqual(VALID_WEIGHTS);
  });

  it("returns null for non-object input", () => {
    expect(parseCategoryWeights(null)).toBeNull();
    expect(parseCategoryWeights(undefined)).toBeNull();
    expect(parseCategoryWeights("string")).toBeNull();
    expect(parseCategoryWeights(42)).toBeNull();
  });

  it("returns null when any weight is NaN", () => {
    const input = { ...VALID_WEIGHTS, skillMatch: NaN };
    expect(parseCategoryWeights(input)).toBeNull();
  });

  it("returns null when any weight is Infinity", () => {
    const input = { ...VALID_WEIGHTS, roleMatch: Infinity };
    expect(parseCategoryWeights(input)).toBeNull();
  });

  it("defaults missing weights to NaN, causing null result", () => {
    const input = { skillMatch: 15 };
    expect(parseCategoryWeights(input)).toBeNull();
  });

  it("defaults roleMatch to 0 when missing but still fails on other NaN fields", () => {
    const input = { skillMatch: 15, experienceMatch: 25 };
    // roleMatch defaults to 0 (valid), but educationMatch/locationMatch/industryMatch/brandRelevance default to NaN
    expect(parseCategoryWeights(input)).toBeNull();
  });
});

describe("parseEntry", () => {
  it("parses a valid history entry", () => {
    const input = {
      ts: "2026-02-25T00:00:00.000Z",
      reason: "auto_tune",
      jobDescriptionId: "jd-1",
      before: VALID_WEIGHTS,
      after: { ...VALID_WEIGHTS, skillMatch: 20 },
    };

    const result = parseEntry(input);
    expect(result).not.toBeNull();
    expect(result!.ts).toBe("2026-02-25T00:00:00.000Z");
    expect(result!.reason).toBe("auto_tune");
    expect(result!.jobDescriptionId).toBe("jd-1");
    expect(result!.after.skillMatch).toBe(20);
  });

  it("returns null for non-object input", () => {
    expect(parseEntry(null)).toBeNull();
    expect(parseEntry("string")).toBeNull();
  });

  it("returns null when ts is missing", () => {
    const input = { reason: "auto_tune", before: VALID_WEIGHTS, after: VALID_WEIGHTS };
    expect(parseEntry(input)).toBeNull();
  });

  it("returns null when reason is missing", () => {
    const input = { ts: "2026-01-01T00:00:00Z", before: VALID_WEIGHTS, after: VALID_WEIGHTS };
    expect(parseEntry(input)).toBeNull();
  });

  it("returns null when before weights are invalid", () => {
    const input = {
      ts: "2026-01-01T00:00:00Z",
      reason: "test",
      before: { skillMatch: NaN },
      after: VALID_WEIGHTS,
    };
    expect(parseEntry(input)).toBeNull();
  });

  it("returns null when after weights are invalid", () => {
    const input = {
      ts: "2026-01-01T00:00:00Z",
      reason: "test",
      before: VALID_WEIGHTS,
      after: { skillMatch: NaN },
    };
    expect(parseEntry(input)).toBeNull();
  });

  it("parses metrics when present and valid", () => {
    const input = {
      ts: "2026-01-01T00:00:00Z",
      reason: "auto_tune",
      before: VALID_WEIGHTS,
      after: VALID_WEIGHTS,
      metrics: {
        currentNdcgAtK: 0.52,
        projectedNdcgAtK: 0.58,
      },
    };

    const result = parseEntry(input);
    expect(result!.metrics).toEqual({
      currentNdcgAtK: 0.52,
      projectedNdcgAtK: 0.58,
      currentShortlistAtK: undefined,
      projectedShortlistAtK: undefined,
    });
  });

  it("omits metrics when not a record", () => {
    const input = {
      ts: "2026-01-01T00:00:00Z",
      reason: "auto_tune",
      before: VALID_WEIGHTS,
      after: VALID_WEIGHTS,
      metrics: "invalid",
    };

    const result = parseEntry(input);
    expect(result!.metrics).toBeUndefined();
  });

  it("sets jobDescriptionId to undefined when not a string", () => {
    const input = {
      ts: "2026-01-01T00:00:00Z",
      reason: "auto_tune",
      before: VALID_WEIGHTS,
      after: VALID_WEIGHTS,
      jobDescriptionId: 123,
    };

    const result = parseEntry(input);
    expect(result!.jobDescriptionId).toBeUndefined();
  });
});
