/**
 * Mock Data Service
 *
 * Provides mock data for development and when worker is unavailable.
 */

import type { z } from "@hono/zod-openapi";
import type { TrendItemSchema, TopicSchema, SearchResultSchema, RssItemSchema } from "../schemas/index.js";

type TrendItem = z.infer<typeof TrendItemSchema>;
type Topic = z.infer<typeof TopicSchema>;
type SearchResult = z.infer<typeof SearchResultSchema>;
type RssItem = z.infer<typeof RssItemSchema>;

// Sample platforms
const platforms = [
  { id: "zhihu", name: "Zhihu Hot List" },
  { id: "weibo", name: "Weibo Hot Search" },
  { id: "douyin", name: "Douyin Hot Topics" },
  { id: "baidu", name: "Baidu Hot Search" },
  { id: "toutiao", name: "Toutiao Headlines" },
];

// Sample news titles (in Chinese for authenticity)
const sampleTitles = [
  "DeepSeek-R1 AI Model Released",
  "Tesla Cybertruck Delivery Begins",
  "Apple Vision Pro Launch Date Announced",
  "SpaceX Starship Test Flight",
  "OpenAI GPT-5 Development Update",
  "Netflix Password Sharing Crackdown",
  "Bitcoin ETF Approval Expected",
  "Microsoft Copilot Integration",
  "Google Gemini AI Features",
  "Amazon Drone Delivery Expansion",
];

function generateTrendItems(count: number, options: {
  platform?: string;
  date?: string;
  includeUrl?: boolean;
}): TrendItem[] {
  const now = new Date();
  const dateStr = options.date || now.toISOString().split("T")[0];

  return Array.from({ length: Math.min(count, sampleTitles.length) }, (_, i) => {
    const platformInfo = options.platform
      ? platforms.find((p) => p.id === options.platform) || platforms[0]
      : platforms[i % platforms.length];

    const item: TrendItem = {
      title: sampleTitles[i],
      platform: platformInfo.id,
      platform_name: platformInfo.name,
      rank: i + 1,
      avg_rank: i + 1 + Math.random() * 2,
      count: Math.floor(Math.random() * 10) + 1,
      timestamp: now.toISOString(),
      date: dateStr,
    };

    if (options.includeUrl) {
      item.url = `https://example.com/news/${i + 1}`;
      item.mobileUrl = `https://m.example.com/news/${i + 1}`;
    }

    return item;
  });
}

function generateTopics(count: number): Topic[] {
  const keywords = [
    "AI",
    "Tesla",
    "Apple",
    "SpaceX",
    "OpenAI",
    "Bitcoin",
    "Microsoft",
    "Google",
    "Amazon",
    "Netflix",
  ];

  return keywords.slice(0, count).map((keyword, i) => ({
    keyword,
    frequency: Math.floor(Math.random() * 20) + 5,
    matched_news: Math.floor(Math.random() * 10) + 1,
    trend: (["rising", "stable", "falling"] as const)[Math.floor(Math.random() * 3)],
    weight_score: Math.random() * 100,
  }));
}

function searchItems(keyword: string, limit: number): SearchResult[] {
  const matching = sampleTitles.filter((title) =>
    title.toLowerCase().includes(keyword.toLowerCase())
  );

  return matching.slice(0, limit).map((title, i) => {
    const platformInfo = platforms[i % platforms.length];
    return {
      title,
      platform: platformInfo.id,
      platform_name: platformInfo.name,
      ranks: [i + 1, i + 2, i + 1],
      count: 3,
      avg_rank: i + 1.3,
      url: `https://example.com/news/${i + 1}`,
      date: new Date().toISOString().split("T")[0],
    };
  });
}

function generateRssItems(count: number, options: {
  feed?: string;
  includeSummary?: boolean;
}): RssItem[] {
  const feeds = [
    { id: "hacker-news", name: "Hacker News" },
    { id: "36kr", name: "36Kr" },
    { id: "techcrunch", name: "TechCrunch" },
  ];

  return Array.from({ length: count }, (_, i) => {
    const feedInfo = options.feed
      ? feeds.find((f) => f.id === options.feed) || feeds[0]
      : feeds[i % feeds.length];

    const item: RssItem = {
      title: `RSS Article ${i + 1}: ${sampleTitles[i % sampleTitles.length]}`,
      feed_id: feedInfo.id,
      feed_name: feedInfo.name,
      url: `https://example.com/rss/${i + 1}`,
      published_at: new Date(Date.now() - i * 3600000).toISOString(),
      author: `Author ${i + 1}`,
      date: new Date().toISOString().split("T")[0],
      fetch_time: new Date().toISOString(),
    };

    if (options.includeSummary) {
      item.summary = `This is a summary for article ${i + 1}. It discusses ${sampleTitles[i % sampleTitles.length].toLowerCase()}.`;
    }

    return item;
  });
}

export const mockData = {
  getTrends: generateTrendItems,
  getTopics: generateTopics,
  search: searchItems,
  getRss: generateRssItems,
  platforms,
};
