/**
 * TrendRadar Shared Types
 *
 * These types are generated from the OpenAPI specification and used across
 * the frontend and backend applications.
 */

// =============================================================================
// Health Types
// =============================================================================

export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version?: string;
}

// =============================================================================
// Trend Types
// =============================================================================

export interface TrendItem {
  /** News headline */
  title: string;
  /** Platform ID (e.g., zhihu, weibo) */
  platform: string;
  /** Platform display name */
  platform_name: string;
  /** Current rank position */
  rank: number;
  /** Average rank over time */
  avg_rank?: number;
  /** Number of times seen on chart */
  count?: number;
  /** When the trend was captured */
  timestamp?: string;
  /** Date of the trend (YYYY-MM-DD) */
  date?: string;
  /** Link to the news item */
  url?: string;
  /** Mobile-friendly link */
  mobileUrl?: string;
}

export interface TrendsResponse {
  success: true;
  summary?: {
    description: string;
    total: number;
    returned: number;
    platforms: string | string[];
  };
  data: TrendItem[];
}

export interface TrendDetailResponse {
  success: true;
  data: TrendItem;
}

// =============================================================================
// Topic Types
// =============================================================================

export interface Topic {
  /** Topic keyword */
  keyword: string;
  /** Number of occurrences */
  frequency: number;
  /** Number of unique news items matching this topic */
  matched_news?: number;
  /** Trend direction */
  trend?: "rising" | "stable" | "falling";
  /** Weighted score */
  weight_score?: number;
}

export interface TopicsResponse {
  success: true;
  topics: Topic[];
  generated_at?: string;
  mode?: string;
  extract_mode?: string;
  total_keywords?: number;
  description?: string;
}

// =============================================================================
// Search Types
// =============================================================================

export interface SearchResult {
  title: string;
  platform: string;
  platform_name: string;
  ranks?: number[];
  count?: number;
  avg_rank?: number;
  url?: string;
  mobileUrl?: string;
  date?: string;
}

export interface SearchStatistics {
  platform_distribution?: Record<string, number>;
  avg_rank?: number;
  keyword: string;
}

export interface SearchResponse {
  success: true;
  results: SearchResult[];
  total: number;
  total_found?: number;
  statistics?: SearchStatistics;
}

// =============================================================================
// RSS Types
// =============================================================================

export interface RssItem {
  title: string;
  feed_id: string;
  feed_name: string;
  url?: string;
  published_at?: string;
  author?: string;
  date?: string;
  fetch_time?: string;
  summary?: string;
}

export interface RssResponse {
  success: true;
  summary?: {
    description: string;
    total: number;
    returned: number;
    days: number;
    feeds: string | string[];
  };
  data: RssItem[];
}

// =============================================================================
// Error Types
// =============================================================================

export interface ApiError {
  code: string;
  message: string;
  suggestion?: string;
}

export interface ErrorResponse {
  success: false;
  error: ApiError;
}

// =============================================================================
// Query Parameter Types
// =============================================================================

export interface TrendsQueryParams {
  platform?: string;
  date?: string;
  limit?: number;
  include_url?: boolean;
}

export interface TopicsQueryParams {
  top_n?: number;
  mode?: "daily" | "current";
  extract_mode?: "keywords" | "auto_extract";
}

export interface SearchQueryParams {
  q: string;
  platform?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
}

export interface RssQueryParams {
  feed?: string;
  days?: number;
  limit?: number;
  include_summary?: boolean;
}

// =============================================================================
// Platform Types
// =============================================================================

export interface Platform {
  id: string;
  name: string;
}

export const PLATFORMS: Platform[] = [
  { id: "zhihu", name: "Zhihu Hot List" },
  { id: "weibo", name: "Weibo Hot Search" },
  { id: "douyin", name: "Douyin Hot Topics" },
  { id: "baidu", name: "Baidu Hot Search" },
  { id: "toutiao", name: "Toutiao Headlines" },
  { id: "bilibili", name: "Bilibili Hot" },
  { id: "36kr", name: "36Kr Flash" },
  { id: "ithome", name: "IT Home" },
  { id: "thepaper", name: "The Paper" },
  { id: "weread", name: "WeRead Books" },
  { id: "coolapk", name: "Coolapk Hot" },
];
