import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// We test the stable-pagination logic in isolation by verifying the pattern:
// when status is "LoadingFirstPage", the hook returns the stored (previous) result.

vi.mock('convex/react', () => ({
  usePaginatedQuery: vi.fn(),
}))

import { usePaginatedQuery } from 'convex/react'

// Inline the useStablePaginatedQuery implementation to test it
import { useRef } from 'react'

function useStablePaginatedQuery(
  name: string,
  ...args: unknown[]
): ReturnType<typeof usePaginatedQuery> {
  const paginatedQueryFn = usePaginatedQuery as unknown as (...a: unknown[]) => ReturnType<typeof usePaginatedQuery>
  const result = paginatedQueryFn(name, ...args)
  const stored = useRef(result)
  if ((result as { status?: string }).status !== 'LoadingFirstPage') {
    stored.current = result
  }
  return stored.current as ReturnType<typeof usePaginatedQuery>
}

describe('useStablePaginatedQuery', () => {
  it('returns the stored (previous) result when status is LoadingFirstPage', () => {
    const mockUsePaginatedQuery = usePaginatedQuery as ReturnType<typeof vi.fn>

    // Initial render: status = "Loaded"
    const loadedResult = {
      results: [{ _id: '1', name: 'test' }],
      loadMore: vi.fn(),
      status: 'Loaded' as const,
      isLoading: false,
    }
    mockUsePaginatedQuery.mockReturnValue(loadedResult)

    const { result, rerender } = renderHook(() =>
      useStablePaginatedQuery('testQuery', { filter: 'a' }),
    )

    expect(result.current).toEqual(loadedResult)
    expect(result.current.status).toBe('Loaded')

    // Args change → status becomes LoadingFirstPage
    const loadingResult = {
      results: [],
      loadMore: vi.fn(),
      status: 'LoadingFirstPage' as const,
      isLoading: true,
    }
    mockUsePaginatedQuery.mockReturnValue(loadingResult)

    rerender()

    // Should still return the stored (previous) result, not the empty loading result
    expect(result.current.status).toBe('Loaded')
    expect(result.current.results).toEqual([{ _id: '1', name: 'test' }])
  })

  it('updates stored result when status transitions back to Loaded', () => {
    const mockUsePaginatedQuery = usePaginatedQuery as ReturnType<typeof vi.fn>

    // First: LoadingFirstPage (no prior result)
    const loadingResult = {
      results: [],
      loadMore: vi.fn(),
      status: 'LoadingFirstPage' as const,
      isLoading: true,
    }
    mockUsePaginatedQuery.mockReturnValue(loadingResult)

    const { result, rerender } = renderHook(() =>
      useStablePaginatedQuery('testQuery', { filter: 'a' }),
    )

    // First render with LoadingFirstPage — returns it (no prior stored result)
    expect(result.current.status).toBe('LoadingFirstPage')

    // Then: Loaded with new data
    const loadedResult = {
      results: [{ _id: '2', name: 'new' }],
      loadMore: vi.fn(),
      status: 'Loaded' as const,
      isLoading: false,
    }
    mockUsePaginatedQuery.mockReturnValue(loadedResult)

    rerender()

    expect(result.current.status).toBe('Loaded')
    expect(result.current.results).toEqual([{ _id: '2', name: 'new' }])
  })

  it('preserves results when LoadingMore (incremental load)', () => {
    const mockUsePaginatedQuery = usePaginatedQuery as ReturnType<typeof vi.fn>

    // Initial Loaded
    const initialResult = {
      results: [{ _id: '1' }],
      loadMore: vi.fn(),
      status: 'Loaded' as const,
      isLoading: false,
    }
    mockUsePaginatedQuery.mockReturnValue(initialResult)

    const { result, rerender } = renderHook(() =>
      useStablePaginatedQuery('testQuery', {}),
    )

    expect(result.current.results).toEqual([{ _id: '1' }])

    // LoadingMore — should return the live result (not stored)
    const loadingMoreResult = {
      results: [{ _id: '1' }, { _id: '2' }],
      loadMore: vi.fn(),
      status: 'LoadingMore' as const,
      isLoading: true,
    }
    mockUsePaginatedQuery.mockReturnValue(loadingMoreResult)

    rerender()

    // LoadingMore should pass through — results grow incrementally
    expect(result.current.status).toBe('LoadingMore')
    expect(result.current.results).toEqual([{ _id: '1' }, { _id: '2' }])
  })
})
