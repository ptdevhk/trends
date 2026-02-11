import { z } from "@hono/zod-openapi";

export const HealthResponseSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "unhealthy"]).openapi({
      example: "healthy",
    }),
    timestamp: z.string().openapi({
      example: "2026-02-11T15:03:47+08:00",
    }),
    version: z.string().optional().openapi({
      example: "0.1.0",
    }),
  })
  .openapi("HealthResponse");
