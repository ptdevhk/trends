import { describe, it, expect } from "vitest";
import {
  PaginationSchema,
  PlatformFilterSchema,
  DateFilterSchema,
  ErrorResponseSchema,
} from "../common.js";
import { HealthResponseSchema } from "../health.js";
import {
  TrendItemSchema,
  TrendsQuerySchema,
  TrendsResponseSchema,
  TopicSchema,
  TopicsQuerySchema,
  TopicsResponseSchema,
} from "../trends.js";

// --- common.ts ---

describe("PaginationSchema", () => {
  it("defaults limit to 50", () => {
    expect(PaginationSchema.parse({}).limit).toBe(50);
  });

  it("parses string limit", () => {
    expect(PaginationSchema.parse({ limit: "25" }).limit).toBe(25);
  });

  it("clamps limit to max 100", () => {
    expect(() => PaginationSchema.parse({ limit: "101" })).toThrow();
  });

  it("clamps limit to min 1", () => {
    expect(() => PaginationSchema.parse({ limit: "0" })).toThrow();
  });
});

describe("PlatformFilterSchema", () => {
  it("accepts platform string", () => {
    expect(PlatformFilterSchema.parse({ platform: "zhihu" }).platform).toBe("zhihu");
  });

  it("allows undefined platform", () => {
    expect(PlatformFilterSchema.parse({}).platform).toBeUndefined();
  });
});

describe("DateFilterSchema", () => {
  it("accepts date string", () => {
    expect(DateFilterSchema.parse({ date: "2026-05-22" }).date).toBe("2026-05-22");
  });

  it("allows undefined date", () => {
    expect(DateFilterSchema.parse({}).date).toBeUndefined();
  });
});

describe("ErrorResponseSchema", () => {
  it("validates error response", () => {
    const result = ErrorResponseSchema.parse({
      success: false,
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("validates error response with suggestion", () => {
    const result = ErrorResponseSchema.parse({
      success: false,
      error: { code: "INVALID", message: "Bad input", suggestion: "Check docs" },
    });
    expect(result.error.suggestion).toBe("Check docs");
  });

  it("rejects success: true", () => {
    expect(() =>
      ErrorResponseSchema.parse({
        success: true,
        error: { code: "OK", message: "Fine" },
      }),
    ).toThrow();
  });

  it("rejects missing error fields", () => {
    expect(() =>
      ErrorResponseSchema.parse({
        success: false,
        error: { code: "ERR" },
      }),
    ).toThrow();
  });
});

// --- health.ts ---

describe("HealthResponseSchema", () => {
  it("validates healthy response", () => {
    const result = HealthResponseSchema.parse({
      status: "healthy",
      timestamp: "2026-05-22T10:00:00+08:00",
    });
    expect(result.status).toBe("healthy");
  });

  it("validates degraded response", () => {
    const result = HealthResponseSchema.parse({
      status: "degraded",
      timestamp: "2026-05-22T10:00:00+08:00",
    });
    expect(result.status).toBe("degraded");
  });

  it("validates with optional version", () => {
    const result = HealthResponseSchema.parse({
      status: "healthy",
      timestamp: "2026-05-22T10:00:00+08:00",
      version: "1.0.0",
    });
    expect(result.version).toBe("1.0.0");
  });

  it("rejects invalid status", () => {
    expect(() =>
      HealthResponseSchema.parse({
        status: "broken",
        timestamp: "2026-05-22T10:00:00+08:00",
      }),
    ).toThrow();
  });
});

// --- trends.ts ---

describe("TrendItemSchema", () => {
  it("validates a trend item", () => {
    const result = TrendItemSchema.parse({
      title: "OpenAI announces GPT-5",
      platform: "zhihu",
      platform_name: "Zhihu Hot List",
      rank: 1,
    });
    expect(result.title).toBe("OpenAI announces GPT-5");
    expect(result.rank).toBe(1);
  });

  it("accepts optional fields", () => {
    const result = TrendItemSchema.parse({
      title: "Test",
      platform: "weibo",
      platform_name: "Weibo",
      rank: 5,
      avg_rank: 3.2,
      count: 10,
      url: "https://example.com",
    });
    expect(result.avg_rank).toBe(3.2);
    expect(result.url).toBe("https://example.com");
  });
});

describe("TrendsQuerySchema", () => {
  it("defaults limit to 50", () => {
    expect(TrendsQuerySchema.parse({}).limit).toBe(50);
  });

  it("parses string limit", () => {
    expect(TrendsQuerySchema.parse({ limit: "25" }).limit).toBe(25);
  });

  it("parses include_url as boolean", () => {
    expect(TrendsQuerySchema.parse({ include_url: "true" }).include_url).toBe(true);
    expect(TrendsQuerySchema.parse({ include_url: "false" }).include_url).toBe(false);
    expect(TrendsQuerySchema.parse({}).include_url).toBe(false);
  });

  it("rejects limit > 100", () => {
    expect(() => TrendsQuerySchema.parse({ limit: "101" })).toThrow();
  });
});

describe("TrendsResponseSchema", () => {
  it("validates response with data", () => {
    const result = TrendsResponseSchema.parse({
      success: true,
      data: [{ title: "Test", platform: "zhihu", platform_name: "Zhihu", rank: 1 }],
    });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("rejects success: false", () => {
    expect(() =>
      TrendsResponseSchema.parse({ success: false, data: [] }),
    ).toThrow();
  });
});

describe("TopicSchema", () => {
  it("validates a topic with required fields", () => {
    const result = TopicSchema.parse({ keyword: "AI", frequency: 15 });
    expect(result.keyword).toBe("AI");
    expect(result.frequency).toBe(15);
  });

  it("accepts optional trend enum", () => {
    expect(TopicSchema.parse({ keyword: "AI", frequency: 15, trend: "rising" }).trend).toBe("rising");
    expect(TopicSchema.parse({ keyword: "AI", frequency: 15, trend: "falling" }).trend).toBe("falling");
  });

  it("rejects invalid trend", () => {
    expect(() => TopicSchema.parse({ keyword: "AI", frequency: 15, trend: "exploding" })).toThrow();
  });
});

describe("TopicsQuerySchema", () => {
  it("defaults top_n to 10", () => {
    expect(TopicsQuerySchema.parse({}).top_n).toBe(10);
  });

  it("defaults mode to current", () => {
    expect(TopicsQuerySchema.parse({}).mode).toBe("current");
  });

  it("defaults extract_mode to keywords", () => {
    expect(TopicsQuerySchema.parse({}).extract_mode).toBe("keywords");
  });

  it("parses custom top_n", () => {
    expect(TopicsQuerySchema.parse({ top_n: "20" }).top_n).toBe(20);
  });

  it("rejects top_n > 50", () => {
    expect(() => TopicsQuerySchema.parse({ top_n: "51" })).toThrow();
  });
});

describe("TopicsResponseSchema", () => {
  it("validates response with topics", () => {
    const result = TopicsResponseSchema.parse({
      success: true,
      topics: [{ keyword: "AI", frequency: 15 }],
    });
    expect(result.success).toBe(true);
    expect(result.topics).toHaveLength(1);
  });
});
