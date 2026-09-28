/**
 * Bounded-concurrency primitives for bulk resume actions.
 *
 * A bulk reject/shortlist over hundreds of rows used to fan out into hundreds
 * of simultaneous POSTs (one `Promise.all` over `selectedIds`), tripping the
 * upstream rate limiter (429) and surfacing as a spurious logout/CSRF failure.
 * These helpers run the batch at a small, fixed concurrency and back off on
 * rate limits so partial failures surface as partial counts instead of a
 * full-session wipe.
 */

/** Max concurrent status-writer POSTs per bulk run. */
export const BULK_ACTION_CONCURRENCY = 5

/** Retry attempts for a rate-limited / transiently-failed write. */
export const RATE_LIMIT_RETRIES = 3

/** Base backoff delay (ms); each attempt doubles it. */
export const RATE_LIMIT_BASE_DELAY_MS = 500

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** True when an error looks like a rate-limit (HTTP 429) response. */
export function isRateLimitResponse(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const value = error as {
    status?: unknown
    response?: { status?: number } | null
    error?: unknown
  }
  if (value.status === 429) {
    return true
  }
  if (value.response?.status === 429) {
    return true
  }
  const message = typeof value.error === 'string' ? value.error.toLowerCase() : ''
  return message.includes('rate limit') || message.includes('too many requests')
}

/** Exponential backoff delay for a 429 retry attempt (0-indexed). */
export function rateLimitBackoffMs(attempt: number): number {
  return RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt
}

export type MapLimitResult<T, R> = {
  item: T
  index: number
  value: R
}

/**
 * Runs `fn` over `items` with at most `concurrency` in flight, preserving
 * order in the returned results. A thrown/failed `fn` resolves its slot to
 * `undefined` (never aborts the batch), so a partial failure never stops the
 * remaining work — callers decide what "success" means per item.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<MapLimitResult<T, R | undefined>>> {
  const results: Array<MapLimitResult<T, R | undefined>> = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      let value: R | undefined
      try {
        value = await fn(item, index)
      } catch {
        value = undefined
      }
      results[index] = { item, index, value }
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/**
 * Runs an idempotent status-write with rate-limit backoff.
 *
 * `fn` should return a truthy value on success and either a falsy value or a
 * thrown error on failure. Status upserts (`saveAction` -> POST /api/actions,
 * `updateCandidateStatus` -> POST /api/candidate-status) are idempotent, and
 * the underlying hooks swallow HTTP errors and return `false`/`undefined`
 * rather than throwing — so a falsy result is treated as retryable too. This
 * genuinely backs off on the 429 storm that used to blast the user's session
 * while never aborting a large batch on a single row.
 */
export async function retryIdempotent(
  fn: () => Promise<unknown>,
  retries = RATE_LIMIT_RETRIES,
): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    let ok = false
    let retryable = false
    try {
      const result = await fn()
      ok = Boolean(result)
      retryable = !ok
    } catch (error) {
      ok = false
      retryable = isRateLimitResponse(error)
    }

    if (ok) {
      return true
    }
    if (!retryable || attempt >= retries) {
      return false
    }
    await sleep(rateLimitBackoffMs(attempt))
  }
}
