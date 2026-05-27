import { useCallback, useEffect, useMemo, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import type { CandidateStatus } from '@/types/resume'

export type CandidateStatusRecord = {
  _id: string
  identityKey: string
  workspaceSlug: string
  status: CandidateStatus
  notes?: string
  updatedBy?: string
  updatedAt: number
  history?: Array<{
    status: string
    updatedAt: number
    notes?: string
  }>
}

type StatusListResponse = {
  success: boolean
  items?: CandidateStatusRecord[]
}

type StatusUpdateResponse = {
  success: boolean
  item?: CandidateStatusRecord
}

export function useCandidateStatus(enabled: boolean = true) {
  const [items, setItems] = useState<CandidateStatusRecord[]>([])
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
    const { data, error: apiError } = await rawApiClient.GET<StatusListResponse>('/api/candidate-status')
    if (apiError || !data?.success) {
      setError('Failed to load candidate status')
      setLoading(false)
      return
    }
    setItems(Array.isArray(data.items) ? data.items : [])
    setLoading(false)
  }, [enabled])

  const updateStatus = useCallback(
    async (identityKey: string, status: CandidateStatus, notes?: string) => {
      const normalized = identityKey.trim()
      if (!normalized) {
        return false
      }

      const { data, error: apiError } = await rawApiClient.POST<StatusUpdateResponse>('/api/candidate-status', {
        body: {
          identityKey: normalized,
          status,
          notes,
        },
      })

      if (apiError || !data?.success) {
        setError('Failed to update candidate status')
        return false
      }

      await load()
      return true
    },
    [load]
  )

  const bulkUpdateStatus = useCallback(
    async (entries: Array<{ identityKey: string; status: CandidateStatus }>) => {
      const CHUNK_SIZE = 10
      const CHUNK_DELAY_MS = 100
      let failures = 0
      for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        if (i > 0) await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS))
        const chunk = entries.slice(i, i + CHUNK_SIZE)
        const results = await Promise.all(
          chunk.map(({ identityKey, status }) => {
            const normalized = identityKey.trim()
            if (!normalized) return Promise.resolve(false)
            return rawApiClient.POST<StatusUpdateResponse>('/api/candidate-status', {
              body: { identityKey: normalized, status },
            }).then(({ data, error: apiError }) => {
              if (apiError || !data?.success) { failures++; return false }
              return true
            })
          })
        )
        if (results.every((r) => r === false)) break
      }
      await load()
      return failures === 0
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

  const statusByIdentity = useMemo(() => {
    const map: Record<string, CandidateStatusRecord> = {}
    items.forEach((item) => {
      map[item.identityKey] = item
    })
    return map
  }, [items])

  return {
    items,
    statusByIdentity,
    loading,
    error,
    reload: load,
    updateStatus,
    bulkUpdateStatus,
  }
}
