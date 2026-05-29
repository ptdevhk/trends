import { useRef } from 'react'
import { usePaginatedQuery } from 'convex/react'

/**
 * Wraps usePaginatedQuery to hold the last complete result while loading
 * new filter args. Prevents flash-of-empty when Convex resets to
 * LoadingFirstPage on arg change.
 *
 * During LoadingFirstPage, returns the previously-stored complete result.
 * During LoadingMore, Loaded, and Exhausted, passes through live results.
 */
export function useStablePaginatedQuery(
  query: Parameters<typeof usePaginatedQuery>[0],
  args: Parameters<typeof usePaginatedQuery>[1],
  options: Parameters<typeof usePaginatedQuery>[2],
): ReturnType<typeof usePaginatedQuery> {
  const result = usePaginatedQuery(query, args, options)
  const stored = useRef(result)

  if (result.status !== 'LoadingFirstPage') {
    stored.current = result
  }

  return stored.current
}
