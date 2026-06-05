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
