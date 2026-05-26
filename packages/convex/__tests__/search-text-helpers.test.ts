import { describe, it, expect } from "vitest";
import { isRecord } from "@trends/shared";
import {
  normalizeWhitespace,
  addScriptBoundarySpaces,
  segmentChineseRuns,
  toNormalizedSearchTokens,
  toTextFragments,
} from "../convex/search_text.js";

// --- isRecord (search_text) ---

describe("isRecord (search_text)", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns true for arrays (no Array.isArray check)", () => {
    // This isRecord does NOT exclude arrays, matching the analyze.ts pattern
    expect(isRecord([])).toBe(true);
  });

  it("returns false for primitives", () => {
    expect(isRecord("str")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

// --- normalizeWhitespace ---

describe("normalizeWhitespace", () => {
  it("collapses multiple spaces into one", () => {
    expect(normalizeWhitespace("hello   world")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeWhitespace("  hello  ")).toBe("hello");
  });

  it("handles tabs and newlines", () => {
    expect(normalizeWhitespace("hello\t\nworld")).toBe("hello world");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeWhitespace("   ")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeWhitespace("")).toBe("");
  });
});

// --- addScriptBoundarySpaces ---

describe("addScriptBoundarySpaces", () => {
  it("adds space between CJK and Latin characters", () => {
    expect(addScriptBoundarySpaces("销售Sales")).toBe("销售 Sales");
    expect(addScriptBoundarySpaces("Sales销售")).toBe("Sales 销售");
  });

  it("leaves same-script text unchanged", () => {
    expect(addScriptBoundarySpaces("hello world")).toBe("hello world");
    expect(addScriptBoundarySpaces("你好世界")).toBe("你好世界");
  });

  it("adds spaces at multiple boundaries", () => {
    expect(addScriptBoundarySpaces("CNC机床销售Sales")).toBe("CNC 机床销售 Sales");
  });

  it("handles empty string", () => {
    expect(addScriptBoundarySpaces("")).toBe("");
  });
});

// --- segmentChineseRuns ---

describe("segmentChineseRuns", () => {
  it("segments long Chinese runs into words", () => {
    const result = segmentChineseRuns("机床行业销售经理");
    // Should contain the original run plus segmented words
    expect(result).toContain("机床行业销售经理");
  });

  it("leaves short Chinese text (under 3 chars) unchanged", () => {
    expect(segmentChineseRuns("你好")).toBe("你好");
  });

  it("leaves non-Chinese text unchanged", () => {
    expect(segmentChineseRuns("hello world")).toBe("hello world");
  });

  it("handles mixed content", () => {
    const result = segmentChineseRuns("销售经理 3年经验");
    expect(result).toContain("销售经理");
  });

  it("handles empty string", () => {
    expect(segmentChineseRuns("")).toBe("");
  });
});

// --- toNormalizedSearchTokens ---

describe("toNormalizedSearchTokens", () => {
  it("normalizes, deduplicates, and filters tokens", () => {
    const result = toNormalizedSearchTokens(["  CNC  ", "cnc", "  Sales  ", "A"]);
    expect(result).toEqual(["cnc", "sales"]);
  });

  it("filters out tokens shorter than 2 chars", () => {
    expect(toNormalizedSearchTokens(["A", "AB", "C"])).toEqual(["ab"]);
  });

  it("returns empty array for undefined input", () => {
    expect(toNormalizedSearchTokens(undefined)).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    expect(toNormalizedSearchTokens([])).toEqual([]);
  });

  it("lowercases all tokens", () => {
    expect(toNormalizedSearchTokens(["CNC", "Fanuc"])).toEqual(["cnc", "fanuc"]);
  });
});

// --- toTextFragments ---

describe("toTextFragments", () => {
  it("extracts string fragments", () => {
    expect(toTextFragments("hello")).toEqual(["hello"]);
  });

  it("normalizes whitespace in strings", () => {
    expect(toTextFragments("  hello   world  ")).toEqual(["hello world"]);
  });

  it("returns empty for empty/whitespace strings", () => {
    expect(toTextFragments("")).toEqual([]);
    expect(toTextFragments("   ")).toEqual([]);
  });

  it("converts numbers to strings", () => {
    expect(toTextFragments(42)).toEqual(["42"]);
    expect(toTextFragments(0)).toEqual(["0"]);
  });

  it("rejects NaN and Infinity", () => {
    expect(toTextFragments(NaN)).toEqual([]);
    expect(toTextFragments(Infinity)).toEqual([]);
  });

  it("converts booleans to strings", () => {
    expect(toTextFragments(true)).toEqual(["true"]);
    expect(toTextFragments(false)).toEqual(["false"]);
  });

  it("returns empty for null and undefined", () => {
    expect(toTextFragments(null)).toEqual([]);
    expect(toTextFragments(undefined)).toEqual([]);
  });

  it("recursively flattens arrays", () => {
    expect(toTextFragments(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("recursively extracts from nested objects (sorted keys)", () => {
    const result = toTextFragments({ b: "x", a: "y" });
    expect(result).toEqual(["y", "x"]); // keys sorted: a before b
  });

  it("handles deeply nested structures", () => {
    const result = toTextFragments({ items: ["a", { name: "b" }] });
    expect(result).toEqual(["a", "b"]);
  });

  it("returns empty for unsupported types", () => {
    expect(toTextFragments(() => {})).toEqual([]);
    expect(toTextFragments(Symbol("x"))).toEqual([]);
  });
});
