import { useEffect, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'

export type EvidenceMode = 'legacy-seed' | 'strict-reviewed'

export type VerifiedEmployerCountInfo = {
  count: number
  evidenceMode: EvidenceMode | undefined
}

/**
 * Verified-employer catalog count for the search results notice.
 *
 * Contract: `GET /api/company-industry-verified-employer-count` →
 * `{ success: true, count: number, evidenceMode: 'legacy-seed' | 'strict-reviewed' }`
 * (60s-cached server side). The client mirrors that with a 60s module-level
 * cache so repeated mounts within the window do not refetch.
 *
 * Fails silently: 401/404 (public share surfaces have no admin session) and
 * network errors yield `undefined` without console error spam — the caller
 * simply omits the notice.
 */
const CACHE_TTL_MS = 60_000

let cachedInfo: VerifiedEmployerCountInfo | undefined
let cachedAt = 0
let inflight: Promise<VerifiedEmployerCountInfo | undefined> | null = null

function freshInfo(): VerifiedEmployerCountInfo | undefined {
  return cachedInfo !== undefined && Date.now() - cachedAt < CACHE_TTL_MS
    ? cachedInfo
    : undefined
}

async function fetchVerifiedEmployerCount(): Promise<VerifiedEmployerCountInfo | undefined> {
  try {
    const { data, response } = await rawApiClient.GET<{
      success: boolean
      count: number
      evidenceMode?: 'legacy-seed' | 'strict-reviewed'
    }>('/api/company-industry-verified-employer-count')
    if (response?.status === 401 || response?.status === 404) return undefined
    const count =
      data && data.success === true && typeof data.count === 'number'
        ? data.count
        : undefined
    if (count !== undefined) {
      cachedInfo = {
        count,
        evidenceMode:
          data?.evidenceMode === 'legacy-seed' || data?.evidenceMode === 'strict-reviewed'
            ? data.evidenceMode
            : undefined,
      }
      cachedAt = Date.now()
    }
    return cachedInfo
  } catch {
    // Silent: the notice is a progressive enhancement, never an error.
    return undefined
  }
}

export function useVerifiedEmployerCount(enabled = true): VerifiedEmployerCountInfo | undefined {
  const [info, setInfo] = useState<VerifiedEmployerCountInfo | undefined>(() => freshInfo())

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      const cached = freshInfo()
      if (cached !== undefined) {
        setInfo(cached)
        return
      }
      if (!inflight) {
        inflight = fetchVerifiedEmployerCount().finally(() => {
          inflight = null
        })
      }
      const next = await inflight
      if (!cancelled && next !== undefined) {
        setInfo(next)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return info
}
