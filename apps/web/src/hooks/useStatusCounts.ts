import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import type { ConvexResumeFilters } from "./useConvexResumes";
import { CANDIDATE_STATUS_VALUES, type CandidateStatus } from "@/types/resume";

export type CandidateStatusCounts = Record<CandidateStatus, number>;

export type StatusCounts = CandidateStatusCounts & {
  total: number;
  overflow: boolean;
  loading: boolean;
};

export type StatusCountFilters = ConvexResumeFilters & {
  showBlocked?: boolean;
};

interface UseStatusCountsParams {
  enabled?: boolean;
  filters: StatusCountFilters;
  workspaceSlug: string;
  useAndModeBff: boolean;
  bffStatusCounts?: Partial<CandidateStatusCounts>;
}

type CountResumesByStatusResult = CandidateStatusCounts & {
  total: number;
  overflow: boolean;
};

function createEmptyStatusCounts(): CandidateStatusCounts {
  return {
    new: 0,
    shortlisted: 0,
    rejected: 0,
    contacted: 0,
    interviewing: 0,
    interviewed_pass: 0,
    interviewed_reject: 0,
    appeal_submitted: 0,
    human_review: 0,
    upheld: 0,
    reversed: 0,
    offer: 0,
    hired: 0,
    withdrawn: 0,
  };
}

function normalizeStatusCounts(input: Partial<CandidateStatusCounts> | undefined): CandidateStatusCounts {
  const counts = createEmptyStatusCounts();
  if (!input) {
    return counts;
  }

  CANDIDATE_STATUS_VALUES.forEach((status) => {
    counts[status] = input[status] ?? 0;
  });
  return counts;
}

function sumStatusCounts(counts: CandidateStatusCounts): number {
  return CANDIDATE_STATUS_VALUES.reduce((total, status) => total + counts[status], 0);
}

function withMetadata(
  counts: CandidateStatusCounts,
  metadata: { total?: number; overflow: boolean; loading: boolean },
): StatusCounts {
  return {
    ...counts,
    total: metadata.total ?? sumStatusCounts(counts),
    overflow: metadata.overflow,
    loading: metadata.loading,
  };
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
    return withMetadata(createEmptyStatusCounts(), { total: 0, overflow: false, loading: false });
  }

  // BFF path: counts come from the BFF response
  if (useAndModeBff) {
    if (bffStatusCounts) {
      const counts = normalizeStatusCounts(bffStatusCounts);
      return withMetadata(counts, { overflow: false, loading: false });
    }
    return withMetadata(createEmptyStatusCounts(), { total: 0, overflow: false, loading: true });
  }

  // Convex direct path
  if (result === undefined) {
    return withMetadata(createEmptyStatusCounts(), { total: 0, overflow: false, loading: true });
  }

  const counts = normalizeStatusCounts(result);
  return withMetadata(counts, {
    total: result.total ?? 0,
    overflow: result.overflow ?? false,
    loading: false,
  });
}
