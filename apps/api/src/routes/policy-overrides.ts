import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { callConvexMutation, isConvexResumeIdValidationError } from "../services/convex-utils.js";
import { getConvexWriteSecret } from "../services/config.js";
import { getAuthenticatedActorId, requireWorkspaceUser } from "../middleware/auth.js";
import { listCandidatePolicyOverrides } from "../services/candidate-policy-override-service.js";

const app = new OpenAPIHono();

app.use("/api/policy-overrides", async (c, next) => {
  if (["GET", "POST", "DELETE"].includes(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});

const CandidatePolicyOverrideSchema = z.object({
  _id: z.string(),
  workspaceSlug: z.string(),
  resumeId: z.string(),
  resumeIdentity: z.string(),
  companyKey: z.string(),
  effect: z.string(),
  reason: z.string().optional(),
  authorizedBy: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const ListOverridesResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(CandidatePolicyOverrideSchema),
});

const SetOverrideRequestSchema = z.object({
  resumeId: z.string(),
  resumeIdentity: z.string(),
  companyKey: z.string(),
  reason: z.string(),
});

const SetOverrideResponseSchema = z.object({
  success: z.literal(true),
  id: z.string(),
});

const SimpleErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const DeleteOverrideQuerySchema = z.object({
  resumeIdentity: z.string().openapi({
    param: {
      name: "resumeIdentity",
      in: "query",
    },
  }),
  companyKey: z.string().openapi({
    param: {
      name: "companyKey",
      in: "query",
    },
  }),
});

const DeleteOverrideResponseSchema = z.object({
  success: z.literal(true),
  removed: z.boolean(),
});

const listRoute = createRoute({
  method: "get",
  path: "/api/policy-overrides",
  tags: ["actions"],
  summary: "List candidate policy overrides",
  responses: {
    200: {
      content: { "application/json": { schema: ListOverridesResponseSchema } },
      description: "Candidate policy override list",
    },
  },
});

app.openapi(listRoute, async (c) => {
  const items = await listCandidatePolicyOverrides(c.var.workspaceSlug);
  return c.json({ success: true as const, items }, 200);
});

const setRoute = createRoute({
  method: "post",
  path: "/api/policy-overrides",
  tags: ["actions"],
  summary: "Set a candidate policy override (allow) for a resume/company pair",
  request: {
    body: {
      content: {
        "application/json": { schema: SetOverrideRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SetOverrideResponseSchema } },
      description: "Override set",
    },
    400: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Missing required fields",
    },
  },
});

app.openapi(setRoute, async (c) => {
  const body = c.req.valid("json");
  const resumeId = body.resumeId.trim();
  if (!resumeId) {
    return c.json(
      { success: false as const, error: "resumeId is required" },
      400
    );
  }

  const resumeIdentity = body.resumeIdentity.trim();
  const companyKey = body.companyKey.trim();
  const reason = body.reason.trim();
  if (!resumeIdentity || !companyKey || !reason) {
    return c.json(
      { success: false as const, error: "resumeIdentity, companyKey, and reason are required" },
      400
    );
  }

  let id: unknown;
  try {
    id = await callConvexMutation("candidate_policy_overrides:set", {
      workspaceSlug: c.var.workspaceSlug,
      resumeId,
      resumeIdentity,
      companyKey,
      reason,
      authorizedBy: getAuthenticatedActorId(c),
      writeSecret: getConvexWriteSecret(),
    });
  } catch (error) {
    if (isConvexResumeIdValidationError(error)) {
      return c.json({ success: false as const, error: "Invalid resumeId" }, 400);
    }
    throw error;
  }

  return c.json({ success: true as const, id: typeof id === "string" ? id : String(id) }, 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/policy-overrides",
  tags: ["actions"],
  summary: "Remove a candidate policy override",
  request: {
    query: DeleteOverrideQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: DeleteOverrideResponseSchema } },
      description: "Override removed",
    },
  },
});

app.openapi(deleteRoute, async (c) => {
  const query = c.req.valid("query");
  const removed = await callConvexMutation("candidate_policy_overrides:remove", {
    workspaceSlug: c.var.workspaceSlug,
    resumeIdentity: query.resumeIdentity,
    companyKey: query.companyKey,
    writeSecret: getConvexWriteSecret(),
  });

  return c.json({ success: true as const, removed: removed === true }, 200);
});

export default app;
