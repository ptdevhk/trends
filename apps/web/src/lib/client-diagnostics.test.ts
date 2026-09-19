import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  reportConvexConnectionEvent,
  resetClientDiagnosticsForTests,
} from './client-diagnostics'
import { workspaceRef } from './workspace-ref'

describe('reportConvexConnectionEvent', () => {
  beforeEach(() => {
    resetClientDiagnosticsForTests()
    workspaceRef.set('hr')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true }),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts a breadcrumb and warns once per cooldown window', () => {
    reportConvexConnectionEvent({
      kind: 'convex_ws_degraded',
      hasEverConnected: true,
      connectionRetries: 4,
    })
    reportConvexConnectionEvent({
      kind: 'convex_ws_degraded',
      hasEverConnected: true,
      connectionRetries: 5,
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      '/api/client-diagnostics/report',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
      }),
    )
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        kind: 'convex_ws_degraded',
        pathname: '/',
        hasEverConnected: true,
        connectionRetries: 4,
      }),
    )
    expect(console.warn).toHaveBeenCalledWith(
      '[trends:client-diagnostic]',
      expect.objectContaining({ kind: 'convex_ws_degraded' }),
    )
  })

  it('allows a retry event after a degraded event', () => {
    reportConvexConnectionEvent({
      kind: 'convex_ws_degraded',
      hasEverConnected: false,
      connectionRetries: 1,
    })
    reportConvexConnectionEvent({
      kind: 'convex_ws_retry',
      hasEverConnected: false,
      connectionRetries: 1,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('records a dropped BFF search', () => {
    reportConvexConnectionEvent({ kind: 'bff_search_failed' })
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        kind: 'bff_search_failed',
        hasEverConnected: false,
        connectionRetries: 0,
      }),
    )
  })

  it('records a Convex query timeout', () => {
    reportConvexConnectionEvent({ kind: 'convex_query_timeout' })
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        kind: 'convex_query_timeout',
      }),
    )
  })
})
