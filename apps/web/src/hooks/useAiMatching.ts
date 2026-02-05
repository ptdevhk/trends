import { useCallback, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import type { MatchStats, MatchingResult } from '@/types/resume'

export type MatchRequest = {
  sessionId?: string
  sample?: string
  jobDescriptionId: string
  resumeIds?: string[]
  limit?: number
}

export function useAiMatching() {
  const [results, setResults] = useState<MatchingResult[]>([])
  const [stats, setStats] = useState<MatchStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matchAll = useCallback(async (payload: MatchRequest) => {
    setLoading(true)
    setError(null)

    const { data, error: apiError } = await (apiClient as any).POST('/api/resumes/match', {
      body: payload,
    })

    if (apiError || !data?.success) {
      setError('Failed to run AI matching')
      setLoading(false)
      return null
    }

    setResults(data.results ?? [])
    setStats(data.stats ?? null)
    setLoading(false)
    return data
  }, [])

  const fetchMatches = useCallback(async (sessionId: string, jobDescriptionId?: string) => {
    setLoading(true)
    setError(null)

    const { data, error: apiError } = await (apiClient as any).GET('/api/resumes/matches', {
      params: {
        query: {
          sessionId,
          jobDescriptionId,
        },
      },
    })

    if (apiError || !data?.success) {
      setError('Failed to load match results')
      setLoading(false)
      return null
    }

    const nextResults = data.results ?? []
    setResults(nextResults)
    if (nextResults.length) {
      const processed = nextResults.length
      const matched = nextResults.filter((item: MatchingResult) => item.score >= 50).length
      const avgScore = Number((nextResults.reduce((sum: number, item: MatchingResult) => sum + item.score, 0) / processed).toFixed(2))
      setStats({ processed, matched, avgScore })
    } else {
      setStats(null)
    }
    setLoading(false)
    return data
  }, [])

  return {
    results,
    stats,
    loading,
    error,
    matchAll,
    fetchMatches,
  }
}
