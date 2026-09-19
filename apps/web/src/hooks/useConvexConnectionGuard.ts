import { useCallback, useEffect, useState } from 'react'
import { useConvexConnectionState } from 'convex/react'
import { reportConvexConnectionEvent } from '@/lib/client-diagnostics'

/** How long the Convex websocket may stay down before loading UIs degrade. */
export const CONVEX_CONNECTION_DEGRADED_AFTER_MS = 8_000

const HEALTHY_WHEN_UNAVAILABLE = {
  isWebSocketConnected: true,
  hasEverConnected: false,
  connectionRetries: 0,
}

function useSafeConvexConnectionState() {
  try {
    return useConvexConnectionState()
  } catch {
    return HEALTHY_WHEN_UNAVAILABLE
  }
}

export function useConvexConnectionGuard() {
  const { isWebSocketConnected, hasEverConnected, connectionRetries } =
    useSafeConvexConnectionState()
  const [isDegraded, setIsDegraded] = useState(false)

  useEffect(() => {
    if (isWebSocketConnected) {
      setIsDegraded(false)
      return
    }

    const timer = window.setTimeout(() => {
      setIsDegraded(true)
    }, CONVEX_CONNECTION_DEGRADED_AFTER_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isWebSocketConnected])

  useEffect(() => {
    if (!isDegraded) return
    reportConvexConnectionEvent({
      kind: 'convex_ws_degraded',
      hasEverConnected,
      connectionRetries,
    })
  }, [isDegraded, hasEverConnected, connectionRetries])

  const retry = useCallback(() => {
    reportConvexConnectionEvent({
      kind: 'convex_ws_retry',
      hasEverConnected,
      connectionRetries,
    })
    window.location.reload()
  }, [hasEverConnected, connectionRetries])

  return {
    isWebSocketConnected,
    hasEverConnected,
    connectionRetries,
    isDegraded,
    retry,
  }
}
