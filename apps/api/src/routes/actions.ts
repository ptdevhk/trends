import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { config } from "../services/config.js";
import { ActionStorage } from "../services/action-storage.js";

const app = new OpenAPIHono();
const actionStorage = new ActionStorage(config.projectRoot);

const ActionTypeSchema = z.enum(["star", "shortlist", "reject", "archive", "note", "contact"]);

const CandidateActionSchema = z.object({
  id: z.number().int(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  resumeId: z.string(),
  actionType: ActionTypeSchema,
  actionData: z.record(z.any()).optional(),
  createdAt: z.string(),
});

const ActionResponseSchema = z.object({
  success: z.literal(true),
  action: CandidateActionSchema,
});

const ActionsResponseSchema = z.object({
  success: z.literal(true),
  actions: z.array(CandidateActionSchema),
});

const CreateActionSchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  resumeId: z.string(),
  actionType: ActionTypeSchema,
  actionData: z.record(z.any()).optional(),
});

const ActionsQuerySchema = z.object({
  sessionId: z.string().openapi({ param: { name: "sessionId", in: "query" }, example: "session-123" }),
  latestOnly: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? true : v === "true"))
    .openapi({ param: { name: "latestOnly", in: "query" }, example: "true" }),
});

const createActionRoute = createRoute({
  method: "post",
  path: "/api/actions",
  tags: ["actions"],
  summary: "Create a candidate action",
  request: {
    body: {
      content: {
        "application/json": { schema: CreateActionSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ActionResponseSchema } },
      description: "Action created",
    },
  },
});

app.openapi(createActionRoute, (c) => {
  const body = c.req.valid("json");
  const action = actionStorage.saveAction({
    userId: body.userId,
    sessionId: body.sessionId,
    resumeId: body.resumeId,
    actionType: body.actionType,
    actionData: body.actionData,
  });
  return c.json({ success: true as const, action }, 200);
});

const listActionsRoute = createRoute({
  method: "get",
  path: "/api/actions",
  tags: ["actions"],
  summary: "List actions for a session",
  request: {
    query: ActionsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: ActionsResponseSchema } },
      description: "Action list",
    },
  },
});

app.openapi(listActionsRoute, (c) => {
  const { sessionId, latestOnly } = c.req.valid("query");
  const actions = latestOnly
    ? actionStorage.getLatestActionsForSession(sessionId)
    : actionStorage.getActionsForSession(sessionId);
  return c.json({ success: true as const, actions }, 200);
});

export default app;
