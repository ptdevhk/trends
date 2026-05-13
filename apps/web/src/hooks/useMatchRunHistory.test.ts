import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { MatchRunItem } from './useMatchRunHistory'
import { useMatchRunHistory } from './useMatchRunHistory'

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(async () => ({
    data: { success: true, runs: [] as MatchRunItem[] },
    error: undefined,
  })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

const sampleRun: MatchRunItem = {
  id: 'run-1',
  jobDescriptionId: 'jd-1',
  sessionId: 's-1',
  mode: 'hybrid',
  status: 'completed',
  totalCount: 100,
  processedCount: 100,
  failedCount: 0,
  matchedCount: 42,
  avgScore: 0.85,
  startedAt: '2026-05-13T00:00:00Z',
  completedAt: '2026-05-13T00:01:00Z',
}

describe('useMatchRunHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches runs on mount when enabled with sessionId', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, runs: [sampleRun] },
      error: undefined,
    })

    const { result } = renderHook(() =>
      useMatchRunHistory({ sessionId: 's-1' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.runs).toEqual([sampleRun])
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes/match-runs', {
      params: { query: { sessionId: 's-1', jobDescriptionId: undefined, limit: 20 } },
    })
  })

  it('fetches runs on mount when enabled with jobDescriptionId', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, runs: [] },
      error: undefined,
    })

    const { result } = renderHook(() =>
      useMatchRunHistory({ jobDescriptionId: 'jd-1' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes/match-runs', {
      params: { query: { sessionId: undefined, jobDescriptionId: 'jd-1', limit: 20 } },
    })
  })

  it('does not fetch when disabled', () => {
    const { result } = renderHook(() =>
      useMatchRunHistory({ sessionId: 's-1', enabled: false })
    )

    expect(mockApiClient.GET).not.toHaveBeenCalled()
    expect(result.current.runs).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('does not fetch when neither sessionId nor jobDescriptionId provided', () => {
    const { result } = renderHook(() => useMatchRunHistory({}))

    expect(mockApiClient.GET).not.toHaveBeenCalled()
    expect(result.current.runs).toEqual([])
  })

  it('sets error on API error response', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: undefined,
      error: { message: 'Network error' },
    })

    const { result } = renderHook(() =>
      useMatchRunHistory({ sessionId: 's-1' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.error).toBe('Failed to load analysis history')
    expect(result.current.runs).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('sets error when success is false', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: false },
      error: undefined,
    })

    const { result } = renderHook(() =>
      useMatchRunHistory({ sessionId: 's-1' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.error).toBe('Failed to load analysis history')
  })

  it('polls at the configured interval', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, runs: [] },
      error: undefined,
    })

    renderHook(() =>
      useMatchRunHistory({ sessionId: 's-1', pollIntervalMs: 5000 })
    )

    // initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)

    // advance by 5s — one poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(mockApiClient.GET).toHaveBeenCalledTimes(2)

    // advance by another 5s — second poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(mockApiClient.GET).toHaveBeenCalledTimes(3)
  })

  it('stops polling when disabled changes to false', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, runs: [] },
      error: undefined,
    })

    const { rerender } = renderHook(
      (props) => useMatchRunHistory(props),
      { initialProps: { sessionId: 's-1', enabled: true, pollIntervalMs: 5000 } }
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)

    // disable
    rerender({ sessionId: 's-1', enabled: false, pollIntervalMs: 5000 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    // no additional calls after disable
    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)
  })

  it('refresh triggers a re-fetch', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, runs: [] },
      error: undefined,
    })

    const { result } = renderHook(() =>
      useMatchRunHistory({ sessionId: 's-1' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockApiClient.GET).toHaveBeenCalledTimes(2)
  })

  it('cleans up interval on unmount', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, runs: [] },
      error: undefined,
    })

    const { unmount } = renderHook(() =>
      useMatchRunHistory({ sessionId: 's-1', pollIntervalMs: 5000 })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    // only the initial fetch, no polling after unmount
    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)
  })

  it('defaults limit to 20 and pollIntervalMs to 4000', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, runs: [] },
      error: undefined,
    })

    renderHook(() => useMatchRunHistory({ sessionId: 's-1' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes/match-runs', {
      params: { query: { sessionId: 's-1', jobDescriptionId: undefined, limit: 20 } },
    })
  })
})
