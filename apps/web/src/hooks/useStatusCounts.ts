import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import type { ConvexResumeFilters } from "./useConvexResumes";

export interface StatusCounts {
  new: number;
  shortlisted: number;
  rejected: number;
  total: number;
  overflow: boolean;
  loading: boolean;
}

export type StatusCountFilters = ConvexResumeFilters & {
  showBlocked?: boolean;
};

interface UseStatusCountsParams {
  enabled?: boolean;
  filters: StatusCountFilters;
  workspaceSlug: string;
  useAndModeBff: boolean;
  bffStatusCounts?: { new: number; shortlisted: number; rejected: number };
}

interface CountResumesByStatusResult {
  new: number;
  shortlisted: number;
  rejected: number;
  total: number;
  overflow: boolean;
}

export function useStatusCounts(params: UseStatusCountsParams): StatusCounts {
  const { enabled = true, filters, workspaceSlug, useAndModeBff, bffStatusCounts } = params;

  // Always call useMemo unconditionally (skip building args for BFF path)
  const queryArgs = useMemo(() => {
    if (!enabled || useAndModeBff) return "skip" as const;
    return {
      workspaceSlug,
      ...(filters.maxExperience != null ? { maxExperience: filters.maxExperience } : {}),
      ...(filters.minRoleYears != null ? { minRoleYears: filters.minRoleYears } : {}),
      ...(filters.roleFilterType ? { roleFilterType: filters.roleFilterType } : {}),
      ...(filters.minAge != null ? { minAge: filters.minAge } : {}),
      ...(filters.maxAge != null ? { maxAge: filters.maxAge } : {}),
      ...(filters.education?.length ? { education: filters.education } : {}),
      ...(filters.skills?.length ? { skills: filters.skills } : {}),
      ...(filters.requiredKeywords?.length ? { requiredKeywords: filters.requiredKeywords } : {}),
      ...(filters.keywords?.length ? { keywords: filters.keywords } : {}),
      ...(filters.locations?.length ? { locations: filters.locations } : {}),
      ...(filters.minSalary != null ? { minSalary: filters.minSalary } : {}),
      ...(filters.maxSalary != null ? { maxSalary: filters.maxSalary } : {}),
      ...(filters.sources?.length ? { sources: filters.sources } : {}),
      ...(filters.showBlocked === true ? { showBlocked: true } : {}),
    };
  }, [enabled, filters, workspaceSlug, useAndModeBff]);

  // Always call useQuery unconditionally
  const result = useQuery(api.resumes.countResumesByStatus, queryArgs as never) as CountResumesByStatusResult | undefined;

  if (!enabled) {
    return { new: 0, shortlisted: 0, rejected: 0, total: 0, overflow: false, loading: false };
  }

  // BFF path: counts come from the BFF response
  if (useAndModeBff) {
    if (bffStatusCounts) {
      return {
        new: bffStatusCounts.new,
        shortlisted: bffStatusCounts.shortlisted,
        rejected: bffStatusCounts.rejected,
        total: bffStatusCounts.new + bffStatusCounts.shortlisted + bffStatusCounts.rejected,
        overflow: false,
        loading: false,
      };
    }
    return { new: 0, shortlisted: 0, rejected: 0, total: 0, overflow: false, loading: true };
  }

  // Convex direct path
  if (result === undefined) {
    return { new: 0, shortlisted: 0, rejected: 0, total: 0, overflow: false, loading: true };
  }

  return {
    new: result.new ?? 0,
    shortlisted: result.shortlisted ?? 0,
    rejected: result.rejected ?? 0,
    total: result.total ?? 0,
    overflow: result.overflow ?? false,
    loading: false,
  };
}
