import { useCallback, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import type { MatchStats, MatchingResult } from '@/types/resume'

export type MatchMode = 'rules_only' | 'hybrid' | 'ai_only'

export type MatchRequest = {
  sessionId?: string
  sample?: string
  jobDescriptionId?: string
  keywords?: string[]
  location?: string
  resumeIds?: string[]
  limit?: number
  topN?: number
  mode?: MatchMode
}

type StreamProgress = {
  done: number
  total: number
}

type StreamResultPayload = {
  resumeId: string
  result: MatchingResult
  progress?: StreamProgress
}

type StreamRulesPayload = {
  results?: MatchingResult[]
  progress?: StreamProgress
}

type StreamDonePayload = {
  stats?: MatchStats
}

const rawBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
const baseUrl = rawBaseUrl.replace(/\/api\/?$/, '')

function mergeResult(results: MatchingResult[], incoming: MatchingResult): MatchingResult[] {
  const idx = results.findIndex((item) => item.resumeId === incoming.resumeId)
  if (idx === -1) return [...results, incoming]

  const next = [...results]
  next[idx] = {
    ...next[idx],
    ...incoming,
  }
  return next
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  const lines = block.split('\n')
  let event = 'message'
  const dataLines: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line) continue
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  if (dataLines.length === 0) return null

  try {
    return {
      event,
      data: JSON.parse(dataLines.join('')),
    }
  } catch {
    return null
  }
}

function calcStats(results: MatchingResult[]): MatchStats | null {
  if (results.length === 0) return null

  const processed = results.length
  const matched = results.filter((item) => item.score >= 50).length
  const avgScore = Number((results.reduce((sum, item) => sum + item.score, 0) / processed).toFixed(2))

  return { processed, matched, avgScore }
}

export function useAiMatching() {
  const [results, setResults] = useState<MatchingResult[]>([])
  const [stats, setStats] = useState<MatchStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<StreamProgress | null>(null)

  const consumeMatchStream = useCallback(async (payload: MatchRequest) => {
    const response = await fetch(`${baseUrl}/api/resumes/match-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok || !response.body) {
      throw new Error(`Failed to open stream (${response.status})`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      while (true) {
        const markerIndex = buffer.indexOf('\n\n')
        if (markerIndex < 0) break

        const block = buffer.slice(0, markerIndex)
        buffer = buffer.slice(markerIndex + 2)

        const parsed = parseSseBlock(block)
        if (!parsed) continue

        if (parsed.event === 'rules') {
          const data = parsed.data as StreamRulesPayload
          if (Array.isArray(data.results) && data.results.length > 0) {
            setResults(data.results)
            setStats(calcStats(data.results))
          }
          if (data.progress) {
            setProgress(data.progress)
          }
          continue
        }

        if (parsed.event === 'result') {
          const data = parsed.data as StreamResultPayload
          if (!data.result) continue

          setResults((prev) => {
            const next = mergeResult(prev, data.result)
            setStats(calcStats(next))
            return next
          })

          if (data.progress) {
            setProgress(data.progress)
          }
          continue
        }

        if (parsed.event === 'done') {
          const data = parsed.data as StreamDonePayload
          setStats(data.stats ?? null)
          setProgress(null)
          return
        }

        if (parsed.event === 'error') {
          const payload = parsed.data as { message?: string }
          throw new Error(payload.message || 'Stream failed')
        }
      }
    }
  }, [])

  const matchAll = useCallback(async (payload: MatchRequest) => {
    setLoading(true)
    setError(null)
    setProgress(null)

    const mode = payload.mode ?? 'hybrid'

    const { data, error: apiError } = await rawApiClient.POST<{
      success: boolean
      mode?: MatchMode
      results?: MatchingResult[]
      stats?: MatchStats
    }>('/api/resumes/match', {
      body: {
        ...payload,
        mode,
      },
    })

    if (apiError || !data?.success) {
      setError('Failed to run matching')
      setLoading(false)
      return null
    }

    setResults(data.results ?? [])
    setStats(data.stats ?? null)

    if (mode === 'hybrid') {
      try {
        await consumeMatchStream({
          ...payload,
          mode,
        })
      } catch (streamError) {
        console.error('Match stream failed', streamError)
        setError('AI streaming updates failed')
      }
    }

    setLoading(false)
    return data
  }, [consumeMatchStream])

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
    setStats(calcStats(nextResults))
    setLoading(false)
    return data
  }, [])

  return {
    results,
    stats,
    loading,
    error,
    progress,
    matchAll,
    fetchMatches,
  }
}
