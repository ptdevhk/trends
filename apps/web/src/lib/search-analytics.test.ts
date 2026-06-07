import { afterAll, describe, expect, it, vi, beforeEach } from 'vitest'
import { logSearchEvent } from '@/lib/search-analytics'

describe('logSearchEvent', () => {
  const mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)

  beforeEach(() => {
    vi.clearAllMocks()
    document.cookie = 'trends_csrf=; Max-Age=0; path=/'
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('sends POST with query and resultCount', () => {
    mockFetch.mockResolvedValue({ ok: true })
    logSearchEvent({ query: 'React developer', resultCount: 10 })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toContain('/api/search-analytics/log')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      query: 'React developer',
      resultCount: 10,
    })
  })

  it('includes topScore when provided', () => {
    mockFetch.mockResolvedValue({ ok: true })
    logSearchEvent({ query: 'test', resultCount: 5, topScore: 92.5 })
    const [, options] = mockFetch.mock.calls[0]
    expect(JSON.parse(options.body).topScore).toBe(92.5)
  })

  it('does not include topScore when not provided', () => {
    mockFetch.mockResolvedValue({ ok: true })
    logSearchEvent({ query: 'test', resultCount: 5 })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.topScore).toBeUndefined()
  })

  it('sets keepalive flag', () => {
    mockFetch.mockResolvedValue({ ok: true })
    logSearchEvent({ query: 'test', resultCount: 1 })
    expect(mockFetch.mock.calls[0][1].keepalive).toBe(true)
  })

  it('sends CSRF token when present', () => {
    document.cookie = 'trends_csrf=csrf-token-analytics; path=/'
    mockFetch.mockResolvedValue({ ok: true })

    logSearchEvent({ query: 'test', resultCount: 1 })

    expect(mockFetch.mock.calls[0][1].headers['X-CSRF-Token']).toBe('csrf-token-analytics')
  })

  it('silently ignores network errors', () => {
    mockFetch.mockRejectedValue(new Error('Network fail'))
    expect(() => {
      logSearchEvent({ query: 'test', resultCount: 1 })
    }).not.toThrow()
  })
})
