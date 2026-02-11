import { CacheService } from "./cache-service.js";
import { config } from "./config.js";
import { DataNotFoundError } from "./errors.js";
import { matchWordGroupAny, ParserService } from "./parser-service.js";
import { formatDateInTimezone, formatIsoOffsetInTimezone } from "./timezone.js";

import type { Topic, TrendItem, SearchResultItem, RssItem } from "../types/data.js";

const STOPWORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
  "看", "好", "自己", "这", "那", "来", "被", "与", "为", "对", "将", "从",
  "以", "及", "等", "但", "或", "而", "于", "中", "由", "可", "可以", "已",
  "已经", "还", "更", "最", "再", "因为", "所以", "如果", "虽然", "然而",
  "什么", "怎么", "如何", "哪", "哪些", "多少", "几", "这个", "那个",
  "他", "她", "它", "他们", "她们", "我们", "你们", "大家", "自己",
  "这样", "那样", "怎样", "这么", "那么", "多么", "非常", "特别",
  "应该", "可能", "能够", "需要", "必须", "一定", "肯定", "确实",
  "正在", "已经", "曾经", "将要", "即将", "刚刚", "马上", "立刻",
  "回应", "发布", "表示", "称", "曝", "官方", "最新", "重磅", "突发",
  "热搜", "刷屏", "引发", "关注", "网友", "评论", "转发", "点赞",
]);

export class DataService {
  private cache: CacheService;
  private parser: ParserService;

  constructor(projectRoot?: string) {
    this.cache = new CacheService();
    this.parser = new ParserService(projectRoot);
  }

  getTrendByTitle(title: string, options?: { includeUrl?: boolean; date?: Date }): TrendItem {
    const cacheKey = this.cache.makeKey("trend_by_title", { title, includeUrl: options?.includeUrl, date: options?.date });
    const cached = this.cache.get<TrendItem>(cacheKey, 900);
    if (cached) return cached;

    const { allTitles, idToName, dateStr } = this.parser.readAllTitlesForDate({
      date: options?.date,
      dbType: "news",
    });

    for (const [platformId, titles] of Object.entries(allTitles)) {
      const info = titles[title];
      if (!info) continue;

      const platformName = idToName[platformId] ?? platformId;
      const ranks = info.ranks ?? [];

      const item: TrendItem = {
        title,
        platform: platformId,
        platform_name: platformName,
        rank: ranks[0] ?? 0,
        count: ranks.length,
        avg_rank: ranks.length > 0 ? Number((ranks.reduce((s, r) => s + r, 0) / ranks.length).toFixed(2)) : 0,
        date: dateStr,
      };

      if (options?.includeUrl) {
        item.url = info.url ?? "";
        item.mobileUrl = info.mobileUrl ?? "";
      }

      this.cache.set(cacheKey, item);
      return item;
    }

    throw new DataNotFoundError(`Trend not found: ${title}`);
  }

  getLatestNews(options: {
    platforms?: string[];
    limit?: number;
    includeUrl?: boolean;
  }): TrendItem[] {
    const cacheKey = this.cache.makeKey("latest_news", options);
    const cached = this.cache.get<TrendItem[]>(cacheKey, 900);
    if (cached) return cached;

    const { allTitles, idToName, timestampsMs, dateStr } = this.parser.readAllTitlesForDate({
      sourceIds: options.platforms,
      dbType: "news",
    });

    const latestTs = Object.values(timestampsMs).length > 0 ? Math.max(...Object.values(timestampsMs)) : Date.now();
    const fetchTime = new Date(latestTs);

    const news: TrendItem[] = [];

    for (const [platformId, titles] of Object.entries(allTitles)) {
      const platformName = idToName[platformId] ?? platformId;
      for (const [title, info] of Object.entries(titles)) {
        const rank = info.ranks?.[0] ?? 0;
        const item: TrendItem = {
          title,
          platform: platformId,
          platform_name: platformName,
          rank,
          timestamp: formatIsoOffsetInTimezone(fetchTime, config.timezone),
          date: dateStr,
        };

        if (options.includeUrl) {
          item.url = info.url ?? "";
          item.mobileUrl = info.mobileUrl ?? "";
        }

        news.push(item);
      }
    }

    news.sort((a, b) => a.rank - b.rank);
    const result = news.slice(0, options.limit ?? 50);

    this.cache.set(cacheKey, result);
    return result;
  }

