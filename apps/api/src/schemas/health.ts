import { z } from "@hono/zod-openapi";

export const HealthResponseSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "unhealthy"]).openapi({
      example: "healthy",
    }),
    timestamp: z.string().openapi({
      example: "2025-01-27T10:00:00Z",
    }),
    version: z.string().optional().openapi({
      example: "0.1.0",
    }),
  })
  .openapi("HealthResponse");
