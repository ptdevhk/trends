import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NewsItem } from '@/lib/types'
import { useTrends, useSearch } from './useTrends'

const mockGetLatestNews = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  data: [] as NewsItem[],
})))

const mockSearchNews = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  data: [] as NewsItem[],
})))

vi.mock('@/lib/api', () => ({
  getLatestNews: mockGetLatestNews,
  searchNews: mockSearchNews,
}))

const sampleNews: NewsItem[] = [
  { id: '1', title: 'Test News', platform_id: 'zhihu', rank: 1, timestamp: '2026-05-13T10:00:00Z' },
  { id: '2', title: 'No Timestamp', platform_id: 'weibo', rank: 2 },
]

describe('useTrends', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches news on mount with default autoFetch', async () => {
    mockGetLatestNews.mockResolvedValueOnce({
      success: true,
      data: sampleNews,
    })

    const { result } = renderHook(() => useTrends())

    await act(async () => {})

    expect(result.current.news).toEqual(sampleNews)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.lastUpdated).toBeInstanceOf(Date)
    expect(mockGetLatestNews).toHaveBeenCalledWith({
      platforms: undefined,
      limit: 50,
      include_url: true,
    })
  })

  it('does not fetch when autoFetch is false', () => {
    const { result } = renderHook(() => useTrends({ autoFetch: false }))

    expect(mockGetLatestNews).not.toHaveBeenCalled()
    expect(result.current.news).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('sets error when success is false', async () => {
    mockGetLatestNews.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR', message: 'Server error' },
    })

    const { result } = renderHook(() => useTrends())

    await act(async () => {})

    expect(result.current.error).toBe('Server error')
    expect(result.current.news).toEqual([])
  })

  it('sets default error message when error has no message', async () => {
    mockGetLatestNews.mockResolvedValueOnce({
      success: false,
    })

    const { result } = renderHook(() => useTrends())

    await act(async () => {})

    expect(result.current.error).toBe('Failed to fetch news')
  })

  it('refresh triggers a re-fetch', async () => {
    mockGetLatestNews.mockResolvedValue({ success: true, data: [] })

    const { result } = renderHook(() => useTrends())

    await act(async () => {})
    expect(mockGetLatestNews).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockGetLatestNews).toHaveBeenCalledTimes(2)
  })

  it('passes platforms and limit to getLatestNews', async () => {
    mockGetLatestNews.mockResolvedValue({ success: true, data: [] })

    renderHook(() => useTrends({ platforms: ['zhihu', 'weibo'], limit: 10 }))

    await waitFor(() => {
      expect(mockGetLatestNews).toHaveBeenCalledWith({
        platforms: ['zhihu', 'weibo'],
        limit: 10,
        include_url: true,
      })
    })
  })

  it('resolveLastUpdated uses first valid timestamp', async () => {
    mockGetLatestNews.mockResolvedValueOnce({
      success: true,
      data: sampleNews,
    })

    const { result } = renderHook(() => useTrends())

    await act(async () => {})

    expect(result.current.lastUpdated).toEqual(new Date('2026-05-13T10:00:00Z'))
  })

  it('resolveLastUpdated falls back to current date when no valid timestamps', async () => {
    mockGetLatestNews.mockResolvedValueOnce({
      success: true,
      data: [{ id: '1', title: 'No Date', platform_id: 'zhihu', rank: 1 }],
    })

    const before = new Date()
    const { result } = renderHook(() => useTrends())

    await act(async () => {})

    expect(result.current.lastUpdated).toBeInstanceOf(Date)
    expect(result.current.lastUpdated!.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })
})

describe('useSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('search calls searchNews with keyword', async () => {
    mockSearchNews.mockResolvedValueOnce({
      success: true,
      data: sampleNews,
    })

    const { result } = renderHook(() => useSearch())

    await act(async () => {
      await result.current.search('test query')
    })

    expect(result.current.results).toEqual(sampleNews)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(mockSearchNews).toHaveBeenCalledWith({
      keyword: 'test query',
      platforms: undefined,
      limit: 50,
    })
  })

  it('empty keyword clears results without calling API', async () => {
    const { result } = renderHook(() => useSearch())

    await act(async () => {
      await result.current.search('  ')
    })

    expect(result.current.results).toEqual([])
    expect(mockSearchNews).not.toHaveBeenCalled()
  })

  it('sets error when search fails', async () => {
    mockSearchNews.mockResolvedValueOnce({
      success: false,
      error: { code: 'ERR', message: 'Search failed' },
    })

    const { result } = renderHook(() => useSearch())

    await act(async () => {
      await result.current.search('query')
    })

    expect(result.current.error).toBe('Search failed')
    expect(result.current.results).toEqual([])
  })

  it('sets default error message when error has no message', async () => {
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
      error: { code: 'ERR', message: 'fail' },
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

  it('passes platforms and limit to searchNews', async () => {
    mockSearchNews.mockResolvedValueOnce({ success: true, data: [] })

    const { result } = renderHook(() => useSearch({ platforms: ['zhihu'], limit: 5 }))

    await act(async () => {
      await result.current.search('test')
    })

    expect(mockSearchNews).toHaveBeenCalledWith({
      keyword: 'test',
      platforms: ['zhihu'],
      limit: 5,
    })
  })
})