  getNewsByDate(targetDate: Date, options: {
    platforms?: string[];
    limit?: number;
    includeUrl?: boolean;
  }): TrendItem[] {
    const dateKey = formatDateInTimezone(targetDate, config.timezone);
    const cacheKey = this.cache.makeKey("news_by_date", { dateKey, ...options });
    const cached = this.cache.get<TrendItem[]>(cacheKey, 900);
    if (cached) return cached;

    const { allTitles, idToName, dateStr } = this.parser.readAllTitlesForDate({
      date: targetDate,
      sourceIds: options.platforms,
      dbType: "news",
    });

    const news: TrendItem[] = [];
    for (const [platformId, titles] of Object.entries(allTitles)) {
      const platformName = idToName[platformId] ?? platformId;
      for (const [title, info] of Object.entries(titles)) {
        const ranks = info.ranks ?? [];
        const avg_rank = ranks.length > 0 ? ranks.reduce((sum, r) => sum + r, 0) / ranks.length : 0;

        const item: TrendItem = {
          title,
          platform: platformId,
          platform_name: platformName,
          rank: ranks[0] ?? 0,
          avg_rank: Number(avg_rank.toFixed(2)),
          count: ranks.length,
          date: dateStr,
        };

        if (options.includeUrl) {
          item.url = info.url ?? "";
          item.mobileUrl = info.mobileUrl ?? "";
        }

        news.push(item);
      }
    }

    news.sort((a, b) => a.rank - b.rank);
    const result = news.slice(0, options.limit ?? 50);

    this.cache.set(cacheKey, result);
    return result;
  }

