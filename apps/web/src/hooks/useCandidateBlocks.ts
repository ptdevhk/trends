import { useCallback, useEffect, useMemo, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'

export type CandidateBlock = {
  _id: string
  identityKey: string
  workspaceSlug: string
  reason?: string
  blockedBy?: string
  blockedAt: number
}

type BlocksResponse = {
  success: boolean
  items?: CandidateBlock[]
}

export function useCandidateBlocks(enabled: boolean = true) {
  const [items, setItems] = useState<CandidateBlock[]>([])
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
    const { data, error: apiError } = await rawApiClient.GET<BlocksResponse>('/api/blocks')

    if (apiError || !data?.success) {
      setError('Failed to load candidate blocks')
      setLoading(false)
      return
    }

    setItems(Array.isArray(data.items) ? data.items : [])
    setLoading(false)
  }, [enabled])

  const blockCandidates = useCallback(
    async (identityKeys: string[], reason?: string) => {
      const normalized = Array.from(new Set(identityKeys.map((item) => item.trim()).filter((item) => item.length > 0)))
      if (normalized.length === 0) {
        return false
      }

      const { data, error: apiError } = await rawApiClient.POST<{ success: boolean }>('/api/blocks', {
        body: {
          identityKeys: normalized,
          reason,
        },
      })

      if (apiError || !data?.success) {
        setError('Failed to block candidates')
        return false
      }

      await load()
      return true
    },
    [load]
  )

  const unblockCandidate = useCallback(
    async (identityKey: string) => {
      const normalized = identityKey.trim()
      if (!normalized) {
        return false
      }

      const { data, error: apiError } = await rawApiClient.DELETE<{ success: boolean; removed?: boolean }>('/api/blocks', {
        params: {
          query: {
            identityKey: normalized,
          },
        },
      })

      if (apiError || !data?.success) {
        setError('Failed to unblock candidate')
        return false
      }

      await load()
      return data.removed === true
    },
    [load]
  )

  const updateBlockReason = useCallback(
    async (identityKey: string, reason?: string) => {
      const normalized = identityKey.trim()
      if (!normalized) {
        return false
      }

      const { data, error: apiError } = await rawApiClient.PATCH<{ success: boolean; updated?: boolean }>('/api/blocks', {
        body: {
          identityKey: normalized,
          reason,
        },
      })

      if (apiError || !data?.success) {
        setError('Failed to update block reason')
        return false
      }

      await load()
      return data.updated === true
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

  const blocksByIdentity = useMemo(() => {
    const map: Record<string, CandidateBlock> = {}
    items.forEach((item) => {
      map[item.identityKey] = item
    })
    return map
  }, [items])

  return {
    items,
    blocksByIdentity,
    loading,
    error,
    reload: load,
    blockCandidates,
    unblockCandidate,
    updateBlockReason,
  }
}
