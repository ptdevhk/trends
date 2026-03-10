import { useCallback, useEffect, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'

export type BrandDisplayMap = Record<
  string,
  {
    displayName: string
    zhHans: string
  }
>

function normalizeBrandId(value: string): string {
  return value.trim().toLowerCase()
}

export function useBrandDisplayMap() {
  const [map, setMap] = useState<BrandDisplayMap | null>(null)

  useEffect(() => {
    let mounted = true

    rawApiClient.GET<BrandDisplayMap>('/api/industry/brand-display-map')
      .then(({ data, error }) => {
        if (!mounted) return
        if (error || !data) {
          setMap(null)
          return
        }
        setMap(data)
      })
      .catch((err: unknown) => {
        console.error('Failed to load brand display map', err)
        if (mounted) {
          setMap(null)
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  const resolve = useCallback((brandId: string): string => {
    const normalized = normalizeBrandId(brandId)
    if (!normalized) {
      return ''
    }
    const resolved = map?.[normalized]?.zhHans
    return resolved || brandId.toUpperCase()
  }, [map])

  return { resolve, map }
}

