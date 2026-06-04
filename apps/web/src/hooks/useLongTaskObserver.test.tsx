import { render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { LongTaskObserver, useLongTaskObserver } from './useLongTaskObserver'

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

  it('logs long tasks as debug diagnostics instead of warnings', () => {
    let observerCallback: ((list: { getEntries: () => Array<{ duration: number; startTime: number }> }) => void) | undefined
    class MockPerformanceObserver {
      observe = mockObserve
      disconnect = mockDisconnect
      static supportedEntryTypes = ['longtask']

      constructor(callback: typeof observerCallback) {
        observerCallback = callback
      }
    }
    // @ts-expect-error mock
    globalThis.PerformanceObserver = MockPerformanceObserver

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderHook(() => useLongTaskObserver())
    observerCallback?.({ getEntries: () => [{ duration: 51.2, startTime: 123.4 }] })

    expect(debugSpy).toHaveBeenCalledWith(
      '[longtask] 51ms at 123ms',
      { duration: 51.2, startTime: 123.4 },
    )
    expect(warnSpy).not.toHaveBeenCalled()

    debugSpy.mockRestore()
    warnSpy.mockRestore()
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

  it('LongTaskObserver component returns null', () => {
    class MockPerformanceObserver {
      observe = mockObserve
      disconnect = mockDisconnect
      static supportedEntryTypes = ['longtask']
    }
    // @ts-expect-error mock
    globalThis.PerformanceObserver = MockPerformanceObserver

    const { container } = render(<LongTaskObserver />)
    expect(container).toBeEmptyDOMElement()
    expect(mockObserve).toHaveBeenCalledWith({ type: 'longtask', buffered: true })
  })
})
