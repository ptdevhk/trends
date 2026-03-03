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

export function useCandidateStatus() {
  const [items, setItems] = useState<CandidateStatusRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
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
  }, [])

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

  useEffect(() => {
    void load()
  }, [load])

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
  }
}
