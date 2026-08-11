import { useEffect, useMemo } from 'react'
import {
  buildCompanyPolicyAliasIndex,
  matchResumeCompanyPolicies,
  type CompanyPolicyEffects,
  type CompanyPolicyIndexEntry,
  type CompanyPolicyMatchHit,
} from '@trends/shared'
import { useCompanyPolicies } from '@/hooks/useCompanyPolicies'
import { useWorkspace } from '@/contexts/WorkspaceContext'

/** Last-built alias index for bulk handlers outside React render. */
let lastAliasIndex: Map<string, CompanyPolicyIndexEntry> = new Map()

export function matchResumeCompanyPolicyCached(input: {
  workHistory?: Array<{ companyName?: string; raw?: string } | null | undefined> | null
  companyHits?: string[] | null
}): CompanyPolicyMatchHit[] {
  return matchResumeCompanyPolicies(input, lastAliasIndex)
}

/**
 * Workspace company-policy alias index for resume list/detail warning badges.
 * Policy is operational signal only — never rewrites AI score.
 *
 * The public resume surface is skipped entirely: the companies / policies
 * endpoints are workspace-gated (401 for anonymous viewers, 403 for
 * authenticated non-members), and policy badges are a workspace feature.
 */
export function useCompanyPolicyIndex(enabled: boolean = true) {
  const { isPublicSurface } = useWorkspace()
  const effectiveEnabled = enabled && !isPublicSurface
  const { companies, policies, loading, error, load } = useCompanyPolicies(effectiveEnabled)

  const aliasIndex = useMemo(() => {
    const policiesByCompanyKey = new Map<string, CompanyPolicyEffects>()
    for (const item of policies) {
      if (!item.effects) {
        continue
      }
      policiesByCompanyKey.set(item.companyKey, item.effects as CompanyPolicyEffects)
    }
    return buildCompanyPolicyAliasIndex(companies, policiesByCompanyKey)
  }, [companies, policies])

  // Keep the module cache for bulk handlers; do not mutate module state during render.
  useEffect(() => {
    lastAliasIndex = aliasIndex
  }, [aliasIndex])

  const matchResume = useMemo(() => {
    return (input: {
      workHistory?: Array<{ companyName?: string; raw?: string } | null | undefined> | null
      companyHits?: string[] | null
    }): CompanyPolicyMatchHit[] => matchResumeCompanyPolicies(input, aliasIndex)
  }, [aliasIndex])

  return {
    aliasIndex,
    loading,
    error,
    load,
    hasPolicies: aliasIndex.size > 0,
    matchResume,
  }
}
