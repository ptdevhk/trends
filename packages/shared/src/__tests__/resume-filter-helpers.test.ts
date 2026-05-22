import { describe, expect, it } from "vitest";

import { normalizeEducationLevel, parseExperienceYears, computeExperienceFromWorkHistory, resolveExperienceYears } from "../resume-filter-helpers.js";

describe("normalizeEducationLevel", () => {
  it("normalizes Chinese education terms", () => {
    expect(normalizeEducationLevel("博士")).toBe("phd");
    expect(normalizeEducationLevel("硕士")).toBe("master");
    expect(normalizeEducationLevel("研究生")).toBe("master");
    expect(normalizeEducationLevel("本科")).toBe("bachelor");
    expect(normalizeEducationLevel("大专")).toBe("associate");
    expect(normalizeEducationLevel("专科")).toBe("associate");
    expect(normalizeEducationLevel("中专")).toBe("high_school");
    expect(normalizeEducationLevel("高中")).toBe("high_school");
    expect(normalizeEducationLevel("中技")).toBe("high_school");
  });

  it("normalizes English education terms (Seek MY market)", () => {
    expect(normalizeEducationLevel("PhD")).toBe("phd");
    expect(normalizeEducationLevel("Ph.D.")).toBe("phd");
    expect(normalizeEducationLevel("Doctorate")).toBe("phd");
    expect(normalizeEducationLevel("Master of Engineering")).toBe("master");
    expect(normalizeEducationLevel("M.S.")).toBe("master");
    expect(normalizeEducationLevel("MBA")).toBe("master");
    expect(normalizeEducationLevel("Bachelor of Engineering")).toBe("bachelor");
    expect(normalizeEducationLevel("B.S.")).toBe("bachelor");
    expect(normalizeEducationLevel("Diploma in IT")).toBe("associate");
    expect(normalizeEducationLevel("Associate Degree")).toBe("associate");
    expect(normalizeEducationLevel("High School")).toBe("high_school");
    expect(normalizeEducationLevel("SPM")).toBe("high_school");
    expect(normalizeEducationLevel("STPM")).toBe("high_school");
  });

  it("returns null for unrecognized values", () => {
    expect(normalizeEducationLevel("")).toBeNull();
    expect(normalizeEducationLevel(null)).toBeNull();
    expect(normalizeEducationLevel(undefined)).toBeNull();
    expect(normalizeEducationLevel("Certification")).toBeNull();
    expect(normalizeEducationLevel("GCE O-Level")).toBeNull();
  });
});

describe("parseExperienceYears", () => {
  it("parses Chinese experience terms", () => {
    expect(parseExperienceYears("应届")).toBe(0);
    expect(parseExperienceYears("无经验")).toBe(0);
  });

  it("parses English zero-experience terms (Seek EN)", () => {
    expect(parseExperienceYears("fresh graduate")).toBe(0);
    expect(parseExperienceYears("Fresh Grad")).toBe(0);
    expect(parseExperienceYears("entry level")).toBe(0);
    expect(parseExperienceYears("Entry Level")).toBe(0);
    expect(parseExperienceYears("no experience")).toBe(0);
    expect(parseExperienceYears("beginner")).toBe(0);
    expect(parseExperienceYears("Beginner")).toBe(0);
  });

  it("parses numeric ranges", () => {
    expect(parseExperienceYears("5")).toBe(5);
    expect(parseExperienceYears("3-5")).toBe(5);
    expect(parseExperienceYears("2~3")).toBe(3);
    expect(parseExperienceYears("1到3")).toBe(3);
  });

  it("returns null for unparseable values", () => {
    expect(parseExperienceYears("")).toBeNull();
    expect(parseExperienceYears(null)).toBeNull();
    expect(parseExperienceYears(undefined)).toBeNull();
    expect(parseExperienceYears("?")).toBeNull();
  });
});

describe("computeExperienceFromWorkHistory", () => {
  it("returns null for empty or non-array input", () => {
    expect(computeExperienceFromWorkHistory(null)).toBeNull();
    expect(computeExperienceFromWorkHistory(undefined)).toBeNull();
    expect(computeExperienceFromWorkHistory([])).toBeNull();
    expect(computeExperienceFromWorkHistory("not an array")).toBeNull();
  });

  it("returns null when no entries have parseable dates", () => {
    expect(computeExperienceFromWorkHistory([{ years: "?" }])).toBeNull();
    expect(computeExperienceFromWorkHistory([{ startDate: "invalid" }])).toBeNull();
  });

  it("computes years from a single entry with start and end dates", () => {
    const result = computeExperienceFromWorkHistory([
      { startDate: "2020-01", endDate: "2023-01" },
    ]);
    expect(result).toBe(3);
  });

  it("uses current date when endDate is missing", () => {
    const result = computeExperienceFromWorkHistory([
      { startDate: "2024-01" },
    ]);
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it("merges overlapping date ranges", () => {
    const result = computeExperienceFromWorkHistory([
      { startDate: "2020-01", endDate: "2023-06" },
      { startDate: "2022-06", endDate: "2024-01" },
    ]);
    // Overlapping: 2020-01 to 2024-01 = 4 years
    expect(result).toBe(4);
  });

  it("sums non-overlapping date ranges", () => {
    const result = computeExperienceFromWorkHistory([
      { startDate: "2018-01", endDate: "2020-01" },
      { startDate: "2022-01", endDate: "2024-01" },
    ]);
    // 2 + 2 = 4 years
    expect(result).toBe(4);
  });

  it("handles YYYY format dates", () => {
    const result = computeExperienceFromWorkHistory([
      { startDate: "2020", endDate: "2023" },
    ]);
    expect(result).toBe(3);
  });
});

describe("resolveExperienceYears", () => {
  it("returns parseExperienceYears result when available", () => {
    expect(resolveExperienceYears("5", [])).toBe(5);
    expect(resolveExperienceYears("3-5", [])).toBe(5);
    expect(resolveExperienceYears("应届", [])).toBe(0);
  });

  it("falls back to workHistory when experience is null", () => {
    const result = resolveExperienceYears(null, [
      { startDate: "2020-01", endDate: "2023-01" },
    ]);
    expect(result).toBe(3);
  });

  it("falls back to workHistory when experience is empty string", () => {
    const result = resolveExperienceYears("", [
      { startDate: "2020-01", endDate: "2023-01" },
    ]);
    expect(result).toBe(3);
  });

  it("falls back to workHistory when experience is unparseable", () => {
    const result = resolveExperienceYears("?", [
      { startDate: "2020-01", endDate: "2023-01" },
    ]);
    expect(result).toBe(3);
  });

  it("returns null when both experience and workHistory are unparseable", () => {
    expect(resolveExperienceYears("", [])).toBeNull();
    expect(resolveExperienceYears(null, [{ years: "?" }])).toBeNull();
  });

  it("prefers explicit experience value over workHistory computation", () => {
    // If experience says "2" but workHistory shows 5 years, use 2
    expect(resolveExperienceYears("2", [
      { startDate: "2020-01", endDate: "2025-01" },
    ])).toBe(2);
  });
});
