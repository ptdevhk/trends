import { useState, useEffect, useCallback } from 'react'
import { getLatestNews, searchNews } from '@/lib/api'
import type { NewsItem } from '@/lib/types'

interface UseTrendsOptions {
  platforms?: string[]
  limit?: number
  autoFetch?: boolean
}

interface UseTrendsReturn {
  news: NewsItem[]
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => Promise<void>
}

export function useTrends(options: UseTrendsOptions = {}): UseTrendsReturn {
  const { platforms, limit = 50, autoFetch = true } = options

  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchNews = useCallback(async () => {
    setLoading(true)
    setError(null)

    const response = await getLatestNews({
      platforms,
      limit,
      include_url: true,
    })

    if (response.success && response.data) {
      setNews(response.data)
      setLastUpdated(new Date())
    } else {
      setError(response.error?.message ?? 'Failed to fetch news')
    }

    setLoading(false)
  }, [platforms, limit])

  useEffect(() => {
    if (autoFetch) {
      fetchNews()
    }
  }, [autoFetch, fetchNews])

  return {
    news,
    loading,
    error,
    lastUpdated,
    refresh: fetchNews,
  }
}

interface UseSearchOptions {
  platforms?: string[]
  limit?: number
}

interface UseSearchReturn {
  results: NewsItem[]
  loading: boolean
  error: string | null
  search: (keyword: string) => Promise<void>
  clear: () => void
}

export function useSearch(options: UseSearchOptions = {}): UseSearchReturn {
  const { platforms, limit = 50 } = options

  const [results, setResults] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(async (keyword: string) => {
    if (!keyword.trim()) {
      setResults([])
      return
    }

    setLoading(true)
    setError(null)

    const response = await searchNews({
      keyword,
      platforms,
      limit,
    })

    if (response.success && response.data) {
      setResults(response.data)
    } else {
      setError(response.error?.message ?? 'Search failed')
    }

    setLoading(false)
  }, [platforms, limit])

  const clear = useCallback(() => {
    setResults([])
    setError(null)
  }, [])

  return {
    results,
    loading,
    error,
    search,
    clear,
  }
}
