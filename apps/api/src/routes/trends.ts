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

const app = new OpenAPIHono();

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

app.openapi(getTrendsRoute, (c) => {
  const { platform, date, limit, include_url } = c.req.valid("query");

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

app.openapi(getTrendByIdRoute, (c) => {
  // For now, return mock data
  // In production, this would look up by ID in the database
  const trends = mockData.getTrends(1, { includeUrl: true });

  return c.json({
    success: true as const,
    data: trends[0],
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
