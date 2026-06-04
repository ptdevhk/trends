/**
 * BFF-side resume filter matching — extracted from routes/resumes.ts for
 * testability.  Mirrors the Convex `matchesResumeListFilters` logic so the
 * three execution paths (Convex, BFF AND-mode, BFF OR-mode) stay aligned.
 */
import {
  formatLocationHierarchySearchText,
  getVerifiedRoleSignalYears,
  type AnalysisRoleSignalLike,
  isLocationMatch,
  isRecord,
  normalizeResumeLocationHierarchy,
  parseRawSalaryRange,
  resolveResumeAnalysisSourceKey,
  resolveExperienceYears,
} from "@trends/shared";
import { normalizeEducationLevel } from "./resume-service.js";

// ---------------------------------------------------------------------------
// Re-exported parse helpers (canonical source: resume-ingest-utils.ts)
// ---------------------------------------------------------------------------

import { toStringValue, toOptionalNumber } from "./resume-ingest-utils.js";
export { toStringValue, toOptionalNumber };

// ---------------------------------------------------------------------------
// Internal helpers (also extracted so tests don't need to replicate them)
// ---------------------------------------------------------------------------

export function parseAgeFromContentField(content: Record<string, unknown>): number | null {
  const ageStr = toStringValue(content.age);
  if (!ageStr) return null;
  const match = ageStr.match(/(\d+)/);
  return match ? parseInt(match[1]!, 10) : null;
}

// ---------------------------------------------------------------------------
// Exported filter type and function
// ---------------------------------------------------------------------------

export type BffResumeFilters = {
  maxExperience?: number;
  education?: string[];
  skills?: string[];
  requiredKeywords?: string[];
  locations?: string[];
  minSalary?: number;
  maxSalary?: number;
  minRoleYears?: number;
  roleFilterType?: string;
  minAge?: number;
  maxAge?: number;
  sources?: string[];
  showArchived?: boolean;
};

/**
 * BFF-side resume filter matching for AND-mode full-table scan.
 * Mirrors the Convex matchesResumeListFilters logic; searchText is
 * passed pre-lowered from the AND-mode scan loop to avoid re-lowering.
 */
export function bffMatchesResumeFilters(
  doc: Record<string, unknown>,
  loweredSearchText: string,
  filters: BffResumeFilters,
): boolean {
  if (!filters.showArchived && doc.isArchived === true) return false;

  const content = isRecord(doc.content) ? doc.content : {};
  const ingestData = isRecord(doc.ingestData) ? doc.ingestData : {};

  if (typeof filters.maxExperience === "number") {
    const expStr = toStringValue(content.experience) ?? "";
    const expYears = resolveExperienceYears(expStr, content.workHistory);
    if (expYears === null) {
      // Unknown experience — exclude if maxExperience is set (cannot guarantee cap)
      return false;
    } else {
      if (expYears > filters.maxExperience) return false;
    }
  }

  if (filters.education?.length) {
    const edu = toStringValue(content.education) ?? "";
    const level = normalizeEducationLevel(edu);
    if (!level || !filters.education.includes(level)) return false;
  }

  if (filters.skills?.length) {
    // Use full searchText (includes name, workHistory, industryTags, synonyms, etc.)
    // rather than only ingestData.industryTags — matches Convex behavior.
    if (!filters.skills.some((skill) => loweredSearchText.includes(skill.toLowerCase()))) return false;
  }

  if (filters.requiredKeywords?.length) {
    if (!filters.requiredKeywords.every((kw) => loweredSearchText.includes(kw.toLowerCase()))) return false;
  }

  if (filters.locations?.length) {
    const locationHierarchy = normalizeResumeLocationHierarchy(content, toStringValue(doc.source) ?? undefined);
    const location = formatLocationHierarchySearchText(locationHierarchy) || (toStringValue(content.location) ?? "");
    if (!filters.locations.some((target) => isLocationMatch(location, target))) return false;
  }

  if (typeof filters.minSalary === "number" || typeof filters.maxSalary === "number") {
    const salaryStr = toStringValue(content.expectedSalary) ?? "";
    const salary = parseRawSalaryRange(salaryStr);
    if (!salary) {
      // Unknown salary — exclude if maxSalary is set (cannot guarantee cap),
      // but skip minSalary (resume might meet the minimum).
      if (typeof filters.maxSalary === "number") return false;
    } else {
      if (typeof filters.minSalary === "number") {
        const maxSalary = salary.max ?? salary.min;
        if (maxSalary !== undefined && maxSalary < filters.minSalary) return false;
      }
      if (typeof filters.maxSalary === "number") {
        const minSalary = salary.min ?? salary.max;
        if (minSalary !== undefined && minSalary > filters.maxSalary) return false;
      }
    }
  }

  if (filters.roleFilterType) {
    // Match Convex hasMatchingRoleSignal: check verifiedRoleYears first, then roleSignals
    const key = filters.roleFilterType.toLowerCase();
    const verifiedRoleYears = isRecord(ingestData.verifiedRoleYears)
      ? ingestData.verifiedRoleYears as Record<string, unknown>
      : {};
    const hasVerifiedRole = typeof verifiedRoleYears[key] === "number";
    let hasMatchingRole = hasVerifiedRole;
    if (!hasMatchingRole) {
      const roleSignals: unknown[] = Array.isArray(ingestData.roleSignals)
        ? ingestData.roleSignals as unknown[]
        : [];
      hasMatchingRole = roleSignals.some((signal: unknown) => {
        if (!isRecord(signal)) return false;
        return typeof signal.type === "string" && signal.type.toLowerCase() === key;
      });
    }
    if (!hasMatchingRole) return false;
  }

  if (typeof filters.minRoleYears === "number" && filters.minRoleYears > 0) {
    const verifiedRoleYears = isRecord(ingestData.verifiedRoleYears)
      ? ingestData.verifiedRoleYears as Record<string, unknown>
      : {};
    const precomputed = filters.roleFilterType
      ? toOptionalNumber(verifiedRoleYears[filters.roleFilterType]) ?? undefined
      : (Object.values(verifiedRoleYears).some((v) => (toOptionalNumber(v) ?? 0) >= filters.minRoleYears!) ? filters.minRoleYears : undefined);
    if (precomputed !== undefined) {
      if (precomputed < filters.minRoleYears) return false;
    } else {
      const roleSignals = Array.isArray(ingestData.roleSignals) ? (ingestData.roleSignals as AnalysisRoleSignalLike[]) : [];
      const fallback = filters.roleFilterType
        ? getVerifiedRoleSignalYears(roleSignals, filters.roleFilterType)
        : Math.max(...roleSignals.map((sig) => typeof sig.type === "string" ? getVerifiedRoleSignalYears(roleSignals, sig.type) : 0), 0);
      if (fallback < filters.minRoleYears) return false;
    }
  }

  if (typeof filters.minAge === "number" || typeof filters.maxAge === "number") {
    const age = toOptionalNumber(doc.age) ?? parseAgeFromContentField(content);
    if (age !== null) {
      if (typeof filters.minAge === "number" && age < filters.minAge) return false;
      if (typeof filters.maxAge === "number" && age > filters.maxAge) return false;
    }
  }

  if (filters.sources?.length) {
    const resumeSourceKey = (typeof doc.sourceKey === 'string' ? doc.sourceKey : undefined)
      ?? resolveResumeAnalysisSourceKey({ source: toStringValue(doc.source) ?? undefined });
    if (!resumeSourceKey || !filters.sources.includes(resumeSourceKey)) return false;
  }

  return true;
}
