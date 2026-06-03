/**
 * Shared resume filter helpers.
 *
 * Used by both BFF (apps/api) and web (apps/web) for consistent
 * education/experience normalization across filter paths.
 *
 * Convex cannot import from @trends/shared and maintains its own copy
 * in convex/resumes.ts — keep them in sync via the sync test in
 * convex/__tests__/schema-validator-sync.test.ts.
 */

/**
 * Normalize education level strings to standard English tokens.
 *
 * Supports both Chinese (博士, 硕士, 本科, etc.) and English
 * (PhD, Master, Bachelor, Diploma, SPM, STPM) terms.
 * Returns null if the value cannot be recognized.
 */
export function normalizeEducationLevel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  // Chinese education terms
  if (/博士/.test(normalized)) return "phd";
  if (/硕士|研究生/.test(normalized)) return "master";
  if (/本科/.test(normalized)) return "bachelor";
  if (/大专|专科/.test(normalized)) return "associate";
  if (/中专|高中|中技/.test(normalized)) return "high_school";
  // English education terms (Seek MY market)
  if (/\bph\.?d\.?\b/.test(normalized) || /\bdoctorate\b/.test(normalized)) return "phd";
  if (/\bmaster/.test(normalized) || /\bm\.?s\.?\b/.test(normalized) || /\bm\.?a\.?\b/.test(normalized) || /\bmba\b/.test(normalized)) return "master";
  if (/\bdiploma\b/.test(normalized) || /\bassociate\b/.test(normalized)) return "associate";
  if (/\bbachelor/.test(normalized) || /\bdegree\b/.test(normalized) || /\bb\.?s\.?\b/.test(normalized) || /\bb\.?a\.?\b/.test(normalized)) return "bachelor";
  if (/\bhigh school\b/.test(normalized) || /\bspm\b/.test(normalized) || /\bstpm\b/.test(normalized)) return "high_school";
  return null;
}

/**
 * Parse experience years from a string value.
 *
 * Supports:
 * - Chinese terms: "应届" / "无经验" → 0
 * - Range formats: "3-5" → 5, "2~3" → 3, "1到3" → 3
 * - Single values: "5" → 5
 *
 * Returns null if the value cannot be parsed.
 * For ranges, returns the max value (conservative estimate).
 */
export function parseExperienceYears(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (/应届|无经验|fresh grad|entry level|no experience|fresh graduate|beginner/i.test(normalized)) return 0;
  const match = normalized.match(/(\d+)(?:\s*[-~到]\s*(\d+))?/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  return Number.isNaN(max) ? null : max;
}

/**
 * Parse date strings like "2023-06", "2023", "2023-06-15" to epoch ms.
 */
export function parseDateToMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) - 1 : 0;
  const day = match[3] ? Number(match[3]) : 1;
  const ms = Date.UTC(year, month, day);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Compute total experience years from workHistory date ranges.
 * Merges overlapping ranges to avoid double-counting.
 * Returns null if no entries have parseable date ranges.
 */
export function computeExperienceFromWorkHistory(workHistory: unknown): number | null {
  if (!Array.isArray(workHistory) || workHistory.length === 0) {
    return null;
  }
  const ranges: Array<{ start: number; end: number }> = [];
  const now = Date.now();
  for (const entry of workHistory) {
    if (typeof entry !== "object" || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    const startMs = parseDateToMs(rec.startDate);
    const endMs = rec.endDate ? parseDateToMs(rec.endDate) : now;
    if (startMs !== null && endMs !== null && endMs > startMs) {
      ranges.push({ start: startMs, end: endMs });
    }
  }
  if (ranges.length === 0) {
    return null;
  }
  // Merge overlapping ranges
  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i].start <= last.end) {
      last.end = Math.max(last.end, ranges[i].end);
    } else {
      merged.push(ranges[i]);
    }
  }
  const totalMs = merged.reduce((sum, r) => sum + (r.end - r.start), 0);
  return Math.round(totalMs / (365.25 * 24 * 60 * 60 * 1000) * 10) / 10;
}

