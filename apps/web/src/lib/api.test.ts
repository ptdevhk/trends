import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { getLatestNews, searchNews, PLATFORMS } from './api'

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('PLATFORMS', () => {
  it('exports platform definitions', () => {
    expect(PLATFORMS).toHaveLength(11)
    expect(PLATFORMS[0]).toEqual({ id: 'zhihu', name: 'Zhihu Hot List' })
  })
})

describe('getLatestNews', () => {
  it('fetches /api/trends with default params', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: '1', title: 'Test', platform: 'zhihu', rank: 1 }] }),
    } as Response)

    const result = await getLatestNews()

    expect(fetchSpy).toHaveBeenCalledWith('/api/trends')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(1)
      expect(result.data[0].title).toBe('Test')
    }
  })

  it('adds platform, limit, and include_url params', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response)

    await getLatestNews({ platforms: ['zhihu', 'weibo'], limit: 10, include_url: true })

    expect(fetchSpy).toHaveBeenCalledWith('/api/trends?platform=zhihu%2Cweibo&limit=10&include_url=true')
  })

  it('handles HTTP error with error response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Server error' } }),
    } as Response)

    const result = await getLatestNews()

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('API_ERROR')
      expect(result.error.message).toContain('Server error')
    }
  })

  it('handles HTTP error without error data', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => { throw new Error('not json') },
    } as unknown as Response)

    const result = await getLatestNews()

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toBe('HTTP 503')
    }
  })

  it('handles network error', async () => {
    fetchSpy.mockRejectedValue(new Error('Failed to fetch'))

    const result = await getLatestNews()

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NETWORK_ERROR')
      expect(result.error.message).toBe('Failed to fetch')
    }
  })

  it('transforms API response to NewsItem format', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: '42', title: 'News Title', platform: 'weibo', platform_name: 'Weibo', rank: 3, avg_rank: 2.5, count: 100, timestamp: '2026-01-01', url: 'https://weibo.com/42', mobileUrl: 'https://m.weibo.com/42' },
        ],
      }),
    } as Response)

    const result = await getLatestNews()

    if (result.success) {
      const item = result.data[0]
      expect(item.id).toBe('42')
      expect(item.platform_id).toBe('weibo')
      expect(item.platform_name).toBe('Weibo')
      expect(item.rank).toBe(3)
      expect(item.avg_rank).toBe(2.5)
      expect(item.count).toBe(100)
    }
  })
})

describe('searchNews', () => {
  it('fetches /api/search with keyword and options', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: 'Search Result', platform: 'baidu', rank: 1 }] }),
    } as Response)

    const result = await searchNews({ keyword: 'test', platforms: ['baidu'], limit: 5 })

    expect(fetchSpy).toHaveBeenCalledWith('/api/search?q=test&platform=baidu&limit=5')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(1)
    }
  })

  it('handles search API error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Bad request' } }),
    } as Response)

    const result = await searchNews({ keyword: 'bad' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toContain('Bad request')
    }
  })

  it('handles search network error', async () => {
    fetchSpy.mockRejectedValue(new Error('Network failure'))

    const result = await searchNews({ keyword: 'test' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NETWORK_ERROR')
    }
  })
})
