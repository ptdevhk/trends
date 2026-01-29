import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HealthResponseSchema } from "../schemas/index.js";
import { config } from "../services/config.js";

const app = new OpenAPIHono();

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["health"],
  summary: "Health check",
  description: "Returns the health status of the API",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
      description: "Service is healthy",
    },
  },
});

app.openapi(healthRoute, async (c) => {
  return c.json({
    status: "healthy" as const,
    timestamp: new Date().toISOString(),
    version: config.version,
  });
});

export default app;
