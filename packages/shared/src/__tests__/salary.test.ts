import { describe, expect, it } from "vitest";

import { parseRawSalaryRange, parseSalaryRange } from "../salary.js";

// ---------------------------------------------------------------------------
// parseSalaryRange
// ---------------------------------------------------------------------------

describe("parseSalaryRange", () => {
  // --- null cases ---

  it("returns null for undefined", () => {
    expect(parseSalaryRange(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSalaryRange("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseSalaryRange("   ")).toBeNull();
  });

  it("returns null for 面议 (negotiable)", () => {
    expect(parseSalaryRange("面议")).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(parseSalaryRange("待遇优厚")).toBeNull();
  });

  // --- K-unit format (default: K units) ---

  it("parses '15K-25K' in K mode (default)", () => {
    const result = parseSalaryRange("15K-25K");
    expect(result).toEqual({ min: 15, max: 25 });
  });

  it("parses '10k-20k' case-insensitive", () => {
    const result = parseSalaryRange("10k-20k");
    expect(result).toEqual({ min: 10, max: 20 });
  });

  // --- K-unit format (raw mode) ---

  it("parses '15K-25K' in raw mode", () => {
    const result = parseSalaryRange("15K-25K", { unit: "raw" });
    expect(result).toEqual({ min: 15000, max: 25000 });
  });

  // --- 万 (wan) unit ---

  it("parses '1万-2万' in K mode", () => {
    const result = parseSalaryRange("1万-2万");
    expect(result).toEqual({ min: 10, max: 20 });
  });

  it("parses '1万-2万' in raw mode", () => {
    const result = parseSalaryRange("1万-2万", { unit: "raw" });
    expect(result).toEqual({ min: 10000, max: 20000 });
  });

  it("parses monthly decimal wan salary in raw mode", () => {
    const result = parseSalaryRange("2.8-4.2万/月", { unit: "raw" });
    expect(result).toEqual({ min: 28000, max: 42000 });
  });

  it("parses monthly decimal wan salary with explicit raw helper", () => {
    expect(parseRawSalaryRange("2.8-4.2万/月")).toEqual({ min: 28000, max: 42000 });
  });

  // --- 千 unit ---

  it("parses '5千-8千' in K mode", () => {
    const result = parseSalaryRange("5千-8千");
    expect(result).toEqual({ min: 5, max: 8 });
  });

  it("parses '5千-8千' in raw mode", () => {
    const result = parseSalaryRange("5千-8千", { unit: "raw" });
    expect(result).toEqual({ min: 5000, max: 8000 });
  });

  // --- Bare numbers (no unit annotation) ---

  it("parses '8000-12000' (bare numbers) in K mode as-is", () => {
    const result = parseSalaryRange("8000-12000");
    expect(result).toEqual({ min: 8000, max: 12000 });
  });

  it("parses '8000-12000' (bare numbers) in raw mode as-is", () => {
    const result = parseSalaryRange("8000-12000", { unit: "raw" });
    expect(result).toEqual({ min: 8000, max: 12000 });
  });

  it("parses '12000-18000元/月' (with suffix) as bare numbers", () => {
    const result = parseSalaryRange("12000-18000元/月");
    expect(result).toEqual({ min: 12000, max: 18000 });
  });

  // --- Single value ---

  it("parses single value '20K'", () => {
    const result = parseSalaryRange("20K");
    expect(result).toEqual({ min: 20, max: undefined });
  });

  it("parses single value '3万' in K mode", () => {
    const result = parseSalaryRange("3万");
    expect(result).toEqual({ min: 30, max: undefined });
  });

  // --- Range separators ---

  it("parses tilde separator '10K~20K'", () => {
    const result = parseSalaryRange("10K~20K");
    expect(result).toEqual({ min: 10, max: 20 });
  });

  it("parses Chinese '到' separator", () => {
    const result = parseSalaryRange("10K到20K");
    expect(result).toEqual({ min: 10, max: 20 });
  });

  it("parses Chinese '至' separator", () => {
    const result = parseSalaryRange("10K至20K");
    expect(result).toEqual({ min: 10, max: 20 });
  });

  // --- Whitespace handling ---

  it("handles whitespace around values", () => {
    const result = parseSalaryRange("  15K - 25K  ");
    expect(result).toEqual({ min: 15, max: 25 });
  });

  // --- Decimal values ---

  it("parses decimal K values '1.5K-3.5K'", () => {
    const result = parseSalaryRange("1.5K-3.5K");
    expect(result).toEqual({ min: 1.5, max: 3.5 });
  });

  it("parses decimal 万 values '0.8万-1.5万'", () => {
    const result = parseSalaryRange("0.8万-1.5万");
    expect(result).toEqual({ min: 8, max: 15 });
  });
});