/**
 * Resolve experience years with fallback to workHistory date ranges.
 * If parseExperienceYears returns a value, use it.
 * Otherwise, compute from workHistory startDate/endDate ranges.
 */
export function resolveExperienceYears(
  experience: string | null | undefined,
  workHistory: unknown,
): number | null {
  const parsed = parseExperienceYears(experience);
  if (parsed !== null) return parsed;
  return computeExperienceFromWorkHistory(workHistory);
}

// ── Digest filter types and matching ────────────────────────────────────

export type DigestFilterArgs = {
  maxExperience?: number;
  education?: string[];
  skills?: string[];
  requiredKeywords?: string[];
  minSalary?: number;
  maxSalary?: number;
  roleFilterType?: string;
  minRoleYears?: number;
  minAge?: number;
  maxAge?: number;
  locations?: string[];
  sources?: string[];
  showArchived?: boolean;
};

export interface DigestRecord {
  isArchived?: boolean;
  source?: string;
  sourceKey?: string;
  searchText?: string;
  age?: number;
  locationText?: string;
  educationLevel?: string;
  salaryMin?: number;
  salaryMax?: number;
  experienceYears?: number;
  roleTypes?: string[];
  roleYearsByType?: Record<string, number>;
}

import { isLocationMatch } from "./location-tree.js";

export function matchesResumeDigestFilters(digest: DigestRecord, filters: DigestFilterArgs | undefined): boolean {
  if (!filters?.showArchived && digest.isArchived === true) return false;
  if (!filters) return true;

  if (typeof filters.maxExperience === "number" && (digest.experienceYears === undefined || digest.experienceYears > filters.maxExperience)) return false;
  if (filters.education?.length && (!digest.educationLevel || !filters.education.includes(digest.educationLevel))) return false;
  const haystack = digest.searchText?.toLowerCase() ?? "";
  if (filters.skills?.length && !filters.skills.some((skill) => haystack.includes(skill.toLowerCase()))) return false;
  if (filters.requiredKeywords?.length && !filters.requiredKeywords.every((kw) => haystack.includes(kw.toLowerCase()))) return false;
  if (filters.locations?.length && !filters.locations.some((target) => isLocationMatch(digest.locationText ?? "", target))) return false;
  if (typeof filters.minSalary === "number") {
    const maxSalary = digest.salaryMax ?? digest.salaryMin;
    if (maxSalary !== undefined && maxSalary < filters.minSalary) return false;
  }
  if (typeof filters.maxSalary === "number") {
    const minSalary = digest.salaryMin ?? digest.salaryMax;
    if (minSalary === undefined || minSalary > filters.maxSalary) return false;
  }
  if (filters.roleFilterType && !_hasDigestRoleType(digest, filters.roleFilterType)) return false;
  if (typeof filters.minRoleYears === "number" && filters.minRoleYears > 0) {
    const roleYears = filters.roleFilterType
      ? digest.roleYearsByType?.[filters.roleFilterType.toLowerCase()] ?? 0
      : Math.max(...Object.values(digest.roleYearsByType ?? {}), 0);
    if (roleYears < filters.minRoleYears) return false;
  }
  if (typeof filters.minAge === "number" && typeof digest.age === "number" && digest.age < filters.minAge) return false;
  if (typeof filters.maxAge === "number" && typeof digest.age === "number" && digest.age > filters.maxAge) return false;
  if (filters.sources?.length) {
    const source = digest.sourceKey ?? digest.source;
    if (!source || !filters.sources.includes(source)) return false;
  }
  return true;
}

function _hasDigestRoleType(digest: DigestRecord, roleFilterType: string): boolean {
  const key = roleFilterType.toLowerCase();
  return (digest.roleTypes ?? []).some((role) => role.toLowerCase() === key)
    || typeof digest.roleYearsByType?.[key] === "number";
}
