import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  TrendsQuerySchema,
  TrendsResponseSchema,
  TrendIdParamSchema,
  TrendDetailResponseSchema,
} from "../schemas/index.js";
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
  const platforms = parsePlatformParam(platform);

  try {
    const trends = date
      ? dataService.getNewsByDate(parseIsoDateParam(date), { platforms, limit, includeUrl: include_url })
      : dataService.getLatestNews({ platforms, limit, includeUrl: include_url });

    return c.json({
      success: true as const,
      summary: {
        description: date
          ? `Trending news for ${date}`
          : "Latest trending news (from existing SQLite output)",
        total: trends.length,
        returned: trends.length,
        platforms: platforms ?? "all platforms",
      },
      data: trends,
    }, 200);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({
        success: true as const,
        summary: {
          description: `${error.message}${error.suggestion ? ` (${error.suggestion})` : ""}`,
          total: 0,
          returned: 0,
          platforms: platforms ?? "all platforms",
        },
        data: [],
      }, 200);
    }
    throw error;
  }
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
  const title = decodeURIComponent(id);
  const trend = dataService.getTrendByTitle(title, { includeUrl: true });

  return c.json({
    success: true as const,
    data: trend,
  }, 200);
});

export default app;
