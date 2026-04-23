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

  const resolvedAnchor = resolveAnchorDate(anchorDate);

  // Collect date intervals as [startMonth, endMonth] in month units
  const intervals: Array<[number, number]> = [];
  for (const entry of workHistory) {
    const normalized = normalizeWorkHistoryEntry(entry);
    if (!normalized) continue;

    // Try structured date fields first
    const startDate = normalized.startDate;
    const endDate = normalized.endDate;
    const startMonthNum = parseYearMonth(startDate);

    if (startMonthNum !== null) {
      const endMonthNum = endDate
        ? parseYearMonth(endDate, resolvedAnchor)
        : null;
      const effectiveEnd = endMonthNum ?? (resolvedAnchor.getFullYear() * 12 + resolvedAnchor.getMonth() + 1);
      if (effectiveEnd > startMonthNum) {
        intervals.push([startMonthNum, effectiveEnd]);
        continue;
      }
    }

    // Fallback: extract interval from raw text via parseRoleYears-style date parsing
    const rawInterval = parseRawDateInterval(normalized.raw || "", resolvedAnchor);
    if (rawInterval) {
      intervals.push(rawInterval);
    }
  }

  if (!intervals.length) return null;

  // Merge overlapping intervals and sum unique months
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let totalMonths = 0;
  let currentStart = intervals[0][0];
  let currentEnd = intervals[0][1];

  for (let i = 1; i < intervals.length; i++) {
    const [start, end] = intervals[i];
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      totalMonths += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  totalMonths += currentEnd - currentStart;

  const years = totalMonths / 12;
  return years > 0 ? Number(years.toFixed(1)) : null;
}

function parseRawDateInterval(raw: string, anchorDate: Date): [number, number] | null {
  const text = raw.trim();
  if (!text) return null;

  // Match date-range patterns in raw text: "YYYY-MM~YYYY-MM" or "YYYY年M月~YYYY年M月"
  const range = text.match(/(\d{4})[-./年](\d{1,2})?.*?[~至到-]\s*(\d{4})(?:[-./年](\d{1,2}))?/u);
  if (range) {
    const startYear = Number(range[1]);
    const startMonth = Number(range[2] || 1);
    const endYear = Number(range[3]);
    const endMonth = Number(range[4] || 1);
    if ([startYear, startMonth, endYear, endMonth].every(Number.isFinite)) {
      const start = startYear * 12 + startMonth;
      const end = endYear * 12 + endMonth;
      if (end > start) return [start, end];
    }
  }

  // Handle 至今/present patterns in raw text
  const presentMatch = text.match(PRESENT_END_PATTERN);
  if (presentMatch) {
    const startYear = Number(presentMatch[1]);
    const startMonth = Number(presentMatch[2] || 1);
    if (Number.isFinite(startYear) && Number.isFinite(startMonth)) {
      const start = startYear * 12 + startMonth;
      const end = anchorDate.getFullYear() * 12 + anchorDate.getMonth() + 1;
      if (end > start) return [start, end];
    }
  }

  return null;
}

function parseYearMonth(value: string | undefined, anchorDate?: Date): number | null {
  if (!value) return null;
  const normalized = value.trim();

  // Handle 至今/present markers
  if (/^(?:至今|目前|今|present|current|now|ongoing)$/iu.test(normalized)) {
    const resolved = resolveAnchorDate(anchorDate);
    return resolved.getFullYear() * 12 + resolved.getMonth() + 1;
  }

  const match = normalized.match(/^((?:19|20)\d{2})(?:[-./年](\d{1,2}))?/u);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2] || 1);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;

  return year * 12 + month;
}
