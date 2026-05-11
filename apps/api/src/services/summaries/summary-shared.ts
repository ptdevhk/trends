import type { SummaryPeriod, SummaryReport } from "@trends/shared";

export const PERIOD_TEMPLATES: Record<SummaryPeriod, string> = {
  daily: "summary-daily",
  weekly: "summary-daily",
  monthly: "summary-monthly",
};

export function getSummaryTitle(period: SummaryPeriod): string {
  if (period === "weekly") return "Weekly Ops Summary";
  if (period === "monthly") return "Monthly New Candidates Digest";
  return "Daily Ops Summary";
}

export function getDefaultTemplateId(period: SummaryPeriod): string {
  return PERIOD_TEMPLATES[period] ?? "summary-daily";
}
