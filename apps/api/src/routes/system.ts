import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  DEFAULT_RESUME_WORK_HISTORY_LIMIT,
  MAX_RESUME_WORK_HISTORY_LIMIT,
  MIN_RESUME_WORK_HISTORY_LIMIT,
  normalizeResumeWorkHistoryLimit,
} from "@trends/shared";
import { callConvexMutation, callConvexQuery } from "../services/convex-utils.js";
import { getAuthenticatedActorId, requireAdmin } from "../middleware/auth.js";

const app = new OpenAPIHono();

app.use("/api/system/resume-work-history-limit", async (c, next) => {
  if (c.req.method === "PUT") {
    return requireAdmin(c, next);
  }
  await next();
});

const MaintenanceResponseSchema = z.object({
  success: z.literal(true),
  maintenanceMode: z.boolean(),
  reason: z.string().optional(),
});

const ResumeWorkHistoryLimitResponseSchema = z.object({
  success: z.literal(true),
  limit: z.number().int(),
  defaultLimit: z.number().int(),
  min: z.number().int(),
  max: z.number().int(),
});

const ResumeWorkHistoryLimitRequestSchema = z.object({
  limit: z.number().int().min(MIN_RESUME_WORK_HISTORY_LIMIT).max(MAX_RESUME_WORK_HISTORY_LIMIT),
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

const getResumeWorkHistoryLimitRoute = createRoute({
  method: "get",
  path: "/api/system/resume-work-history-limit",
  tags: ["system"],
  summary: "Get global resume work-history limit",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeWorkHistoryLimitResponseSchema,
        },
      },
      description: "Effective global resume work-history limit",
    },
  },
});

app.openapi(getResumeWorkHistoryLimitRoute, async (c) => {
  let limit = DEFAULT_RESUME_WORK_HISTORY_LIMIT;

  try {
    limit = normalizeResumeWorkHistoryLimit(
      await callConvexQuery("system_settings:getResumeWorkHistoryLimit", {}),
    );
  } catch (err) {
    console.error("[system/resume-work-history-limit] Failed to query Convex", err);
  }

  return c.json({
    success: true as const,
    limit,
    defaultLimit: DEFAULT_RESUME_WORK_HISTORY_LIMIT,
    min: MIN_RESUME_WORK_HISTORY_LIMIT,
    max: MAX_RESUME_WORK_HISTORY_LIMIT,
  }, 200);
});

const putResumeWorkHistoryLimitRoute = createRoute({
  method: "put",
  path: "/api/system/resume-work-history-limit",
  tags: ["system"],
  summary: "Update global resume work-history limit",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ResumeWorkHistoryLimitRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeWorkHistoryLimitResponseSchema,
        },
      },
      description: "Updated global resume work-history limit",
    },
  },
});

app.openapi(putResumeWorkHistoryLimitRoute, async (c) => {
  const { limit } = c.req.valid("json");
  const savedLimit = normalizeResumeWorkHistoryLimit(await callConvexMutation(
    "system_settings:setResumeWorkHistoryLimit",
    {
      limit,
      updatedBy: getAuthenticatedActorId(c),
      reason: "Updated from system runtime settings",
    },
  ));

  return c.json({
    success: true as const,
    limit: savedLimit,
    defaultLimit: DEFAULT_RESUME_WORK_HISTORY_LIMIT,
    min: MIN_RESUME_WORK_HISTORY_LIMIT,
    max: MAX_RESUME_WORK_HISTORY_LIMIT,
  }, 200);
});

export default app;
