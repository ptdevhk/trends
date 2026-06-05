import { useCallback, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useWorkspace } from '@/contexts/WorkspaceContext'
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

type CandidateStatusWriteResponse = {
  success: boolean
}

export function useCandidateStatus(enabled: boolean = true) {
  const { slug: workspaceSlug } = useWorkspace()

  const rawItems = useQuery(
    api.candidate_status.list,
    enabled ? { workspaceSlug } : 'skip',
  )

  const items: CandidateStatusRecord[] = useMemo(() => {
    if (!rawItems) return []
    return rawItems.map((item) => ({
      _id: item._id,
      identityKey: item.identityKey,
      workspaceSlug: item.workspaceSlug,
      status: item.status as CandidateStatus,
      notes: item.notes,
      updatedBy: item.updatedBy,
      updatedAt: item.updatedAt,
      history: item.history,
    }))
  }, [rawItems])

  const updateStatus = useCallback(
    async (identityKey: string, status: CandidateStatus, notes?: string) => {
      const normalized = identityKey.trim()
      if (!normalized) {
        return false
      }

      try {
        const { data, error: apiError } = await rawApiClient.POST<CandidateStatusWriteResponse>('/api/candidate-status', {
          body: {
            identityKey: normalized,
            status,
            notes,
          },
        })
        return !apiError && data?.success === true
      } catch {
        return false
      }
    },
    [],
  )

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
    loading: rawItems === undefined,
    error: null,
    reload: () => {}, // no-op: Convex subscription is reactive
    updateStatus,
  }
}
