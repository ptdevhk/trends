/**
 * Tests for resume-ingest-utils.ts — shared ingest data parsing helpers.
 *
 * Covers toStringValue, toOptionalNumber, toStringArray, parseBrandHits,
 * parseRoleSignals, and buildResumeIngestData with systematic edge cases.
 */
import { describe, expect, it } from "vitest";
import {
  toStringValue,
  toOptionalNumber,
  toStringArray,
  parseBrandHits,
  parseRoleSignals,
  buildResumeIngestData,
} from "../services/resume-ingest-utils.js";

// ---------------------------------------------------------------------------
// toStringValue
// ---------------------------------------------------------------------------

describe("toStringValue", () => {
  it("returns trimmed string", () => {
    expect(toStringValue("  hello  ")).toBe("hello");
  });

  it("returns empty string for null", () => {
    expect(toStringValue(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(toStringValue(undefined)).toBe("");
  });

  it("converts numbers to trimmed string", () => {
    expect(toStringValue(42)).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// toOptionalNumber
// ---------------------------------------------------------------------------

describe("toOptionalNumber", () => {
  it("returns finite numbers as-is", () => {
    expect(toOptionalNumber(42)).toBe(42);
  });

  it("parses numeric strings", () => {
    expect(toOptionalNumber("3.14")).toBe(3.14);
  });

  it("returns undefined for non-numeric strings", () => {
    expect(toOptionalNumber("abc")).toBeUndefined();
  });

  it("returns undefined for empty strings", () => {
    expect(toOptionalNumber("  ")).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(toOptionalNumber(NaN)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(toOptionalNumber(Infinity)).toBeUndefined();
  });

  it("returns undefined for non-string non-number", () => {
    expect(toOptionalNumber({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toStringArray
// ---------------------------------------------------------------------------

describe("toStringArray", () => {
  it("maps string items and filters empty", () => {
    expect(toStringArray(["a", "  b  ", "", "c"])).toEqual(["a", "b", "c"]);
  });

  it("converts non-string items to strings", () => {
    expect(toStringArray([1, "b"])).toEqual(["1", "b"]);
  });

  it("returns empty array for non-array input", () => {
    expect(toStringArray("not an array")).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(toStringArray(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseBrandHits
// ---------------------------------------------------------------------------

describe("parseBrandHits", () => {
  it("parses valid brand hits", () => {
    const input = [
      { brand: "Siemens", role: "employer", source: "workHistory", context: "employer" },
    ];
    const result = parseBrandHits(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      brand: "Siemens",
      role: "employer",
      source: "workHistory",
      context: "employer",
    });
  });

  it("skips entries with missing required fields", () => {
    const input = [
      { brand: "Siemens", role: "employer" }, // missing source and context
    ];
    expect(parseBrandHits(input)).toEqual([]);
  });

  it("skips non-record entries", () => {
    expect(parseBrandHits(["not a record", 42])).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    expect(parseBrandHits(null)).toEqual([]);
  });

  it("parses equipment brand context", () => {
    const input = [
      { brand: "DMG Mori", role: "equipment", source: "workHistory", context: "equipment" },
    ];
    const result = parseBrandHits(input);
    expect(result[0]!.context).toBe("equipment");
  });
});

// ---------------------------------------------------------------------------
// parseRoleSignals
// ---------------------------------------------------------------------------

describe("parseRoleSignals", () => {
  it("parses valid role signals", () => {
    const input = [
      {
        type: "sales",
        years: 5,
        matchedSignals: ["key account"],
        signalCount: 1,
        occurrences: 3,
        industryVerifiedYears: 3,
        verifyIn: "searchText",
      },
    ];
    const result = parseRoleSignals(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("sales");
    expect(result[0]!.years).toBe(5);
    expect(result[0]!.verifyIn).toBe("searchText");
  });

  it("skips entries without type or years", () => {
    const input = [
      { type: "", years: 5 },
      { type: "sales", years: undefined },
    ];
    expect(parseRoleSignals(input)).toEqual([]);
  });

  it("defaults verifyIn to workHistory", () => {
    const input = [{ type: "operator", years: 3, verifyIn: "unknown" }];
    const result = parseRoleSignals(input);
    expect(result[0]!.verifyIn).toBe("workHistory");
  });

  it("defaults signalCount and occurrences to matchedSignals.length", () => {
    const input = [{
      type: "sales",
      years: 5,
      matchedSignals: ["a", "b"],
      verifyIn: "searchText",
    }];
    const result = parseRoleSignals(input);
    expect(result[0]!.signalCount).toBe(2);
    expect(result[0]!.occurrences).toBe(2);
  });

  it("parses matchedWorkEntries", () => {
    const input = [{
      type: "sales",
      years: 5,
      verifyIn: "workHistory",
      matchedWorkEntries: [
        { companyName: "Acme", jobTitle: "Manager", years: 3, industryVerified: true, matchedSignals: ["key account"] },
      ],
    }];
    const result = parseRoleSignals(input);
    expect(result[0]!.matchedWorkEntries).toHaveLength(1);
    expect(result[0]!.matchedWorkEntries![0]!.companyName).toBe("Acme");
  });

  it("returns empty array for non-array input", () => {
    expect(parseRoleSignals("not an array")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildResumeIngestData
// ---------------------------------------------------------------------------

describe("buildResumeIngestData", () => {
  it("returns undefined for non-record input", () => {
    expect(buildResumeIngestData(null)).toBeUndefined();
    expect(buildResumeIngestData("string")).toBeUndefined();
  });

  it("returns undefined for empty record", () => {
    expect(buildResumeIngestData({})).toBeUndefined();
  });

  it("parses industry tags", () => {
    const result = buildResumeIngestData({ industryTags: ["cnc", "machining"] });
    expect(result?.industryTags).toEqual(["cnc", "machining"]);
  });

  it("filters out unknown experience levels", () => {
    const result = buildResumeIngestData({ experienceLevel: "unknown" });
    expect(result?.experienceLevel).toBeUndefined();
  });

  it("preserves meaningful experience levels", () => {
    const result = buildResumeIngestData({ experienceLevel: "Senior" });
    expect(result?.experienceLevel).toBe("Senior");
  });

  it("parses ruleScores with numeric values only", () => {
    const result = buildResumeIngestData({
      ruleScores: { jd1: 85, jd2: "invalid", jd3: NaN },
    });
    expect(result?.ruleScores).toEqual({ jd1: 85 });
  });

  it("parses verifiedRoleYears with numeric values only", () => {
    const result = buildResumeIngestData({
      industryTags: ["test"], // needed so result is not undefined
      verifiedRoleYears: { sales: 5, marketing: "bad" },
    });
    expect(result?.verifiedRoleYears).toEqual({ sales: 5 });
  });

  it("includes computedAt and skillsVersion when present", () => {
    const result = buildResumeIngestData({
      industryTags: ["test"],
      computedAt: 1234567890,
      skillsVersion: 2,
    });
    expect(result?.computedAt).toBe(1234567890);
    expect(result?.skillsVersion).toBe(2);
  });

  it("includes market when present", () => {
    const result = buildResumeIngestData({ market: "CN" });
    expect(result?.market).toBe("CN");
  });
});
