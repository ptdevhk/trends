import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useLongTaskObserver } from './useLongTaskObserver'

describe('useLongTaskObserver', () => {
  const mockObserve = vi.fn()
  const mockDisconnect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates PerformanceObserver and observes longtask', () => {
    class MockPerformanceObserver {
      observe = mockObserve
      disconnect = mockDisconnect
      static supportedEntryTypes = ['longtask']
    }
    // @ts-expect-error mock
    globalThis.PerformanceObserver = MockPerformanceObserver

    renderHook(() => useLongTaskObserver())
    expect(mockObserve).toHaveBeenCalledWith({ type: 'longtask', buffered: true })
  })

  it('disconnects observer on unmount', () => {
    class MockPerformanceObserver {
      observe = mockObserve
      disconnect = mockDisconnect
      static supportedEntryTypes = ['longtask']
    }
    // @ts-expect-error mock
    globalThis.PerformanceObserver = MockPerformanceObserver

    const { unmount } = renderHook(() => useLongTaskObserver())
    unmount()
    expect(mockDisconnect).toHaveBeenCalled()
  })

  it('no-ops when PerformanceObserver is undefined', () => {
    // @ts-expect-error mock
    delete globalThis.PerformanceObserver

    expect(() => {
      renderHook(() => useLongTaskObserver())
    }).not.toThrow()
  })

  it('handles observe throwing (unsupported longtask type)', () => {
    class MockPerformanceObserver {
      observe = vi.fn(() => { throw new Error('not supported') })
      disconnect = mockDisconnect
      static supportedEntryTypes = []
    }
    // @ts-expect-error mock
    globalThis.PerformanceObserver = MockPerformanceObserver

    expect(() => {
      renderHook(() => useLongTaskObserver())
    }).not.toThrow()
  })
})
