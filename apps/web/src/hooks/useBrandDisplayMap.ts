import { useBrandDisplayMapResolve } from '@/contexts/BrandDisplayMapContext'

/**
 * Returns a resolve function that maps brand IDs to display names.
 * Data is fetched once by BrandDisplayMapProvider (at app level) and shared
 * across all consumers — no per-component HTTP requests.
 */
export function useBrandDisplayMap() {
  return useBrandDisplayMapResolve()
}
