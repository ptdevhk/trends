import { apiBaseUrl, buildApiHeaders } from './api-client'

/**
 * Raw fetch wrappers for API endpoints that cannot be expressed through the
 * typed openapi-fetch client (SSE streams, blob downloads with raw header
 * reads, and the generic settings `requestJson` helper that accepts arbitrary
 * paths/methods). Every wrapper applies the same middleware semantics as
 * apiClient (X-Workspace-Slug on all requests, X-CSRF-Token on mutating
 * methods) via buildApiHeaders, so headers stay uniform across the app.
 *
 * This is the only place outside api-client.ts where raw `fetch(` calls to
 * API endpoints may live.
 */

/** Error thrown by requestJson for non-2xx responses, carrying status + body. */
export class SettingsRequestError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`)
    this.name = 'SettingsRequestError'
    this.status = status
    this.body = body
  }
}

/**
 * Generic JSON request used by the system-settings pages. Preserves the
 * historical behavior of useSettingsRequestJson: always sends
 * Content-Type: application/json, includes credentials, throws
 * SettingsRequestError with the parsed failure body on non-2xx, and returns
 * the parsed JSON body on success.
 */
export async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const headers = buildApiHeaders({
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'Content-Type': 'application/json',
    },
  })

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new SettingsRequestError(response.status, body)
  }

  return response.json() as Promise<unknown>
}

/**
 * Opens the SSE match-stream endpoint and returns the raw Response so the
 * caller can consume the text/event-stream body via response.body reader.
 */
export async function postMatchStream(payload: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${apiBaseUrl}/api/resumes/match-stream`, {
    method: 'POST',
    headers: buildApiHeaders({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    body: JSON.stringify(payload),
    signal,
  })
}

/**
 * Downloads a review packet file, returning the raw Response so the caller
 * can read the blob and the Content-Disposition filename header.
 */
export async function downloadReviewPacket(runId: string): Promise<Response> {
  const url = new URL(
    `${apiBaseUrl}/api/resumes/review-packets/${encodeURIComponent(runId)}/download`,
    window.location.origin,
  ).toString()
  return fetch(url, {
    headers: buildApiHeaders(),
    credentials: 'include',
  })
}
