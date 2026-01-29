import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { SearchQuerySchema, SearchResponseSchema } from "../schemas/index.js";
import { config } from "../services/config.js";
import { DataService } from "../services/data-service.js";
import { DataNotFoundError } from "../services/errors.js";

const app = new OpenAPIHono();
const dataService = new DataService(config.projectRoot);

function parsePlatformParam(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function parseIsoDateParam(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid date format: ${value}`);
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
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
  const platforms = parsePlatformParam(platform);

  const dateRange = (start_date || end_date)
    ? {
        start: start_date ? parseIsoDateParam(start_date) : parseIsoDateParam(end_date!),
        end: end_date ? parseIsoDateParam(end_date) : parseIsoDateParam(start_date!),
      }
    : undefined;

  try {
    const result = dataService.searchNewsByKeyword({
      keyword: q,
      platforms,
      limit,
      dateRange,
    });

    return c.json({
      success: true as const,
      results: result.results,
      total: result.total,
      total_found: result.total_found,
      statistics: result.statistics,
    }, 200);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({
        success: true as const,
        results: [],
        total: 0,
        total_found: 0,
        statistics: {
          keyword: q,
          avg_rank: 0,
          platform_distribution: {},
        },
      }, 200);
    }
    throw error;
  }
});

export default app;
