import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import { useWorkspace } from './WorkspaceContext'

type BrandDisplayEntry = {
  displayName: string
  zhHans: string
}

type BrandDisplayMap = Record<string, BrandDisplayEntry>

const BrandDisplayMapContext = createContext<BrandDisplayMap | null>(null)

export function BrandDisplayMapProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<BrandDisplayMap | null>(null)
  const { slug } = useWorkspace()

  useEffect(() => {
    let active = true
    setMap(null)

    rawApiClient
      .GET<BrandDisplayMap>('/api/industry/brand-display-map')
      .then(({ data }) => {
        if (active) setMap(data ?? null)
      })
      .catch((err: unknown) => {
        console.error('Failed to load brand display map', err)
        if (active) setMap(null)
      })

    return () => {
      active = false
    }
  }, [slug])

  return (
    <BrandDisplayMapContext.Provider value={map}>
      {children}
    </BrandDisplayMapContext.Provider>
  )
}

export function useBrandDisplayMapResolve() {
  const map = useContext(BrandDisplayMapContext)

  const resolve = useCallback(
    (brandId: string) => {
      const key = (brandId ?? '').trim().toLowerCase()
      if (!key) return ''
      return map?.[key]?.zhHans ?? brandId.toUpperCase()
    },
    [map],
  )

  return useMemo(() => ({ resolve }), [resolve])
}
