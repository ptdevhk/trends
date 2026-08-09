import { useEffect, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'

/**
 * Verified-employer catalog count for the search results notice.
 *
 * Contract: `GET /api/company-industry-verified-employer-count` →
 * `{ success: true, count: number }` (60s-cached server side). The client
 * mirrors that with a 60s module-level cache so repeated mounts within the
 * window do not refetch.
 *
 * Fails silently: 401/404 (public share surfaces have no admin session) and
 * network errors yield `undefined` without console error spam — the caller
 * simply omits the notice.
 */
const CACHE_TTL_MS = 60_000

let cachedCount: number | undefined
let cachedAt = 0
let inflight: Promise<number | undefined> | null = null

function freshCount(): number | undefined {
  return cachedCount !== undefined && Date.now() - cachedAt < CACHE_TTL_MS
    ? cachedCount
    : undefined
}

async function fetchVerifiedEmployerCount(): Promise<number | undefined> {
  try {
    const { data, response } = await rawApiClient.GET<{ success: boolean; count: number }>(
      '/api/company-industry-verified-employer-count',
    )
    if (response?.status === 401 || response?.status === 404) return undefined
    const count = data && data.success === true && typeof data.count === 'number'
      ? data.count
      : undefined
    if (count !== undefined) {
      cachedCount = count
      cachedAt = Date.now()
    }
    return count
  } catch {
    // Silent: the notice is a progressive enhancement, never an error.
    return undefined
  }
}

export function useVerifiedEmployerCount(enabled = true): number | undefined {
  const [count, setCount] = useState<number | undefined>(() => freshCount())

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      const cached = freshCount()
      if (cached !== undefined) {
        setCount(cached)
        return
      }
      if (!inflight) {
        inflight = fetchVerifiedEmployerCount().finally(() => {
          inflight = null
        })
      }
      const next = await inflight
      if (!cancelled && next !== undefined) {
        setCount(next)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return count
}
