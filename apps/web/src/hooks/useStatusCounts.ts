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

interface UseStatusCountsParams {
  filters: ConvexResumeFilters;
  workspaceSlug: string;
  useAndModeBff: boolean;
  bffStatusCounts?: { new: number; shortlisted: number; rejected: number };
}

export function useStatusCounts(params: UseStatusCountsParams): StatusCounts {
  const { filters, workspaceSlug, useAndModeBff, bffStatusCounts } = params;

  // Convex direct path: call countResumesByStatus query
  const queryArgs = useMemo(() => {
    if (useAndModeBff) return "skip";
    return {
      workspaceSlug,
      maxExperience: filters.maxExperience,
      minRoleYears: filters.minRoleYears,
      roleFilterType: filters.roleFilterType,
      minAge: filters.minAge,
      maxAge: filters.maxAge,
      education: filters.education,
      skills: filters.skills,
      requiredKeywords: filters.requiredKeywords,
      locations: filters.locations,
      minSalary: filters.minSalary,
      maxSalary: filters.maxSalary,
      sources: filters.sources,
    };
  }, [filters, workspaceSlug, useAndModeBff]);

  const result = useQuery(api.resumes.countResumesByStatus, queryArgs);

  // BFF path: counts come from the BFF response directly
  if (useAndModeBff) {
    return {
      new: bffStatusCounts?.new ?? 0,
      shortlisted: bffStatusCounts?.shortlisted ?? 0,
      rejected: bffStatusCounts?.rejected ?? 0,
      total:
        (bffStatusCounts?.new ?? 0) +
        (bffStatusCounts?.shortlisted ?? 0) +
        (bffStatusCounts?.rejected ?? 0),
      overflow: false,
      loading: !bffStatusCounts,
    };
  }

  if (result === undefined) {
    return {
      new: 0,
      shortlisted: 0,
      rejected: 0,
      total: 0,
      overflow: false,
      loading: true,
    };
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
