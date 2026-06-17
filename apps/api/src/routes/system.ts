import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { callConvexQuery } from "../services/convex-utils.js";

const app = new OpenAPIHono();

const MaintenanceResponseSchema = z.object({
  success: z.literal(true),
  maintenanceMode: z.boolean(),
  reason: z.string().optional(),
});

const getMaintenanceRoute = createRoute({
  method: "get",
  path: "/api/system/maintenance",
  tags: ["system"],
  summary: "Check maintenance mode status",
  description:
    "Returns whether the system is currently in maintenance mode. When true, BFF write requests are rejected with 503.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: MaintenanceResponseSchema,
        },
      },
      description: "Current maintenance mode state",
    },
  },
});

app.openapi(getMaintenanceRoute, async (c) => {
  let maintenanceMode = false;

  try {
    const value = await callConvexQuery("system_settings:isMaintenanceMode", {});
    maintenanceMode = value === true;
  } catch (err) {
    console.error("[system/maintenance] Failed to query Convex", err);
  }

  return c.json({ success: true as const, maintenanceMode }, 200);
});

export default app;
