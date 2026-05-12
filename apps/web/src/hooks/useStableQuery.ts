import { useRef } from 'react'
import { useQuery } from 'convex/react'
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from 'convex/server'

/**
 * Wraps Convex `useQuery` to hold stale data during transitions.
 * When a component remounts (e.g., back/forward navigation), `useQuery`
 * returns `undefined` while re-subscribing — causing a loading flash.
 * This hook returns the last non-undefined result instead.
 */
export function useStableQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...args: OptionalRestArgs<Query>
): FunctionReturnType<Query> | undefined {
  const result = useQuery(query, ...args)
  const stableRef = useRef(result)

  if (result !== undefined) {
    stableRef.current = result
  }

  return stableRef.current
}
