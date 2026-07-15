import type { components } from '@/lib/api-types'
import { withWorkspaceHeaders } from '@/lib/workspace-ref'

export type ResumeExportRequestBody =
  components['schemas']['ResumeExportCanonicalRequest']

const csrfCookieName = 'trends_csrf'
const csrfHeaderName = 'X-CSRF-Token'

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

function parseDownloadFilename(
  contentDisposition: string | null,
): string | undefined {
  if (!contentDisposition) {
    return undefined
  }

  const encodedMatch = contentDisposition.match(
    /filename\*\s*=\s*UTF-8''([^;]+)/i,
  )
  if (encodedMatch?.[1]) {
    const encodedFilename = encodedMatch[1].trim().replace(/^"(.*)"$/, '$1')
    try {
      return decodeURIComponent(encodedFilename)
    } catch {
      return encodedFilename
    }
  }

  const filenameMatch = contentDisposition.match(
    /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i,
  )
  const filename = filenameMatch?.[1] ?? filenameMatch?.[2]
  return filename?.trim()
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const blobUrl = window.URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = blobUrl
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)

  try {
    link.click()
  } finally {
    link.remove()
    window.URL.revokeObjectURL(blobUrl)
  }
}

export async function submitResumeExportDownload(
  apiBaseUrl: string,
  payload: ResumeExportRequestBody,
): Promise<void> {
  const csrfToken = readCookie(csrfCookieName)
  const headers = withWorkspaceHeaders({
    'Content-Type': 'application/json',
  })
  // Mutating export must match apiClient / search-analytics CSRF contract.
  if (csrfToken) {
    headers.set(csrfHeaderName, csrfToken)
  }

  let response: Response
  try {
    response = await fetch(
      new URL(`${apiBaseUrl}/api/resumes/export`, window.location.origin)
        .toString(),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'include',
      },
    )
  } catch (error) {
    throw new Error(
      `Network error: failed to reach export server${error instanceof Error ? `: ${error.message}` : ''}`,
    )
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = (await response.json().catch(() => null)) as
        | { error?: unknown }
        | null
      const errorMessage =
        typeof body?.error === 'string' && body.error.trim().length > 0
          ? body.error
          : `Export failed (HTTP ${response.status})`
      throw new Error(errorMessage)
    }

    const responseText = await response.text().catch(() => '')
    throw new Error(
      responseText.trim() || `Export failed (HTTP ${response.status})`,
    )
  }

  const blob = await response.blob()
  const filename =
    parseDownloadFilename(response.headers.get('content-disposition')) ??
    `resumes-export.${payload.format === 'xlsx' ? 'xlsx' : 'csv'}`
  triggerBlobDownload(blob, filename)
}