  searchNewsByKeyword(options: {
    keyword: string;
    dateRange?: { start: Date; end: Date };
    platforms?: string[];
    limit?: number;
  }): { results: SearchResultItem[]; total: number; total_found: number; statistics: { platform_distribution: Record<string, number>; avg_rank: number; keyword: string } } {
    const cacheKey = this.cache.makeKey("search", options);
    const cached = this.cache.get<ReturnType<DataService["searchNewsByKeyword"]>>(cacheKey, 900);
    if (cached) return cached;

    const range = options.dateRange ?? (() => {
      const latest = this.parser.resolveDate(undefined, "news");
      return { start: latest, end: latest };
    })();

    let startDate = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
    let endDate = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate());
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];

    const keywordLower = options.keyword.toLowerCase();
    const results: SearchResultItem[] = [];
    const platform_distribution: Record<string, number> = {};

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      try {
        const { allTitles, idToName, dateStr } = this.parser.readAllTitlesForDate({
          date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
          sourceIds: options.platforms,
          dbType: "news",
        });

        for (const [platformId, titles] of Object.entries(allTitles)) {
          const platformName = idToName[platformId] ?? platformId;
          for (const [title, info] of Object.entries(titles)) {
            if (!title.toLowerCase().includes(keywordLower)) continue;
            const ranks = info.ranks ?? [];
            const avg_rank = ranks.length > 0 ? ranks.reduce((sum, r) => sum + r, 0) / ranks.length : 0;

            results.push({
              title,
              platform: platformId,
              platform_name: platformName,
              ranks,
              count: ranks.length,
              avg_rank: Number(avg_rank.toFixed(2)),
              url: info.url ?? "",
              mobileUrl: info.mobileUrl ?? "",
              date: dateStr,
            });

            platform_distribution[platformId] = (platform_distribution[platformId] ?? 0) + 1;
          }
        }
      } catch (error) {
        if (error instanceof DataNotFoundError) continue;
        throw error;
      }
    }

    if (results.length === 0) {
      throw new DataNotFoundError(`No news found containing keyword '${options.keyword}'`, {
        suggestion: "Try a different keyword or run a fresh crawl to generate more data",
      });
    }

    const allRanks = results.flatMap((r) => r.ranks);
    const avg_rank = allRanks.length > 0 ? allRanks.reduce((sum, r) => sum + r, 0) / allRanks.length : 0;

    const total_found = results.length;
    const limited = options.limit && options.limit > 0 ? results.slice(0, options.limit) : results;

    const result = {
      results: limited,
      total: limited.length,
      total_found,
      statistics: {
        platform_distribution,
        avg_rank: Number(avg_rank.toFixed(2)),
        keyword: options.keyword,
      },
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  getTrendingTopics(options: {
    top_n?: number;
    mode?: "daily" | "current";
    extract_mode?: "keywords" | "auto_extract";
  }): { topics: Topic[]; generated_at: string; mode: string; extract_mode: string; total_keywords: number; description: string } {
    const cacheKey = this.cache.makeKey("trending_topics", options);
    const cached = this.cache.get<ReturnType<DataService["getTrendingTopics"]>>(cacheKey, 900);
    if (cached) return cached;

    const mode = options.mode ?? "current";
    const extract_mode = options.extract_mode ?? "keywords";
    const top_n = Math.min(Math.max(options.top_n ?? 10, 1), 50);

    const { allTitles } = this.parser.readAllTitlesForDate({ dbType: "news" });
    const titles = Object.values(allTitles).flatMap((perPlatform) => Object.keys(perPlatform));
    if (titles.length === 0) {
      throw new DataNotFoundError("No news data available for trending topics");
    }

    const wordFrequency = new Map<string, number>();
    const keywordToNews = new Map<string, string[]>();

    if (extract_mode === "keywords") {
      const groups = this.parser.parseFrequencyWords();
      for (const title of titles) {
        const matchedGroup = groups.find((g) => matchWordGroupAny(g, title));
        if (!matchedGroup) continue;

        const key = matchedGroup.display_name ?? matchedGroup.group_key;
        wordFrequency.set(key, (wordFrequency.get(key) ?? 0) + 1);
        const list = keywordToNews.get(key) ?? [];
        list.push(title);
        keywordToNews.set(key, list);
      }
    } else {
      for (const title of titles) {
        for (const word of this.extractWordsFromTitle(title)) {
          wordFrequency.set(word, (wordFrequency.get(word) ?? 0) + 1);
          const list = keywordToNews.get(word) ?? [];
          list.push(title);
          keywordToNews.set(word, list);
        }
      }
    }

    const sorted = [...wordFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, top_n);
    const topics: Topic[] = sorted.map(([keyword, frequency]) => ({
      keyword,
      frequency,
      matched_news: new Set(keywordToNews.get(keyword) ?? []).size,
      trend: "stable",
      weight_score: 0,
    }));

    const result = {
      topics,
      generated_at: formatIsoOffsetInTimezone(new Date(), config.timezone),
      mode,
      extract_mode,
      total_keywords: wordFrequency.size,
      description: `${mode === "daily" ? "Daily" : "Current"} statistics - ${
        extract_mode === "keywords" ? "Based on preset keywords" : "Auto-extracted"
      }`,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  getLatestRss(options: {
    feeds?: string[];
    days?: number;
    limit?: number;
    includeSummary?: boolean;
  }): RssItem[] {
    const cacheKey = this.cache.makeKey("latest_rss", options);
    const cached = this.cache.get<RssItem[]>(cacheKey, 900);
    if (cached) return cached;

    const days = Math.min(Math.max(options.days ?? 1, 1), 30);
    const limit = options.limit ?? 50;

    const rss: RssItem[] = [];
    const seenUrls = new Set<string>();

    const latest = this.parser.resolveDate(undefined, "rss");

    for (let i = 0; i < days; i += 1) {
      const day = new Date(latest.getFullYear(), latest.getMonth(), latest.getDate() - i);
      try {
        const { allTitles, idToName, timestampsMs, dateStr } = this.parser.readAllTitlesForDate({
          date: day,
          sourceIds: options.feeds,
          dbType: "rss",
        });

        const latestTs = Object.values(timestampsMs).length > 0 ? Math.max(...Object.values(timestampsMs)) : Date.now();
        const fetchTime = new Date(latestTs);

        for (const [feedId, items] of Object.entries(allTitles)) {
          const feedName = idToName[feedId] ?? feedId;
          for (const [title, info] of Object.entries(items)) {
            const url = info.url ?? "";
            if (url && seenUrls.has(url)) continue;
            if (url) seenUrls.add(url);

            const item: RssItem = {
              title,
              feed_id: feedId,
              feed_name: feedName,
              url,
              published_at: info.published_at ?? "",
              author: info.author ?? "",
              date: dateStr,
              fetch_time: formatIsoOffsetInTimezone(fetchTime, config.timezone),
            };
            if (options.includeSummary) item.summary = info.summary ?? "";
            rss.push(item);
          }
        }
      } catch (error) {
        if (error instanceof DataNotFoundError) continue;
        throw error;
      }
    }

    rss.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
    const result = rss.slice(0, limit);
    this.cache.set(cacheKey, result);
    return result;
  }

  private extractWordsFromTitle(title: string, minLength = 2): string[] {
    let text = title;
    text = text.replace(/http[s]?:\/\/\S+/g, "");
    text = text.replace(/\[.*?\]/g, "");
    text = text.replace(/[【】《》「」『』""''・·•]/g, "");

    const matches = text.match(/[\u4e00-\u9fff]{2,}|[a-zA-Z]{2,}[a-zA-Z0-9]*/g) ?? [];
    return matches.filter((w) => w.length >= minLength && !STOPWORDS.has(w) && !STOPWORDS.has(w.toLowerCase()));
  }
}
