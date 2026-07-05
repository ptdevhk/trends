import { afterEach, describe, it, expect, vi } from "vitest";
import { logger } from "../logger.js";
import {
  toStringArray,
  normalizeIngestBrandHits,
  normalizeMatchedWorkEntries,
  normalizeRoleSignals,
  normalizeIngestData,
  countOccurrences,
  inferResumeSource,
  matchesAllRequiredKeywords,
} from "../resume-service.js";

vi.mock("../logger.js", () => ({
  logger: {
    error: vi.fn(),
  },
}));

afterEach(() => {
  vi.mocked(logger.error).mockClear();
});

// --- toStringArray ---

describe("toStringArray", () => {
  it("returns string array from string array", () => {
    expect(toStringArray(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("trims and filters empty strings", () => {
    expect(toStringArray(["  a  ", "", "  ", "b"])).toEqual(["a", "b"]);
  });

  it("converts non-string items to strings", () => {
    expect(toStringArray([42, true, "hello"])).toEqual(["42", "true", "hello"]);
  });

  it("returns empty array for non-array input", () => {
    expect(toStringArray("hello")).toEqual([]);
    expect(toStringArray(42)).toEqual([]);
    expect(toStringArray(null)).toEqual([]);
    expect(toStringArray(undefined)).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    expect(toStringArray([])).toEqual([]);
  });
});

// --- normalizeIngestBrandHits ---

describe("normalizeIngestBrandHits", () => {
  it("returns undefined for non-array input", () => {
    expect(normalizeIngestBrandHits("string")).toBeUndefined();
    expect(normalizeIngestBrandHits(42)).toBeUndefined();
    expect(normalizeIngestBrandHits(null)).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(normalizeIngestBrandHits([])).toBeUndefined();
  });

  it("normalizes valid brand hit objects", () => {
    const result = normalizeIngestBrandHits([
      { brand: "Haas", role: "Sales Engineer", source: "resume", context: "work history", companyId: 123 },
    ]);
    expect(result).toEqual([
      { brand: "Haas", role: "Sales Engineer", source: "resume", context: "work history", companyId: 123 },
    ]);
  });

  it("omits companyId when undefined", () => {
    const result = normalizeIngestBrandHits([
      { brand: "DMG", role: "CNC Operator", source: "resume", context: "experience" },
    ]);
    expect(result).toEqual([
      { brand: "DMG", role: "CNC Operator", source: "resume", context: "experience" },
    ]);
  });

  it("filters out entries missing required fields", () => {
    const result = normalizeIngestBrandHits([
      { brand: "Haas", role: "Sales", source: "resume", context: "work" },
      { brand: "", role: "Sales", source: "resume", context: "work" },
      { brand: "DMG", role: "", source: "resume", context: "work" },
    ]);
    expect(result).toEqual([
      { brand: "Haas", role: "Sales", source: "resume", context: "work" },
    ]);
  });

  it("filters out non-record entries", () => {
    const result = normalizeIngestBrandHits([
      "not an object",
      42,
      { brand: "Haas", role: "Sales", source: "resume", context: "work" },
    ]);
    expect(result).toEqual([
      { brand: "Haas", role: "Sales", source: "resume", context: "work" },
    ]);
  });

  it("returns undefined when all entries are invalid", () => {
    expect(normalizeIngestBrandHits([{ brand: "" }])).toBeUndefined();
  });
});

// --- normalizeMatchedWorkEntries ---

describe("normalizeMatchedWorkEntries", () => {
  it("returns undefined for non-array input", () => {
    expect(normalizeMatchedWorkEntries({})).toBeUndefined();
    expect(normalizeMatchedWorkEntries("string")).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(normalizeMatchedWorkEntries([])).toBeUndefined();
  });

  it("normalizes valid matched work entries", () => {
    const result = normalizeMatchedWorkEntries([
      { years: 5, companyName: "ABC Corp", jobTitle: "Engineer", industryVerified: true, matchedSignals: ["CNC"] },
    ]);
    expect(result).toEqual([
      { companyName: "ABC Corp", jobTitle: "Engineer", years: 5, industryVerified: true, matchedSignals: ["CNC"] },
    ]);
  });

  it("requires years field — filters out entries without it", () => {
    const result = normalizeMatchedWorkEntries([
      { companyName: "ABC Corp" },
      { years: 3, companyName: "XYZ Ltd" },
    ]);
    expect(result).toEqual([
      { companyName: "XYZ Ltd", years: 3, industryVerified: false, matchedSignals: [] },
    ]);
  });

  it("omits companyName and jobTitle when empty", () => {
    const result = normalizeMatchedWorkEntries([
      { years: 5 },
    ]);
    expect(result).toEqual([
      { years: 5, industryVerified: false, matchedSignals: [] },
    ]);
  });

  it("defaults industryVerified to false", () => {
    const result = normalizeMatchedWorkEntries([
      { years: 5, companyName: "Corp" },
    ]);
    expect(result?.[0]?.industryVerified).toBe(false);
  });

  it("includes directRoleMatch when boolean", () => {
    const result = normalizeMatchedWorkEntries([
      { years: 5, directRoleMatch: true },
    ]);
    expect(result?.[0]?.directRoleMatch).toBe(true);
  });

  it("omits directRoleMatch when not boolean", () => {
    const result = normalizeMatchedWorkEntries([
      { years: 5, directRoleMatch: "yes" },
    ]);
    expect(result?.[0]?.directRoleMatch).toBeUndefined();
  });
});

// --- normalizeRoleSignals ---

describe("normalizeRoleSignals", () => {
  it("returns undefined for non-array input", () => {
    expect(normalizeRoleSignals({})).toBeUndefined();
    expect(normalizeRoleSignals("string")).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(normalizeRoleSignals([])).toBeUndefined();
  });

  it("normalizes valid role signals", () => {
    const result = normalizeRoleSignals([
      { type: "Sales Engineer", years: 5, matchedSignals: ["CNC", "Machine Tools"] },
    ]);
    expect(result).toEqual([
      {
        type: "Sales Engineer",
        matchedSignals: ["CNC", "Machine Tools"],
        signalCount: 2,
        occurrences: 2,
        years: 5,
        verifyIn: "workHistory",
      },
    ]);
  });

  it("requires type and years — filters out incomplete entries", () => {
    const result = normalizeRoleSignals([
      { type: "Sales Engineer" },
      { years: 5 },
      { type: "Engineer", years: 3, matchedSignals: [] },
    ]);
    expect(result).toEqual([
      {
        type: "Engineer",
        matchedSignals: [],
        signalCount: 0,
        occurrences: 0,
        years: 3,
        verifyIn: "workHistory",
      },
    ]);
  });

  it("uses signalCount from input when provided", () => {
    const result = normalizeRoleSignals([
      { type: "CNC Operator", years: 3, matchedSignals: ["CNC"], signalCount: 10 },
    ]);
    expect(result?.[0]?.signalCount).toBe(10);
  });

  it("falls back to matchedSignals.length for signalCount", () => {
    const result = normalizeRoleSignals([
      { type: "CNC Operator", years: 3, matchedSignals: ["CNC", "Lathe"] },
    ]);
    expect(result?.[0]?.signalCount).toBe(2);
  });

  it("includes optional years fields when provided", () => {
    const result = normalizeRoleSignals([
      {
        type: "Sales",
        years: 5,
        matchedSignals: [],
        industryVerifiedYears: 3,
        roleRelevantYears: 4,
        industryVerifiedRelevantYears: 2,
      },
    ]);
    expect(result?.[0]?.industryVerifiedYears).toBe(3);
    expect(result?.[0]?.roleRelevantYears).toBe(4);
    expect(result?.[0]?.industryVerifiedRelevantYears).toBe(2);
  });

  it("defaults verifyIn to workHistory", () => {
    const result = normalizeRoleSignals([
      { type: "Sales", years: 5, matchedSignals: [] },
    ]);
    expect(result?.[0]?.verifyIn).toBe("workHistory");
  });

  it("uses verifyIn from input when provided", () => {
    const result = normalizeRoleSignals([
      { type: "Sales", years: 5, matchedSignals: [], verifyIn: "profile" },
    ]);
    expect(result?.[0]?.verifyIn).toBe("profile");
  });

  it("includes nested matchedWorkEntries", () => {
    const result = normalizeRoleSignals([
      {
        type: "Sales",
        years: 5,
        matchedSignals: [],
        matchedWorkEntries: [{ years: 5, companyName: "Corp" }],
      },
    ]);
    expect(result?.[0]?.matchedWorkEntries).toEqual([
      { companyName: "Corp", years: 5, industryVerified: false, matchedSignals: [] },
    ]);
  });
});

// --- normalizeIngestData ---

describe("normalizeIngestData", () => {
  it("returns undefined for non-record input", () => {
    expect(normalizeIngestData("string")).toBeUndefined();
    expect(normalizeIngestData(42)).toBeUndefined();
    expect(normalizeIngestData(null)).toBeUndefined();
  });

  it("returns undefined when all fields are empty", () => {
    expect(normalizeIngestData({})).toBeUndefined();
    expect(normalizeIngestData({ industryTags: [] })).toBeUndefined();
    expect(normalizeIngestData({ companyHits: [] })).toBeUndefined();
  });

  it("normalizes ingest data with industry tags", () => {
    const result = normalizeIngestData({ industryTags: ["CNC", "Sales"] });
    expect(result).toEqual({ industryTags: ["CNC", "Sales"] });
  });

  it("includes market when present", () => {
    const result = normalizeIngestData({ industryTags: ["CNC"], market: "CN" });
    expect(result).toEqual({ industryTags: ["CNC"], market: "CN" });
  });

  it("excludes empty market", () => {
    const result = normalizeIngestData({ industryTags: ["CNC"], market: "" });
    expect(result).toEqual({ industryTags: ["CNC"] });
  });

  it("includes ruleScores when non-empty record", () => {
    const result = normalizeIngestData({ industryTags: ["CNC"], ruleScores: { cnc: 85 } });
    expect(result).toEqual({ industryTags: ["CNC"], ruleScores: { cnc: 85 } });
  });

  it("excludes empty ruleScores", () => {
    const result = normalizeIngestData({ industryTags: ["CNC"], ruleScores: {} });
    expect(result).toEqual({ industryTags: ["CNC"] });
  });

  it("includes brand hits", () => {
    const result = normalizeIngestData({
      brandHits: [{ brand: "Haas", role: "Sales", source: "resume", context: "work" }],
    });
    expect(result?.brandHits).toEqual([
      { brand: "Haas", role: "Sales", source: "resume", context: "work" },
    ]);
  });

  it("includes company hits", () => {
    const result = normalizeIngestData({ companyHits: ["Haas", "DMG"] });
    expect(result).toEqual({ companyHits: ["Haas", "DMG"] });
  });

  it("includes role signals", () => {
    const result = normalizeIngestData({
      roleSignals: [{ type: "Sales", years: 5, matchedSignals: [] }],
    });
    expect(result?.roleSignals).toBeDefined();
    expect(result?.roleSignals?.[0]?.type).toBe("Sales");
  });
});

// --- countOccurrences ---

describe("countOccurrences", () => {
  it("counts non-overlapping occurrences", () => {
    expect(countOccurrences("abcabc", "abc")).toBe(2);
  });

  it("uses non-overlapping search", () => {
    expect(countOccurrences("aaa", "aa")).toBe(1);
  });

  it("returns 0 for empty needle", () => {
    expect(countOccurrences("hello", "")).toBe(0);
  });

  it("returns 0 when needle not found", () => {
    expect(countOccurrences("hello world", "xyz")).toBe(0);
  });

  it("returns 1 for single occurrence", () => {
    expect(countOccurrences("hello world", "world")).toBe(1);
  });

  it("counts occurrences in empty haystack", () => {
    expect(countOccurrences("", "a")).toBe(0);
  });

  it("is case-sensitive", () => {
    expect(countOccurrences("Hello hello", "hello")).toBe(1);
  });
});

// --- inferResumeSource ---

describe("inferResumeSource", () => {
  it("returns sourceHost when present", () => {
    expect(inferResumeSource({ sourceHost: "HR.JOB5156.COM" })).toBe("hr.job5156.com");
  });

  it("extracts hostname from sourceUrl", () => {
    expect(inferResumeSource({ sourceUrl: "https://www.seek.com.my/jobs" })).toBe("www.seek.com.my");
  });

  it("falls back to sourceKey mapping for job5156", () => {
    expect(inferResumeSource({ sourceKey: "job5156" })).toBe("hr.job5156.com");
  });

  it("falls back to sourceKey mapping for seek", () => {
    expect(inferResumeSource({ sourceKey: "seek" })).toBe("seek");
  });

  it("falls back to sourceKey mapping for 51job", () => {
    expect(inferResumeSource({ sourceKey: "51job" })).toBe("ehire.51job.com");
  });

  it("returns undefined for unrecognized sourceKey", () => {
    expect(inferResumeSource({ sourceKey: "unknown" })).toBeUndefined();
  });

  it("returns undefined when no metadata", () => {
    expect(inferResumeSource(undefined)).toBeUndefined();
  });

  it("returns undefined when metadata is empty object", () => {
    expect(inferResumeSource({})).toBeUndefined();
  });

  it("prioritizes sourceHost over sourceUrl", () => {
    expect(inferResumeSource({
      sourceHost: "custom.host.com",
      sourceUrl: "https://other.host.com/page",
    })).toBe("custom.host.com");
  });

  it("handles invalid URL gracefully", () => {
    expect(inferResumeSource({ sourceUrl: "not-a-url" })).toBeUndefined();
  });

  it("logs invalid sourceUrl before falling back to sourceKey", () => {
    expect(inferResumeSource({ sourceUrl: "not a valid url", sourceKey: "seek" })).toBe("seek");
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to parse resume source URL",
      expect.any(Error),
      { service: "resume-service", sourceUrl: "not a valid url" },
    );
  });
});

// --- matchesAllRequiredKeywords ---

describe("matchesAllRequiredKeywords", () => {
  it("returns true for empty requiredKeywords", () => {
    expect(matchesAllRequiredKeywords("hello world", undefined)).toBe(true);
    expect(matchesAllRequiredKeywords("hello world", [])).toBe(true);
  });

  it("returns true when all keywords are present", () => {
    expect(matchesAllRequiredKeywords("CNC sales engineer", ["CNC", "sales"])).toBe(true);
  });

  it("returns false when a keyword is missing", () => {
    expect(matchesAllRequiredKeywords("CNC engineer", ["CNC", "sales"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesAllRequiredKeywords("cnc SALES engineer", ["CNC", "sales"])).toBe(true);
  });

  it("returns false for empty text with required keywords", () => {
    expect(matchesAllRequiredKeywords("", ["CNC"])).toBe(false);
  });

  it("returns false for whitespace-only text with required keywords", () => {
    expect(matchesAllRequiredKeywords("   ", ["CNC"])).toBe(false);
  });

  it("deduplicates keywords before checking", () => {
    expect(matchesAllRequiredKeywords("CNC", ["CNC", "cnc"])).toBe(true);
  });

  it("filters empty keywords", () => {
    expect(matchesAllRequiredKeywords("hello", ["", "hello"])).toBe(true);
  });
});
