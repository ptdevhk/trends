import { describe, expect, it } from "vitest";
import { isRecord } from "@trends/shared";
import {
  clampScore,
  extractBreakdown,
  parseBreakdownCandidate,
  readTextField,
  toScore,
  EMPTY_BREAKDOWN,
} from "./debug-ai-score-utils";

// ── isRecord ────────────────────────────────────────────────────────

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ key: "value" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(true); // arrays are objects — isRecord is a structural check
  });

  it("returns false for primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

// ── toScore ─────────────────────────────────────────────────────────

describe("toScore", () => {
  it("returns finite numbers as-is", () => {
    expect(toScore(0)).toBe(0);
    expect(toScore(42)).toBe(42);
    expect(toScore(99.5)).toBe(99.5);
  });

  it("parses numeric strings", () => {
    expect(toScore("85")).toBe(85);
    expect(toScore("0")).toBe(0);
  });

  it("returns null for non-finite numbers", () => {
    expect(toScore(Infinity)).toBe(null);
    expect(toScore(-Infinity)).toBe(null);
    expect(toScore(NaN)).toBe(null);
  });

  it("returns null for non-numeric strings", () => {
    expect(toScore("high")).toBe(null);
  });

  it("converts empty string to 0 (Number('') === 0)", () => {
    expect(toScore("")).toBe(0);
  });

  it("returns null for non-number/non-string types", () => {
    expect(toScore(true)).toBe(null);
    expect(toScore(null)).toBe(null);
    expect(toScore(undefined)).toBe(null);
    expect(toScore({})).toBe(null);
  });
});

// ── clampScore ──────────────────────────────────────────────────────

describe("clampScore", () => {
  it("returns value within 0-100 unchanged", () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(50)).toBe(50);
    expect(clampScore(100)).toBe(100);
  });

  it("clamps negative values to 0", () => {
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(-100)).toBe(0);
  });

  it("clamps values over 100 to 100", () => {
    expect(clampScore(101)).toBe(100);
    expect(clampScore(999)).toBe(100);
  });
});

// ── parseBreakdownCandidate ─────────────────────────────────────────

describe("parseBreakdownCandidate", () => {
  it("returns null for non-record input", () => {
    expect(parseBreakdownCandidate(null)).toBe(null);
    expect(parseBreakdownCandidate("string")).toBe(null);
    expect(parseBreakdownCandidate(42)).toBe(null);
  });

  it("returns null when breakdown field is missing", () => {
    expect(parseBreakdownCandidate({})).toBe(null);
    expect(parseBreakdownCandidate({ breakdown: null })).toBe(null);
    expect(parseBreakdownCandidate({ breakdown: "invalid" })).toBe(null);
  });

  it("parses a valid breakdown object", () => {
    const result = parseBreakdownCandidate({
      breakdown: {
        experience: 80,
        skills: 70,
        industry_db: 60,
        education: 50,
        location: 40,
      },
    });
    expect(result).toEqual({
      experience: 80,
      skills: 70,
      industry_db: 60,
      education: 50,
      location: 40,
    });
  });

  it("maps related_exp to experience", () => {
    const result = parseBreakdownCandidate({
      breakdown: { related_exp: 90, skills: 0, industry_db: 0, education: 0, location: 0 },
    });
    expect(result?.experience).toBe(90);
  });

  it("prefers related_exp over experience when both present", () => {
    const result = parseBreakdownCandidate({
      breakdown: { related_exp: 90, experience: 50, skills: 0, industry_db: 0, education: 0, location: 0 },
    });
    expect(result?.experience).toBe(90);
  });

  it("falls back to experience when related_exp is absent", () => {
    const result = parseBreakdownCandidate({
      breakdown: { experience: 50, skills: 0, industry_db: 0, education: 0, location: 0 },
    });
    expect(result?.experience).toBe(50);
  });

  it("parses string scores", () => {
    const result = parseBreakdownCandidate({
      breakdown: { experience: "75", skills: "25", industry_db: "0", education: "0", location: "0" },
    });
    expect(result?.experience).toBe(75);
    expect(result?.skills).toBe(25);
  });

  it("clamps scores to 0-100", () => {
    const result = parseBreakdownCandidate({
      breakdown: { experience: 150, skills: -10, industry_db: 50, education: 0, location: 0 },
    });
    expect(result?.experience).toBe(100);
    expect(result?.skills).toBe(0);
    expect(result?.industry_db).toBe(50);
  });

  it("defaults missing keys to 0", () => {
    const result = parseBreakdownCandidate({
      breakdown: { experience: 80 },
    });
    expect(result).toEqual({
      experience: 80,
      skills: 0,
      industry_db: 0,
      education: 0,
      location: 0,
    });
  });

  it("handles invalid score values gracefully", () => {
    const result = parseBreakdownCandidate({
      breakdown: { experience: "high", skills: NaN, industry_db: null, education: undefined, location: 0 },
    });
    expect(result).toEqual(EMPTY_BREAKDOWN);
  });
});

