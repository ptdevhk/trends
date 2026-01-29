export type TrendItem = {
  title: string;
  platform: string;
  platform_name: string;
  rank: number;
  avg_rank?: number;
  count?: number;
  timestamp?: string;
  date?: string;
  url?: string;
  mobileUrl?: string;
};

export type Topic = {
  keyword: string;
  frequency: number;
  matched_news?: number;
  trend?: "rising" | "stable" | "falling";
  weight_score?: number;
};

export type SearchResultItem = {
  title: string;
  platform: string;
  platform_name: string;
  ranks: number[];
  count: number;
  avg_rank: number;
  url?: string;
  mobileUrl?: string;
  date: string;
};

export type RssItem = {
  title: string;
  feed_id: string;
  feed_name: string;
  url?: string;
  published_at?: string;
  author?: string;
  date?: string;
  fetch_time?: string;
  summary?: string;
};

