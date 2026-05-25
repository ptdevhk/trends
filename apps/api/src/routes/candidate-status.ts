import { isRecord } from "@trends/shared";


import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";


import { callConvexQuery, callConvexMutation } from "../services/convex-utils.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";

const app = new OpenAPIHono();


const CandidateStatusEnum = z.enum([
  "new",
  "contacted",
  "interviewing",
  "interviewed_pass",
  "interviewed_reject",
  "offer",
  "hired",
  "withdrawn",
]);

const CandidateStatusSchema = z.object({
  _id: z.string(),
  identityKey: z.string(),
  workspaceSlug: z.string(),
  status: CandidateStatusEnum,
  notes: z.string().optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.number(),
  history: z.array(z.object({
    status: z.string(),
    updatedAt: z.number(),
    notes: z.string().optional(),
  })).optional(),
});

const ListResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(CandidateStatusSchema),
});

const UpdateRequestSchema = z.object({
  identityKey: z.string(),
  status: CandidateStatusEnum,
  notes: z.string().optional(),
  updatedBy: z.string().optional(),
});

const UpdateResponseSchema = z.object({
  success: z.literal(true),
  item: CandidateStatusSchema.optional(),
  learningEntry: z.object({
    date: z.string(),
    observation: z.string(),
  }).optional(),
});

type CandidateStatusItem = z.infer<typeof CandidateStatusSchema>;

function toCandidateStatusItem(value: unknown): CandidateStatusItem | undefined {
  const parsed = CandidateStatusSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

const listRoute = createRoute({
  method: "get",
  path: "/api/candidate-status",
  tags: ["actions"],
  summary: "List candidate interview statuses",
  responses: {
    200: {
      content: { "application/json": { schema: ListResponseSchema } },
      description: "Status list",
    },
  },
});

app.openapi(listRoute, async (c) => {
  const value = await callConvexQuery( "candidate_status:list", {
    workspaceSlug: c.var.workspaceSlug,
  });
  const items = Array.isArray(value)
    ? value
        .map((item) => toCandidateStatusItem(item))
        .filter((item): item is CandidateStatusItem => item !== undefined)
    : [];
  return c.json({ success: true as const, items }, 200);
});

const updateRoute = createRoute({
  method: "post",
  path: "/api/candidate-status",
  tags: ["actions"],
  summary: "Set candidate interview status",
  request: {
    body: {
      content: {
        "application/json": { schema: UpdateRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: UpdateResponseSchema } },
      description: "Status updated",
    },
  },
});

app.openapi(updateRoute, async (c) => {
  const body = c.req.valid("json");
  await callConvexMutation( "candidate_status:upsert", {
    workspaceSlug: c.var.workspaceSlug,
    identityKey: body.identityKey,
    status: body.status,
    notes: body.notes,
    updatedBy: body.updatedBy,
  });

  const item = await callConvexQuery( "candidate_status:getByIdentity", {
    workspaceSlug: c.var.workspaceSlug,
    identityKey: body.identityKey,
  });

  let learningEntry:
    | {
      date: string;
      observation: string;
    }
    | undefined;

  if (body.status === "interviewed_reject") {
    const noteText = body.notes?.trim() || "面试后不合适";
    learningEntry = await workspaceConfigService.appendLearningLogEntry(
      c.var.workspaceSlug,
      `reject_pattern: ${noteText} -> interviewed_reject`
    );
  }

  return c.json({
    success: true as const,
    item: toCandidateStatusItem(item),
    learningEntry,
  }, 200);
});

export default app;
