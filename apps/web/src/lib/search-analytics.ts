import { apiBaseUrl } from './api-client'

const csrfCookieName = 'trends_csrf'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null
  }
  const prefix = `${name}=`
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return match ? decodeURIComponent(match.slice(prefix.length)) : null
}

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
  const csrfToken = readCookie(csrfCookieName)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Workspace-Slug': workspace,
  }
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken
  }

  fetch(`${apiBaseUrl}/api/search-analytics/log`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
    credentials: 'include',
    keepalive: true,
  }).catch(() => {
    // Fire-and-forget — ignore network errors
  })
}
