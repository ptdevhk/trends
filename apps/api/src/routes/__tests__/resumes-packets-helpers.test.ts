import { describe, expect, it } from "vitest";

import {
  isRecord,
  toStringValue,
  toOptionalNumber,
  toStringArray,
  toBrandRole,
  toBrandContext,
  parseBrandHits,
  parseRoleSignals,
  buildResumeIngestData,
} from "../resumes-packets-helpers.js";

// ---------------------------------------------------------------------------
// isRecord
// ---------------------------------------------------------------------------
describe("isRecord", () => {
  it("returns true for a plain object", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(Symbol("s"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toStringValue
// ---------------------------------------------------------------------------
describe("toStringValue", () => {
  it("trims strings", () => {
    expect(toStringValue("  hello  ")).toBe("hello");
    expect(toStringValue("hello")).toBe("hello");
    expect(toStringValue("")).toBe("");
    expect(toStringValue("  ")).toBe("");
  });

  it("converts null to empty string", () => {
    expect(toStringValue(null)).toBe("");
  });

  it("converts undefined to empty string", () => {
    expect(toStringValue(undefined)).toBe("");
  });

  it("converts numbers via String()", () => {
    expect(toStringValue(42)).toBe("42");
    expect(toStringValue(0)).toBe("0");
  });

  it("converts objects via String()", () => {
    expect(toStringValue({})).toBe("[object Object]");
  });

  it("converts booleans via String()", () => {
    expect(toStringValue(true)).toBe("true");
    expect(toStringValue(false)).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// toOptionalNumber
// ---------------------------------------------------------------------------
describe("toOptionalNumber", () => {
  it("returns finite numbers as-is", () => {
    expect(toOptionalNumber(42)).toBe(42);
    expect(toOptionalNumber(0)).toBe(0);
    expect(toOptionalNumber(-3.14)).toBe(-3.14);
  });

  it("returns undefined for Infinity and NaN", () => {
    expect(toOptionalNumber(Infinity)).toBeUndefined();
    expect(toOptionalNumber(-Infinity)).toBeUndefined();
    expect(toOptionalNumber(NaN)).toBeUndefined();
  });

  it("parses numeric strings", () => {
    expect(toOptionalNumber("42")).toBe(42);
    expect(toOptionalNumber("3.14")).toBe(3.14);
    expect(toOptionalNumber("0")).toBe(0);
  });

  it("returns undefined for empty strings", () => {
    expect(toOptionalNumber("")).toBeUndefined();
    expect(toOptionalNumber("  ")).toBeUndefined();
  });

  it("returns undefined for non-numeric strings", () => {
    expect(toOptionalNumber("abc")).toBeUndefined();
    expect(toOptionalNumber("12abc")).toBeUndefined();
  });

  it("returns undefined for non-string/non-number types", () => {
    expect(toOptionalNumber(null)).toBeUndefined();
    expect(toOptionalNumber(undefined)).toBeUndefined();
    expect(toOptionalNumber({})).toBeUndefined();
    expect(toOptionalNumber([])).toBeUndefined();
    expect(toOptionalNumber(true)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toStringArray
// ---------------------------------------------------------------------------
describe("toStringArray", () => {
  it("returns empty array for non-array input", () => {
    expect(toStringArray(null)).toEqual([]);
    expect(toStringArray(undefined)).toEqual([]);
    expect(toStringArray("hello")).toEqual([]);
    expect(toStringArray({})).toEqual([]);
  });

  it("maps elements through toStringValue and filters empty", () => {
    expect(toStringArray(["a", "b"])).toEqual(["a", "b"]);
    expect(toStringArray(["  a  ", "b"])).toEqual(["a", "b"]);
    expect(toStringArray(["a", null, "b", undefined])).toEqual(["a", "b"]);
    expect(toStringArray(["a", "", "b", "  "])).toEqual(["a", "b"]);
  });

  it("converts non-string elements to strings", () => {
    expect(toStringArray([1, 2, 3])).toEqual(["1", "2", "3"]);
    expect(toStringArray([true, false])).toEqual(["true", "false"]);
  });

  it("returns empty array for empty input array", () => {
    expect(toStringArray([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toBrandRole
// ---------------------------------------------------------------------------
describe("toBrandRole", () => {
  it('returns "employer" for "employer"', () => {
    expect(toBrandRole("employer")).toBe("employer");
  });

  it('returns "equipment" for "equipment"', () => {
    expect(toBrandRole("equipment")).toBe("equipment");
  });

  it('returns "both" for "both"', () => {
    expect(toBrandRole("both")).toBe("both");
  });

  it("returns null for invalid values", () => {
    expect(toBrandRole("invalid")).toBeNull();
    expect(toBrandRole("")).toBeNull();
    expect(toBrandRole(null)).toBeNull();
    expect(toBrandRole(undefined)).toBeNull();
    expect(toBrandRole(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toBrandContext
// ---------------------------------------------------------------------------
describe("toBrandContext", () => {
  it('returns "employer" for "employer"', () => {
    expect(toBrandContext("employer")).toBe("employer");
  });

  it('returns "equipment" for "equipment"', () => {
    expect(toBrandContext("equipment")).toBe("equipment");
  });

  it('returns "sales" for "sales"', () => {
    expect(toBrandContext("sales")).toBe("sales");
  });

  it('returns "technical" for "technical"', () => {
    expect(toBrandContext("technical")).toBe("technical");
  });

  it('returns "general" for "general"', () => {
    expect(toBrandContext("general")).toBe("general");
  });

  it("returns null for invalid values", () => {
    expect(toBrandContext("invalid")).toBeNull();
    expect(toBrandContext("")).toBeNull();
    expect(toBrandContext(null)).toBeNull();
    expect(toBrandContext(undefined)).toBeNull();
    expect(toBrandContext(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseBrandHits
// ---------------------------------------------------------------------------
describe("parseBrandHits", () => {
  it("returns empty array for non-array input", () => {
    expect(parseBrandHits(null)).toEqual([]);
    expect(parseBrandHits(undefined)).toEqual([]);
    expect(parseBrandHits({})).toEqual([]);
    expect(parseBrandHits("string")).toEqual([]);
  });

  it("returns empty array for empty array", () => {
    expect(parseBrandHits([])).toEqual([]);
  });

  it("parses valid brand hit objects", () => {
    const input = [
      {
        brand: "Company A",
        role: "employer",
        source: "workHistory",
        context: "sales",
      },
    ];
    const result = parseBrandHits(input);
    expect(result).toEqual([
      {
        brand: "Company A",
        role: "employer",
        source: "workHistory",
        context: "sales",
      },
    ]);
  });

  it("filters out items with invalid fields", () => {
    const input = [
      {
        brand: "Valid",
        role: "employer",
        source: "workHistory",
        context: "sales",
      },
      {
        brand: "",
        role: "employer",
        source: "workHistory",
        context: "sales",
      },
      {
        brand: "No Role",
        role: null,
        source: "workHistory",
        context: "sales",
      },
    ];
    const result = parseBrandHits(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.brand).toBe("Valid");
  });

  it("filters out non-object items", () => {
    const input = [
      { brand: "Valid", role: "employer", source: "workHistory", context: "sales" },
      null,
      "string",
      42,
    ];
    const result = parseBrandHits(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.brand).toBe("Valid");
  });

  it("trims brand strings", () => {
    const input = [
      {
        brand: "  Company B  ",
        role: "employer",
        source: "workHistory",
        context: "technical",
      },
    ];
    const result = parseBrandHits(input);
    expect(result[0]!.brand).toBe("Company B");
  });

  it("validates source enum values", () => {
    const input = [
      { brand: "A", role: "employer", source: "workHistory", context: "sales" },
      { brand: "B", role: "equipment", source: "selfIntro", context: "general" },
      { brand: "C", role: "both", source: "jobIntention", context: "employer" },
      { brand: "D", role: "employer", source: "invalidSource", context: "sales" },
    ];
    const result = parseBrandHits(input);
    expect(result).toHaveLength(3);
    expect(result.map((h) => h.brand)).toEqual(["A", "B", "C"]);
  });
});

// ---------------------------------------------------------------------------
// parseRoleSignals
// ---------------------------------------------------------------------------
describe("parseRoleSignals", () => {
  it("returns empty array for non-array input", () => {
    expect(parseRoleSignals(null)).toEqual([]);
    expect(parseRoleSignals(undefined)).toEqual([]);
    expect(parseRoleSignals({})).toEqual([]);
    expect(parseRoleSignals("string")).toEqual([]);
  });

  it("returns empty array for empty array", () => {
    expect(parseRoleSignals([])).toEqual([]);
  });

  it("parses valid role signal objects with defaults", () => {
    const input = [
      {
        type: "cnc operator",
        years: 5,
        matchedSignals: ["cnc", "machining"],
      },
    ];
    const result = parseRoleSignals(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("cnc operator");
    expect(result[0]!.years).toBe(5);
    // verifyIn defaults to "workHistory"
    expect(result[0]!.verifyIn).toBe("workHistory");
    // signalCount defaults to matchedSignals length
    expect(result[0]!.signalCount).toBe(2);
    // occurrences defaults to matchedSignals length
    expect(result[0]!.occurrences).toBe(2);
    // industryVerifiedYears defaults to 0
    expect(result[0]!.industryVerifiedYears).toBe(0);
    // roleRelevantYears/industryVerifiedRelevantYears are omitted when undefined
    expect(result[0]!.roleRelevantYears).toBeUndefined();
    expect(result[0]!.industryVerifiedRelevantYears).toBeUndefined();
  });

  it("uses actual signalCount and occurrences when provided", () => {
    const input = [
      {
        type: "sales manager",
        years: 8,
        matchedSignals: ["sales", "negotiation", "leadership"],
        signalCount: 10,
        occurrences: 15,
        industryVerifiedYears: 6,
        verifyIn: "searchText",
      },
    ];
    const result = parseRoleSignals(input);
    expect(result[0]!.signalCount).toBe(10);
    expect(result[0]!.occurrences).toBe(15);
    expect(result[0]!.industryVerifiedYears).toBe(6);
    expect(result[0]!.verifyIn).toBe("searchText");
  });

  it("filters out items without type", () => {
    const input = [
      { type: "valid", years: 3, matchedSignals: [] },
      { type: "", years: 3, matchedSignals: [] },
      { years: 3, matchedSignals: [] },
    ];
    expect(parseRoleSignals(input)).toHaveLength(1);
  });

  it("filters out items without valid years", () => {
    const input = [
      { type: "valid", years: 5, matchedSignals: [] },
      { type: "no years", matchedSignals: [] },
      { type: "nan", years: "abc", matchedSignals: [] },
    ];
    expect(parseRoleSignals(input)).toHaveLength(1);
  });

  it("includes roleRelevantYears and industryVerifiedRelevantYears when present", () => {
    const input = [
      {
        type: "engineer",
        years: 4,
        matchedSignals: ["engineering"],
        roleRelevantYears: 3,
        industryVerifiedRelevantYears: 2,
      },
    ];
    const result = parseRoleSignals(input);
    expect(result[0]!.roleRelevantYears).toBe(3);
    expect(result[0]!.industryVerifiedRelevantYears).toBe(2);
  });

  describe("matchedWorkEntries", () => {
    it("parses matchedWorkEntries correctly", () => {
      const input = [
        {
          type: "engineer",
          years: 5,
          matchedSignals: ["cad"],
          matchedWorkEntries: [
            {
              companyName: "ABC Corp",
              jobTitle: "Engineer",
              years: 3,
              industryVerified: true,
              matchedSignals: ["cad"],
            },
          ],
        },
      ];
      const result = parseRoleSignals(input);
      expect(result[0]!.matchedWorkEntries).toBeDefined();
      expect(result[0]!.matchedWorkEntries).toHaveLength(1);
      expect(result[0]!.matchedWorkEntries![0]!.companyName).toBe("ABC Corp");
      expect(result[0]!.matchedWorkEntries![0]!.years).toBe(3);
      expect(result[0]!.matchedWorkEntries![0]!.industryVerified).toBe(true);
    });

    it("omits matchedWorkEntries when empty", () => {
      const input = [
        {
          type: "engineer",
          years: 5,
          matchedSignals: ["cad"],
          matchedWorkEntries: [],
        },
      ];
      const result = parseRoleSignals(input);
      expect(result[0]!.matchedWorkEntries).toBeUndefined();
    });

    it("filters matchedWorkEntries with missing years", () => {
      const input = [
        {
          type: "engineer",
          years: 5,
          matchedSignals: ["cad"],
          matchedWorkEntries: [
            { companyName: "Valid", years: 3, industryVerified: true, matchedSignals: [] },
            { companyName: "No Years", industryVerified: true, matchedSignals: [] },
          ],
        },
      ];
      const result = parseRoleSignals(input);
      expect(result[0]!.matchedWorkEntries).toHaveLength(1);
      expect(result[0]!.matchedWorkEntries![0]!.companyName).toBe("Valid");
    });

    it("handles null matchedWorkEntries gracefully", () => {
      const input = [
        {
          type: "engineer",
          years: 5,
          matchedSignals: ["cad"],
          matchedWorkEntries: null,
        },
      ];
      const result = parseRoleSignals(input);
      expect(result[0]!.matchedWorkEntries).toBeUndefined();
    });
  });

  it("filters out non-object items", () => {
    const input = [
      { type: "valid", years: 3, matchedSignals: [] },
      null,
      "string",
    ];
    expect(parseRoleSignals(input)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildResumeIngestData
// ---------------------------------------------------------------------------
describe("buildResumeIngestData", () => {
  it("returns undefined for non-object input", () => {
    expect(buildResumeIngestData(null)).toBeUndefined();
    expect(buildResumeIngestData(undefined)).toBeUndefined();
    expect(buildResumeIngestData([])).toBeUndefined();
    expect(buildResumeIngestData("string")).toBeUndefined();
  });

  it("returns undefined when all fields are empty/absent", () => {
    expect(buildResumeIngestData({})).toBeUndefined();
  });

  it("builds full ingest data from provided fields", () => {
    const input = {
      industryTags: ["manufacturing", "automotive"],
      synonymHits: ["cnc"],
      evidenceText: "Has 5 years CNC experience",
      companyHits: ["Company A"],
      brandHits: [
        { brand: "BrandX", role: "employer", source: "workHistory", context: "sales" },
      ],
      roleSignals: [
        { type: "cnc operator", years: 5, matchedSignals: ["cnc"] },
      ],
      industryDbV2Raw: 3,
      experienceLevel: "senior",
      market: "MY",
      ruleScores: { relevance: 0.95, skills: 0.8 },
      computedAt: 1700000000000,
      skillsVersion: 42,
    };

    const result = buildResumeIngestData(input);

    expect(result).toBeDefined();
    expect(result!.industryTags).toEqual(["manufacturing", "automotive"]);
    expect(result!.synonymHits).toEqual(["cnc"]);
    expect(result!.evidenceText).toBe("Has 5 years CNC experience");
    expect(result!.companyHits).toEqual(["Company A"]);
    expect(result!.brandHits).toHaveLength(1);
    expect(result!.brandHits![0]!.brand).toBe("BrandX");
    expect(result!.roleSignals).toHaveLength(1);
    expect(result!.roleSignals![0]!.type).toBe("cnc operator");
    expect(result!.industryDbV2Raw).toBe(3);
    expect(result!.experienceLevel).toBe("senior");
    expect(result!.market).toBe("MY");
    expect(result!.ruleScores).toEqual({ relevance: 0.95, skills: 0.8 });
    expect(result!.computedAt).toBe(1700000000000);
    expect(result!.skillsVersion).toBe(42);
  });

  it('filters out experienceLevel "unknown"', () => {
    const input = {
      industryTags: ["tech"],
      experienceLevel: "unknown",
    };
    const result = buildResumeIngestData(input);
    expect(result!.experienceLevel).toBeUndefined();
  });

  it("filters non-finite values from ruleScores", () => {
    const input = {
      industryTags: ["tech"],
      ruleScores: { a: 1, b: NaN, c: Infinity },
    };
    const result = buildResumeIngestData(input);
    expect(result!.ruleScores).toEqual({ a: 1 });
  });

  it("omits ruleScores when empty after filtering", () => {
    const input = {
      industryTags: ["tech"],
      ruleScores: { a: NaN },
    };
    const result = buildResumeIngestData(input);
    expect(result!.ruleScores).toBeUndefined();
  });

  it("parses verifiedRoleYears correctly", () => {
    const input = {
      industryTags: ["tech"],
      verifiedRoleYears: { "sales manager": 5, "cnc operator": 3 },
    };
    const result = buildResumeIngestData(input);
    expect(result!.verifiedRoleYears).toEqual({ "sales manager": 5, "cnc operator": 3 });
  });

  it("filters NaN values from verifiedRoleYears", () => {
    const input = {
      industryTags: ["tech"],
      verifiedRoleYears: { "sales manager": 5, invalid: NaN },
    };
    const result = buildResumeIngestData(input);
    expect(result!.verifiedRoleYears).toEqual({ "sales manager": 5 });
  });

  it("omits verifiedRoleYears when empty", () => {
    const input = {
      industryTags: ["tech"],
      verifiedRoleYears: { invalid: NaN },
    };
    const result = buildResumeIngestData(input);
    expect(result!.verifiedRoleYears).toBeUndefined();
  });

  it("handles computedAt and skillsVersion correctly", () => {
    const result1 = buildResumeIngestData({ industryTags: ["tech"], computedAt: 1000 });
    expect(result1!.computedAt).toBe(1000);

    const result2 = buildResumeIngestData({ industryTags: ["tech"], skillsVersion: 5 });
    expect(result2!.skillsVersion).toBe(5);
  });

  it("returns undefined when only optional numeric fields are set to 0", () => {
    // 0 is finite so industryDbV2Raw would be set, making it non-empty
    const input = { industryDbV2Raw: 0 };
    const result = buildResumeIngestData(input);
    expect(result).toBeDefined();
    expect(result!.industryDbV2Raw).toBe(0);
  });

  it("trims evidenceText", () => {
    const input = { industryTags: ["tech"], evidenceText: "  some evidence  " };
    const result = buildResumeIngestData(input);
    expect(result!.evidenceText).toBe("some evidence");
  });

  it("trims companyHits values", () => {
    const input = { companyHits: ["  Company A  ", "Company B"] };
    const result = buildResumeIngestData(input);
    expect(result!.companyHits).toEqual(["Company A", "Company B"]);
  });
});
