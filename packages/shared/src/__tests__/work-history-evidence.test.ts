import { describe, expect, it } from "vitest";

import {
  buildLatestWorkHistoryEvidence,
  buildWorkHistoryDateRange,
  buildWorkHistoryEntryText,
  buildWorkHistoryEvidence,
  DEFAULT_RESUME_WORK_HISTORY_LIMIT,
  MAX_RESUME_WORK_HISTORY_LIMIT,
  MIN_RESUME_WORK_HISTORY_LIMIT,
  normalizeWorkHistoryEntry,
  normalizeResumeWorkHistoryLimit,
  selectLatestWorkHistory,
} from "../work-history-evidence";

describe("normalizeWorkHistoryEntry", () => {
  it("normalizes a string entry to { raw }", () => {
    const result = normalizeWorkHistoryEntry("2015-04~2022-07 中山聚诚机电有限公司销售部经理");
    expect(result).toEqual({ raw: "2015-04~2022-07 中山聚诚机电有限公司销售部经理" });
  });

  it("normalizes a structured object entry preserving all fields", () => {
    const result = normalizeWorkHistoryEntry({
      companyName: "中山聚诚机电有限公司",
      jobTitle: "销售部经理",
      startDate: "2015-04",
      endDate: "2022-07",
      description: "报价及价格分析",
    });
    expect(result).toEqual({
      raw: "",
      companyName: "中山聚诚机电有限公司",
      jobTitle: "销售部经理",
      startDate: "2015-04",
      endDate: "2022-07",
      description: "报价及价格分析",
    });
  });

  it("returns null for empty string", () => {
    expect(normalizeWorkHistoryEntry("")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizeWorkHistoryEntry(null)).toBeNull();
  });

  it("returns null for object with only empty strings", () => {
    expect(normalizeWorkHistoryEntry({ raw: "", companyName: "" })).toBeNull();
  });
});

describe("buildWorkHistoryDateRange", () => {
  it("joins start and end with tilde", () => {
    expect(buildWorkHistoryDateRange("2020-01", "2024-01")).toBe("2020-01 ~ 2024-01");
  });

  it("returns start only when end is absent", () => {
    expect(buildWorkHistoryDateRange("2020-01", undefined)).toBe("2020-01");
  });

  it("returns empty string when both absent", () => {
    expect(buildWorkHistoryDateRange(undefined, undefined)).toBe("");
  });

  it("handles 至今 as end date", () => {
    expect(buildWorkHistoryDateRange("2024-01", "至今")).toBe("2024-01 ~ 至今");
  });
});

describe("buildWorkHistoryEntryText", () => {
  it("builds structured text from date range, company, title, description", () => {
    const result = buildWorkHistoryEntryText({
      startDate: "2020-01",
      endDate: "2024-01",
      companyName: "北京精雕科技集团有限公司",
      jobTitle: "销售工程师",
      description: "CNC机床销售",
    });
    expect(result).toBe("2020-01 ~ 2024-01 北京精雕科技集团有限公司 销售工程师 CNC机床销售");
  });

  it("falls back to raw when structured fields produce nothing", () => {
    const result = buildWorkHistoryEntryText({
      raw: "2015-04~2022-07(7年3月)中山聚诚机电有限公司销售部经理",
    });
    expect(result).toBe("2015-04~2022-07(7年3月)中山聚诚机电有限公司销售部经理");
  });

  it("returns empty string for null-like input", () => {
    expect(buildWorkHistoryEntryText(null)).toBe("");
    expect(buildWorkHistoryEntryText("")).toBe("");
  });

  it("omits missing optional fields without extra spaces", () => {
    const result = buildWorkHistoryEntryText({
      companyName: "某公司",
      jobTitle: "销售",
    });
    expect(result).toBe("某公司 销售");
  });
});

