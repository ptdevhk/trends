/**
 * TrendRadar Web Types
 *
 * Types used by the web frontend application.
 */

export interface NewsItem {
  /** Unique identifier */
  id: string
  /** News headline */
  title: string
  /** Platform ID (e.g., zhihu, weibo) */
  platform_id: string
  /** Platform display name */
  platform_name?: string
  /** Current rank position */
  rank: number
  /** Average rank over time */
  avg_rank?: number
  /** Number of times seen on chart */
  count?: number
  /** When the trend was captured */
  timestamp?: string
  /** Date of the trend (YYYY-MM-DD) */
  date?: string
  /** Link to the news item */
  url?: string
  /** Mobile-friendly link */
  mobileUrl?: string
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    suggestion?: string
  }
}

export interface GetLatestNewsParams {
  platforms?: string[]
  limit?: number
  include_url?: boolean
}

export interface SearchNewsParams {
  keyword: string
  platforms?: string[]
  limit?: number
}
