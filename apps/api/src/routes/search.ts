import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { SearchQuerySchema, SearchResponseSchema } from "../schemas";
import { mockData } from "../services/mock-data";
import { workerClient, type WorkerSearchResultItem } from "../services/worker-client";
import { config } from "../services/config";

const app = new OpenAPIHono();

// Transform worker search result to BFF response format (snake_case mobile_url → camelCase mobileUrl)
function transformSearchResult(item: WorkerSearchResultItem) {
  return {
    title: item.title,
    platform: item.platform,
    platform_name: item.platform_name,
    ranks: item.ranks,
    count: item.count,
    avg_rank: item.avg_rank,
    url: item.url,
    mobileUrl: item.mobile_url,
    date: item.date,
  };
}

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

app.openapi(searchRoute, async (c) => {
  const { q, platform, limit, start_date, end_date } = c.req.valid("query");

  // Helper to build mock response
  const buildMockResponse = () => {
    const results = mockData.search(q, limit);
    const filteredResults = platform
      ? results.filter((r) => r.platform === platform)
      : results;

    return {
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
    };
  };

  // Use mock data in development mode or when explicitly configured
  if (config.useMock) {
    return c.json(buildMockResponse(), 200);
  }

  // Call the worker API
  const result = await workerClient.searchNews({
    q,
    platform,
    limit,
    start_date,
    end_date,
  });

  // Fallback to mock data on error
  if (!result.success || !result.data) {
    console.error("Worker error, falling back to mock:", result.error);
    return c.json(buildMockResponse(), 200);
  }

  // Transform and return real data
  const transformedResults = result.data.results.map(transformSearchResult);

  return c.json({
    success: true as const,
    results: transformedResults,
    total: result.data.total,
    total_found: result.data.total_found,
    statistics: {
      keyword: result.data.statistics.keyword ?? q,
      avg_rank: result.data.statistics.avg_rank,
      platform_distribution: result.data.statistics.platform_distribution,
    },
  }, 200);
});

export default app;
