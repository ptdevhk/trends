import type { ResumeWorkHistoryItem } from "../types/resume.js";

export function parseRoleYears(raw: string): number {
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
      const monthDiff = (endYear - startYear) * 12 + (endMonth - startMonth);
      if (monthDiff > 0) {
        return monthDiff / 12;
      }
    }
  }

  return 0;
}

export function computeWorkHistoryYears(workHistory: ResumeWorkHistoryItem[]): number | null {
  if (!workHistory.length) return null;
  let total = 0;
  for (const entry of workHistory) {
    total += parseRoleYears(entry.raw || "");
  }
  return total > 0 ? Number(total.toFixed(1)) : null;
}
