import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HealthResponseSchema } from "../schemas";
import { config } from "../services/config";
import { workerClient } from "../services/worker-client";

const app = new OpenAPIHono();

// Extended health response schema with worker status
const ExtendedHealthResponseSchema = HealthResponseSchema.extend({
  worker: z.object({
    status: z.enum(["connected", "disconnected"]),
    url: z.string(),
  }).optional(),
  mode: z.enum(["mock", "worker"]).optional(),
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["health"],
  summary: "Health check",
  description: "Returns the health status of the API including worker connectivity",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ExtendedHealthResponseSchema,
        },
      },
      description: "Service is healthy",
    },
  },
});

app.openapi(healthRoute, async (c) => {
  // Check worker connectivity (only in production mode)
  let workerStatus: "connected" | "disconnected" = "disconnected";

  if (!config.useMock) {
    workerStatus = await workerClient.isHealthy() ? "connected" : "disconnected";
  }

  return c.json({
    status: "healthy" as const,
    timestamp: new Date().toISOString(),
    version: config.version,
    worker: {
      status: workerStatus,
      url: config.workerUrl,
    },
    mode: config.useMock ? "mock" as const : "worker" as const,
  });
});

export default app;
