import { useCallback, useMemo, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import type { MatchStats, MatchingResult } from '@/types/resume'

export type MatchRequest = {
  sessionId?: string
  sample?: string
  jobDescriptionId: string
  resumeIds?: string[]
  limit?: number
  mode?: 'rules_only' | 'hybrid' | 'ai_only'
}

export type MatchStreamRequest = {
  sessionId?: string
  sample?: string
  jobDescriptionId: string
  resumeIds?: string[]
  limit?: number
  concurrency?: number
  aiLimit?: number
  minRuleScore?: number
}

type MatchStreamProgress = {
  done: number
  total: number
}

type MatchStreamEvent =
  | { event: 'start'; data: { total: number; considered?: number; topN?: number; minScore?: number } }
  | { event: 'match'; data: { resumeId: string; result: MatchingResult; progress: MatchStreamProgress } }
  | { event: 'done'; data: { done: number; total: number } }
  | { event: 'error'; data: string }

const API_BASE = import.meta.env.VITE_API_URL || ''

function parseSseMessage(raw: string): { event: string; data: string } | null {
  const lines = raw.split(/\r?\n/g)
  let event = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim())
    }
  }

  const data = dataLines.join('\n').trim()
  if (!data) return null
  return { event, data }
}

function computeStats(nextResults: MatchingResult[]): MatchStats | null {
  if (!nextResults.length) return null
  const processed = nextResults.length
  const matched = nextResults.filter((item) => item.score >= 50).length
  const avgScore = Number((nextResults.reduce((sum, item) => sum + item.score, 0) / processed).toFixed(2))
  return { processed, matched, avgScore }
}

export function useAiMatching() {
  const [results, setResults] = useState<MatchingResult[]>([])
  const [stats, setStats] = useState<MatchStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [progress, setProgress] = useState<MatchStreamProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resultsMap = useMemo(() => new Map(results.map((item) => [item.resumeId, item])), [results])

  const matchAll = useCallback(async (payload: MatchRequest) => {
    setLoading(true)
    setError(null)

    const { data, error: apiError } = await rawApiClient.POST<{
      success: boolean
      results?: MatchingResult[]
      stats?: MatchStats
    }>('/api/resumes/match', {
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

    const { data, error: apiError } = await rawApiClient.GET<{
      success: boolean
      results?: MatchingResult[]
    }>('/api/resumes/matches', {
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

  const streamMatches = useCallback(async (payload: MatchStreamRequest) => {
    setStreaming(true)
    setError(null)
    setProgress(null)

    const response = await fetch(`${API_BASE}/api/resumes/match-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      setError(text || 'Failed to start AI stream')
      setStreaming(false)
      return null
    }

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ''

    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const parsed = parseSseMessage(part)
          if (!parsed) continue

          if (parsed.event === 'error') {
            setError(parsed.data)
            continue
          }

          let eventData: unknown
          try {
            eventData = JSON.parse(parsed.data)
          } catch (e) {
            console.error('Failed to parse SSE data', e)
            continue
          }

          const event = parsed.event as MatchStreamEvent['event']
          if (event === 'start') {
            const start = eventData as { total: number }
            setProgress({ done: 0, total: start.total })
            continue
          }

          if (event === 'match') {
            const match = eventData as { result: MatchingResult; progress: MatchStreamProgress }
            setProgress(match.progress)
            setResults((prev) => {
              const map = new Map(prev.map((item) => [item.resumeId, item]))
              map.set(match.result.resumeId, match.result)
              const next = Array.from(map.values())
              setStats(computeStats(next))
              return next
            })
            continue
          }

          if (event === 'done') {
            const doneEvent = eventData as { done: number; total: number }
            setProgress({ done: doneEvent.done, total: doneEvent.total })
          }
        }
      }

    } catch (e) {
      console.error('AI stream failed', e)
      setError('AI stream failed')
      return null
    } finally {
      setStreaming(false)
      reader.releaseLock()
    }

    return { success: true }
  }, [])

  return {
    results,
    stats,
    loading,
    streaming,
    progress,
    error,
    resultsMap,
    matchAll,
    fetchMatches,
    streamMatches,
  }
}
