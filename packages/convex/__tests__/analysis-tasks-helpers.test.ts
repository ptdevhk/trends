import { describe, it, expect } from "vitest";
import {
  isObject,
  toNumber,
  toStringArray,
  parseBreakdown,
  unwrapLlmResult,
  parseLlmResult,
  extractKeywords,
  normalizeKeywords,
  stableHash,
  buildAnalysisDispatchJobKey,
  buildAnalysisDispatchIdempotencyKey,
} from "../convex/analysis_tasks.js";

// --- isObject ---

describe("isObject (analysis_tasks)", () => {
  it("returns true for plain objects", () => {
    expect(isObject({})).toBe(true);
  });

  it("returns false for null", () => {
    expect(isObject(null)).toBe(false);
  });

  it("returns true for arrays (typeof === 'object')", () => {
    expect(isObject([])).toBe(true);
  });

  it("returns false for primitives", () => {
    expect(isObject("str")).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });
});

// --- toNumber (analysis_tasks) ---

describe("toNumber (analysis_tasks)", () => {
  it("returns number for finite values", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-3.5)).toBe(-3.5);
  });

  it("parses numeric strings", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber("3.14")).toBe(3.14);
  });

  it("parses English word numbers", () => {
    expect(toNumber("seventy")).toBe(70);
    expect(toNumber("eighty")).toBe(80);
    expect(toNumber("hundred")).toBe(100);
  });

  it("parses compound word numbers", () => {
    expect(toNumber("seventy-five")).toBe(75);
    expect(toNumber("eighty five")).toBe(85);
  });

  it("returns null for non-numeric strings", () => {
    expect(toNumber("abc")).toBeNull();
  });

  it("returns null for NaN and Infinity", () => {
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });

  it("returns null for non-number/string types", () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

// --- toStringArray ---

describe("toStringArray", () => {
  it("filters to string elements", () => {
    expect(toStringArray(["a", 42, "b", null])).toEqual(["a", "b"]);
  });

  it("returns empty array for non-array input", () => {
    expect(toStringArray(null)).toEqual([]);
    expect(toStringArray({})).toEqual([]);
    expect(toStringArray("string")).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    expect(toStringArray([])).toEqual([]);
  });
});

// --- parseBreakdown ---

describe("parseBreakdown", () => {
  it("parses numeric values from object", () => {
    expect(parseBreakdown({ related_exp: 80, industry_db: 50 })).toEqual({
      related_exp: 80,
      industry_db: 50,
    });
  });

  it("parses numeric string values", () => {
    expect(parseBreakdown({ related_exp: "80" })).toEqual({ related_exp: 80 });
  });

  it("parses word number values", () => {
    expect(parseBreakdown({ related_exp: "seventy" })).toEqual({ related_exp: 70 });
  });

  it("returns undefined for non-object input", () => {
    expect(parseBreakdown(null)).toBeUndefined();
    expect(parseBreakdown(42)).toBeUndefined();
  });

  it("returns undefined when all values are non-numeric", () => {
    expect(parseBreakdown({ label: "high" })).toBeUndefined();
  });
});

// --- unwrapLlmResult ---

describe("unwrapLlmResult", () => {
  it("returns object with top-level score", () => {
    const result = unwrapLlmResult({ score: 80, summary: "Good" });
    expect(result).toEqual({ score: 80, summary: "Good" });
  });

  it("unwraps 'result' wrapper", () => {
    const result = unwrapLlmResult({ result: { score: 75 } });
    expect(result).toEqual({ score: 75 });
  });

  it("unwraps 'data' wrapper", () => {
    const result = unwrapLlmResult({ data: { score: 60 } });
    expect(result).toEqual({ score: 60 });
  });

  it("scans one level for object with score", () => {
    const result = unwrapLlmResult({ custom: { score: 90 }, other: "x" });
    expect(result).toEqual({ score: 90 });
  });

  it("returns null for object without score", () => {
    expect(unwrapLlmResult({ summary: "No score" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(unwrapLlmResult(null)).toBeNull();
    expect(unwrapLlmResult(42)).toBeNull();
  });
});

// --- parseLlmResult ---

describe("parseLlmResult", () => {
  it("parses a complete result", () => {
    const result = parseLlmResult({ score: 80, summary: "Good", recommendation: "match" });
    expect(result.score).toBe(80);
    expect(result.summary).toBe("Good");
    expect(result.recommendation).toBe("match");
  });

  it("unwraps nested result", () => {
    const result = parseLlmResult({ result: { score: 70 } });
    expect(result.score).toBe(70);
  });

  it("defaults summary when missing", () => {
    const result = parseLlmResult({ score: 50 });
    expect(result.summary).toBe("No summary provided.");
  });

  it("defaults recommendation to 'potential'", () => {
    const result = parseLlmResult({ score: 50 });
    expect(result.recommendation).toBe("potential");
  });

  it("parses word number score", () => {
    const result = parseLlmResult({ score: "eighty" });
    expect(result.score).toBe(80);
  });

  it("throws for missing score", () => {
    expect(() => parseLlmResult({})).toThrow();
  });

  it("throws for non-numeric score", () => {
    expect(() => parseLlmResult({ score: "abc" })).toThrow();
  });

  it("filters highlights to strings", () => {
    const result = parseLlmResult({ score: 50, highlights: ["good", 42] });
    expect(result.highlights).toEqual(["good"]);
  });
});

// --- extractKeywords ---

describe("extractKeywords", () => {
  it("extracts lowercase alphanumeric keywords of 2+ chars", () => {
    expect(extractKeywords("CNC machine tools 销售经验")).toEqual(
      expect.arrayContaining(["cnc", "machine", "tools", "销售经验"])
    );
  });

  it("filters single characters", () => {
    expect(extractKeywords("a big test")).toEqual(
      expect.arrayContaining(["big", "test"])
    );
  });

  it("deduplicates", () => {
    const result = extractKeywords("cnc cnc cnc");
    expect(result).toEqual(["cnc"]);
  });

  it("returns empty for empty string", () => {
    expect(extractKeywords("")).toEqual([]);
  });
});

// --- normalizeKeywords ---

describe("normalizeKeywords", () => {
  it("trims, lowercases, and deduplicates", () => {
    expect(normalizeKeywords(["  CNC  ", "cnc", "Fanuc"])).toEqual(["cnc", "fanuc"]);
  });

  it("filters out empty strings after trimming", () => {
    expect(normalizeKeywords(["", "  ", "valid"])).toEqual(["valid"]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeKeywords([])).toEqual([]);
  });
});

// --- stableHash ---

describe("stableHash", () => {
  it("returns hex string", () => {
    expect(stableHash("test")).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic", () => {
    expect(stableHash("test")).toBe(stableHash("test"));
  });

  it("returns different values for different inputs", () => {
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });

  it("handles empty string", () => {
    expect(typeof stableHash("")).toBe("string");
  });
});

// --- buildAnalysisDispatchJobKey ---

describe("buildAnalysisDispatchJobKey", () => {
  it("uses JD ID when available", () => {
    const result = buildAnalysisDispatchJobKey({
      derivedJobDescriptionId: "jd123",
      resumeIds: [],
    });
    expect(result).toContain("job:jd123");
    expect(result).toContain("prompt:");
  });

  it("uses keywords when no JD ID", () => {
    const result = buildAnalysisDispatchJobKey({
      keywords: ["cnc", "sales"],
      resumeIds: [],
    });
    expect(result).toContain("keywords:");
  });

  it("uses JD title/content hash when no keywords", () => {
    const result = buildAnalysisDispatchJobKey({
      jobDescriptionTitle: "Sales Manager",
      jobDescriptionContent: "Requirements...",
      resumeIds: [],
    });
    expect(result).toContain("job-content:");
  });

  it("defaults to 'default' when nothing provided", () => {
    const result = buildAnalysisDispatchJobKey({
      resumeIds: [],
    });
    expect(result).toContain("job:default:");
  });
});

// --- buildAnalysisDispatchIdempotencyKey ---

describe("buildAnalysisDispatchIdempotencyKey", () => {
  it("combines job key with resume hash", () => {
    const result = buildAnalysisDispatchIdempotencyKey({
      derivedJobDescriptionId: "jd1",
      resumeIds: ["r1", "r2"],
    });
    expect(result).toContain("job:jd1");
    expect(result).toContain(":resumes:");
  });

  it("sorts and deduplicates resume IDs", () => {
    const key1 = buildAnalysisDispatchIdempotencyKey({
      derivedJobDescriptionId: "jd1",
      resumeIds: ["r2", "r1"],
    });
    const key2 = buildAnalysisDispatchIdempotencyKey({
      derivedJobDescriptionId: "jd1",
      resumeIds: ["r1", "r2"],
    });
    expect(key1).toBe(key2);
  });
});
