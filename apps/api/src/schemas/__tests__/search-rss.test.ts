import { describe, it, expect } from "vitest";
import {
  SearchResultSchema,
  SearchQuerySchema,
  SearchResponseSchema,
} from "../search.js";
import {
  RssItemSchema,
  RssQuerySchema,
  RssResponseSchema,
} from "../rss.js";

// --- search.ts ---

describe("SearchResultSchema", () => {
  it("validates a search result with required fields", () => {
    const result = SearchResultSchema.parse({
      title: "AI breakthrough",
      platform: "zhihu",
      platform_name: "Zhihu",
    });
    expect(result.title).toBe("AI breakthrough");
  });

  it("accepts optional fields", () => {
    const result = SearchResultSchema.parse({
      title: "Test",
      platform: "weibo",
      platform_name: "Weibo",
      ranks: [1, 2, 3],
      count: 5,
      avg_rank: 2.0,
      url: "https://example.com",
    });
    expect(result.ranks).toEqual([1, 2, 3]);
    expect(result.avg_rank).toBe(2.0);
  });
});

describe("SearchQuerySchema", () => {
  it("parses a valid query", () => {
    const result = SearchQuerySchema.parse({ q: "AI" });
    expect(result.q).toBe("AI");
  });

  it("defaults limit to 50", () => {
    expect(SearchQuerySchema.parse({ q: "AI" }).limit).toBe(50);
  });

  it("parses string limit", () => {
    expect(SearchQuerySchema.parse({ q: "AI", limit: "25" }).limit).toBe(25);
  });

  it("rejects limit > 100", () => {
    expect(() => SearchQuerySchema.parse({ q: "AI", limit: "101" })).toThrow();
  });

  it("rejects empty query string", () => {
    expect(() => SearchQuerySchema.parse({ q: "" })).toThrow();
  });

  it("accepts optional date filters", () => {
    const result = SearchQuerySchema.parse({
      q: "AI",
      start_date: "2026-01-01",
      end_date: "2026-05-22",
    });
    expect(result.start_date).toBe("2026-01-01");
    expect(result.end_date).toBe("2026-05-22");
  });
});

describe("SearchResponseSchema", () => {
  it("validates response with results", () => {
    const result = SearchResponseSchema.parse({
      success: true,
      results: [{ title: "AI", platform: "zhihu", platform_name: "Zhihu" }],
      total: 1,
    });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("validates response with statistics", () => {
    const result = SearchResponseSchema.parse({
      success: true,
      results: [],
      total: 0,
      statistics: { keyword: "AI", avg_rank: 3.5 },
    });
    expect(result.statistics?.keyword).toBe("AI");
  });

  it("rejects success: false", () => {
    expect(() =>
      SearchResponseSchema.parse({ success: false, results: [], total: 0 }),
    ).toThrow();
  });
});

// --- rss.ts ---

describe("RssItemSchema", () => {
  it("validates an RSS item with required fields", () => {
    const result = RssItemSchema.parse({
      title: "Tech News",
      feed_id: "techcrunch",
      feed_name: "TechCrunch",
    });
    expect(result.title).toBe("Tech News");
    expect(result.feed_id).toBe("techcrunch");
  });

  it("accepts optional fields", () => {
    const result = RssItemSchema.parse({
      title: "Test",
      feed_id: "feed1",
      feed_name: "Feed One",
      url: "https://example.com/article",
      published_at: "2026-05-22",
      author: "John",
    });
    expect(result.url).toBe("https://example.com/article");
    expect(result.author).toBe("John");
  });
});

describe("RssQuerySchema", () => {
  it("defaults days to 1", () => {
    expect(RssQuerySchema.parse({}).days).toBe(1);
  });

  it("defaults limit to 50", () => {
    expect(RssQuerySchema.parse({}).limit).toBe(50);
  });

  it("parses string days", () => {
    expect(RssQuerySchema.parse({ days: "7" }).days).toBe(7);
  });

  it("parses string limit", () => {
    expect(RssQuerySchema.parse({ limit: "25" }).limit).toBe(25);
  });

  it("parses include_summary as boolean", () => {
    expect(RssQuerySchema.parse({ include_summary: "true" }).include_summary).toBe(true);
    expect(RssQuerySchema.parse({ include_summary: "false" }).include_summary).toBe(false);
    expect(RssQuerySchema.parse({}).include_summary).toBe(false);
  });

  it("rejects days > 30", () => {
    expect(() => RssQuerySchema.parse({ days: "31" })).toThrow();
  });

  it("rejects limit > 100", () => {
    expect(() => RssQuerySchema.parse({ limit: "101" })).toThrow();
  });

  it("accepts feed filter", () => {
    expect(RssQuerySchema.parse({ feed: "techcrunch" }).feed).toBe("techcrunch");
  });
});

describe("RssResponseSchema", () => {
  it("validates response with items", () => {
    const result = RssResponseSchema.parse({
      success: true,
      data: [{ title: "News", feed_id: "f1", feed_name: "Feed 1" }],
    });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("validates response with summary", () => {
    const result = RssResponseSchema.parse({
      success: true,
      data: [],
      summary: {
        description: "RSS feed",
        total: 10,
        returned: 5,
        days: 1,
        feeds: "techcrunch",
      },
    });
    expect(result.summary?.total).toBe(10);
  });

  it("rejects success: false", () => {
    expect(() =>
      RssResponseSchema.parse({ success: false, data: [] }),
    ).toThrow();
  });
});
