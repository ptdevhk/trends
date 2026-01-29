import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { RssQuerySchema, RssResponseSchema } from "../schemas/index.js";
import { config } from "../services/config.js";
import { DataService } from "../services/data-service.js";
import { DataNotFoundError } from "../services/errors.js";

const app = new OpenAPIHono();
const dataService = new DataService(config.projectRoot);

function parseFeedParam(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

// GET /api/rss - Get RSS feed items
const getRssRoute = createRoute({
  method: "get",
  path: "/api/rss",
  tags: ["rss"],
  summary: "Get RSS feed items",
  description: "Returns the latest RSS feed items",
  request: {
    query: RssQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: RssResponseSchema,
        },
      },
      description: "RSS items",
    },
  },
});

app.openapi(getRssRoute, (c) => {
  const { feed, days, limit, include_summary } = c.req.valid("query");
  const feeds = parseFeedParam(feed);

  try {
    const items = dataService.getLatestRss({
      feeds,
      days,
      limit,
      includeSummary: include_summary,
    });

    return c.json({
      success: true as const,
      summary: {
        description: days > 1
          ? `RSS items from the last ${days} days`
          : "Latest RSS items",
        total: items.length,
        returned: items.length,
        days,
        feeds: feeds ?? "all feeds",
      },
      data: items,
    });
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({
        success: true as const,
        summary: {
          description: `${error.message}${error.suggestion ? ` (${error.suggestion})` : ""}`,
          total: 0,
          returned: 0,
          days,
          feeds: feeds ?? "all feeds",
        },
        data: [],
      });
    }
    throw error;
  }
});

export default app;
