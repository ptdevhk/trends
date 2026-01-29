import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  TrendsQuerySchema,
  TrendsResponseSchema,
  TrendIdParamSchema,
  TrendDetailResponseSchema,
  TopicsQuerySchema,
  TopicsResponseSchema,
} from "../schemas";
import { mockData } from "../services/mock-data";
import { workerClient, type WorkerTrendItem, type WorkerTrendsResponse, type WorkerTrendDetailResponse } from "../services/worker-client";
import { config } from "../services/config";

const app = new OpenAPIHono();

// Transform worker response to BFF response format (snake_case mobile_url → camelCase mobileUrl)
function transformTrendItem(item: WorkerTrendItem, includeUrl?: boolean) {
  return {
    title: item.title,
    platform: item.platform,
    platform_name: item.platform_name,
    rank: item.rank,
    timestamp: item.timestamp ?? undefined,
    date: item.date ?? undefined,
    url: includeUrl ? (item.url ?? undefined) : undefined,
    mobileUrl: includeUrl ? (item.mobile_url ?? undefined) : undefined,
  };
}

// GET /api/trends - Get trending news
const getTrendsRoute = createRoute({
  method: "get",
  path: "/api/trends",
  tags: ["trends"],
  summary: "Get trending news",
  description: "Returns the latest trending news items from various platforms",
  request: {
    query: TrendsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: TrendsResponseSchema,
        },
      },
      description: "Successful response",
    },
  },
});

app.openapi(getTrendsRoute, async (c) => {
  const { platform, date, limit, include_url } = c.req.valid("query");

  // Use mock data in development mode or when explicitly configured
  if (config.useMock) {
    const trends = mockData.getTrends(limit, {
      platform,
      date,
      includeUrl: include_url,
    });

    return c.json({
      success: true as const,
      summary: {
        description: date
          ? `Trending news for ${date}`
          : "Latest trending news",
        total: trends.length,
        returned: trends.length,
        platforms: platform || "all platforms",
      },
      data: trends,
    }, 200);
  }

  // Call the worker API
  const result = await workerClient.getTrends({
    platform,
    date,
    limit,
    include_url,
  });

  // Fallback to mock data on error
  if (!result.success || !result.data) {
    console.error("Worker error, falling back to mock:", result.error);
    const trends = mockData.getTrends(limit, {
      platform,
      date,
      includeUrl: include_url,
    });

    return c.json({
      success: true as const,
      summary: {
        description: date
          ? `Trending news for ${date}`
          : "Latest trending news",
        total: trends.length,
        returned: trends.length,
        platforms: platform || "all platforms",
      },
      data: trends,
    }, 200);
  }

  // Transform and return real data
  const transformedData = result.data.data.map(item => transformTrendItem(item, include_url));

  return c.json({
    success: true as const,
    summary: {
      description: date
        ? `Trending news for ${date}`
        : "Latest trending news",
      total: result.data.total,
      returned: transformedData.length,
      platforms: platform || "all platforms",
    },
    data: transformedData,
  }, 200);
});

// GET /api/trends/:id - Get trend details
const getTrendByIdRoute = createRoute({
  method: "get",
  path: "/api/trends/{id}",
  tags: ["trends"],
  summary: "Get trend details",
  description: "Returns detailed information about a specific trend item",
  request: {
    params: TrendIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: TrendDetailResponseSchema,
        },
      },
      description: "Successful response",
    },
  },
});

app.openapi(getTrendByIdRoute, async (c) => {
  const { id } = c.req.valid("param");

  // Use mock data in development mode or when explicitly configured
  if (config.useMock) {
    const trends = mockData.getTrends(1, { includeUrl: true });
    return c.json({
      success: true as const,
      data: trends[0],
    }, 200);
  }

  // Call the worker API
  const result = await workerClient.getTrendById(id);

  // Fallback to mock data on error
  if (!result.success || !result.data) {
    console.error("Worker error, falling back to mock:", result.error);
    const trends = mockData.getTrends(1, { includeUrl: true });
    return c.json({
      success: true as const,
      data: trends[0],
    }, 200);
  }

  // Transform and return real data
  return c.json({
    success: true as const,
    data: transformTrendItem(result.data.data, true),
  }, 200);
});

// GET /api/topics - Get trending topics
const getTopicsRoute = createRoute({
  method: "get",
  path: "/api/topics",
  tags: ["trends"],
  summary: "Get trending topics",
  description: "Returns aggregated trending topics based on keyword frequency",
  request: {
    query: TopicsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: TopicsResponseSchema,
        },
      },
      description: "Successful response",
    },
  },
});

app.openapi(getTopicsRoute, (c) => {
  const { top_n, mode, extract_mode } = c.req.valid("query");

  const topics = mockData.getTopics(top_n);

  return c.json({
    success: true as const,
    topics,
    generated_at: new Date().toISOString(),
    mode,
    extract_mode,
    total_keywords: topics.length,
    description: `${mode === "daily" ? "Daily" : "Current"} statistics - ${
      extract_mode === "keywords" ? "Based on preset keywords" : "Auto-extracted"
    }`,
  }, 200);
});

export default app;