// ── extractBreakdown ────────────────────────────────────────────────

describe("extractBreakdown", () => {
  it("returns EMPTY_BREAKDOWN for null", () => {
    expect(extractBreakdown(null)).toEqual(EMPTY_BREAKDOWN);
  });

  it("extracts from direct analysis field", () => {
    const result = extractBreakdown({
      analysis: { breakdown: { experience: 85, skills: 70, industry_db: 60, education: 50, location: 40 } },
    });
    expect(result.experience).toBe(85);
  });

  it("extracts from analyses.default when no direct analysis", () => {
    const result = extractBreakdown({
      analyses: {
        default: { breakdown: { experience: 90, skills: 80, industry_db: 70, education: 60, location: 50 } },
      },
    });
    expect(result.experience).toBe(90);
  });

  it("searches other analysis keys when default has no breakdown", () => {
    const result = extractBreakdown({
      analyses: {
        default: {},
        custom: { breakdown: { experience: 75, skills: 65, industry_db: 55, education: 45, location: 35 } },
      },
    });
    expect(result.experience).toBe(75);
  });

  it("returns EMPTY_BREAKDOWN when no analysis is found", () => {
    expect(extractBreakdown({})).toEqual(EMPTY_BREAKDOWN);
    expect(extractBreakdown({ analysis: null, analyses: null })).toEqual(EMPTY_BREAKDOWN);
  });

  it("prefers direct analysis over analyses.default", () => {
    const result = extractBreakdown({
      analysis: { breakdown: { experience: 10, skills: 0, industry_db: 0, education: 0, location: 0 } },
      analyses: {
        default: { breakdown: { experience: 90, skills: 0, industry_db: 0, education: 0, location: 0 } },
      },
    });
    expect(result.experience).toBe(10);
  });
});

// ── readTextField ───────────────────────────────────────────────────

describe("readTextField", () => {
  it("reads a string value by key", () => {
    expect(readTextField({ name: "Alice" }, "name")).toBe("Alice");
  });

  it("trims whitespace", () => {
    expect(readTextField({ name: "  Alice  " }, "name")).toBe("Alice");
  });

  it("returns null for missing key", () => {
    expect(readTextField({ name: "Alice" }, "age")).toBe(null);
  });

  it("returns null for empty/whitespace-only string", () => {
    expect(readTextField({ name: "" }, "name")).toBe(null);
    expect(readTextField({ name: "   " }, "name")).toBe(null);
  });

  it("returns null for non-string values", () => {
    expect(readTextField({ name: 42 }, "name")).toBe(null);
    expect(readTextField({ name: null }, "name")).toBe(null);
    expect(readTextField({ name: true }, "name")).toBe(null);
  });

  it("returns null for non-record source", () => {
    expect(readTextField(null, "name")).toBe(null);
    expect(readTextField("string", "name")).toBe(null);
    expect(readTextField(42, "name")).toBe(null);
  });
});
