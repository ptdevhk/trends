import { describe, expect, it } from "vitest";

import {
  normalizeKeywordPhrases,
  inferKeywordQueryMode,
  parseKeywordQuery,
  formatKeywordQuery,
  formatKeywordInput,
  type KeywordQueryMode,
} from "../keyword-query.js";

// ---------------------------------------------------------------------------
// normalizeKeywordPhrases
// ---------------------------------------------------------------------------

describe("normalizeKeywordPhrases", () => {
  it("trims whitespace from keywords", () => {
    expect(normalizeKeywordPhrases(["  AI  ", " Python "])).toEqual(["AI", "Python"]);
  });

  it("collapses internal whitespace", () => {
    expect(normalizeKeywordPhrases(["machine   learning"])).toEqual(["machine learning"]);
  });

  it("removes empty strings", () => {
    expect(normalizeKeywordPhrases(["AI", "", "  ", "Python"])).toEqual(["AI", "Python"]);
  });

  it("deduplicates case-insensitively (keeps first occurrence)", () => {
    expect(normalizeKeywordPhrases(["AI", "ai", "Ai"])).toEqual(["AI"]);
  });

  it("returns empty array for all-empty input", () => {
    expect(normalizeKeywordPhrases(["", "  "])).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeKeywordPhrases([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// inferKeywordQueryMode
// ---------------------------------------------------------------------------

describe("inferKeywordQueryMode", () => {
  it("returns AND for single keyword", () => {
    expect(inferKeywordQueryMode(["AI"])).toBe("AND");
  });

  it("returns AND for multiple single-word keywords", () => {
    expect(inferKeywordQueryMode(["AI", "Python"])).toBe("AND");
  });

  it("returns OR when any keyword contains a space (multi-word phrase)", () => {
    expect(inferKeywordQueryMode(["machine learning", "AI"])).toBe("OR");
  });

  it("returns AND for empty input", () => {
    expect(inferKeywordQueryMode([])).toBe("AND");
  });

  it("returns OR when there are multiple keywords and one is multi-word", () => {
    expect(inferKeywordQueryMode(["data science", "engineer", "manager"])).toBe("OR");
  });
});

// ---------------------------------------------------------------------------
// parseKeywordQuery
// ---------------------------------------------------------------------------

describe("parseKeywordQuery", () => {
  it("parses empty string", () => {
    expect(parseKeywordQuery("")).toEqual({ keywords: [], mode: "AND" });
  });

  it("parses whitespace-only string", () => {
    expect(parseKeywordQuery("   ")).toEqual({ keywords: [], mode: "AND" });
  });

  it("parses single keyword", () => {
    expect(parseKeywordQuery("AI")).toEqual({ keywords: ["AI"], mode: "AND" });
  });

  it("parses space-separated keywords as AND", () => {
    const result = parseKeywordQuery("AI Python");
    expect(result.keywords).toEqual(["AI", "Python"]);
    expect(result.mode).toBe("AND");
  });

  it("parses OR operator", () => {
    const result = parseKeywordQuery("AI OR Python");
    expect(result.keywords).toEqual(["AI", "Python"]);
    expect(result.mode).toBe("OR");
  });

  it("parses case-insensitive OR operator", () => {
    const result = parseKeywordQuery("AI or Python");
    expect(result.keywords).toEqual(["AI", "Python"]);
    expect(result.mode).toBe("OR");
  });

  it("parses quoted phrase as single keyword", () => {
    const result = parseKeywordQuery('"machine learning"');
    expect(result.keywords).toEqual(["machine learning"]);
  });

  it("parses mixed quoted and unquoted keywords", () => {
    const result = parseKeywordQuery('"machine learning" Python');
    expect(result.keywords).toEqual(["machine learning", "Python"]);
  });

  it("parses comma-separated keywords", () => {
    const result = parseKeywordQuery("AI, Python, Java");
    expect(result.keywords).toEqual(["AI", "Python", "Java"]);
  });

  it("parses Chinese comma separator", () => {
    const result = parseKeywordQuery("AI，Python");
    expect(result.keywords).toEqual(["AI", "Python"]);
  });

  it("parses newline-separated keywords", () => {
    const result = parseKeywordQuery("AI\nPython");
    expect(result.keywords).toEqual(["AI", "Python"]);
  });

  it("parses 、(Chinese enumeration comma) separator", () => {
    const result = parseKeywordQuery("AI、Python");
    expect(result.keywords).toEqual(["AI", "Python"]);
  });

  it("deduplicates parsed keywords", () => {
    const result = parseKeywordQuery("AI AI Python");
    expect(result.keywords).toEqual(["AI", "Python"]);
  });

  it("handles OR with quoted phrases", () => {
    const result = parseKeywordQuery('"machine learning" OR "data science"');
    expect(result.keywords).toEqual(["machine learning", "data science"]);
    expect(result.mode).toBe("OR");
  });
});

// ---------------------------------------------------------------------------
// formatKeywordQuery
// ---------------------------------------------------------------------------

describe("formatKeywordQuery", () => {
  it("formats empty keywords", () => {
    expect(formatKeywordQuery([])).toBe("");
  });

  it("formats AND mode keywords", () => {
    expect(formatKeywordQuery(["AI", "Python"], "AND")).toBe("AI Python");
  });

  it("formats OR mode keywords with quotes", () => {
    expect(formatKeywordQuery(["AI", "Python"], "OR")).toBe('"AI" OR "Python"');
  });

  it("quotes multi-word phrases in AND mode", () => {
    expect(formatKeywordQuery(["machine learning", "AI"], "AND")).toBe('"machine learning" "AI"');
  });

  it("infers mode when not specified", () => {
    // Single-word keywords → AND
    expect(formatKeywordQuery(["AI", "Python"])).toBe("AI Python");
    // Multi-word phrase → OR (inferred)
    expect(formatKeywordQuery(["machine learning", "AI"])).toBe('"machine learning" OR "AI"');
  });

  it("escapes double quotes in keywords", () => {
    expect(formatKeywordQuery(['say "hello"'], "OR")).toBe('"say \\"hello\\""');
  });
});

// ---------------------------------------------------------------------------
// formatKeywordInput
// ---------------------------------------------------------------------------

describe("formatKeywordInput", () => {
  it("formats empty keywords", () => {
    expect(formatKeywordInput([])).toBe("");
  });

  it("formats single-word keywords with spaces (AND)", () => {
    expect(formatKeywordInput(["AI", "Python"])).toBe("AI Python");
  });

  it("formats multi-word keywords with commas (OR)", () => {
    expect(formatKeywordInput(["machine learning", "data science"])).toBe("machine learning, data science");
  });

  it("quotes single multi-word phrase", () => {
    expect(formatKeywordInput(["machine learning"])).toBe('"machine learning"');
  });

  it("formats single keyword without quotes", () => {
    expect(formatKeywordInput(["AI"])).toBe("AI");
  });
});
