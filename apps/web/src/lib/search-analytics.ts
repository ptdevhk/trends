import { apiBaseUrl } from './api-client'

/**
 * Log a search query event to the BFF analytics endpoint.
 * Fire-and-forget — errors are silently ignored.
 */
export function logSearchEvent(params: {
  query: string
  resultCount: number
  topScore?: number
}): void {
  const workspace = document.querySelector<HTMLMetaElement>('meta[name="workspace-slug"]')?.content
    ?? window.location.pathname.split('/')[1]
    ?? 'default'

  fetch(`${apiBaseUrl}/api/search-analytics/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-Slug': workspace,
    },
    body: JSON.stringify(params),
    keepalive: true,
  }).catch(() => {
    // Fire-and-forget — ignore network errors
  })
}
