import { describe, it, expect } from "vitest";
import {
  isRecord,
  toStringValue,
  toOptionalNumber,
  parseAgeFromContentField,
  bffMatchesResumeFilters,
} from "../bff-filter-utils.js";

// --- isRecord (bff-filter) ---

describe("isRecord (bff-filter)", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns true for arrays (no Array.isArray check)", () => {
    expect(isRecord([])).toBe(true);
  });

  it("returns false for primitives", () => {
    expect(isRecord("str")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

// --- toStringValue ---

describe("toStringValue", () => {
  it("returns trimmed string for string input", () => {
    expect(toStringValue("  hello  ")).toBe("hello");
  });

  it("returns empty string for null/undefined", () => {
    expect(toStringValue(null)).toBe("");
    expect(toStringValue(undefined)).toBe("");
  });

  it("converts non-string values", () => {
    expect(toStringValue(42)).toBe("42");
    expect(toStringValue(true)).toBe("true");
  });

  it("trims converted values", () => {
    // String(42) has no extra whitespace, but the trim is applied
    expect(toStringValue(42)).toBe("42");
  });
});

// --- toOptionalNumber ---

describe("toOptionalNumber", () => {
  it("returns number for finite values", () => {
    expect(toOptionalNumber(42)).toBe(42);
    expect(toOptionalNumber(0)).toBe(0);
  });

  it("parses numeric strings", () => {
    expect(toOptionalNumber("42")).toBe(42);
    expect(toOptionalNumber("  3.14  ")).toBe(3.14);
  });

  it("returns undefined for non-numeric strings", () => {
    expect(toOptionalNumber("abc")).toBeUndefined();
  });

  it("returns undefined for empty/whitespace strings", () => {
    expect(toOptionalNumber("")).toBeUndefined();
    expect(toOptionalNumber("   ")).toBeUndefined();
  });

  it("returns undefined for NaN and Infinity", () => {
    expect(toOptionalNumber(NaN)).toBeUndefined();
    expect(toOptionalNumber(Infinity)).toBeUndefined();
  });

  it("returns undefined for non-number/string types", () => {
    expect(toOptionalNumber(null)).toBeUndefined();
    expect(toOptionalNumber(undefined)).toBeUndefined();
    expect(toOptionalNumber(true)).toBeUndefined();
  });
});

// --- parseAgeFromContentField ---

describe("parseAgeFromContentField", () => {
  it("parses age from string with digits", () => {
    expect(parseAgeFromContentField({ age: "29岁" })).toBe(29);
    expect(parseAgeFromContentField({ age: "31" })).toBe(31);
  });

  it("parses first number from string", () => {
    expect(parseAgeFromContentField({ age: "Age: 25 years" })).toBe(25);
  });

  it("returns null for empty age", () => {
    expect(parseAgeFromContentField({ age: "" })).toBeNull();
    expect(parseAgeFromContentField({ age: "   " })).toBeNull();
  });

  it("returns null for missing age", () => {
    expect(parseAgeFromContentField({})).toBeNull();
  });

  it("handles numeric age via toStringValue conversion", () => {
    // toStringValue(29) → "29" → parseInt("29") → 29
    expect(parseAgeFromContentField({ age: 29 })).toBe(29);
  });

  it("returns null for string without digits", () => {
    expect(parseAgeFromContentField({ age: "unknown" })).toBeNull();
  });
});

// --- bffMatchesResumeFilters ---

describe("bffMatchesResumeFilters", () => {
  const baseDoc = {
    content: { experience: "5年" },
    source: "sample",
  };

  it("returns true when no filters are set", () => {
    expect(bffMatchesResumeFilters(baseDoc as any, "", {})).toBe(true);
  });

  it("excludes archived resumes when showArchived not set", () => {
    expect(bffMatchesResumeFilters(
      { ...baseDoc, isArchived: true } as any,
      "",
      {},
    )).toBe(false);
  });

  it("includes archived resumes when showArchived is true", () => {
    expect(bffMatchesResumeFilters(
      { ...baseDoc, isArchived: true } as any,
      "",
      { showArchived: true },
    )).toBe(true);
  });

  it("filters by minExperience", () => {
    expect(bffMatchesResumeFilters(baseDoc as any, "", { minExperience: 3 })).toBe(true);
    expect(bffMatchesResumeFilters(baseDoc as any, "", { minExperience: 10 })).toBe(false);
  });

  it("filters by maxExperience", () => {
    expect(bffMatchesResumeFilters(baseDoc as any, "", { maxExperience: 10 })).toBe(true);
    expect(bffMatchesResumeFilters(baseDoc as any, "", { maxExperience: 3 })).toBe(false);
  });

  it("filters by skills in searchText", () => {
    expect(bffMatchesResumeFilters(baseDoc as any, "cnc sales engineer", { skills: ["cnc"] })).toBe(true);
    expect(bffMatchesResumeFilters(baseDoc as any, "sales engineer", { skills: ["cnc"] })).toBe(false);
  });

  it("skills filter uses OR logic", () => {
    expect(bffMatchesResumeFilters(baseDoc as any, "cnc engineer", { skills: ["cnc", "java"] })).toBe(true);
  });

  it("filters by requiredKeywords (AND logic)", () => {
    expect(bffMatchesResumeFilters(baseDoc as any, "cnc sales engineer", { requiredKeywords: ["cnc", "sales"] })).toBe(true);
    expect(bffMatchesResumeFilters(baseDoc as any, "cnc engineer", { requiredKeywords: ["cnc", "sales"] })).toBe(false);
  });

  it("returns true for empty doc with no filters", () => {
    expect(bffMatchesResumeFilters({} as any, "", {})).toBe(true);
  });
});
