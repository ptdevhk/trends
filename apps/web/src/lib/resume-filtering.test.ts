import { describe, expect, it } from "vitest";

import { getResumeAge, parseExperienceYears } from "./resume-filtering";

describe("parseExperienceYears", () => {
  it("returns 0 for undefined input", () => {
    expect(parseExperienceYears(undefined)).toBe(0);
  });

  it("returns 0 for empty string", () => {
    expect(parseExperienceYears("")).toBe(0);
  });

  it("parses plain integer string", () => {
    expect(parseExperienceYears("5")).toBe(5);
  });

  it("parses decimal string", () => {
    expect(parseExperienceYears("3.5")).toBe(3.5);
  });

  it("extracts first number from string with Chinese units", () => {
    expect(parseExperienceYears("5年")).toBe(5);
  });

  it("extracts first number from string with English units", () => {
    expect(parseExperienceYears("5 years")).toBe(5);
  });

  it("extracts first number from range string", () => {
    // "3-5" → regex matches "3" (first occurrence)
    expect(parseExperienceYears("3-5")).toBe(3);
  });

  it("extracts decimal from string with trailing text", () => {
    expect(parseExperienceYears("2.5年经验")).toBe(2.5);
  });

  it("returns 0 for string with no digits", () => {
    expect(parseExperienceYears("experienced")).toBe(0);
  });

  it("extracts number after leading text", () => {
    expect(parseExperienceYears("over 10 years")).toBe(10);
  });
});

describe("getResumeAge", () => {
  it("returns truncated ageNumber when valid", () => {
    expect(getResumeAge({ ageNumber: 25.7 })).toBe(25);
  });

  it("falls back to age string when ageNumber is 0", () => {
    expect(getResumeAge({ ageNumber: 0, age: "30岁" })).toBe(30);
  });

  it("falls back to age string when ageNumber is negative", () => {
    expect(getResumeAge({ ageNumber: -1, age: "30岁" })).toBe(30);
  });

  it("falls back to age string when ageNumber is NaN", () => {
    expect(getResumeAge({ ageNumber: NaN, age: "30岁" })).toBe(30);
  });

  it("falls back to age string when ageNumber is Infinity", () => {
    expect(getResumeAge({ ageNumber: Infinity, age: "30岁" })).toBe(30);
  });

  it("parses Chinese age format with 岁 suffix", () => {
    expect(getResumeAge({ age: "25岁" })).toBe(25);
  });

  it("parses plain numeric age string", () => {
    expect(getResumeAge({ age: "30" })).toBe(30);
  });

  it("returns null when both ageNumber and age are missing", () => {
    expect(getResumeAge({})).toBeNull();
  });

  it("returns null for age string with 4+ digits (rejected by regex)", () => {
    expect(getResumeAge({ age: "1234" })).toBeNull();
  });

  it("returns 0 for age string 0 (string branch has no > 0 guard)", () => {
    // parseResumeAgeNumber's > 0 check only applies to typeof number, not string
    expect(getResumeAge({ age: "0" })).toBe(0);
  });

  it("returns null for non-string, non-number age", () => {
    expect(getResumeAge({ age: true })).toBeNull();
  });
});
