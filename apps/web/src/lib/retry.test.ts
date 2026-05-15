import { describe, expect, it, vi } from 'vitest'
import { withRetry } from '@/lib/retry'

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, { baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValueOnce('ok')
    const result = await withRetry(fn, { baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fail'))
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow('always fail')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('aborts during retry delay', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    const controller = new AbortController()
    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 1000, signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow('Aborted')
  })
})
