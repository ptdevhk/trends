import { useEffect } from 'react'

/**
 * Observes long tasks (>50ms) on the main thread using the Long Tasks API.
 * Logs diagnostics in development, silently no-ops if the API is unavailable.
 * Mount <LongTaskObserver /> once at the app root.
 */
export function useLongTaskObserver() {
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (import.meta.env.DEV) {
          console.debug(
            `[longtask] ${Math.round(entry.duration)}ms at ${entry.startTime.toFixed(0)}ms`,
            entry,
          )
        }
      }
    })

    try {
      observer.observe({ type: 'longtask', buffered: true })
    } catch {
      // Long Tasks API not supported in this browser
      return
    }

    return () => observer.disconnect()
  }, [])
}

/** Mount this component once at the app root to enable long-task detection. */
export function LongTaskObserver() {
  useLongTaskObserver()
  return null
}
