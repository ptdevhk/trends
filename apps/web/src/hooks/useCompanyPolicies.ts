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

type CompanyPolicyCache = {
  companies: CompanyItem[]
  policies: CompanyPolicyItem[]
  loadedAt: number
}

/** Module cache so list cards share one fetch per workspace session. */
let cache: CompanyPolicyCache | null = null
let inflight: Promise<CompanyPolicyCache | null> | null = null
const listeners = new Set<() => void>()

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

async function fetchCompanyPolicyData(): Promise<CompanyPolicyCache | null> {
  try {
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
      loadedAt: Date.now(),
    }
  } catch {
    return null
  }
}

async function loadShared(force = false): Promise<CompanyPolicyCache | null> {
  if (!force && cache) {
    return cache
  }
  if (!force && inflight) {
    return inflight
  }

  inflight = (async () => {
    const next = await fetchCompanyPolicyData()
    if (next) {
      cache = next
      notifyListeners()
    }
    inflight = null
    return next
  })()

  return inflight
}

export function useCompanyPolicies(enabled: boolean = true) {
  const [companies, setCompanies] = useState<CompanyItem[]>(cache?.companies ?? [])
  const [policies, setPolicies] = useState<CompanyPolicyItem[]>(cache?.policies ?? [])
  const [loading, setLoading] = useState(enabled && !cache)
  const [error, setError] = useState<string | null>(null)

  const applyCache = useCallback((next: CompanyPolicyCache | null) => {
    if (!next) {
      return
    }
    setCompanies(next.companies)
    setPolicies(next.policies)
  }, [])

  const load = useCallback(async (force = false) => {
    if (!enabled) {
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const next = await loadShared(force)
    if (!next) {
      setError('Failed to load company policies')
      setLoading(false)
      return
    }
    applyCache(next)
    setLoading(false)
  }, [applyCache, enabled])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const listener = () => {
      if (cache) {
        applyCache(cache)
      }
    }
    listeners.add(listener)
    void load(false)
    return () => {
      listeners.delete(listener)
    }
  }, [applyCache, enabled, load])

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
    async (companyKey: string, preset: CompanyPolicyPreset, summary?: string) => {
      const { data, error: apiError } = await rawApiClient.POST<{
        success: boolean
        revision?: number
      }>('/api/company-policies', {
        body: {
          companyKey,
          preset,
          ...(summary ? { summary } : {}),
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
