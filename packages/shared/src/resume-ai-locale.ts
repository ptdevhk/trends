import { resolveResumeAiPromptLocale } from "./generated/resume-ai-prompts.js";

export interface ResumeAiLocaleText {
  noneLabel: string;
  emptyFieldLabel: string;
  noWorkHistoryLabel: string;
  yearsUnitSuffix: string;
  verifiedLabel: string;
  unverifiedLabel: string;
  signalsLabel: string;
  indirectRoleLabel: string;
  serviceUnavailableSummary: string;
  analysisErrorSummary: string;
  analysisErrorConcernPrefix: string;
  noAnalysisResult: string;
  parseErrorConcern: string;
  parseErrorSummary: string;
}

const ZH_HANS_TEXT: ResumeAiLocaleText = {
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
};

const EN_TEXT: ResumeAiLocaleText = {
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
};

export function getResumeAiLocaleText(requestedLocale?: string): ResumeAiLocaleText {
  const resolution = resolveResumeAiPromptLocale(requestedLocale);

  switch (resolution.resolvedSourceLocale) {
    case "en":
      return EN_TEXT;
    default:
      return ZH_HANS_TEXT;
  }
}
