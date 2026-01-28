/**
 * TrendRadar API Client
 *
 * Provides functions to interact with the TrendRadar BFF API.
 */

import type { NewsItem, ApiResponse, GetLatestNewsParams, SearchNewsParams } from './types'

// API base URL - in production this would come from environment variables
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

/**
 * Platform definitions
 */
export interface Platform {
  id: string
  name: string
}

export const PLATFORMS: Platform[] = [
  { id: 'zhihu', name: 'Zhihu Hot List' },
  { id: 'weibo', name: 'Weibo Hot Search' },
  { id: 'douyin', name: 'Douyin Hot Topics' },
  { id: 'baidu', name: 'Baidu Hot Search' },
  { id: 'toutiao', name: 'Toutiao Headlines' },
  { id: 'bilibili', name: 'Bilibili Hot' },
  { id: '36kr', name: '36Kr Flash' },
  { id: 'ithome', name: 'IT Home' },
  { id: 'thepaper', name: 'The Paper' },
  { id: 'weread', name: 'WeRead Books' },
  { id: 'coolapk', name: 'Coolapk Hot' },
]

/**
 * Fetch the latest news/trends from the API
 */
export async function getLatestNews(
  params: GetLatestNewsParams = {}
): Promise<ApiResponse<NewsItem[]>> {
  try {
    const searchParams = new URLSearchParams()

    if (params.platforms?.length) {
      searchParams.set('platform', params.platforms.join(','))
    }
    if (params.limit) {
      searchParams.set('limit', String(params.limit))
    }
    if (params.include_url) {
      searchParams.set('include_url', 'true')
    }

    const url = `${API_BASE_URL}/trends${searchParams.toString() ? `?${searchParams}` : ''}`
    const response = await fetch(url)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: errorData.error?.message || `HTTP ${response.status}`,
          suggestion: 'Please try again later',
        },
      }
    }

    const data = await response.json()

    // Transform API response to NewsItem format
    const newsItems: NewsItem[] = (data.data || []).map((item: Record<string, unknown>, index: number) => ({
      id: String(item.id || `${item.platform}-${index}`),
      title: String(item.title || ''),
      platform_id: String(item.platform || ''),
      platform_name: String(item.platform_name || item.platform || ''),
      rank: Number(item.rank) || index + 1,
      avg_rank: item.avg_rank ? Number(item.avg_rank) : undefined,
      count: item.count ? Number(item.count) : undefined,
      timestamp: item.timestamp ? String(item.timestamp) : undefined,
      date: item.date ? String(item.date) : undefined,
      url: item.url ? String(item.url) : undefined,
      mobileUrl: item.mobileUrl ? String(item.mobileUrl) : undefined,
    }))

    return {
      success: true,
      data: newsItems,
    }
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
        suggestion: 'Please check your connection and try again',
      },
    }
  }
}

/**
 * Search news by keyword
 */
export async function searchNews(
  params: SearchNewsParams
): Promise<ApiResponse<NewsItem[]>> {
  try {
    const searchParams = new URLSearchParams()
    searchParams.set('q', params.keyword)

    if (params.platforms?.length) {
      searchParams.set('platform', params.platforms.join(','))
    }
    if (params.limit) {
      searchParams.set('limit', String(params.limit))
    }

    const url = `${API_BASE_URL}/search?${searchParams}`
    const response = await fetch(url)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: errorData.error?.message || `HTTP ${response.status}`,
          suggestion: 'Please try again later',
        },
      }
    }

    const data = await response.json()

    // Transform API response to NewsItem format
    const newsItems: NewsItem[] = (data.results || []).map((item: Record<string, unknown>, index: number) => ({
      id: String(item.id || `${item.platform}-${index}`),
      title: String(item.title || ''),
      platform_id: String(item.platform || ''),
      platform_name: String(item.platform_name || item.platform || ''),
      rank: Number(item.rank) || index + 1,
      avg_rank: item.avg_rank ? Number(item.avg_rank) : undefined,
      count: item.count ? Number(item.count) : undefined,
      date: item.date ? String(item.date) : undefined,
      url: item.url ? String(item.url) : undefined,
      mobileUrl: item.mobileUrl ? String(item.mobileUrl) : undefined,
    }))

    return {
      success: true,
      data: newsItems,
    }
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
        suggestion: 'Please check your connection and try again',
      },
    }
  }
}
