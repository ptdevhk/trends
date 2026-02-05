import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import type { CandidateAction, CandidateActionType } from '@/types/resume'

export function useCandidateActions(sessionId?: string) {
  const [actions, setActions] = useState<Record<string, CandidateActionType>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadActions = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)

    const { data, error: apiError } = await (apiClient as any).GET('/api/actions', {
      params: {
        query: {
          sessionId,
          latestOnly: 'true',
        },
      },
    })

    if (apiError || !data?.success) {
      setError('Failed to load actions')
      setLoading(false)
      return
    }

    const map: Record<string, CandidateActionType> = {}
    ;(data.actions as CandidateAction[]).forEach((action) => {
      map[action.resumeId] = action.actionType
    })

    setActions(map)
    setLoading(false)
  }, [sessionId])

  const saveAction = useCallback(
    async (payload: { resumeId: string; actionType: CandidateActionType; actionData?: Record<string, unknown> }) => {
      if (!sessionId) return null
      const { data, error: apiError } = await (apiClient as any).POST('/api/actions', {
        body: {
          sessionId,
          resumeId: payload.resumeId,
          actionType: payload.actionType,
          actionData: payload.actionData,
        },
      })

      if (apiError || !data?.success) {
        setError('Failed to save action')
        return null
      }

      setActions((prev) => ({
        ...prev,
        [payload.resumeId]: payload.actionType,
      }))

      return data.action as CandidateAction
    },
    [sessionId]
  )

  useEffect(() => {
    loadActions()
  }, [loadActions])

  useEffect(() => {
    if (!sessionId) {
      setActions({})
    }
  }, [sessionId])

  return {
    actions,
    loading,
    error,
    reload: loadActions,
    saveAction,
  }
}
