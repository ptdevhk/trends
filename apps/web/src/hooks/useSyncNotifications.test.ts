import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncNotifications } from './useSyncNotifications'

type SyncEvent = {
  timestamp: number
  status: 'success' | 'error'
  submitted?: number
  inserted?: number
  updated?: number
  error?: string
} | null | undefined

const useQueryMock = vi.hoisted(() => vi.fn<() => SyncEvent>())
const toastSuccessMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...(args as [])),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    sync_events: { getLatest: 'sync_events:getLatest' },
  },
}))

describe('useSyncNotifications', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
    toastSuccessMock.mockReset()
    toastErrorMock.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-13T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not toast while query is still loading (undefined)', () => {
    useQueryMock.mockReturnValue(undefined)
    renderHook(() => useSyncNotifications())
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('does not toast on the first observed event (initialization)', () => {
    useQueryMock.mockReturnValue({
      timestamp: Date.now(),
      status: 'success',
      submitted: 10,
      inserted: 5,
      updated: 5,
    })
    renderHook(() => useSyncNotifications())
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('toasts success when a newer success event arrives', () => {
    useQueryMock.mockReturnValueOnce({
      timestamp: Date.now() - 1000,
      status: 'success',
    })
    const { rerender } = renderHook(() => useSyncNotifications())

    useQueryMock.mockReturnValueOnce({
      timestamp: Date.now(),
      status: 'success',
      submitted: 3,
      inserted: 2,
      updated: 1,
    })
    rerender()

    expect(toastSuccessMock).toHaveBeenCalledTimes(1)
    expect(toastSuccessMock).toHaveBeenCalledWith('Synced 3 resumes (2 new, 1 updated)')
  })

  it('toasts error when a newer error event arrives', () => {
    useQueryMock.mockReturnValueOnce({
      timestamp: Date.now() - 1000,
      status: 'success',
    })
    const { rerender } = renderHook(() => useSyncNotifications())

    useQueryMock.mockReturnValueOnce({
      timestamp: Date.now(),
      status: 'error',
      error: 'connection refused',
    })
    rerender()

    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith('Sync failed: connection refused')
  })

  it('does not toast when event timestamp is not newer than last seen', () => {
    const ts = Date.now()
    useQueryMock.mockReturnValueOnce({ timestamp: ts, status: 'success' })
    const { rerender } = renderHook(() => useSyncNotifications())

    // Same timestamp — should not trigger another toast
    useQueryMock.mockReturnValueOnce({ timestamp: ts, status: 'success' })
    rerender()
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('does not toast on stale events older than 30s', () => {
    useQueryMock.mockReturnValueOnce({
      timestamp: Date.now() - 60_000,
      status: 'success',
    })
    const { rerender } = renderHook(() => useSyncNotifications())

    useQueryMock.mockReturnValueOnce({
      timestamp: Date.now() - 31_000,
      status: 'success',
    })
    rerender()

    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('does not subscribe to events when disabled', () => {
    useQueryMock.mockReturnValue(undefined)
    renderHook(() => useSyncNotifications(false))
    expect(useQueryMock).toHaveBeenCalledWith('sync_events:getLatest', 'skip')
  })

  it('re-initializes (skips first event toast) when re-enabled after being disabled', () => {
    useQueryMock.mockReturnValue({
      timestamp: Date.now(),
      status: 'success',
    })
    const { rerender } = renderHook(
      ({ enabled }) => useSyncNotifications(enabled),
      { initialProps: { enabled: true } }
    )

    // Toggle off — refs reset
    rerender({ enabled: false })
    // Re-enable — next event should be re-initialized (no toast)
    rerender({ enabled: true })

    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('handles null latestEvent without throwing', () => {
    useQueryMock.mockReturnValue(null)
    expect(() => renderHook(() => useSyncNotifications())).not.toThrow()
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })
})
