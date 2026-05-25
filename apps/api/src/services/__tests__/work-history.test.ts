import { describe, it, expect } from "vitest";
import {
  parseRoleYears,
  computeEntryRoleYears,
  extractCompanyFromWorkHistory,
  computeWorkHistoryYears,
} from "../work-history.js";
import type { ResumeWorkHistoryItem } from "../../types/resume.js";

describe("parseRoleYears", () => {
  it("returns 0 for empty string", () => {
    expect(parseRoleYears("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(parseRoleYears("   ")).toBe(0);
  });

  it("parses explicit duration in years", () => {
    expect(parseRoleYears("(5年)")).toBe(5);
  });

  it("parses explicit duration in years and months", () => {
    expect(parseRoleYears("(3年6月)")).toBeCloseTo(3.5);
  });

  it("parses date range with years and months", () => {
    const result = parseRoleYears("2020-01~2023-06");
    expect(result).toBeCloseTo(3.417, 1);
  });

  it("parses date range with Chinese separators", () => {
    const result = parseRoleYears("2020年1月至2023年6月");
    expect(result).toBeGreaterThan(3);
    expect(result).toBeLessThan(4);
  });

  it("parses date range with present/至今", () => {
    const anchor = new Date(2026, 0, 1); // Jan 2026
    const result = parseRoleYears("2020-01~至今", anchor);
    expect(result).toBeCloseTo(6);
  });

  it("parses date range with present in Chinese", () => {
    const anchor = new Date(2025, 11, 1); // Dec 2025
    const result = parseRoleYears("2023年6月至今 · 某公司", anchor);
    expect(result).toBeGreaterThan(2);
  });

  it("returns 0 for unparseable text", () => {
    expect(parseRoleYears("some random text")).toBe(0);
  });

  it("returns 0 when end date is before start date", () => {
    expect(parseRoleYears("2025-01~2020-01")).toBe(0);
  });
});

describe("computeEntryRoleYears", () => {
  it("returns 0 for entry with no data", () => {
    const entry: ResumeWorkHistoryItem = { raw: "" };
    expect(computeEntryRoleYears(entry)).toBe(0);
  });

  it("computes years from structured date fields", () => {
    const entry: ResumeWorkHistoryItem = {
      raw: "",
      startDate: "2020-01",
      endDate: "2023-01",
    };
    const result = computeEntryRoleYears(entry);
    expect(result).toBeCloseTo(3);
  });

  it("falls back to raw text when structured dates are missing", () => {
    const entry: ResumeWorkHistoryItem = {
      raw: "2020-01~2023-01 · 某公司",
    };
    const result = computeEntryRoleYears(entry);
    expect(result).toBeGreaterThan(0);
  });
});

describe("extractCompanyFromWorkHistory", () => {
  it("extracts company name from companyName field", () => {
    const entry: ResumeWorkHistoryItem = {
      raw: "",
      companyName: "东莞市智通直聘科技有限公司",
    };
    expect(extractCompanyFromWorkHistory(entry)).toContain("科技");
  });

  it("extracts company name ending with 公司", () => {
    const entry: ResumeWorkHistoryItem = {
      raw: "2020-01~2023-01 · 深圳某某公司",
    };
    const result = extractCompanyFromWorkHistory(entry);
    expect(result).toContain("公司");
  });

  it("extracts company name ending with 集团", () => {
    const entry: ResumeWorkHistoryItem = {
      raw: "华为集团 · 工程师",
    };
    const result = extractCompanyFromWorkHistory(entry);
    expect(result).toBe("华为集团");
  });

  it("returns empty string for entry with no company info", () => {
    const entry: ResumeWorkHistoryItem = { raw: "" };
    expect(extractCompanyFromWorkHistory(entry)).toBe("");
  });

  it("returns first token when no pattern match", () => {
    const entry: ResumeWorkHistoryItem = {
      raw: "ABC Corp engineer",
      companyName: "ABC Corp",
    };
    const result = extractCompanyFromWorkHistory(entry);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe("computeWorkHistoryYears", () => {
  it("returns null for empty work history", () => {
    expect(computeWorkHistoryYears([])).toBeNull();
  });

  it("computes total years from single entry with structured dates", () => {
    const history: ResumeWorkHistoryItem[] = [
      { raw: "", startDate: "2020-01", endDate: "2023-01" },
    ];
    const result = computeWorkHistoryYears(history);
    expect(result).toBe(3);
  });

  it("computes total years from multiple non-overlapping entries", () => {
    const history: ResumeWorkHistoryItem[] = [
      { raw: "", startDate: "2020-01", endDate: "2022-01" },
      { raw: "", startDate: "2023-01", endDate: "2025-01" },
    ];
    const result = computeWorkHistoryYears(history);
    expect(result).toBe(4);
  });

  it("merges overlapping intervals", () => {
    const history: ResumeWorkHistoryItem[] = [
      { raw: "", startDate: "2020-01", endDate: "2023-01" },
      { raw: "", startDate: "2022-01", endDate: "2024-01" },
    ];
    const result = computeWorkHistoryYears(history);
    expect(result).toBe(4);
  });

  it("handles present/ongoing end dates", () => {
    const anchor = new Date(2026, 0, 1);
    const history: ResumeWorkHistoryItem[] = [
      { raw: "", startDate: "2024-01", endDate: "至今" },
    ];
    const result = computeWorkHistoryYears(history, anchor);
    expect(result).toBe(2);
  });

  it("falls back to raw text date parsing", () => {
    const history: ResumeWorkHistoryItem[] = [
      { raw: "2020-01~2023-01 · 某公司" },
    ];
    const result = computeWorkHistoryYears(history);
    expect(result).toBeGreaterThan(0);
  });

  it("returns null when no entries have parseable dates", () => {
    const history: ResumeWorkHistoryItem[] = [
      { raw: "no date info here" },
    ];
    expect(computeWorkHistoryYears(history)).toBeNull();
  });

  it("rounds result to 1 decimal", () => {
    const history: ResumeWorkHistoryItem[] = [
      { raw: "", startDate: "2020-01", endDate: "2022-07" },
    ];
    const result = computeWorkHistoryYears(history);
    if (result !== null) {
      expect(result.toString()).toMatch(/^\d+\.\d$/);
    }
  });
});
