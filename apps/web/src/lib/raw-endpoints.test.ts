import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadReviewPacket, postMatchStream, requestJson, SettingsRequestError } from './raw-endpoints'
import { workspaceRef } from './workspace-ref'

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'trends_csrf=; Max-Age=0; path=/'
  workspaceRef.set('dev')
})

function stubFetchJson(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('requestJson', () => {
  it('returns the parsed JSON body on success', async () => {
    const fetchMock = stubFetchJson({ success: true, items: [1, 2] })
    const result = await requestJson('/api/company-industry-proposals')
    expect(result).toEqual({ success: true, items: [1, 2] })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/company-industry-proposals'),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('includes workspace slug, content-type, and csrf token on mutating requests', async () => {
    document.cookie = 'trends_csrf=csrf-token-9; path=/'
    workspaceRef.set('cn-main')
    const fetchMock = stubFetchJson({ success: true })
    await requestJson('/api/company-industry-proposals/proposal-1/approve', { method: 'POST' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('X-Workspace-Slug')).toBe('cn-main')
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token-9')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('does not add csrf token to read requests', async () => {
    document.cookie = 'trends_csrf=csrf-token-9; path=/'
    const fetchMock = stubFetchJson({ success: true })
    await requestJson('/api/companies')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('X-CSRF-Token')).toBeNull()
    expect(headers.get('X-Workspace-Slug')).toBe('dev')
  })

  it('throws SettingsRequestError with the status and parsed failure body', async () => {
    const failureBody = {
      success: false,
      code: 'INDUSTRY_REVIEW_STALE',
      error: 'The review packet is stale.',
    }
    stubFetchJson(failureBody, 409)

    let thrown: unknown
    try {
      await requestJson('/api/company-industry-proposals/proposal-1/approve', { method: 'POST' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(SettingsRequestError)
    expect(thrown).toMatchObject({
      name: 'SettingsRequestError',
      message: 'HTTP 409',
      status: 409,
      body: failureBody,
    })
  })
})

describe('postMatchStream', () => {
  it('POSTs a JSON body to the match-stream endpoint with middleware headers', async () => {
    document.cookie = 'trends_csrf=csrf-stream-1; path=/'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('event: done\ndata: {"stats":{}}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const signal = new AbortController().signal
    const response = await postMatchStream({ sessionId: 's1', mode: 'hybrid' }, signal)

    expect(response.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/api/resumes/match-stream')
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(signal)
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: 's1', mode: 'hybrid' })
    const headers = new Headers(init.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-Workspace-Slug')).toBe('dev')
    expect(headers.get('X-CSRF-Token')).toBe('csrf-stream-1')
  })
})

describe('downloadReviewPacket', () => {
  it('GETs the download endpoint with the encoded run id and workspace header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('file-bytes', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': "attachment; filename*=UTF-8''packet.csv",
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await downloadReviewPacket('run/1')

    expect(response.ok).toBe(true)
    expect(await response.text()).toBe('file-bytes')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/api/resumes/review-packets/run%2F1/download')
    expect(init.method ?? 'GET').toBe('GET')
    const headers = new Headers(init.headers)
    expect(headers.get('X-Workspace-Slug')).toBe('dev')
    expect(headers.get('X-CSRF-Token')).toBeNull()
  })
})
