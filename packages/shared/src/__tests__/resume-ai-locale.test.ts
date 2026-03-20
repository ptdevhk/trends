import { describe, expect, it } from "vitest";

import { getResumeAiLocaleText } from "../resume-ai-locale.js";

describe("getResumeAiLocaleText", () => {
  it("returns English labels for the English prompt locale", () => {
    expect(getResumeAiLocaleText("en")).toEqual({
      noneLabel: "none",
      emptyFieldLabel: "Not provided",
      noWorkHistoryLabel: "No work history provided",
      yearsUnitSuffix: " years",
      verifiedLabel: "verified",
      unverifiedLabel: "unverified",
      signalsLabel: "signals",
    });
  });

  it("falls back to zh-Hans labels when no localized prompt source exists", () => {
    expect(getResumeAiLocaleText("ja")).toEqual({
      noneLabel: "无",
      emptyFieldLabel: "未填写",
      noWorkHistoryLabel: "无工作经历",
      yearsUnitSuffix: "年",
      verifiedLabel: "已验证",
      unverifiedLabel: "未验证",
      signalsLabel: "信号",
    });
  });
});
