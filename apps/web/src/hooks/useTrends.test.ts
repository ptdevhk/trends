import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useTrends, useSearch } from './useTrends'

const mockGetLatestNews = vi.fn()
const mockSearchNews = vi.fn()

vi.mock('@/lib/api', () => ({
  getLatestNews: (...args: unknown[]) => mockGetLatestNews(...args),
  searchNews: (...args: unknown[]) => mockSearchNews(...args),
}))

describe('useTrends', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches news on mount by default', async () => {
    mockGetLatestNews.mockResolvedValueOnce({
      success: true,
      data: [{ title: 'Test', platform: 'zhihu', timestamp: '2026-05-13T10:00:00Z' }],
    })
    const { result } = renderHook(() => useTrends())
    await act(async () => {})

    expect(mockGetLatestNews).toHaveBeenCalledWith({
      platforms: undefined,
      limit: 50,
      include_url: true,
    })
    expect(result.current.news).toHaveLength(1)
    expect(result.current.error).toBeNull()
  })

  it('does not fetch when autoFetch is false', async () => {
    renderHook(() => useTrends({ autoFetch: false }))
    await act(async () => {})

    expect(mockGetLatestNews).not.toHaveBeenCalled()
  })

  it('passes platforms and limit to API', async () => {
    const platforms = ['weibo', 'zhihu']
    mockGetLatestNews.mockResolvedValueOnce({ success: true, data: [] })
    renderHook(() => useTrends({ platforms, limit: 10 }))
    await act(async () => {})

    expect(mockGetLatestNews).toHaveBeenCalledWith({
      platforms: ['weibo', 'zhihu'],
      limit: 10,
      include_url: true,
    })
  })

  it('sets error on API failure', async () => {
    mockGetLatestNews.mockResolvedValueOnce({
      success: false,
      error: { message: 'network down' },
    })
    const { result } = renderHook(() => useTrends())
    await act(async () => {})

    expect(result.current.error).toBe('network down')
    expect(result.current.news).toEqual([])
  })

  it('sets default error when no error message', async () => {
    mockGetLatestNews.mockResolvedValueOnce({ success: false })
    const { result } = renderHook(() => useTrends())
    await act(async () => {})

    expect(result.current.error).toBe('Failed to fetch news')
  })

  it('resolves lastUpdated from first valid timestamp', async () => {
    mockGetLatestNews.mockResolvedValueOnce({
      success: true,
      data: [
        { title: 'A', platform: 'zhihu', timestamp: '2026-05-13T10:00:00Z' },
        { title: 'B', platform: 'weibo' },
      ],
    })
    const { result } = renderHook(() => useTrends())
    await act(async () => {})

    expect(result.current.lastUpdated).toBeInstanceOf(Date)
    expect(result.current.lastUpdated?.toISOString()).toBe('2026-05-13T10:00:00.000Z')
  })

  it('refresh re-fetches news', async () => {
    mockGetLatestNews.mockResolvedValueOnce({ success: true, data: [] })
    const { result } = renderHook(() => useTrends({ autoFetch: false }))
    await act(async () => {})

    expect(mockGetLatestNews).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockGetLatestNews).toHaveBeenCalledTimes(1)
  })
})

describe('useSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searches and returns results', async () => {
    mockSearchNews.mockResolvedValueOnce({
      success: true,
      data: [{ title: 'Result', platform: 'zhihu' }],
    })
    const { result } = renderHook(() => useSearch())
    await act(async () => {
      await result.current.search('test query')
    })

    expect(mockSearchNews).toHaveBeenCalledWith({
      keyword: 'test query',
      platforms: undefined,
      limit: 50,
    })
    expect(result.current.results).toHaveLength(1)
  })

  it('clears results for empty keyword', async () => {
    const { result } = renderHook(() => useSearch())
    await act(async () => {
      await result.current.search('  ')
    })

    expect(mockSearchNews).not.toHaveBeenCalled()
    expect(result.current.results).toEqual([])
  })

  it('sets error on search failure', async () => {
    mockSearchNews.mockResolvedValueOnce({
      success: false,
      error: { message: 'timeout' },
    })
    const { result } = renderHook(() => useSearch())
    await act(async () => {
      await result.current.search('query')
    })

    expect(result.current.error).toBe('timeout')
  })

  it('sets default error when no error message', async () => {
    mockSearchNews.mockResolvedValueOnce({ success: false })
    const { result } = renderHook(() => useSearch())
    await act(async () => {
      await result.current.search('query')
    })

    expect(result.current.error).toBe('Search failed')
  })

  it('clear resets results and error', async () => {
    mockSearchNews.mockResolvedValueOnce({
      success: false,
      error: { message: 'fail' },
    })
    const { result } = renderHook(() => useSearch())
    await act(async () => {
      await result.current.search('query')
    })
    expect(result.current.error).toBe('fail')

    act(() => {
      result.current.clear()
    })
    expect(result.current.results).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('passes platforms and limit to search', async () => {
    const platforms = ['weibo']
    mockSearchNews.mockResolvedValueOnce({ success: true, data: [] })
    const { result } = renderHook(() => useSearch({ platforms, limit: 5 }))
    await act(async () => {
      await result.current.search('q')
    })

    expect(mockSearchNews).toHaveBeenCalledWith({
      keyword: 'q',
      platforms: ['weibo'],
      limit: 5,
    })
  })
})
