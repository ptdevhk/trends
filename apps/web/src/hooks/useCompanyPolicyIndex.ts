import { useMemo } from 'react'
import {
  buildCompanyPolicyAliasIndex,
  matchResumeCompanyPolicies,
  type CompanyPolicyEffects,
  type CompanyPolicyIndexEntry,
  type CompanyPolicyMatchHit,
} from '@trends/shared'
import { useCompanyPolicies } from '@/hooks/useCompanyPolicies'

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
 */
export function useCompanyPolicyIndex(enabled: boolean = true) {
  const { companies, policies, loading, error, load } = useCompanyPolicies(enabled)

  const aliasIndex = useMemo(() => {
    const policiesByCompanyKey = new Map<string, CompanyPolicyEffects>()
    for (const item of policies) {
      if (!item.effects) {
        continue
      }
      policiesByCompanyKey.set(item.companyKey, item.effects as CompanyPolicyEffects)
    }
    const next = buildCompanyPolicyAliasIndex(companies, policiesByCompanyKey)
    lastAliasIndex = next
    return next
  }, [companies, policies])

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
