import { describe, expect, it, vi } from 'vitest'
import {
  BULK_ACTION_CONCURRENCY,
  isRateLimitResponse,
  mapLimit,
  rateLimitBackoffMs,
  retryIdempotent,
} from '../bulk-concurrency'

describe('bulk-concurrency helpers', () => {
  it('runs mapLimit with at most `concurrency` workers in flight and preserves order', async () => {
    let inFlight = 0
    let peak = 0
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    const results = await mapLimit(items, 3, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return n * 2
    })

    expect(peak).toBeLessThanOrEqual(3)
    expect(results.map((r) => r.value)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
    expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('captures a rejected fn into the result instead of aborting the batch', async () => {
    const results = await mapLimit(
      [1, 2, 3],
      2,
      async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      },
    )
    const succeeded = results.filter((r) => r?.value !== undefined).map((r) => r.value)
    expect(succeeded).toEqual([1, 3])
  })

  it('retries a rate-limited (429) call and ultimately succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce(true)

    const ok = await retryIdempotent(fn, 5)
    expect(ok).toBe(true)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('treats a falsy idempotent result as retryable', async () => {
    const fn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const ok = await retryIdempotent(fn, 5)
    expect(ok).toBe(true)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up after the retry budget on a persistent 429', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429 })
    const ok = await retryIdempotent(fn, 2)
    expect(ok).toBe(false)
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('does not retry a non-rate-limit failure', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(true)
    const ok = await retryIdempotent(fn, 5)
    expect(ok).toBe(false)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('recognizes rate-limit response shapes', () => {
    expect(isRateLimitResponse({ status: 429 })).toBe(true)
    expect(isRateLimitResponse({ response: { status: 429 } })).toBe(true)
    expect(isRateLimitResponse({ error: 'Too Many Requests' })).toBe(true)
    expect(isRateLimitResponse({ status: 500 })).toBe(false)
    expect(isRateLimitResponse(new Error('nope'))).toBe(false)
  })

  it('backs off exponentially', () => {
    expect(rateLimitBackoffMs(0)).toBe(500)
    expect(rateLimitBackoffMs(1)).toBe(1000)
    expect(rateLimitBackoffMs(2)).toBe(2000)
  })

  it('exposes a sane default concurrency ceiling', () => {
    expect(BULK_ACTION_CONCURRENCY).toBe(5)
  })
})
