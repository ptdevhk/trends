import { useEffect, useMemo } from 'react'
import {
  buildCompanyPolicyAliasIndex,
  deriveMarketFromSourceKey,
  matchResumeCompanyPolicies,
  resolvePolicyEffectsForCompanies,
  type CompanyPolicyEffects,
  type CompanyPolicyIndexEntry,
  type CompanyPolicyMatchHit,
} from '@trends/shared'
import { useCompanyPolicies, type CompanyPolicyItem } from '@/hooks/useCompanyPolicies'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { hasWorkspaceAdminAccess } from '@/lib/workspace-access'

export type CompanyPolicyMatchInput = {
  workHistory?: Array<{ companyName?: string; raw?: string } | null | undefined> | null
  companyHits?: string[] | null
  /** Resume source market key (schema field); routes the per-market index (T5). */
  sourceKey?: string | null
}

type AliasIndexByMarket = Record<'cn' | 'my', Map<string, CompanyPolicyIndexEntry>>

/** Last-built per-market alias indexes for bulk handlers outside React render. */
let lastAliasIndexByMarket: AliasIndexByMarket = { cn: new Map(), my: new Map() }

export function matchResumeCompanyPolicyCached(
  input: CompanyPolicyMatchInput,
): CompanyPolicyMatchHit[] {
  const market = deriveMarketFromSourceKey(input.sourceKey)
  return matchResumeCompanyPolicies(input, lastAliasIndexByMarket[market === 'MY' ? 'my' : 'cn'])
}

/**
 * Per-market company-policy alias index for resume list/detail warning badges.
 * Mirrors the BFF enforcer: market scope beats workspace scope per company
 * (workspace rows still apply in markets without their own row). Policy is
 * operational signal only — never rewrites AI score.
 *
 * The public resume surface is skipped entirely: the companies / policies
 * endpoints are workspace-gated (401 for anonymous viewers, 403 for
 * authenticated non-members), and policy badges are a workspace feature.
 */
export function useCompanyPolicyIndex(enabled: boolean = true) {
  const { isPublicSurface, slug } = useWorkspace()
  const { memberships } = useAuth()
  const isWorkspaceAdmin = hasWorkspaceAdminAccess(memberships, slug)
  const effectiveEnabled = enabled && !isPublicSurface
  const { companies, policies, marketPolicies, loading, error, load } =
    useCompanyPolicies(effectiveEnabled, isWorkspaceAdmin)

  const workspaceByCompanyKey = useMemo(() => {
    const map = new Map<string, CompanyPolicyEffects>()
    for (const item of policies) {
      if (!item.effects) {
        continue
      }
      map.set(item.companyKey, item.effects as CompanyPolicyEffects)
    }
    return map
  }, [policies])

  const aliasIndexByMarket = useMemo(() => {
    const buildIndex = (marketRows: CompanyPolicyItem[]): Map<string, CompanyPolicyIndexEntry> => {
      const marketByCompanyKey = new Map<string, CompanyPolicyEffects>()
      for (const item of marketRows) {
        if (!item.effects) {
          continue
        }
        marketByCompanyKey.set(item.companyKey, item.effects as CompanyPolicyEffects)
      }
      return buildCompanyPolicyAliasIndex(
        companies,
        resolvePolicyEffectsForCompanies([
          { scopeType: 'market', effectsByCompanyKey: marketByCompanyKey },
          { scopeType: 'workspace', effectsByCompanyKey: workspaceByCompanyKey },
        ]),
      )
    }
    return {
      cn: buildIndex(marketPolicies.cn),
      my: buildIndex(marketPolicies.my),
    }
  }, [companies, marketPolicies, workspaceByCompanyKey])

  // Keep the module cache for bulk handlers; do not mutate module state during render.
  useEffect(() => {
    lastAliasIndexByMarket = aliasIndexByMarket
  }, [aliasIndexByMarket])

  const matchResume = useMemo(() => {
    return (input: CompanyPolicyMatchInput): CompanyPolicyMatchHit[] => {
      const market = deriveMarketFromSourceKey(input.sourceKey)
      return matchResumeCompanyPolicies(input, aliasIndexByMarket[market === 'MY' ? 'my' : 'cn'])
    }
  }, [aliasIndexByMarket])

  return {
    aliasIndexByMarket,
    loading,
    error,
    load,
    hasPolicies: aliasIndexByMarket.cn.size > 0 || aliasIndexByMarket.my.size > 0,
    matchResume,
  }
}
