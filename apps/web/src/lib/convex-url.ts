/**
 * Browser Convex URL.
 *
 * Local `make dev` talks to Convex over HTTP (`VITE_CONVEX_URL`, often a LAN
 * http://host:3210). The public HTTPS port URL
 * (`https://port-5173-…alphasolves.com`) cannot open `ws://` — the browser
 * throws "Failed to construct 'WebSocket'". Same-origin `/convex` is proxied
 * by Vite to the local backend so the page can use `wss://`.
 */
export function resolveBrowserConvexUrl(
  envUrl: string | undefined,
  location: Pick<Location, 'protocol' | 'origin'> = window.location,
): string | undefined {
  const trimmed = envUrl?.trim()
  if (location.protocol === 'https:') {
    return `${location.origin}/convex`
  }
  return trimmed || undefined
}
