/**
 * Tests for resumes-packets-helpers.ts — pure data parsing functions.
 *
 * Covers isRecord, toBrandRole, toBrandContext, parseBrandHits,
 * parseRoleSignals, buildResumeIngestData.
 */
import { describe, expect, it } from "vitest";
import {
  isRecord,
  toBrandRole,
  toBrandContext,
  parseBrandHits,
  parseRoleSignals,
  buildResumeIngestData,
} from "../routes/resumes-packets-helpers.js";

// ---------------------------------------------------------------------------
// isRecord
// ---------------------------------------------------------------------------

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([1, 2])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toBrandRole
// ---------------------------------------------------------------------------

describe("toBrandRole", () => {
  it("returns valid roles unchanged", () => {
    expect(toBrandRole("employer")).toBe("employer");
    expect(toBrandRole("equipment")).toBe("equipment");
    expect(toBrandRole("both")).toBe("both");
  });

  it("returns null for invalid values", () => {
    expect(toBrandRole("invalid")).toBeNull();
    expect(toBrandRole(null)).toBeNull();
    expect(toBrandRole(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toBrandContext
// ---------------------------------------------------------------------------

describe("toBrandContext", () => {
  it("returns valid contexts unchanged", () => {
    expect(toBrandContext("employer")).toBe("employer");
    expect(toBrandContext("equipment")).toBe("equipment");
    expect(toBrandContext("sales")).toBe("sales");
    expect(toBrandContext("technical")).toBe("technical");
    expect(toBrandContext("general")).toBe("general");
  });

  it("returns null for invalid values", () => {
    expect(toBrandContext("invalid")).toBeNull();
    expect(toBrandContext(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseBrandHits
// ---------------------------------------------------------------------------

describe("parseBrandHits", () => {
  it("parses valid brand hits", () => {
    const result = parseBrandHits([{
      brand: "Haas",
      role: "equipment",
      source: "workHistory",
      context: "technical",
    }]);
    expect(result).toEqual([{
      brand: "Haas",
      role: "equipment",
      source: "workHistory",
      context: "technical",
    }]);
  });

  it("filters out items with missing required fields", () => {
    expect(parseBrandHits([{ brand: "Haas", role: "equipment" }])).toEqual([]);
    expect(parseBrandHits([{ brand: "", role: "equipment", source: "workHistory", context: "general" }])).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    expect(parseBrandHits(null)).toEqual([]);
    expect(parseBrandHits("not array")).toEqual([]);
  });

  it("filters out non-record items in array", () => {
    expect(parseBrandHits([null, "string", 42])).toEqual([]);
  });

  it("handles multiple valid items", () => {
    const result = parseBrandHits([
      { brand: "DMG", role: "both", source: "selfIntro", context: "employer" },
      { brand: "Mazak", role: "equipment", source: "jobIntention", context: "sales" },
    ]);
    expect(result.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// parseRoleSignals
// ---------------------------------------------------------------------------

describe("parseRoleSignals", () => {
  it("parses a valid role signal with minimal fields", () => {
    const result = parseRoleSignals([{
      type: "cnc_operator",
      years: 5,
    }]);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("cnc_operator");
    expect(result[0].years).toBe(5);
    expect(result[0].verifyIn).toBe("workHistory");
  });

  it("parses role signal with all optional fields", () => {
    const result = parseRoleSignals([{
      type: "sales",
      years: 3,
      matchedSignals: ["sales_exec", "account_manager"],
      signalCount: 5,
      occurrences: 8,
      industryVerifiedYears: 2,
      roleRelevantYears: 3,
      industryVerifiedRelevantYears: 2,
      verifyIn: "searchText",
      matchedWorkEntries: [{
        companyName: "ABC Corp",
        jobTitle: "Sales Manager",
        years: 3,
        industryVerified: true,
        matchedSignals: ["sales_exec"],
      }],
    }]);
    expect(result.length).toBe(1);
    expect(result[0].matchedSignals).toEqual(["sales_exec", "account_manager"]);
    expect(result[0].signalCount).toBe(5);
    expect(result[0].occurrences).toBe(8);
    expect(result[0].industryVerifiedYears).toBe(2);
    expect(result[0].roleRelevantYears).toBe(3);
    expect(result[0].industryVerifiedRelevantYears).toBe(2);
    expect(result[0].verifyIn).toBe("searchText");
    expect(result[0].matchedWorkEntries?.length).toBe(1);
    expect(result[0].matchedWorkEntries?.[0].companyName).toBe("ABC Corp");
    expect(result[0].matchedWorkEntries?.[0].industryVerified).toBe(true);
  });

  it("defaults signalCount and occurrences to matchedSignals.length", () => {
    const result = parseRoleSignals([{
      type: "cnc_operator",
      years: 5,
      matchedSignals: ["a", "b", "c"],
    }]);
    expect(result[0].signalCount).toBe(3);
    expect(result[0].occurrences).toBe(3);
  });

  it("defaults industryVerifiedYears to 0", () => {
    const result = parseRoleSignals([{
      type: "cnc_operator",
      years: 5,
    }]);
    expect(result[0].industryVerifiedYears).toBe(0);
  });

  it("returns empty array for non-array input", () => {
    expect(parseRoleSignals(null)).toEqual([]);
    expect(parseRoleSignals("string")).toEqual([]);
  });

  it("filters items without type or years", () => {
    expect(parseRoleSignals([{ years: 5 }])).toEqual([]);
    expect(parseRoleSignals([{ type: "cnc" }])).toEqual([]);
  });

  it("defaults verifyIn to workHistory for unknown values", () => {
    const result = parseRoleSignals([{
      type: "cnc",
      years: 5,
      verifyIn: "unknown",
    }]);
    expect(result[0].verifyIn).toBe("workHistory");
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

  it("returns undefined for empty/meaningless record", () => {
    expect(buildResumeIngestData({})).toBeUndefined();
    expect(buildResumeIngestData({ industryTags: [] })).toBeUndefined();
  });

  it("parses ingestData with industryTags", () => {
    const result = buildResumeIngestData({ industryTags: ["cnc", "machining"] });
    expect(result).toBeDefined();
    expect(result?.industryTags).toEqual(["cnc", "machining"]);
  });

  it("parses ingestData with multiple fields", () => {
    const result = buildResumeIngestData({
      industryTags: ["cnc"],
      synonymHits: ["operator"],
      evidenceText: "7 years CNC experience",
      companyHits: ["ABC Corp"],
      market: "CN",
    });
    expect(result?.industryTags).toEqual(["cnc"]);
    expect(result?.synonymHits).toEqual(["operator"]);
    expect(result?.evidenceText).toBe("7 years CNC experience");
    expect(result?.companyHits).toEqual(["ABC Corp"]);
    expect(result?.market).toBe("CN");
  });

  it("filters out unknown experienceLevel", () => {
    const result = buildResumeIngestData({
      industryTags: ["cnc"],
      experienceLevel: "unknown",
    });
    expect(result?.experienceLevel).toBeUndefined();
  });

  it("keeps meaningful experienceLevel", () => {
    const result = buildResumeIngestData({
      industryTags: ["cnc"],
      experienceLevel: "Senior",
    });
    expect(result?.experienceLevel).toBe("Senior");
  });

  it("parses verifiedRoleYears with numeric values", () => {
    const result = buildResumeIngestData({
      industryTags: ["cnc"],
      verifiedRoleYears: { cnc: 5, sales: 3 },
    });
    expect(result?.verifiedRoleYears).toEqual({ cnc: 5, sales: 3 });
  });

  it("filters non-numeric values from verifiedRoleYears", () => {
    const result = buildResumeIngestData({
      industryTags: ["cnc"],
      verifiedRoleYears: { cnc: 5, invalid: "yes" },
    });
    expect(result?.verifiedRoleYears).toEqual({ cnc: 5 });
  });

  it("parses ruleScores with numeric values", () => {
    const result = buildResumeIngestData({
      industryTags: ["cnc"],
      ruleScores: { relevance: 0.8, quality: 0.9 },
    });
    expect(result?.ruleScores).toEqual({ relevance: 0.8, quality: 0.9 });
  });

  it("filters non-finite values from ruleScores", () => {
    const result = buildResumeIngestData({
      industryTags: ["cnc"],
      ruleScores: { relevance: 0.8, invalid: NaN, also: Infinity },
    });
    expect(result?.ruleScores).toEqual({ relevance: 0.8 });
  });
});
