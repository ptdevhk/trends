import { buildWorkHistoryDateRange, buildWorkHistoryEntryText, normalizeWorkHistoryEntry } from "@trends/shared";

import type { ResumeWorkHistoryItem } from "../types/resume.js";

const PRESENT_END_PATTERN = /(\d{4})[-./年](\d{1,2})?[^0-9]*(?:至今|目前|今|present|current|now|ongoing)/iu;

function computeMonthsDiff(startYear: number, startMonth: number, endYear: number, endMonth: number): number {
  const diff = (endYear - startYear) * 12 + (endMonth - startMonth);
  return diff > 0 ? diff / 12 : 0;
}

function resolveAnchorDate(anchorDate: Date | undefined): Date {
  return anchorDate ?? new Date();
}

export function parseRoleYears(raw: string, anchorDate?: Date): number {
  const text = raw.trim();
  if (!text) {
    return 0;
  }

  const explicitDuration = text.match(/\((\d+)\s*年(?:(\d+)\s*月)?\)/u);
  if (explicitDuration) {
    const years = Number(explicitDuration[1] || 0);
    const months = Number(explicitDuration[2] || 0);
    if (Number.isFinite(years) && Number.isFinite(months)) {
      return years + (months / 12);
    }
  }

  const range = text.match(/(\d{4})[-./年](\d{1,2})?.*?[~至到-]\s*(\d{4})(?:[-./年](\d{1,2}))?/u);
  if (range) {
    const startYear = Number(range[1]);
    const startMonth = Number(range[2] || 1);
    const endYear = Number(range[3]);
    const endMonth = Number(range[4] || 1);

    if ([startYear, startMonth, endYear, endMonth].every((value) => Number.isFinite(value))) {
      const years = computeMonthsDiff(startYear, startMonth, endYear, endMonth);
      if (years > 0) {
        return years;
      }
    }
  }

  // Handle 至今/present as end date: compute duration from start date to now.
  // Covers 51job-live format "YYYY-MM~至今 · ..." where endDate has no year digits.
  const presentEndMatch = text.match(PRESENT_END_PATTERN);
  if (presentEndMatch) {
    const startYear = Number(presentEndMatch[1]);
    const startMonth = Number(presentEndMatch[2] || 1);
    const resolvedAnchorDate = resolveAnchorDate(anchorDate);
    const endYear = resolvedAnchorDate.getFullYear();
    const endMonth = resolvedAnchorDate.getMonth() + 1;
    if (Number.isFinite(startYear) && Number.isFinite(startMonth)) {
      const years = computeMonthsDiff(startYear, startMonth, endYear, endMonth);
      if (years > 0) {
        return years;
      }
    }
  }

  return 0;
}

export function computeEntryRoleYears(entry: ResumeWorkHistoryItem, anchorDate?: Date): number {
  const normalized = normalizeWorkHistoryEntry(entry);
  if (!normalized) {
    return 0;
  }

  const dateRangeYears = parseRoleYears(buildWorkHistoryDateRange(normalized.startDate, normalized.endDate), anchorDate);
  if (dateRangeYears > 0) {
    return dateRangeYears;
  }

  return parseRoleYears(normalized.raw || "", anchorDate);
}

const COMPANY_PATTERN = /([\u4e00-\u9fa5A-Za-z0-9()（）·.&\-]{2,40}(?:公司|集团|科技|机械|设备|自动化|股份|有限|厂|行))/;

function normalizeCompanyName(raw: string): string {
  return raw
    .replace(/^[\d\-~至今年月日()（）.\s]+/, "")
    .replace(/[\s,，。;；]+/g, " ")
    .trim();
}

export function extractCompanyFromWorkHistory(entry: ResumeWorkHistoryItem): string {
  const normalized = normalizeWorkHistoryEntry(entry);
  const cleaned = normalizeCompanyName(normalized?.companyName || buildWorkHistoryEntryText(entry));
  if (!cleaned) {
    return "";
  }

  const companyMatch = cleaned.match(COMPANY_PATTERN);
  if (companyMatch) {
    return companyMatch[1];
  }

  const firstToken = cleaned.split(/\s+/g).find((token) => token.length >= 2);
  return firstToken || "";
}

export function computeWorkHistoryYears(workHistory: ResumeWorkHistoryItem[], anchorDate?: Date): number | null {
  if (!workHistory.length) return null;
  let total = 0;
  for (const entry of workHistory) {
    total += computeEntryRoleYears(entry, anchorDate);
  }
  return total > 0 ? Number(total.toFixed(1)) : null;
}
