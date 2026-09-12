import { useCallback, useEffect, useState } from 'react'
import { useConvexConnectionState } from 'convex/react'

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

  const retry = useCallback(() => {
    window.location.reload()
  }, [])

  return {
    isWebSocketConnected,
    hasEverConnected,
    connectionRetries,
    isDegraded,
    retry,
  }
}
