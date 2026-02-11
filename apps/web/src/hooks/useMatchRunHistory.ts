import { useCallback, useEffect, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'

export type MatchRunMode = 'rules_only' | 'hybrid' | 'ai_only'
export type MatchRunStatus = 'processing' | 'completed' | 'failed'

export type MatchRunItem = {
  id: string
  sessionId?: string
  jobDescriptionId: string
  sampleName?: string
  mode: MatchRunMode
  status: MatchRunStatus
  totalCount: number
  processedCount: number
  failedCount: number
  matchedCount?: number
  avgScore?: number
  startedAt: string
  completedAt?: string
  error?: string
}

type MatchRunsResponse = {
  success: boolean
  runs?: MatchRunItem[]
}

type UseMatchRunHistoryParams = {
  sessionId?: string
  jobDescriptionId?: string
  enabled?: boolean
  limit?: number
  pollIntervalMs?: number
}

export function useMatchRunHistory(params: UseMatchRunHistoryParams) {
  const {
    sessionId,
    jobDescriptionId,
    enabled = true,
    limit = 20,
    pollIntervalMs = 4000,
  } = params

  const [runs, setRuns] = useState<MatchRunItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRuns = useCallback(async () => {
    if (!enabled) return
    if (!sessionId && !jobDescriptionId) {
      setRuns([])
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: apiError } = await rawApiClient.GET<MatchRunsResponse>(
      '/api/resumes/match-runs',
      {
        params: {
          query: {
            sessionId,
            jobDescriptionId,
            limit,
          },
        },
      }
    )

    if (apiError || !data?.success) {
      setError('Failed to load analysis history')
      setLoading(false)
      return
    }

    setRuns(Array.isArray(data.runs) ? data.runs : [])
    setLoading(false)
  }, [enabled, jobDescriptionId, limit, sessionId])

  useEffect(() => {
    void fetchRuns()
  }, [fetchRuns])

  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(() => {
      void fetchRuns()
    }, pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, fetchRuns, pollIntervalMs])

  return {
    runs,
    loading,
    error,
    refresh: fetchRuns,
  }
}
