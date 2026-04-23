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
      indirectRoleLabel: "[indirect-role]",
      serviceUnavailableSummary: "AI matching service unavailable",
      analysisErrorSummary: "An error occurred during AI analysis",
      analysisErrorConcernPrefix: "AI analysis failed",
      noAnalysisResult: "No analysis result",
      parseErrorConcern: "AI response parse failed",
      parseErrorSummary: "Unable to parse AI response",
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
      indirectRoleLabel: "[非主职角色]",
      serviceUnavailableSummary: "AI匹配服务不可用",
      analysisErrorSummary: "AI分析过程中发生错误",
      analysisErrorConcernPrefix: "AI分析失败",
      noAnalysisResult: "无分析结果",
      parseErrorConcern: "AI响应解析失败",
      parseErrorSummary: "无法解析AI返回结果",
    });
  });
});
