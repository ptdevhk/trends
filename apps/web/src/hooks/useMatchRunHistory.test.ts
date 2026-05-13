import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useMatchRunHistory } from './useMatchRunHistory'

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(async () => ({ data: { success: true, runs: [] } })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

describe('useMatchRunHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches runs on mount when enabled with sessionId', async () => {
    const runs = [{ id: 'run-1', jobDescriptionId: 'jd-1', mode: 'hybrid', status: 'completed', totalCount: 10, processedCount: 10, failedCount: 0, startedAt: '2026-05-13T00:00:00Z' }]
    mockApiClient.GET.mockResolvedValueOnce({ data: { success: true, runs } })

    const { result } = renderHook(() => useMatchRunHistory({ sessionId: 's-1' }))
    await act(async () => {})

    expect(result.current.runs).toHaveLength(1)
    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes/match-runs', {
      params: { query: { sessionId: 's-1', jobDescriptionId: undefined, limit: 20 } },
    })
  })

  it('does not fetch when enabled but no sessionId or jobDescriptionId', async () => {
    const { result } = renderHook(() => useMatchRunHistory({ enabled: true }))
    await act(async () => {})

    expect(mockApiClient.GET).not.toHaveBeenCalled()
    expect(result.current.runs).toEqual([])
  })

  it('does not fetch when disabled', async () => {
    renderHook(() => useMatchRunHistory({ sessionId: 's-1', enabled: false }))
    await act(async () => {})

    expect(mockApiClient.GET).not.toHaveBeenCalled()
  })

  it('sets error on API failure', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: { success: false } })
    const { result } = renderHook(() => useMatchRunHistory({ sessionId: 's-1' }))
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load analysis history')
  })

  it('sets error on network error', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: null, error: 'timeout' })
    const { result } = renderHook(() => useMatchRunHistory({ sessionId: 's-1' }))
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load analysis history')
  })

  it('polls at specified interval', async () => {
    mockApiClient.GET.mockResolvedValue({ data: { success: true, runs: [] } })

    renderHook(() => useMatchRunHistory({ sessionId: 's-1', pollIntervalMs: 5000 }))
    await act(async () => {})

    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(mockApiClient.GET).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(mockApiClient.GET).toHaveBeenCalledTimes(3)
  })

  it('clears interval on unmount', async () => {
    mockApiClient.GET.mockResolvedValue({ data: { success: true, runs: [] } })

    const { unmount } = renderHook(() => useMatchRunHistory({ sessionId: 's-1', pollIntervalMs: 5000 }))
    await act(async () => {})

    unmount()

    await act(async () => {
      vi.advanceTimersByTime(10000)
    })

    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)
  })

  it('uses custom limit', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: { success: true, runs: [] } })
    renderHook(() => useMatchRunHistory({ jobDescriptionId: 'jd-1', limit: 5 }))
    await act(async () => {})

    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes/match-runs', {
      params: { query: { sessionId: undefined, jobDescriptionId: 'jd-1', limit: 5 } },
    })
  })
})
