import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { config } from "../services/config.js";
import { ClientDiagnosticsLogger } from "../services/client-diagnostics-logger.js";
import { logger } from "../services/logger.js";

const app = new OpenAPIHono();
const diagnosticsLogger = new ClientDiagnosticsLogger(config.projectRoot);

const ReportSchema = z.object({
  kind: z.enum([
    "convex_ws_degraded",
    "convex_ws_retry",
    "bff_search_failed",
    "convex_query_timeout",
  ]),
  pathname: z.string().min(1).max(200),
  hasEverConnected: z.boolean(),
  connectionRetries: z.number().int().min(0).max(10_000),
  visibility: z.string().max(32).optional(),
});

const reportRoute = createRoute({
  method: "post",
  path: "/report",
  tags: ["Client Diagnostics"],
  summary: "Record a browser-side Convex connection diagnostic",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ReportSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Diagnostic logged",
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
  const workspace = c.req.header("X-Workspace-Slug") ?? "default";
  const event = {
    ...body,
    workspace,
    timestamp: Date.now(),
  };
  diagnosticsLogger.logEvent(event);
  logger.warn("client_diagnostic", {
    route: "/api/client-diagnostics/report",
    kind: event.kind,
    pathname: event.pathname,
    workspace: event.workspace,
    hasEverConnected: event.hasEverConnected,
    connectionRetries: event.connectionRetries,
  });
  return c.json({ success: true as const }, 200);
});

export default app;
