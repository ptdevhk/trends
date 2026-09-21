import { apiBaseUrl } from './api-client'
import { workspaceRef } from './workspace-ref'

export type ConvexConnectionDiagnosticKind =
  | 'convex_ws_degraded'
  | 'convex_ws_retry'
  | 'bff_search_failed'
  | 'convex_query_timeout'

type ConvexConnectionDiagnostic = {
  kind: ConvexConnectionDiagnosticKind
  hasEverConnected?: boolean
  connectionRetries?: number
}

const REPORT_COOLDOWN_MS = 15_000

let lastReportKey = ''
let lastReportAt = 0

export function resetClientDiagnosticsForTests() {
  lastReportKey = ''
  lastReportAt = 0
}

function currentPathname(): string {
  if (typeof window === 'undefined') return '/'
  const pathname = window.location.pathname || '/'
  return pathname.slice(0, 200)
}

/**
 * Fire-and-forget breadcrumb when the Convex websocket stays down long
 * enough to show the connection-interrupted banner (or when the user
 * clicks Retry). No query string, no PII.
 */
export function reportConvexConnectionEvent(event: ConvexConnectionDiagnostic): void {
  if (typeof window === 'undefined') return

  const pathname = currentPathname()
  const key = `${event.kind}:${pathname}`
  const now = Date.now()
  if (key === lastReportKey && now - lastReportAt < REPORT_COOLDOWN_MS) {
    return
  }
  lastReportKey = key
  lastReportAt = now

  const payload = {
    kind: event.kind,
    pathname,
    hasEverConnected: event.hasEverConnected ?? false,
    connectionRetries: event.connectionRetries ?? 0,
    visibility: document.visibilityState,
  }

  console.warn('[trends:client-diagnostic]', payload)

  const body = JSON.stringify(payload)
  fetch(`${apiBaseUrl}/api/client-diagnostics/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-Slug': workspaceRef.get(),
    },
    body,
    credentials: 'include',
    keepalive: true,
  }).catch(() => {})
}
