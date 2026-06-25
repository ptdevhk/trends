import { useCallback, useEffect, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import { classifyApiError, getAuthErrorTranslationKey, type AuthErrorType } from '@/lib/auth-errors'
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

function extractRating(action: CandidateAction): number | undefined {
  if (action.actionType !== 'rating') return undefined
  const rating = action.actionData?.rating
  return typeof rating === 'number' && rating >= 0 && rating <= 5 ? rating : undefined
}

function extractRatingFromActionType(actionType: CandidateActionType, actionData?: Record<string, unknown>): number | undefined {
  if (actionType !== 'rating') return undefined
  const rating = actionData?.rating
  return typeof rating === 'number' && rating >= 0 && rating <= 5 ? rating : undefined
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error as { status: unknown }
    return typeof status === 'number' ? status : undefined
  }
  return undefined
}

export function useCandidateActions(sessionId?: string, jobDescriptionId?: string, enabled: boolean = true) {
  const [actionsByResume, setActionsByResume] = useState<Record<string, CandidateActionType>>({})
  const [aiFeedbackByResume, setAiFeedbackByResume] = useState<Record<string, AiFeedbackState>>({})
  const [ratingsByResume, setRatingsByResume] = useState<Record<string, number>>({})
  const [commentsByResume, setCommentsByResume] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authError, setAuthError] = useState<AuthErrorType>(null)

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
    const nextRatingsByResume: Record<string, number> = {}
    const nextCommentsByResume: Record<string, string> = {}

    ;(data.actions ?? []).forEach((action) => {
      const rating = extractRating(action)
      if (rating !== undefined) {
        if (rating > 0) {
          nextRatingsByResume[action.resumeId] = rating
        }
        return
      }

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

      if (action.actionType === 'note') {
        const text = action.actionData?.text
        if (typeof text === 'string' && text.length > 0) {
          nextCommentsByResume[action.resumeId] = text
        }
      }
      nextActionsByResume[action.resumeId] = action.actionType
    })

    setActionsByResume(nextActionsByResume)
    setAiFeedbackByResume(nextAiFeedbackByResume)
    setRatingsByResume(nextRatingsByResume)
    setCommentsByResume(nextCommentsByResume)
    setLoading(false)
  }, [enabled, jobDescriptionId, sessionId])

  const saveAction = useCallback(
    async (payload: { resumeId: string; actionType: CandidateActionType; actionData?: Record<string, unknown> }) => {
      if (!sessionId) return null

      // Optimistic update: apply the action/rating immediately
      const rating = extractRatingFromActionType(payload.actionType, payload.actionData)
      const previousRating = ratingsByResume[payload.resumeId]
      const previousAction = actionsByResume[payload.resumeId]
      const previousFeedback = aiFeedbackByResume[payload.resumeId]
      const previousComment = commentsByResume[payload.resumeId]

      if (rating !== undefined) {
        if (rating === 0) {
          setRatingsByResume((prev) => {
            const next = { ...prev }
            delete next[payload.resumeId]
            return next
          })
        } else {
          setRatingsByResume((prev) => ({ ...prev, [payload.resumeId]: rating }))
        }
      } else {
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
          if (payload.actionType === 'note') {
            const text = payload.actionData?.text
            if (typeof text === 'string' && text.length > 0) {
              setCommentsByResume((prev) => ({ ...prev, [payload.resumeId]: text }))
            }
          }
        }
      }

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

      if (apiError || !data?.success || !data.action) {
        // Revert optimistic update on error
        if (rating !== undefined) {
          if (previousRating !== undefined) {
            setRatingsByResume((prev) => ({ ...prev, [payload.resumeId]: previousRating }))
          } else {
            setRatingsByResume((prev) => {
              const next = { ...prev }
              delete next[payload.resumeId]
              return next
            })
          }
        } else {
          const feedback = actionToAiFeedback(payload.actionType)
          if (feedback) {
            setAiFeedbackByResume((prev) => {
              const next = { ...prev }
              if (previousFeedback) {
                next[payload.resumeId] = previousFeedback
              } else {
                delete next[payload.resumeId]
              }
              return next
            })
          } else {
            setActionsByResume((prev) => {
              const next = { ...prev }
              if (previousAction) {
                next[payload.resumeId] = previousAction
              } else {
                delete next[payload.resumeId]
              }
              return next
            })
            if (payload.actionType === 'note') {
              setCommentsByResume((prev) => {
                const next = { ...prev }
                if (previousComment) {
                  next[payload.resumeId] = previousComment
                } else {
                  delete next[payload.resumeId]
                }
                return next
              })
            }
          }
        }

        const errorStatus = getErrorStatus(apiError)
        const authErrorType = classifyApiError(errorStatus, data as { error?: string } | undefined)
        if (authErrorType) {
          setAuthError(authErrorType)
          setError(getAuthErrorTranslationKey(authErrorType))
        } else {
          setError('Failed to save action')
        }
        return null
      }

      return data.action ?? null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setAiFeedbackByResume uses functional update; aiFeedbackByResume not read directly
    [sessionId, ratingsByResume, actionsByResume, commentsByResume]
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
      setRatingsByResume({})
    }
  }, [enabled, sessionId])

  return {
    actions: actionsByResume,
    actionsByResume,
    aiFeedbackByResume,
    ratingsByResume,
    commentsByResume,
    loading,
    error,
    authError,
    reload: loadActions,
    saveAction,
    getAiFeedback,
  }
}
