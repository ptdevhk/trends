import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { config } from "../services/config.js";
import { WebVitalsLogger } from "../services/web-vitals-logger.js";

const app = new OpenAPIHono();
const webVitalsLogger = new WebVitalsLogger(config.projectRoot);

const MetricSchema = z.object({
  name: z.string(),
  value: z.number(),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  id: z.string(),
  navigationType: z.string(),
});

const reportRoute = createRoute({
  method: "post",
  path: "/report",
  tags: ["Web Vitals"],
  summary: "Report a Core Web Vitals metric from the client",
  request: {
    body: {
      content: {
        "application/json": {
          schema: MetricSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Metric logged",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
          }),
        },
      },
    },
  },
});

app.openapi(reportRoute, (c) => {
  const body = c.req.valid("json");
  const workspace =
    c.req.header("X-Workspace-Slug") ?? "default";
  webVitalsLogger.logMetric({
    ...body,
    workspace,
    timestamp: Date.now(),
  });
  return c.json({ success: true as const }, 200);
});

const summaryRoute = createRoute({
  method: "get",
  path: "/summary",
  tags: ["Web Vitals"],
  summary: "Get aggregated Web Vitals summary",
  request: {
    query: z.object({
      hours: z.coerce.number().int().min(1).max(168).optional(),
    }),
  },
  responses: {
    200: {
      description: "Web Vitals summary",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            summary: z.object({
              totalReports: z.number().int(),
              metrics: z.record(
                z.object({
                  p50: z.number(),
                  p75: z.number(),
                  p95: z.number(),
                  good: z.number().int(),
                  needsImprovement: z.number().int(),
                  poor: z.number().int(),
                })
              ),
            }),
          }),
        },
      },
    },
  },
});

app.openapi(summaryRoute, (c) => {
  const { hours } = c.req.valid("query");
  const summary = webVitalsLogger.getSummary(hours ?? 24);
  return c.json({ success: true as const, summary }, 200);
});

export default app;
