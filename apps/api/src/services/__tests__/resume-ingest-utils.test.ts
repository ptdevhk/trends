import { describe, expect, it } from "vitest";
import {
  buildResumeIngestData,
  parseBrandHits,
  parseRoleSignals,
  toStringArray,
  toStringValue,
  toOptionalNumber,
} from "../resume-ingest-utils.js";

describe("resume-ingest-utils", () => {
  // ── toStringValue ──────────────────────────────────────────────────────
  describe("toStringValue", () => {
    it("trims string values", () => {
      expect(toStringValue("  hello  ")).toBe("hello");
    });

    it("returns empty string for null", () => {
      expect(toStringValue(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(toStringValue(undefined)).toBe("");
    });

    it("converts numbers to trimmed strings", () => {
      expect(toStringValue(42)).toBe("42");
    });

    it("converts objects to trimmed strings", () => {
      expect(toStringValue({})).toBe("[object Object]");
    });
  });

  // ── toOptionalNumber ───────────────────────────────────────────────────
  describe("toOptionalNumber", () => {
    it("returns finite numbers as-is", () => {
      expect(toOptionalNumber(5)).toBe(5);
      expect(toOptionalNumber(0)).toBe(0);
      expect(toOptionalNumber(-3)).toBe(-3);
    });

    it("returns undefined for Infinity", () => {
      expect(toOptionalNumber(Infinity)).toBeUndefined();
    });

    it("parses numeric strings", () => {
      expect(toOptionalNumber("10")).toBe(10);
      expect(toOptionalNumber(" 5 ")).toBe(5);
    });

    it("returns undefined for empty or non-numeric strings", () => {
      expect(toOptionalNumber("")).toBeUndefined();
      expect(toOptionalNumber("abc")).toBeUndefined();
    });

    it("returns undefined for null and undefined", () => {
      expect(toOptionalNumber(null)).toBeUndefined();
      expect(toOptionalNumber(undefined)).toBeUndefined();
    });
  });

  // ── toStringArray ──────────────────────────────────────────────────────
  describe("toStringArray", () => {
    it("converts string array to trimmed values", () => {
      expect(toStringArray(["  a  ", "b", "c"])).toEqual(["a", "b", "c"]);
    });

    it("returns empty array for null and undefined", () => {
      expect(toStringArray(null)).toEqual([]);
      expect(toStringArray(undefined)).toEqual([]);
    });

    it("returns empty array for non-array values", () => {
      expect(toStringArray("string")).toEqual([]);
      expect(toStringArray(42)).toEqual([]);
      expect(toStringArray({})).toEqual([]);
    });

    it("filters out empty strings and converts mixed types", () => {
      expect(toStringArray(["good", "", null, "  ", undefined, 42])).toEqual(["good", "42"]);
    });
  });

  // ── parseBrandHits ─────────────────────────────────────────────────────
  describe("parseBrandHits", () => {
    it("parses valid BrandHit items", () => {
      const result = parseBrandHits([
        { brand: "Google", role: "employer", source: "workHistory", context: "technical" },
        { brand: "Meta", role: "both", source: "selfIntro", context: "general" },
      ]);
      expect(result).toEqual([
        { brand: "Google", role: "employer", source: "workHistory", context: "technical" },
        { brand: "Meta", role: "both", source: "selfIntro", context: "general" },
      ]);
    });

    it("skips items with missing or empty brand", () => {
      const result = parseBrandHits([
        { brand: "", role: "employer", source: "workHistory", context: "technical" },
        { brand: null, role: "employer", source: "workHistory", context: "general" },
      ]);
      expect(result).toEqual([]);
    });

    it("skips items with invalid role, source, or context", () => {
      const result = parseBrandHits([
        { brand: "Acme", role: "invalid", source: "workHistory", context: "technical" },
        { brand: "Acme", role: "employer", source: "unknown", context: "general" },
        { brand: "Acme", role: "employer", source: "workHistory", context: "bogus" },
      ]);
      expect(result).toEqual([]);
    });

    it("returns empty array for non-array input", () => {
      expect(parseBrandHits(null)).toEqual([]);
      expect(parseBrandHits(undefined)).toEqual([]);
      expect(parseBrandHits("string")).toEqual([]);
    });

    it("skips non-record items in array (isRecord excludes arrays)", () => {
      // isRecord in this file excludes arrays via !Array.isArray
      const result = parseBrandHits([
        null,
        undefined,
        42,
        ["nested", "array"],
      ]);
      expect(result).toEqual([]);
    });

    it("accepts all valid enum values for role, source, and context", () => {
      const result = parseBrandHits([
        { brand: "A", role: "employer", source: "workHistory", context: "employer" },
        { brand: "B", role: "equipment", source: "jobIntention", context: "equipment" },
        { brand: "C", role: "both", source: "selfIntro", context: "sales" },
        { brand: "D", role: "employer", source: "workHistory", context: "technical" },
        { brand: "E", role: "employer", source: "workHistory", context: "general" },
      ]);
      expect(result).toHaveLength(5);
    });
  });

  // ── parseRoleSignals ────────────────────────────────────────────────────
  describe("parseRoleSignals", () => {
    it("parses valid RoleSignalSummary items", () => {
      const result = parseRoleSignals([
        { type: "engineer", years: 3, matchedSignals: ["react", "typescript"] },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("engineer");
      expect(result[0].years).toBe(3);
      expect(result[0].matchedSignals).toEqual(["react", "typescript"]);
      // Defaults for optional counts
      expect(result[0].signalCount).toBe(2);
      expect(result[0].occurrences).toBe(2);
      expect(result[0].industryVerifiedYears).toBe(0);
      expect(result[0].verifyIn).toBe("workHistory");
    });

    it("skips items with missing type or years", () => {
      const result = parseRoleSignals([
        { type: "", years: 3 },
        { years: 3 },
        { type: "engineer", years: undefined },
      ]);
      expect(result).toEqual([]);
    });

    it("returns empty array for non-array input", () => {
      expect(parseRoleSignals(null)).toEqual([]);
      expect(parseRoleSignals(undefined)).toEqual([]);
    });

    it("skips non-record items in array (isRecord excludes arrays)", () => {
      const result = parseRoleSignals([
        null,
        "string",
        ["engineer", 3],
      ]);
      expect(result).toEqual([]);
    });

    it("parses matchedWorkEntries when present", () => {
      const result = parseRoleSignals([
        {
          type: "engineer",
          years: 5,
          matchedWorkEntries: [
            { companyName: "Google", jobTitle: "SWE", years: 3, industryVerified: true, matchedSignals: ["react"] },
            { years: 2, industryVerified: false, matchedSignals: [] },
          ],
        },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].matchedWorkEntries).toHaveLength(2);
      expect(result[0].matchedWorkEntries![0]).toEqual({
        companyName: "Google",
        jobTitle: "SWE",
        years: 3,
        industryVerified: true,
        matchedSignals: ["react"],
      });
      expect(result[0].matchedWorkEntries![1]).toEqual({
        years: 2,
        industryVerified: false,
        matchedSignals: [],
      });
    });

    it("passes through optional fields when provided", () => {
      const result = parseRoleSignals([
        {
          type: "engineer",
          years: 3,
          signalCount: 10,
          occurrences: 8,
          industryVerifiedYears: 2,
          verifyIn: "searchText",
        },
      ]);
      expect(result[0].signalCount).toBe(10);
      expect(result[0].occurrences).toBe(8);
      expect(result[0].industryVerifiedYears).toBe(2);
      expect(result[0].verifyIn).toBe("searchText");
    });

    it("includes roleRelevantYears and industryVerifiedRelevantYears when present", () => {
      const result = parseRoleSignals([
        {
          type: "engineer",
          years: 3,
          roleRelevantYears: 2,
          industryVerifiedRelevantYears: 1,
        },
      ]);
      expect(result[0].roleRelevantYears).toBe(2);
      expect(result[0].industryVerifiedRelevantYears).toBe(1);
    });

    it("excludes roleRelevantYears when not provided (undefined)", () => {
      const result = parseRoleSignals([
        { type: "engineer", years: 3 },
      ]);
      expect(result[0].roleRelevantYears).toBeUndefined();
      expect(result[0].industryVerifiedRelevantYears).toBeUndefined();
    });

    it("skips matchedWorkEntry records whose years are undefined", () => {
      const result = parseRoleSignals([
        {
          type: "engineer",
          years: 3,
          matchedWorkEntries: [
            { companyName: "Google", years: undefined, industryVerified: true, matchedSignals: [] },
          ],
        },
      ]);
      // The entry with undefined years should be filtered out
      expect(result[0].matchedWorkEntries).toBeUndefined();
    });
  });

  // ── buildResumeIngestData ──────────────────────────────────────────────
  describe("buildResumeIngestData", () => {
    it("parses machineOrigin and survives the emptiness guard as a lone field", () => {
      expect(buildResumeIngestData({ machineOrigin: "international" })).toEqual({ machineOrigin: "international" });
      expect(buildResumeIngestData({ machineOrigin: "bogus" })).toBeUndefined();
      const full = buildResumeIngestData({ industryTags: ["cnc"], machineOrigin: "domestic" });
      expect(full).toMatchObject({ industryTags: ["cnc"], machineOrigin: "domestic" });
    });

    it("returns undefined for null and undefined input", () => {
      expect(buildResumeIngestData(null)).toBeUndefined();
      expect(buildResumeIngestData(undefined)).toBeUndefined();
    });

    it("returns undefined for non-record input (including arrays, since isRecord excludes arrays)", () => {
      expect(buildResumeIngestData("string")).toBeUndefined();
      expect(buildResumeIngestData(42)).toBeUndefined();
      expect(buildResumeIngestData([1, 2, 3])).toBeUndefined();
    });

    it("builds complete ingestData from full input", () => {
      const input = {
        industryTags: ["tech", "finance"],
        synonymHits: ["software"],
        evidenceText: "Strong background",
        companyHits: ["Google", "Meta"],
        brandHits: [
          { brand: "Google", role: "employer", source: "workHistory", context: "technical" },
        ],
        roleSignals: [
          { type: "engineer", years: 3, matchedSignals: ["react"] },
        ],
        industryDbV2Raw: 42,
        experienceLevel: "Senior",
        verifiedRoleYears: { engineer: 3, manager: 1 },
        ruleScores: { scoreA: 0.8, scoreB: 0.5 },
        market: "US",
        computedAt: 1234567890,
        skillsVersion: 2,
      };

      const result = buildResumeIngestData(input);
      expect(result).toBeDefined();
      expect(result!.industryTags).toEqual(["tech", "finance"]);
      expect(result!.companyHits).toEqual(["Google", "Meta"]);
      expect(result!.brandHits).toHaveLength(1);
      expect(result!.roleSignals).toHaveLength(1);
      expect(result!.industryDbV2Raw).toBe(42);
      expect(result!.experienceLevel).toBe("Senior");
      expect(result!.verifiedRoleYears).toEqual({ engineer: 3, manager: 1 });
      expect(result!.ruleScores).toEqual({ scoreA: 0.8, scoreB: 0.5 });
      expect(result!.market).toBe("US");
      expect(result!.computedAt).toBe(1234567890);
      expect(result!.skillsVersion).toBe(2);
    });

    it("returns undefined when all fields are empty or absent", () => {
      const result = buildResumeIngestData({});
      expect(result).toBeUndefined();
    });

    it("returns undefined when all arrays are empty and no optional fields present", () => {
      const result = buildResumeIngestData({
        industryTags: [],
        synonymHits: [],
        companyHits: [],
        brandHits: [],
        roleSignals: [],
      });
      expect(result).toBeUndefined();
    });

    it("filters out non-numeric values from ruleScores", () => {
      const result = buildResumeIngestData({
        ruleScores: { good: 0.8, bad: "string", nan: NaN, infinity: Infinity },
      });
      expect(result).toBeDefined();
      expect(result!.ruleScores).toEqual({ good: 0.8 });
    });

    it("filters non-numeric values from verifiedRoleYears", () => {
      const result = buildResumeIngestData({
        roleSignals: [{ type: "engineer", years: 3 }],
        verifiedRoleYears: { engineer: 3, manager: "unknown", director: NaN },
      });
      expect(result!.verifiedRoleYears).toEqual({ engineer: 3 });
    });

    it("excludes experienceLevel when 'unknown'", () => {
      const result = buildResumeIngestData({
        roleSignals: [{ type: "engineer", years: 3 }],
        experienceLevel: "Unknown",
      });
      expect(result!.experienceLevel).toBeUndefined();
    });

    it("includes experienceLevel when meaningful and case-insensitive unknown check works", () => {
      // Normalized: "Senior" → "senior", not "unknown"
      const result = buildResumeIngestData({
        roleSignals: [{ type: "engineer", years: 3 }],
        experienceLevel: "Senior",
      });
      expect(result!.experienceLevel).toBe("Senior");
    });

    it("omits optional fields not present in input", () => {
      const result = buildResumeIngestData({
        roleSignals: [{ type: "engineer", years: 3 }],
      });
      expect(result!.industryTags).toBeUndefined();
      expect(result!.synonymHits).toBeUndefined();
      expect(result!.evidenceText).toBeUndefined();
      expect(result!.companyHits).toBeUndefined();
      expect(result!.brandHits).toBeUndefined();
      expect(result!.industryDbV2Raw).toBeUndefined();
      expect(result!.experienceLevel).toBeUndefined();
      expect(result!.verifiedRoleYears).toBeUndefined();
      expect(result!.ruleScores).toBeUndefined();
      expect(result!.market).toBeUndefined();
      expect(result!.computedAt).toBeUndefined();
      expect(result!.skillsVersion).toBeUndefined();
    });
  });
});
