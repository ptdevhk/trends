import { useDeferredValue } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'

export function useSearchPrefetch(query: string | undefined) {
  const deferredQuery = useDeferredValue(query)
  const trimmed = (deferredQuery ?? '').trim()
  return useQuery(
    api.resumes.search,
    trimmed ? { query: trimmed, limit: 10 } : 'skip',
  )
}