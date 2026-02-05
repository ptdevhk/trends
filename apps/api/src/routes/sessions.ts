import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { ResumeFiltersSchema } from "../schemas/index.js";
import { config } from "../services/config.js";
import { SessionManager } from "../services/session-manager.js";

const app = new OpenAPIHono();
const sessionManager = new SessionManager(config.projectRoot);

const SessionStatusSchema = z.enum(["active", "completed", "archived"]);

const SearchSessionSchema = z.object({
  id: z.string().openapi({ example: "session-123" }),
  userId: z.string().optional().openapi({ example: "user-1" }),
  jobDescriptionId: z.string().optional().openapi({ example: "lathe-sales" }),
  sampleName: z.string().optional().openapi({ example: "sample-initial" }),
  filters: ResumeFiltersSchema.optional(),
  status: SessionStatusSchema.openapi({ example: "active" }),
  createdAt: z.string().openapi({ example: "2026-02-05T08:00:00.000Z" }),
  updatedAt: z.string().openapi({ example: "2026-02-05T08:00:00.000Z" }),
  expiresAt: z.string().optional().openapi({ example: "2026-02-10T08:00:00.000Z" }),
});

const SessionResponseSchema = z.object({
  success: z.literal(true),
  session: SearchSessionSchema,
});

const SessionCreateSchema = z.object({
  userId: z.string().optional(),
  jobDescriptionId: z.string().optional(),
  sampleName: z.string().optional(),
  filters: ResumeFiltersSchema.optional(),
});

const SessionUpdateSchema = z.object({
  userId: z.string().optional(),
  jobDescriptionId: z.string().optional(),
  sampleName: z.string().optional(),
  filters: ResumeFiltersSchema.optional(),
  status: SessionStatusSchema.optional(),
  expiresAt: z.string().optional(),
});

const SessionIdParamSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "session-123" }),
});

const createSessionRoute = createRoute({
  method: "post",
  path: "/api/sessions",
  tags: ["sessions"],
  summary: "Create a new search session",
  request: {
    body: {
      content: {
        "application/json": { schema: SessionCreateSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SessionResponseSchema } },
      description: "Session created",
    },
  },
});

app.openapi(createSessionRoute, (c) => {
  const body = c.req.valid("json");
  const session = sessionManager.createSession({
    userId: body.userId,
    jobDescriptionId: body.jobDescriptionId,
    sampleName: body.sampleName,
    filters: body.filters,
  });
  return c.json({ success: true as const, session }, 200);
});

const getSessionRoute = createRoute({
  method: "get",
  path: "/api/sessions/{id}",
  tags: ["sessions"],
  summary: "Get a search session",
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: SessionResponseSchema } },
      description: "Session details",
    },
    404: {
      description: "Session not found",
    },
  },
});

app.openapi(getSessionRoute, (c) => {
  const { id } = c.req.valid("param");
  const session = sessionManager.getSession(id);
  if (!session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }
  return c.json({ success: true as const, session }, 200);
});

const updateSessionRoute = createRoute({
  method: "patch",
  path: "/api/sessions/{id}",
  tags: ["sessions"],
  summary: "Update a search session",
  request: {
    params: SessionIdParamSchema,
    body: {
      content: {
        "application/json": { schema: SessionUpdateSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SessionResponseSchema } },
      description: "Session updated",
    },
    404: {
      description: "Session not found",
    },
  },
});

app.openapi(updateSessionRoute, (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const session = sessionManager.updateSession(id, {
    userId: body.userId,
    jobDescriptionId: body.jobDescriptionId,
    sampleName: body.sampleName,
    filters: body.filters,
    status: body.status,
    expiresAt: body.expiresAt,
  });

  if (!session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  return c.json({ success: true as const, session }, 200);
});

export default app;
