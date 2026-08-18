import { useCallback, useEffect, useMemo, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import type { CandidatePolicyOverride } from '@trends/shared'

type OverridesResponse = {
  success: boolean
  items?: CandidatePolicyOverride[]
}

export function overrideKey(resumeIdentity: string, companyKey: string): string {
  return `${resumeIdentity.trim()}::${companyKey.trim()}`
}

export function useCandidatePolicyOverrides(enabled: boolean = true) {
  const [items, setItems] = useState<CandidatePolicyOverride[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await rawApiClient.GET<OverridesResponse>(
      '/api/policy-overrides'
    )

    if (apiError || !data?.success) {
      setError('Failed to load candidate policy overrides')
      setLoading(false)
      return
    }

    setItems(Array.isArray(data.items) ? data.items : [])
    setLoading(false)
  }, [enabled])

  const setOverride = useCallback(
    async (
      resumeId: string,
      resumeIdentity: string,
      companyKey: string,
      reason: string
    ): Promise<boolean> => {
      const identity = resumeIdentity.trim()
      const key = companyKey.trim()
      if (!identity || !key || !reason.trim()) {
        return false
      }

      const { data, error: apiError } = await rawApiClient.POST<{ success: boolean }>(
        '/api/policy-overrides',
        {
          body: {
            resumeId,
            resumeIdentity: identity,
            companyKey: key,
            reason: reason.trim(),
          },
        }
      )

      if (apiError || !data?.success) {
        setError('Failed to set candidate policy override')
        return false
      }

      await load()
      return true
    },
    [load]
  )

  const removeOverride = useCallback(
    async (resumeIdentity: string, companyKey: string): Promise<boolean> => {
      const identity = resumeIdentity.trim()
      const key = companyKey.trim()
      if (!identity || !key) {
        return false
      }

      const { data, error: apiError } = await rawApiClient.DELETE<{
        success: boolean
        removed?: boolean
      }>('/api/policy-overrides', {
        params: {
          query: {
            resumeIdentity: identity,
            companyKey: key,
          },
        },
      })

      if (apiError || !data?.success) {
        setError('Failed to remove candidate policy override')
        return false
      }

      await load()
      return data.removed === true
    },
    [load]
  )

  useEffect(() => {
    if (!enabled) {
      setItems([])
      return
    }
    void load()
  }, [enabled, load])

  const overridesByKey = useMemo(() => {
    const map: Record<string, CandidatePolicyOverride> = {}
    items.forEach((item) => {
      map[overrideKey(item.resumeIdentity, item.companyKey)] = item
    })
    return map
  }, [items])

  return {
    items,
    overridesByKey,
    loading,
    error,
    reload: load,
    setOverride,
    removeOverride,
  }
}
