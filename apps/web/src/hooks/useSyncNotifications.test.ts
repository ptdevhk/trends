import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useSyncNotifications } from './useSyncNotifications'

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()

vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => mockToastSuccess(...args), error: (...args: unknown[]) => mockToastError(...args) },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

let queryResult: unknown = undefined
vi.mock('convex/react', () => ({
  useQuery: () => queryResult,
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: { sync_events: { getLatest: 'sync_events/getLatest' } },
}))

// Date.now() = 1_000_000. Use timestamps near this to avoid stale-event filter.
const NOW = 1_000_000

describe('useSyncNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryResult = undefined
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  it('does not toast when disabled', () => {
    queryResult = { timestamp: NOW - 500, status: 'success', submitted: 10 }
    renderHook(() => useSyncNotifications(false))
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('does not toast on initial load (first event)', () => {
    queryResult = { timestamp: NOW - 500, status: 'success', submitted: 10 }
    renderHook(() => useSyncNotifications(true))
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('toasts success when new event arrives', () => {
    queryResult = undefined
    const { rerender } = renderHook(() => useSyncNotifications(true))

    queryResult = { timestamp: NOW - 500, status: 'success', submitted: 10, inserted: 5, updated: 5 }
    rerender()

    queryResult = { timestamp: NOW - 200, status: 'success', submitted: 20, inserted: 10, updated: 10 }
    rerender()

    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('20'))
  })

  it('toasts error when new failed event arrives', () => {
    queryResult = undefined
    const { rerender } = renderHook(() => useSyncNotifications(true))

    queryResult = { timestamp: NOW - 500, status: 'success', submitted: 10 }
    rerender()

    queryResult = { timestamp: NOW - 200, status: 'error', error: 'connection lost' }
    rerender()

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('connection lost'))
  })

  it('skips stale events (older than 30s)', () => {
    queryResult = undefined
    const { rerender } = renderHook(() => useSyncNotifications(true))

    queryResult = { timestamp: NOW - 500, status: 'success', submitted: 10 }
    rerender()

    // Stale: Date.now(1000000) - (NOW - 40000) = 40000 > 30000
    queryResult = { timestamp: NOW - 40_000, status: 'success', submitted: 20 }
    rerender()

    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('does not toast when event timestamp is same or older', () => {
    queryResult = undefined
    const { rerender } = renderHook(() => useSyncNotifications(true))

    queryResult = { timestamp: NOW - 500, status: 'success', submitted: 10 }
    rerender()

    queryResult = { timestamp: NOW - 500, status: 'success', submitted: 20 }
    rerender()

    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
})
