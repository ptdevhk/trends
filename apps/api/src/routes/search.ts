import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { SearchQuerySchema, SearchResponseSchema } from "../schemas";
import { mockData } from "../services/mock-data";

const app = new OpenAPIHono();

// GET /api/search - Search news
const searchRoute = createRoute({
  method: "get",
  path: "/api/search",
  tags: ["search"],
  summary: "Search news",
  description: "Search news items by keyword across platforms and dates",
  request: {
    query: SearchQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SearchResponseSchema,
        },
      },
      description: "Search results",
    },
  },
});

app.openapi(searchRoute, (c) => {
  const { q, platform, limit } = c.req.valid("query");

  const results = mockData.search(q, limit);

  // Filter by platform if specified
  const filteredResults = platform
    ? results.filter((r) => r.platform === platform)
    : results;

  return c.json({
    success: true as const,
    results: filteredResults,
    total: filteredResults.length,
    total_found: filteredResults.length,
    statistics: {
      keyword: q,
      avg_rank: filteredResults.length > 0
        ? filteredResults.reduce((sum, r) => sum + (r.avg_rank || 0), 0) / filteredResults.length
        : 0,
      platform_distribution: filteredResults.reduce((acc, r) => {
        acc[r.platform] = (acc[r.platform] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    },
  }, 200);
});

export default app;
