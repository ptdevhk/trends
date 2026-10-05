import { describe, expect, it } from 'vitest'
import { resolveBrowserConvexUrl } from './convex-url'

describe('resolveBrowserConvexUrl', () => {
  it('keeps the env HTTP Convex URL on http://localhost', () => {
    expect(
      resolveBrowserConvexUrl('http://10.10.0.126:3210', {
        protocol: 'http:',
        origin: 'http://localhost:5173',
      }),
    ).toBe('http://10.10.0.126:3210')
  })

  it('uses same-origin /convex on HTTPS so the browser can open wss', () => {
    expect(
      resolveBrowserConvexUrl('http://10.10.0.126:3210', {
        protocol: 'https:',
        origin: 'https://port-5173-pvelxc.example.com',
      }),
    ).toBe('https://port-5173-pvelxc.example.com/convex')
  })

  it('still proxies HTTPS when VITE_CONVEX_URL is unset', () => {
    expect(
      resolveBrowserConvexUrl(undefined, {
        protocol: 'https:',
        origin: 'https://example.test',
      }),
    ).toBe('https://example.test/convex')
  })
})
