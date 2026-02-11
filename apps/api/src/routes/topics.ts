import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { TopicsQuerySchema, TopicsResponseSchema } from "../schemas/index.js";
import { config } from "../services/config.js";
import { DataService } from "../services/data-service.js";
import { DataNotFoundError } from "../services/errors.js";
import { formatIsoOffsetInTimezone } from "../services/timezone.js";

const app = new OpenAPIHono();
const dataService = new DataService(config.projectRoot);

const getTopicsRoute = createRoute({
  method: "get",
  path: "/api/topics",
  tags: ["topics"],
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

app.openapi(getTopicsRoute, async (c) => {
  const { top_n, mode, extract_mode } = c.req.valid("query");

  try {
    const result = dataService.getTrendingTopics({
      top_n,
      mode,
      extract_mode,
    });

    return c.json({
      success: true as const,
      ...result,
    }, 200);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({
        success: true as const,
        topics: [],
        generated_at: formatIsoOffsetInTimezone(new Date(), config.timezone),
        mode,
        extract_mode,
        total_keywords: 0,
        description: `${error.message}${error.suggestion ? ` (${error.suggestion})` : ""}`,
      }, 200);
    }
    throw error;
  }
});

export default app;
