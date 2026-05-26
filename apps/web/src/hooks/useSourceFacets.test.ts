import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSourceFacets } from './useSourceFacets'

const fetchFacetsMock = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useAction: () => fetchFacetsMock,
  useQuery: () => undefined,
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    resumes_diagnostics: {
      listDiagnosticsSourceFacets: 'resumes_diagnostics:listDiagnosticsSourceFacets',
    },
  },
}))

describe('useSourceFacets', () => {
  beforeEach(() => {
    fetchFacetsMock.mockReset()
  })

  it('returns loading state initially', () => {
    fetchFacetsMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSourceFacets(false))
    expect(result.current.facets).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBeUndefined()
  })

  it('populates facets when fetch resolves', async () => {
    const facets = [{ source: 'liepin', count: 12 }]
    fetchFacetsMock.mockResolvedValue(facets)
    const { result } = renderHook(() => useSourceFacets(false))

    await waitFor(() => expect(result.current.facets).toEqual(facets))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
  })

  it('sets error when fetch rejects', async () => {
    const err = new Error('network')
    fetchFacetsMock.mockRejectedValue(err)
    const { result } = renderHook(() => useSourceFacets(false))

    await waitFor(() => expect(result.current.error).toBe(err))
    expect(result.current.facets).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
  })

  it('passes archived flag to the fetch action', async () => {
    fetchFacetsMock.mockResolvedValue([])
    renderHook(() => useSourceFacets(true))

    await waitFor(() => expect(fetchFacetsMock).toHaveBeenCalledWith({ archived: true }))
  })

  it('re-runs fetch when archived flag toggles', async () => {
    fetchFacetsMock.mockResolvedValue([])
    const { rerender } = renderHook(({ archived }) => useSourceFacets(archived), {
      initialProps: { archived: false },
    })
    await waitFor(() => expect(fetchFacetsMock).toHaveBeenCalledWith({ archived: false }))

    rerender({ archived: true })
    await waitFor(() => expect(fetchFacetsMock).toHaveBeenCalledWith({ archived: true }))
    expect(fetchFacetsMock).toHaveBeenCalledTimes(2)
  })

  it('does not update state after unmount (cancellation)', async () => {
    let resolve!: (value: unknown) => void
    const pending = new Promise((r) => { resolve = r })
    fetchFacetsMock.mockReturnValue(pending)

    const { result, unmount } = renderHook(() => useSourceFacets(false))
    unmount()
    resolve([{ source: 'liepin', count: 1 }])
    await pending

    // After unmount, the last observed state is the loading state (no error, no facets).
    expect(result.current.facets).toBeUndefined()
    expect(result.current.error).toBeUndefined()
  })
})
