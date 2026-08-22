import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Nightly-UAT F11: the ~1.7 MB BFF AND-mode search intermittently failed in
 * the browser with net::ERR_FAILED through the Vite dev proxy — browser-only,
 * in bursts of 3 (the hook's retry chain), self-healing on reload. The dev
 * server ran with Node's default keepAliveTimeout (5 s), closing idle
 * keep-alive sockets that the browser still holds in its pool; reusing a
 * closed socket resets the request. This test guards the vite.config.ts
 * configureServer hook that raises the dev server's keep-alive ceiling.
 */
const viteConfigSource = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8')

describe('Vite dev server keep-alive', () => {
  it('raises keepAliveTimeout above Node\u2019s 5 s default in configureServer', () => {
    expect(viteConfigSource).toContain('configureServer')

    const match = viteConfigSource.match(/keepAliveTimeout\s*=\s*([\d_]+)/)
    expect(match).not.toBeNull()
    const keepAliveMs = Number(match![1].replace(/_/g, ''))
    expect(keepAliveMs).toBeGreaterThanOrEqual(60_000)

    // Node docs: headersTimeout must be set higher than keepAliveTimeout.
    const headersMatch = viteConfigSource.match(/headersTimeout\s*=\s*([\d_]+)/)
    expect(headersMatch).not.toBeNull()
    const headersMs = Number(headersMatch![1].replace(/_/g, ''))
    expect(headersMs).toBeGreaterThan(keepAliveMs)
  })
})
