import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { MatchingResult, MatchStats } from '@/types/resume'
import { useAiMatching } from './useAiMatching'

const mockPost = vi.hoisted(() => vi.fn(async () => ({
  data: { success: true, results: [] as MatchingResult[], stats: null as MatchStats | null },
  error: undefined,
})))

const mockGet = vi.hoisted(() => vi.fn(async () => ({
  data: { success: true, results: [] as MatchingResult[] },
  error: undefined,
})))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { POST: mockPost, GET: mockGet },
}))

// mock fetch for SSE stream (not tested in detail here)
const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', mockFetch)

const sampleResult: MatchingResult = {
  resumeId: 'r1',
  score: 85,
  recommendation: 'strong_yes',
  highlights: ['React experience'],
  concerns: [],
  summary: 'Strong candidate',
  matchedAt: '2026-05-13T00:00:00Z',
}

const lowScoreResult: MatchingResult = {
  resumeId: 'r2',
  score: 30,
  recommendation: 'no',
  highlights: [],
  concerns: ['Lacks experience'],
  summary: 'Weak match',
  matchedAt: '2026-05-13T00:00:00Z',
}

describe('useAiMatching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with empty state', () => {
    const { result } = renderHook(() => useAiMatching())

    expect(result.current.results).toEqual([])
    expect(result.current.stats).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.progress).toBeNull()
  })

  it('fetchMatches loads results and calculates stats', async () => {
    mockGet.mockResolvedValueOnce({
      data: { success: true, results: [sampleResult, lowScoreResult] },
      error: undefined,
    })

    const { result } = renderHook(() => useAiMatching())

    await act(async () => {
      await result.current.fetchMatches('session-1', 'jd-1')
    })

    expect(result.current.results).toEqual([sampleResult, lowScoreResult])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.stats).toEqual({
      processed: 2,
      matched: 1,  // only r1 has score >= 50
      avgScore: 57.5,  // (85 + 30) / 2
    })
    expect(mockGet).toHaveBeenCalledWith('/api/resumes/matches', {
      params: { query: { sessionId: 'session-1', jobDescriptionId: 'jd-1' } },
    })
  })

  it('fetchMatches handles error', async () => {
    mockGet.mockResolvedValueOnce({
      data: undefined,
      error: { message: 'fail' },
    })

    const { result } = renderHook(() => useAiMatching())

    await act(async () => {
      await result.current.fetchMatches('session-1')
    })

    expect(result.current.error).toBe('Failed to load match results')
    expect(result.current.loading).toBe(false)
    expect(result.current.results).toEqual([])
  })

  it('fetchMatches handles success=false', async () => {
    mockGet.mockResolvedValueOnce({
      data: { success: false },
      error: undefined,
    })

    const { result } = renderHook(() => useAiMatching())

    await act(async () => {
      await result.current.fetchMatches('session-1')
    })

    expect(result.current.error).toBe('Failed to load match results')
  })

  it('matchAll POSTs and sets results (rules_only mode)', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: true, results: [sampleResult], stats: { processed: 1, matched: 1, avgScore: 85 } },
      error: undefined,
    })

    const { result } = renderHook(() => useAiMatching())

    await act(async () => {
      await result.current.matchAll({ sessionId: 's1', mode: 'rules_only' })
    })

    expect(result.current.results).toEqual([sampleResult])
    expect(result.current.stats).toEqual({ processed: 1, matched: 1, avgScore: 85 })
    expect(result.current.loading).toBe(false)
    expect(mockPost).toHaveBeenCalledWith('/api/resumes/match', {
      body: expect.objectContaining({ sessionId: 's1', mode: 'rules_only' }),
    })
  })

  it('matchAll defaults mode to hybrid', async () => {
    // hybrid mode will try to open SSE stream — mock fetch to reject
    mockFetch.mockRejectedValueOnce(new Error('no stream'))

    mockPost.mockResolvedValueOnce({
      data: { success: true, results: [], stats: null },
      error: undefined,
    })

    const { result } = renderHook(() => useAiMatching())

    await act(async () => {
      await result.current.matchAll({ sessionId: 's1' })
    })

    expect(mockPost).toHaveBeenCalledWith('/api/resumes/match', {
      body: expect.objectContaining({ mode: 'hybrid' }),
    })
  })

  it('matchAll handles POST error', async () => {
    mockPost.mockResolvedValueOnce({
      data: undefined,
      error: { message: 'fail' },
    })

    const { result } = renderHook(() => useAiMatching())

    await act(async () => {
      await result.current.matchAll({ sessionId: 's1', mode: 'rules_only' })
    })

    expect(result.current.error).toBe('Failed to run matching')
    expect(result.current.loading).toBe(false)
  })

  it('matchAll handles success=false', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: false },
      error: undefined,
    })

    const { result } = renderHook(() => useAiMatching())

    await act(async () => {
      await result.current.matchAll({ sessionId: 's1', mode: 'rules_only' })
    })

    expect(result.current.error).toBe('Failed to run matching')
  })

  it('matchAll sets loading during execution', async () => {
    let resolvePost: (v: unknown) => void
    mockPost.mockReturnValueOnce(new Promise((resolve) => { resolvePost = resolve }))

    const { result } = renderHook(() => useAiMatching())

    act(() => {
      void result.current.matchAll({ sessionId: 's1', mode: 'rules_only' })
    })

    // loading should be true while POST is pending
    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolvePost!({ data: { success: true, results: [] }, error: undefined })
    })

    expect(result.current.loading).toBe(false)
  })

  it('calcStats computes avgScore correctly', async () => {
    const results: MatchingResult[] = [
      { ...sampleResult, resumeId: 'a', score: 90 },
      { ...sampleResult, resumeId: 'b', score: 70 },
      { ...sampleResult, resumeId: 'c', score: 40 },
    ]

    mockGet.mockResolvedValueOnce({
      data: { success: true, results },
      error: undefined,
    })

    const { result } = renderHook(() => useAiMatching())

    await act(async () => {
      await result.current.fetchMatches('s1')
    })

    expect(result.current.stats).toEqual({
      processed: 3,
      matched: 2,  // 90 and 70 are >= 50
      avgScore: 66.67,  // (90 + 70 + 40) / 3
    })
  })
})