describe("work-history evidence helpers", () => {
  it("selects the latest three entries by recency", () => {
    const selected = selectLatestWorkHistory([
      { raw: "2018-01 Legacy Co.", startDate: "2018-01", endDate: "2019-01", companyName: "Legacy Co." },
      { raw: "2024-05 Current Co.", startDate: "2024-05", endDate: "至今", companyName: "Current Co." },
      { raw: "2021-03 Mid Co.", startDate: "2021-03", endDate: "2023-12", companyName: "Mid Co." },
      { raw: "2024-01 Recent Co.", startDate: "2024-01", endDate: "2024-04", companyName: "Recent Co." },
      { raw: "2020-02 Older Co.", startDate: "2020-02", endDate: "2021-02", companyName: "Older Co." },
    ]);

    expect(selected.map((entry) => entry.companyName)).toEqual([
      "Current Co.",
      "Recent Co.",
      "Mid Co.",
    ]);
  });

  it("keeps input order as a stable fallback when dates are missing", () => {
    const selected = selectLatestWorkHistory([
      { raw: "First Co.", companyName: "First Co." },
      { raw: "Second Co.", companyName: "Second Co." },
      { raw: "Third Co.", companyName: "Third Co." },
      { raw: "Fourth Co.", companyName: "Fourth Co." },
    ]);

    expect(selected.map((entry) => entry.companyName)).toEqual([
      "First Co.",
      "Second Co.",
      "Third Co.",
    ]);
  });

  it("builds latest-work-history evidence without mutating full evidence behavior", () => {
    const workHistory = [
      { raw: "2018-01 Legacy Co.", startDate: "2018-01", endDate: "2019-01", companyName: "Legacy Co.", jobTitle: "Operator" },
      { raw: "2024-05 Current Co.", startDate: "2024-05", endDate: "至今", companyName: "Current Co.", jobTitle: "Manager" },
      { raw: "2021-03 Mid Co.", startDate: "2021-03", endDate: "2023-12", companyName: "Mid Co.", jobTitle: "Engineer" },
      { raw: "2024-01 Recent Co.", startDate: "2024-01", endDate: "2024-04", companyName: "Recent Co.", jobTitle: "Sales" },
    ];

    expect(buildWorkHistoryEvidence(workHistory).lines).toHaveLength(4);
    expect(buildLatestWorkHistoryEvidence(workHistory).lines).toEqual([
      "2024-05 ~ 至今 Current Co. Manager",
      "2024-01 ~ 2024-04 Recent Co. Sales",
      "2021-03 ~ 2023-12 Mid Co. Engineer",
    ]);
  });

  it("honors an explicit configured selection limit", () => {
    const selected = selectLatestWorkHistory([
      { companyName: "One", startDate: "2025-01", endDate: "至今" },
      { companyName: "Two", startDate: "2024-01", endDate: "2024-12" },
      { companyName: "Three", startDate: "2023-01", endDate: "2023-12" },
      { companyName: "Four", startDate: "2022-01", endDate: "2022-12" },
      { companyName: "Five", startDate: "2021-01", endDate: "2021-12" },
    ], { limit: 5 });

    expect(selected.map((entry) => entry.companyName)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
    ]);
  });
});

describe("normalizeResumeWorkHistoryLimit", () => {
  it("exposes the approved default and bounds", () => {
    expect(DEFAULT_RESUME_WORK_HISTORY_LIMIT).toBe(3);
    expect(MIN_RESUME_WORK_HISTORY_LIMIT).toBe(1);
    expect(MAX_RESUME_WORK_HISTORY_LIMIT).toBe(10);
  });

  it.each([1, 3, 10])("accepts valid integer limit %s", (value) => {
    expect(normalizeResumeWorkHistoryLimit(value)).toBe(value);
  });

  it.each([undefined, null, "3", 0, 11, 2.5, Number.NaN])(
    "falls back to three for invalid value %s",
    (value) => {
      expect(normalizeResumeWorkHistoryLimit(value)).toBe(3);
    },
  );
});
