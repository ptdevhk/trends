import { resolveResumeAiPromptLocale } from "./generated/resume-ai-prompts.js";

export interface ResumeAiLocaleText {
  noneLabel: string;
  emptyFieldLabel: string;
  noWorkHistoryLabel: string;
  yearsUnitSuffix: string;
  verifiedLabel: string;
  unverifiedLabel: string;
  signalsLabel: string;
}

const ZH_HANS_TEXT: ResumeAiLocaleText = {
  noneLabel: "无",
  emptyFieldLabel: "未填写",
  noWorkHistoryLabel: "无工作经历",
  yearsUnitSuffix: "年",
  verifiedLabel: "已验证",
  unverifiedLabel: "未验证",
  signalsLabel: "信号",
};

const EN_TEXT: ResumeAiLocaleText = {
  noneLabel: "none",
  emptyFieldLabel: "Not provided",
  noWorkHistoryLabel: "No work history provided",
  yearsUnitSuffix: " years",
  verifiedLabel: "verified",
  unverifiedLabel: "unverified",
  signalsLabel: "signals",
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
