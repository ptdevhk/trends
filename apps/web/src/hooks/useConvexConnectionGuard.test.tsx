import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONVEX_CONNECTION_DEGRADED_AFTER_MS,
  useConvexConnectionGuard,
} from './useConvexConnectionGuard'

const useConvexConnectionStateMock = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useConvexConnectionState: () => useConvexConnectionStateMock(),
}))

function connectionState(
  overrides: {
    isWebSocketConnected?: boolean
    hasEverConnected?: boolean
    connectionRetries?: number
  } = {},
) {
  return {
    hasInflightRequests: false,
    isWebSocketConnected: true,
    timeOfOldestInflightRequest: null,
    hasEverConnected: true,
    connectionCount: 1,
    connectionRetries: 0,
    inflightMutations: 0,
    inflightActions: 0,
    ...overrides,
  }
}

describe('useConvexConnectionGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useConvexConnectionStateMock.mockReset()
    useConvexConnectionStateMock.mockReturnValue(connectionState())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes an 8 second degraded threshold as a named constant', () => {
    expect(CONVEX_CONNECTION_DEGRADED_AFTER_MS).toBe(8_000)
  })

  it('stays healthy while the websocket is connected', () => {
    const { result } = renderHook(() => useConvexConnectionGuard())

    expect(result.current.isWebSocketConnected).toBe(true)
    expect(result.current.isDegraded).toBe(false)
    expect(result.current.hasEverConnected).toBe(true)
    expect(result.current.connectionRetries).toBe(0)

    act(() => {
      vi.advanceTimersByTime(CONVEX_CONNECTION_DEGRADED_AFTER_MS * 2)
    })

    expect(result.current.isDegraded).toBe(false)
  })

  it('does not mark the connection degraded before the named timeout', () => {
    useConvexConnectionStateMock.mockReturnValue(
      connectionState({
        isWebSocketConnected: false,
        hasEverConnected: true,
        connectionRetries: 2,
      }),
    )

    const { result } = renderHook(() => useConvexConnectionGuard())

    expect(result.current.isWebSocketConnected).toBe(false)
    expect(result.current.isDegraded).toBe(false)
    expect(result.current.connectionRetries).toBe(2)

    act(() => {
      vi.advanceTimersByTime(CONVEX_CONNECTION_DEGRADED_AFTER_MS - 1)
    })

    expect(result.current.isDegraded).toBe(false)
  })

  it('marks the connection degraded after the websocket stays down past the named timeout', () => {
    useConvexConnectionStateMock.mockReturnValue(
      connectionState({
        isWebSocketConnected: false,
        hasEverConnected: false,
        connectionRetries: 4,
      }),
    )

    const { result } = renderHook(() => useConvexConnectionGuard())

    act(() => {
      vi.advanceTimersByTime(CONVEX_CONNECTION_DEGRADED_AFTER_MS)
    })

    expect(result.current.isDegraded).toBe(true)
    expect(result.current.hasEverConnected).toBe(false)
  })

  it('clears the degraded flag when the websocket reconnects', () => {
    useConvexConnectionStateMock.mockReturnValue(
      connectionState({
        isWebSocketConnected: false,
        connectionRetries: 3,
      }),
    )

    const { result, rerender } = renderHook(() => useConvexConnectionGuard())

    act(() => {
      vi.advanceTimersByTime(CONVEX_CONNECTION_DEGRADED_AFTER_MS)
    })
    expect(result.current.isDegraded).toBe(true)

    useConvexConnectionStateMock.mockReturnValue(
      connectionState({
        isWebSocketConnected: true,
        connectionRetries: 3,
      }),
    )
    rerender()

    expect(result.current.isWebSocketConnected).toBe(true)
    expect(result.current.isDegraded).toBe(false)
  })

  it('fails open instead of throwing when ConvexProvider is missing', () => {
    useConvexConnectionStateMock.mockImplementation(() => {
      throw new Error('Could not find Convex client!')
    })

    const { result } = renderHook(() => useConvexConnectionGuard())

    expect(result.current.isWebSocketConnected).toBe(true)
    expect(result.current.isDegraded).toBe(false)
    expect(result.current.hasEverConnected).toBe(false)
  })

  it('does not degrade if the websocket reconnects before the timeout', () => {
    useConvexConnectionStateMock.mockReturnValue(
      connectionState({ isWebSocketConnected: false }),
    )

    const { result, rerender } = renderHook(() => useConvexConnectionGuard())

    act(() => {
      vi.advanceTimersByTime(CONVEX_CONNECTION_DEGRADED_AFTER_MS / 2)
    })
    expect(result.current.isDegraded).toBe(false)

    useConvexConnectionStateMock.mockReturnValue(
      connectionState({ isWebSocketConnected: true }),
    )
    rerender()

    act(() => {
      vi.advanceTimersByTime(CONVEX_CONNECTION_DEGRADED_AFTER_MS)
    })

    expect(result.current.isDegraded).toBe(false)
  })
})
