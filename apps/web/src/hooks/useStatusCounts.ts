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

  // BFF path: counts come from the BFF response directly
  if (useAndModeBff) {
    if (bffStatusCounts) {
      return {
        new: bffStatusCounts.new,
        shortlisted: bffStatusCounts.shortlisted,
        rejected: bffStatusCounts.rejected,
        total:
          bffStatusCounts.new + bffStatusCounts.shortlisted + bffStatusCounts.rejected,
        overflow: false,
        loading: false,
      };
    }
    return {
      new: 0,
      shortlisted: 0,
      rejected: 0,
      total: 0,
      overflow: false,
      loading: true,
    };
  }

  // Convex direct path: call countResumesByStatus query
  const queryArgs = useMemo(() => {
    const args: Record<string, unknown> = { workspaceSlug };
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        args[key] = value;
      }
    }
    return args;
  }, [filters, workspaceSlug]);

  const result = useQuery(api.resumes.countResumesByStatus, queryArgs);

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
    new: (result as Record<string, number>).new ?? 0,
    shortlisted: (result as Record<string, number>).shortlisted ?? 0,
    rejected: (result as Record<string, number>).rejected ?? 0,
    total: (result as Record<string, number>).total ?? 0,
    overflow: (result as Record<string, boolean>).overflow ?? false,
    loading: false,
  };
}
