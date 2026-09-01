import createClient from 'openapi-fetch'
import type { paths } from './api-types'
import { workspaceRef } from './workspace-ref'

const rawBaseUrl = import.meta.env.VITE_API_URL || '/api'
export const apiBaseUrl = rawBaseUrl.replace(/\/api\/?$/, '')
const csrfCookieName = 'trends_csrf'
const csrfHeaderName = 'X-CSRF-Token'
const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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

export const apiClient = createClient<paths>({ baseUrl: apiBaseUrl, credentials: 'include' })

/**
 * Builds a Headers object with the same middleware semantics applied to every
 * apiClient request: X-Workspace-Slug from workspaceRef on all requests, and
 * X-CSRF-Token from the trends_csrf cookie on mutating methods (POST/PUT/
 * PATCH/DELETE) unless the caller already set it. Used by the raw lib/ fetch
 * wrappers (raw-endpoints.ts) so they stay in lock-step with the client
 * middleware.
 */
export function buildApiHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  headers.set('X-Workspace-Slug', workspaceRef.get())
  if (mutatingMethods.has((init?.method ?? 'GET').toUpperCase()) && !headers.has(csrfHeaderName)) {
    const csrfToken = readCookie(csrfCookieName)
    if (csrfToken) {
      headers.set(csrfHeaderName, csrfToken)
    }
  }
  return headers
}

apiClient.use({
  onRequest({ request }) {
    request.headers.set('X-Workspace-Slug', workspaceRef.get())
    if (mutatingMethods.has(request.method.toUpperCase()) && !request.headers.has(csrfHeaderName)) {
      const csrfToken = readCookie(csrfCookieName)
      if (csrfToken) {
        request.headers.set(csrfHeaderName, csrfToken)
      }
    }
    return request
  },
})

// Stash the raw Response on the openapi-fetch result so callers can read
// response headers (e.g. Retry-After on the login lockout). openapi-fetch
// only surfaces status in the parsed body; the response object is otherwise
// discarded after it is consumed.
apiClient.use({
  async onResponse({ response }) {
    const clone = response.clone()
    ;(response as Response & { json: () => Promise<unknown> }).json = async function json() {
      const parsed = (await Response.prototype.json.call(this)) as { response?: Response }
      if (parsed && typeof parsed === 'object' && parsed.response === undefined) {
        ;(parsed as { response?: Response }).response = clone
      }
      return parsed
    }
    return response
  },
})
