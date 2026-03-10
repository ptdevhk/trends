import { useCallback, useEffect, useMemo, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'

type BrandDisplayEntry = {
  displayName: string
  zhHans: string
}

type BrandDisplayMap = Record<string, BrandDisplayEntry>

export function useBrandDisplayMap() {
  const [map, setMap] = useState<BrandDisplayMap | null>(null)

  useEffect(() => {
    let mounted = true

    rawApiClient
      .GET<BrandDisplayMap>('/api/industry/brand-display-map')
      .then(({ data }) => {
        if (!mounted) return
        setMap(data ?? null)
      })
      .catch((err: unknown) => {
        console.error('Failed to load brand display map', err)
        if (mounted) setMap(null)
      })

    return () => {
      mounted = false
    }
  }, [])

  const resolve = useCallback(
    (brandId: string) => {
      const key = (brandId ?? '').trim().toLowerCase()
      if (!key) return ''
      return map?.[key]?.zhHans ?? brandId.toUpperCase()
    },
    [map]
  )

  return useMemo(() => ({ resolve }), [resolve])
}

