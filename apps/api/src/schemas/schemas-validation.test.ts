import { describe, expect, it } from "vitest";

import {
  TrendItemSchema,
  TrendsQuerySchema,
  TrendsResponseSchema,
  TrendIdParamSchema,
  TrendDetailResponseSchema,
  TopicSchema,
  TopicsQuerySchema,
  TopicsResponseSchema,
} from "../schemas/trends.js";

import {
  SearchResultSchema,
  SearchQuerySchema,
  SearchResponseSchema,
} from "../schemas/search.js";

import {
  PaginationSchema,
  PlatformFilterSchema,
  DateFilterSchema,
  SimpleErrorSchema,
  ErrorResponseSchema,
} from "../schemas/common.js";

import {
  RssItemSchema,
  RssQuerySchema,
  RssResponseSchema,
} from "../schemas/rss.js";

import { HealthResponseSchema } from "../schemas/health.js";

// ---------------------------------------------------------------------------
// trends.ts schemas
// ---------------------------------------------------------------------------

describe("TrendItemSchema", () => {
  it("parses a valid trend item", () => {
    const result = TrendItemSchema.safeParse({
      title: "AI breakthrough",
      platform: "zhihu",
      platform_name: "Zhihu Hot List",
      rank: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = TrendItemSchema.safeParse({
      title: "Test",
      platform: "weibo",
      platform_name: "Weibo",
      rank: 5,
      avg_rank: 3.5,
      count: 10,
      timestamp: "2024-01-01",
      date: "2024-01-01",
      url: "https://example.com",
      mobileUrl: "https://m.example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = TrendItemSchema.safeParse({ title: "Test" });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer rank", () => {
    const result = TrendItemSchema.safeParse({
      title: "Test",
      platform: "zhihu",
      platform_name: "Zhihu",
      rank: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("TrendsQuerySchema", () => {
  it("applies default limit of 50", () => {
    const result = TrendsQuerySchema.parse({});
    expect(result.limit).toBe(50);
  });

  it("parses limit from string", () => {
    const result = TrendsQuerySchema.parse({ limit: "25" });
    expect(result.limit).toBe(25);
  });

  it("rejects limit below 1", () => {
    const result = TrendsQuerySchema.safeParse({ limit: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects limit above 100", () => {
    const result = TrendsQuerySchema.safeParse({ limit: "101" });
    expect(result.success).toBe(false);
  });

  it("parses include_url as true when 'true'", () => {
    const result = TrendsQuerySchema.parse({ include_url: "true" });
    expect(result.include_url).toBe(true);
  });

  it("parses include_url as false when not 'true'", () => {
    const result = TrendsQuerySchema.parse({ include_url: "false" });
    expect(result.include_url).toBe(false);
  });

  it("defaults include_url to false", () => {
    const result = TrendsQuerySchema.parse({});
    expect(result.include_url).toBe(false);
  });

  it("accepts optional platform and date", () => {
    const result = TrendsQuerySchema.parse({ platform: "zhihu", date: "2024-01-01" });
    expect(result.platform).toBe("zhihu");
    expect(result.date).toBe("2024-01-01");
  });
});

describe("TrendsResponseSchema", () => {
  it("parses a valid response with summary", () => {
    const result = TrendsResponseSchema.safeParse({
      success: true,
      summary: {
        description: "Top trends",
        total: 10,
        returned: 10,
        platforms: "zhihu",
      },
      data: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts platforms as array", () => {
    const result = TrendsResponseSchema.safeParse({
      success: true,
      summary: {
        description: "Top",
        total: 5,
        returned: 5,
        platforms: ["zhihu", "weibo"],
      },
      data: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects success: false", () => {
    const result = TrendsResponseSchema.safeParse({
      success: false,
      data: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("TrendIdParamSchema", () => {
  it("parses a valid id", () => {
    const result = TrendIdParamSchema.safeParse({ id: "abc123" });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = TrendIdParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("TopicSchema", () => {
  it("parses a valid topic", () => {
    const result = TopicSchema.safeParse({
      keyword: "AI",
      frequency: 15,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = TopicSchema.safeParse({
      keyword: "AI",
      frequency: 10,
      matched_news: 5,
      trend: "rising",
      weight_score: 0.8,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid trend value", () => {
    const result = TopicSchema.safeParse({
      keyword: "AI",
      frequency: 10,
      trend: "exploding",
    });
    expect(result.success).toBe(false);
  });
});

describe("TopicsQuerySchema", () => {
  it("applies default top_n of 10", () => {
    const result = TopicsQuerySchema.parse({});
    expect(result.top_n).toBe(10);
  });

  it("parses top_n from string", () => {
    const result = TopicsQuerySchema.parse({ top_n: "25" });
    expect(result.top_n).toBe(25);
  });

  it("rejects top_n above 50", () => {
    const result = TopicsQuerySchema.safeParse({ top_n: "51" });
    expect(result.success).toBe(false);
  });

  it("defaults mode to current", () => {
    const result = TopicsQuerySchema.parse({});
    expect(result.mode).toBe("current");
  });

  it("defaults extract_mode to keywords", () => {
    const result = TopicsQuerySchema.parse({});
    expect(result.extract_mode).toBe("keywords");
  });

  it("accepts valid mode values", () => {
    for (const mode of ["daily", "current"] as const) {
      const result = TopicsQuerySchema.parse({ mode });
      expect(result.mode).toBe(mode);
    }
  });

  it("accepts valid extract_mode values", () => {
    for (const extract_mode of ["keywords", "auto_extract"] as const) {
      const result = TopicsQuerySchema.parse({ extract_mode });
      expect(result.extract_mode).toBe(extract_mode);
    }
  });
});

// ---------------------------------------------------------------------------
// search.ts schemas
// ---------------------------------------------------------------------------

describe("SearchResultSchema", () => {
  it("parses a valid search result", () => {
    const result = SearchResultSchema.safeParse({
      title: "AI news",
      platform: "zhihu",
      platform_name: "Zhihu",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = SearchResultSchema.safeParse({
      title: "Test",
      platform: "weibo",
      platform_name: "Weibo",
      ranks: [1, 2, 3],
      count: 5,
      avg_rank: 2.0,
      url: "https://example.com",
      mobileUrl: "https://m.example.com",
      date: "2024-01-01",
    });
    expect(result.success).toBe(true);
  });
});

describe("SearchQuerySchema", () => {
  it("requires q parameter", () => {
    const result = SearchQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parses valid query with defaults", () => {
    const result = SearchQuerySchema.parse({ q: "AI" });
    expect(result.limit).toBe(50);
  });

  it("parses limit from string", () => {
    const result = SearchQuerySchema.parse({ q: "AI", limit: "25" });
    expect(result.limit).toBe(25);
  });

  it("rejects empty q", () => {
    const result = SearchQuerySchema.safeParse({ q: "" });
    expect(result.success).toBe(false);
  });

  it("accepts optional date filters", () => {
    const result = SearchQuerySchema.parse({
      q: "AI",
      start_date: "2024-01-01",
      end_date: "2024-12-31",
      platform: "zhihu",
    });
    expect(result.start_date).toBe("2024-01-01");
    expect(result.end_date).toBe("2024-12-31");
  });
});

describe("SearchResponseSchema", () => {
  it("parses a valid response with statistics", () => {
    const result = SearchResponseSchema.safeParse({
      success: true,
      results: [],
      total: 0,
      statistics: {
        keyword: "AI",
        avg_rank: 5.0,
        platform_distribution: { zhihu: 3, weibo: 2 },
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses response without statistics", () => {
    const result = SearchResponseSchema.safeParse({
      success: true,
      results: [],
      total: 0,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// common.ts schemas
// ---------------------------------------------------------------------------

describe("PaginationSchema", () => {
  it("defaults limit to 50", () => {
    const result = PaginationSchema.parse({});
    expect(result.limit).toBe(50);
  });

  it("parses limit from string", () => {
    const result = PaginationSchema.parse({ limit: "20" });
    expect(result.limit).toBe(20);
  });

  it("rejects limit below 1", () => {
    const result = PaginationSchema.safeParse({ limit: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects limit above 100", () => {
    const result = PaginationSchema.safeParse({ limit: "200" });
    expect(result.success).toBe(false);
  });
});

describe("SimpleErrorSchema", () => {
  it("parses a valid error", () => {
    const result = SimpleErrorSchema.safeParse({
      success: false,
      error: "Not found",
    });
    expect(result.success).toBe(true);
  });

  it("rejects success: true", () => {
    const result = SimpleErrorSchema.safeParse({
      success: true,
      error: "Not found",
    });
    expect(result.success).toBe(false);
  });
});

describe("ErrorResponseSchema", () => {
  it("parses a structured error", () => {
    const result = ErrorResponseSchema.safeParse({
      success: false,
      error: {
        code: "INVALID_PARAMETER",
        message: "Invalid platform ID",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional suggestion", () => {
    const result = ErrorResponseSchema.safeParse({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
        suggestion: "Try a different ID",
      },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rss.ts schemas
// ---------------------------------------------------------------------------

describe("RssQuerySchema", () => {
  it("applies default days of 1", () => {
    const result = RssQuerySchema.parse({});
    expect(result.days).toBe(1);
  });

  it("parses days from string", () => {
    const result = RssQuerySchema.parse({ days: "7" });
    expect(result.days).toBe(7);
  });

  it("rejects days above 30", () => {
    const result = RssQuerySchema.safeParse({ days: "31" });
    expect(result.success).toBe(false);
  });

  it("applies default limit of 50", () => {
    const result = RssQuerySchema.parse({});
    expect(result.limit).toBe(50);
  });

  it("parses include_summary as true when 'true'", () => {
    const result = RssQuerySchema.parse({ include_summary: "true" });
    expect(result.include_summary).toBe(true);
  });

  it("defaults include_summary to false", () => {
    const result = RssQuerySchema.parse({});
    expect(result.include_summary).toBe(false);
  });
});

describe("RssItemSchema", () => {
  it("parses a valid RSS item", () => {
    const result = RssItemSchema.safeParse({
      title: "Article title",
      feed_id: "feed-1",
      feed_name: "Tech Feed",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = RssItemSchema.safeParse({
      title: "Test",
      feed_id: "f1",
      feed_name: "Feed",
      url: "https://example.com",
      published_at: "2024-01-01",
      author: "Author",
      date: "2024-01-01",
      fetch_time: "2024-01-01T00:00:00Z",
      summary: "Summary text",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// health.ts schema
// ---------------------------------------------------------------------------

describe("HealthResponseSchema", () => {
  it("parses a healthy response", () => {
    const result = HealthResponseSchema.safeParse({
      status: "healthy",
      timestamp: "2024-01-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid status values", () => {
    for (const status of ["healthy", "degraded", "unhealthy"] as const) {
      const result = HealthResponseSchema.safeParse({
        status,
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    const result = HealthResponseSchema.safeParse({
      status: "broken",
      timestamp: "2024-01-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional version", () => {
    const result = HealthResponseSchema.safeParse({
      status: "healthy",
      timestamp: "2024-01-01T00:00:00Z",
      version: "0.4.4",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing timestamp", () => {
    const result = HealthResponseSchema.safeParse({ status: "healthy" });
    expect(result.success).toBe(false);
  });
});
