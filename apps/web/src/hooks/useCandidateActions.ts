import { useCallback, useEffect, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import {
  actionToAiFeedback,
  type AiFeedbackSentiment,
  type AiFeedbackState,
  type AiFeedbackTarget,
  type CandidateAction,
  type CandidateActionType,
} from '@/types/resume'

function setFeedbackState(
  current: Record<string, AiFeedbackState>,
  resumeId: string,
  target: AiFeedbackTarget,
  sentiment: AiFeedbackSentiment
): Record<string, AiFeedbackState> {
  return {
    ...current,
    [resumeId]: {
      ...current[resumeId],
      [target === 'ai_score' ? 'score' : 'summary']: sentiment,
    },
  }
}

export function useCandidateActions(sessionId?: string, jobDescriptionId?: string, enabled: boolean = true) {
  const [actionsByResume, setActionsByResume] = useState<Record<string, CandidateActionType>>({})
  const [aiFeedbackByResume, setAiFeedbackByResume] = useState<Record<string, AiFeedbackState>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadActions = useCallback(async () => {
    if (!enabled || !sessionId) return
    setLoading(true)
    setError(null)

    const { data, error: apiError } = await rawApiClient.GET<{
      success: boolean
      actions?: CandidateAction[]
    }>('/api/actions', {
      params: {
        query: {
          sessionId,
          jobDescriptionId,
          latestOnly: 'true',
        },
      },
    })

    if (apiError || !data?.success) {
      setError('Failed to load actions')
      setLoading(false)
      return
    }

    const nextActionsByResume: Record<string, CandidateActionType> = {}
    let nextAiFeedbackByResume: Record<string, AiFeedbackState> = {}

    ;(data.actions ?? []).forEach((action) => {
      const feedback = actionToAiFeedback(action.actionType)
      if (feedback) {
        nextAiFeedbackByResume = setFeedbackState(
          nextAiFeedbackByResume,
          action.resumeId,
          feedback.target,
          feedback.sentiment
        )
        return
      }

      nextActionsByResume[action.resumeId] = action.actionType
    })

    setActionsByResume(nextActionsByResume)
    setAiFeedbackByResume(nextAiFeedbackByResume)
    setLoading(false)
  }, [enabled, jobDescriptionId, sessionId])

  const saveAction = useCallback(
    async (payload: { resumeId: string; actionType: CandidateActionType; actionData?: Record<string, unknown> }) => {
      if (!sessionId) return null

      const { data, error: apiError } = await rawApiClient.POST<{
        success: boolean
        action?: CandidateAction
      }>('/api/actions', {
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

      const feedback = actionToAiFeedback(payload.actionType)
      if (feedback) {
        setAiFeedbackByResume((prev) =>
          setFeedbackState(prev, payload.resumeId, feedback.target, feedback.sentiment)
        )
      } else {
        setActionsByResume((prev) => ({
          ...prev,
          [payload.resumeId]: payload.actionType,
        }))
      }

      return data.action ?? null
    },
    [sessionId]
  )

  const getAiFeedback = useCallback(
    (resumeId: string, target: AiFeedbackTarget): AiFeedbackSentiment | undefined => {
      const feedback = aiFeedbackByResume[resumeId]
      if (!feedback) {
        return undefined
      }
      return target === 'ai_score' ? feedback.score : feedback.summary
    },
    [aiFeedbackByResume]
  )

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      setError(null)
      return
    }
    void loadActions()
  }, [enabled, loadActions])

  useEffect(() => {
    if (!enabled || !sessionId) {
      setActionsByResume({})
      setAiFeedbackByResume({})
    }
  }, [enabled, sessionId])

  return {
    actions: actionsByResume,
    actionsByResume,
    aiFeedbackByResume,
    loading,
    error,
    reload: loadActions,
    saveAction,
    getAiFeedback,
  }
}
