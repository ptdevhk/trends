import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useSourceFacets } from './useSourceFacets'

const mockFetchFacets = vi.fn()
let mockResult: unknown = undefined

vi.mock('convex/react', () => ({
  useAction: () => mockFetchFacets,
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: { resumes: { listDiagnosticsSourceFacets: 'resumes/listDiagnosticsSourceFacets' } },
}))

describe('useSourceFacets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchFacets.mockImplementation(() => Promise.resolve(mockResult))
  })

  it('returns loading state initially', () => {
    mockFetchFacets.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSourceFacets(false))
    expect(result.current.isLoading).toBe(true)
    expect(result.current.facets).toBeUndefined()
  })

  it('fetches and returns facets on success', async () => {
    mockResult = [{ source: '51job', count: 10 }]
    const { result } = renderHook(() => useSourceFacets(false))
    await act(async () => {})

    expect(result.current.facets).toEqual([{ source: '51job', count: 10 }])
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
  })

  it('passes archived param to fetchFacets', async () => {
    mockResult = []
    renderHook(() => useSourceFacets(true))
    await act(async () => {})

    expect(mockFetchFacets).toHaveBeenCalledWith({ archived: true })
  })

  it('sets error when fetch fails', async () => {
    const err = new Error('network')
    mockFetchFacets.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useSourceFacets(false))
    await act(async () => {})

    expect(result.current.error).toBe(err)
    expect(result.current.isLoading).toBe(false)
  })

  it('cancels state update on unmount', async () => {
    let resolvePromise: (value: unknown) => void
    mockFetchFacets.mockReturnValue(
      new Promise((resolve) => { resolvePromise = resolve }),
    )
    const { unmount } = renderHook(() => useSourceFacets(false))

    unmount()
    resolvePromise!([{ source: '51job', count: 5 }])

    // Should not throw or update state after unmount
    await act(async () => {})
  })
})
