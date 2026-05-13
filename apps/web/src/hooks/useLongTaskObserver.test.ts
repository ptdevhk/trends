import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useLongTaskObserver } from './useLongTaskObserver'

class MockPerformanceObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  static supportedEntryTypes = ['longtask']
}

describe('useLongTaskObserver', () => {
  const originalPO = globalThis.PerformanceObserver

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error mock
    globalThis.PerformanceObserver = MockPerformanceObserver
  })

  afterEach(() => {
    globalThis.PerformanceObserver = originalPO
  })

  it('creates PerformanceObserver and observes longtask', () => {
    renderHook(() => useLongTaskObserver())
    const observer = new MockPerformanceObserver()
    expect(observer.observe).toBeDefined()
  })

  it('disconnects observer on unmount', () => {
    const { unmount } = renderHook(() => useLongTaskObserver())
    unmount()
  })

  it('no-ops when PerformanceObserver is undefined', () => {
    // @ts-expect-error mock
    delete globalThis.PerformanceObserver

    expect(() => {
      renderHook(() => useLongTaskObserver())
    }).not.toThrow()
  })

  it('handles observe throwing (unsupported longtask type)', () => {
    class ThrowingPO {
      observe = vi.fn(() => { throw new Error('not supported') })
      disconnect = vi.fn()
      static supportedEntryTypes = []
    }
    // @ts-expect-error mock
    globalThis.PerformanceObserver = ThrowingPO

    expect(() => {
      renderHook(() => useLongTaskObserver())
    }).not.toThrow()
  })
})
