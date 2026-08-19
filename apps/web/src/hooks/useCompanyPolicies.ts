import { useCallback, useEffect, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import type { CompanyPolicyPreset } from '@trends/shared'

export type CompanyAlias = {
  aliasDisplay: string
  aliasNormalized: string
  source: string
}

export type CompanyItem = {
  _id: string
  companyKey: string
  status: string
  displayName: string
  nameCn?: string
  nameEn?: string
  createdAt: number
  updatedAt: number
  /** Soft-delete marker; set → the company is archived. */
  archivedAt?: number
  aliases: CompanyAlias[]
}

export type CompanyPolicyItem = {
  companyKey: string
  displayName: string
  nameCn?: string
  nameEn?: string
  status: string
  scopeType: string
  scopeId: string
  revision: number
  effects: {
    visibility?: string
    workflow?: string
    rankingEffect?: string
    reasonCodes?: string[]
    summary?: string
  } | null
  createdAt: number
  createdBy?: string
}

type ListResponse<T> = {
  success: boolean
  items?: T[]
}

export type PolicyScope = 'workspace' | 'cn' | 'my'

type CompanyPolicyCache = {
  companies: CompanyItem[]
  policies: CompanyPolicyItem[]
  /** Market-scoped policy rows, keyed by lowercase market id (T5). */
  marketPolicies: { cn: CompanyPolicyItem[]; my: CompanyPolicyItem[] }
  loadedAt: number
}

/**
 * Module cache so list cards share one fetch per workspace session. Keyed by
 * mode so a restricted (non-admin) load never pollutes the admin cache and
 * vice versa — otherwise a role switch would surface stale market layers.
 */
type CacheMode = 'full' | 'restricted'
let caches: Record<CacheMode, CompanyPolicyCache | null> = { full: null, restricted: null }
let inflights: Record<CacheMode, Promise<CompanyPolicyCache | null> | null> = {
  full: null,
  restricted: null,
}
const listeners = new Set<() => void>()

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

async function fetchCompanyPolicyData(includeMarkets: boolean): Promise<CompanyPolicyCache | null> {
  try {
    if (!includeMarkets) {
      const [companiesResult, policiesResult] = await Promise.all([
        // Archived companies are hidden by default server-side; the companies
        // tab opts in so operators can restore them.
        rawApiClient.GET<ListResponse<CompanyItem>>('/api/companies?includeArchived=true'),
        rawApiClient.GET<ListResponse<CompanyPolicyItem>>('/api/company-policies'),
      ])

      if (companiesResult.error || !companiesResult.data?.success) {
        return null
      }
      if (policiesResult.error || !policiesResult.data?.success) {
        return null
      }

      return {
        companies: Array.isArray(companiesResult.data.items) ? companiesResult.data.items : [],
        policies: Array.isArray(policiesResult.data.items) ? policiesResult.data.items : [],
        marketPolicies: { cn: [], my: [] },
        loadedAt: Date.now(),
      }
    }

    const [companiesResult, policiesResult, cnPoliciesResult, myPoliciesResult] = await Promise.all([
      // Archived companies are hidden by default server-side; the companies
      // tab opts in so operators can restore them.
      rawApiClient.GET<ListResponse<CompanyItem>>('/api/companies?includeArchived=true'),
      rawApiClient.GET<ListResponse<CompanyPolicyItem>>('/api/company-policies'),
      rawApiClient.GET<ListResponse<CompanyPolicyItem>>('/api/company-policies?market=cn'),
      rawApiClient.GET<ListResponse<CompanyPolicyItem>>('/api/company-policies?market=my'),
    ])

    if (companiesResult.error || !companiesResult.data?.success) {
      return null
    }
    if (policiesResult.error || !policiesResult.data?.success) {
      return null
    }
    // Market-scope reads are admin-only (T5); non-admins get 403, which is
    // treated as an empty market layer rather than a hard failure.
    if (cnPoliciesResult.error && cnPoliciesResult.response?.status !== 403) {
      return null
    }
    if (myPoliciesResult.error && myPoliciesResult.response?.status !== 403) {
      return null
    }

    const cnPolicies = cnPoliciesResult.error
      ? []
      : Array.isArray(cnPoliciesResult.data?.items)
        ? cnPoliciesResult.data.items
        : []
    const myPolicies = myPoliciesResult.error
      ? []
      : Array.isArray(myPoliciesResult.data?.items)
        ? myPoliciesResult.data.items
        : []

    return {
      companies: Array.isArray(companiesResult.data.items) ? companiesResult.data.items : [],
      policies: Array.isArray(policiesResult.data.items) ? policiesResult.data.items : [],
      marketPolicies: { cn: cnPolicies, my: myPolicies },
      loadedAt: Date.now(),
    }
  } catch {
    return null
  }
}

async function loadShared(force = false, includeMarkets = true): Promise<CompanyPolicyCache | null> {
  const mode: CacheMode = includeMarkets ? 'full' : 'restricted'
  if (!force && caches[mode]) {
    return caches[mode]
  }
  if (!force && inflights[mode]) {
    return inflights[mode]
  }

  inflights[mode] = (async () => {
    const next = await fetchCompanyPolicyData(includeMarkets)
    if (next) {
      caches[mode] = next
      notifyListeners()
    }
    inflights[mode] = null
    return next
  })()

  return inflights[mode]
}

export function useCompanyPolicies(enabled: boolean = true, includeMarkets: boolean = true) {
  const mode: CacheMode = includeMarkets ? 'full' : 'restricted'
  const [companies, setCompanies] = useState<CompanyItem[]>(caches[mode]?.companies ?? [])
  const [policies, setPolicies] = useState<CompanyPolicyItem[]>(caches[mode]?.policies ?? [])
  const [marketPolicies, setMarketPolicies] = useState<{
    cn: CompanyPolicyItem[]
    my: CompanyPolicyItem[]
  }>(caches[mode]?.marketPolicies ?? { cn: [], my: [] })
  const [loading, setLoading] = useState(enabled && !caches[mode])
  const [error, setError] = useState<string | null>(null)

  const applyCache = useCallback((next: CompanyPolicyCache | null) => {
    if (!next) {
      return
    }
    setCompanies(next.companies)
    setPolicies(next.policies)
    setMarketPolicies(next.marketPolicies)
  }, [])

  const load = useCallback(async (force = false) => {
    if (!enabled) {
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const next = await loadShared(force, includeMarkets)
    if (!next) {
      setError('Failed to load company policies')
      setLoading(false)
      return
    }
    applyCache(next)
    setLoading(false)
  }, [applyCache, enabled, includeMarkets])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const listener = () => {
      const current = caches[includeMarkets ? 'full' : 'restricted']
      if (current) {
        applyCache(current)
      }
    }
    listeners.add(listener)
    void load(false)
    return () => {
      listeners.delete(listener)
    }
  }, [applyCache, enabled, includeMarkets, load])

  const seedCanonical = useCallback(
    async (seedNoHireForWorkspace: boolean = true) => {
      const { data, error: apiError } = await rawApiClient.POST<{
        success: boolean
        companiesCreated?: number
        companiesUpdated?: number
        aliasesCreated?: number
        policiesSeeded?: number
        policyRevision?: number | null
      }>('/api/companies/seed', {
        body: { seedNoHireForWorkspace },
      })
      if (apiError || !data?.success) {
        setError('Failed to seed companies')
        return null
      }
      await load(true)
      return data
    },
    [load],
  )

  const upsertCompany = useCallback(
    async (input: {
      companyKey: string
      displayName: string
      nameCn?: string
      nameEn?: string
      status?: 'provisional' | 'confirmed' | 'merged'
    }) => {
      const { data, error: apiError } = await rawApiClient.POST<{
        success: boolean
        companyKey?: string
        created?: boolean
      }>('/api/companies', { body: input })
      if (apiError || !data?.success) {
        setError('Failed to save company')
        return false
      }
      await load(true)
      return true
    },
    [load],
  )

  const addAlias = useCallback(
    async (companyKey: string, alias: string) => {
      const { data, error: apiError } = await rawApiClient.POST<{
        success: boolean
        created?: boolean
      }>('/api/companies/aliases', {
        body: { companyKey, alias },
      })
      if (apiError || !data?.success) {
        setError('Failed to add alias')
        return false
      }
      await load(true)
      return true
    },
    [load],
  )

  const setCompanyArchived = useCallback(
    async (companyKey: string, archived: boolean) => {
      const { data, error: apiError } = await rawApiClient.POST<{
        success: boolean
        companyKey?: string
        archived?: boolean
        archivedAt?: number | null
      }>(`/api/companies/${encodeURIComponent(companyKey)}/archive`, {
        body: { archived },
      })
      if (apiError || !data?.success) {
        setError('Failed to update company archive state')
        return false
      }
      await load(true)
      return true
    },
    [load],
  )

  const setPolicyPreset = useCallback(
    async (
      companyKey: string,
      preset: CompanyPolicyPreset,
      summary?: string,
      scope: PolicyScope = 'workspace',
    ) => {
      const { data, error: apiError } = await rawApiClient.POST<{
        success: boolean
        revision?: number
      }>('/api/company-policies', {
        body: {
          companyKey,
          preset,
          ...(summary ? { summary } : {}),
          ...(scope === 'cn' || scope === 'my' ? { market: scope } : {}),
        },
      })
      if (apiError || !data?.success) {
        setError('Failed to update company policy')
        return false
      }
      await load(true)
      return true
    },
    [load],
  )

  return {
    companies,
    policies,
    marketPolicies,
    loading,
    error,
    load: () => load(true),
    seedCanonical,
    upsertCompany,
    addAlias,
    setPolicyPreset,
    setCompanyArchived,
  }
}
