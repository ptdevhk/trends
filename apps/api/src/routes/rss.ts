import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { RssQuerySchema, RssResponseSchema } from "../schemas";
import { mockData } from "../services/mock-data";

const app = new OpenAPIHono();

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

  const items = mockData.getRss(limit, {
    feed,
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
      feeds: feed || "all feeds",
    },
    data: items,
  });
});

export default app;
