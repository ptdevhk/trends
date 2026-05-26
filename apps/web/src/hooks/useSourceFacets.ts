import { useEffect, useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { SourceFacet } from '@/components/SourceFacetSelect'

export function useSourceFacets(archived: boolean) {
  const [facets, setFacets] = useState<SourceFacet[] | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const fetchFacets = useAction(api.resumes_diagnostics.listDiagnosticsSourceFacets)

  useEffect(() => {
    let cancelled = false
    setFacets(undefined)
    setError(undefined)
    void fetchFacets({ archived })
      .then((result) => {
        if (!cancelled) setFacets(result as SourceFacet[])
      })
      .catch((err) => {
        if (!cancelled) setError(err)
      })
    return () => { cancelled = true }
  }, [fetchFacets, archived])

  return { facets, isLoading: facets === undefined && error === undefined, error }
}
