import { isRecord } from "@trends/shared";


import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";


import { callConvexQuery, callConvexMutation } from "../services/convex-utils.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";
import { logger } from "../services/logger.js";

const app = new OpenAPIHono();


const CandidateStatusEnum = z.enum([
  "new",
  "contacted",
  "interviewing",
  "interviewed_pass",
  "interviewed_reject",
  "appeal_submitted",
  "human_review",
  "upheld",
  "reversed",
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

const AppealRequestSchema = z.object({
  resumeId: z.string().min(1),
  identityKey: z.string().min(1),
  reason: z.string().max(2000).optional(),
});

const AppealResponseSchema = z.object({
  success: z.literal(true),
  status: z.literal("appeal_submitted"),
});

const SimpleErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
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

// ---------------------------------------------------------------------------
// Candidate appeal submission (EU AI Act Art. 14 — right to human review)
// ---------------------------------------------------------------------------

const submitAppealRoute = createRoute({
  method: "post",
  path: "/api/candidate-appeal",
  tags: ["actions"],
  summary: "Submit a candidate appeal for human review",
  description: "Allows a candidate to request human review of an AI-assisted decision. Transitions candidate_status to appeal_submitted and sets the audit log outcome to appealed.",
  request: {
    body: {
      content: {
        "application/json": { schema: AppealRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: AppealResponseSchema } },
      description: "Appeal submitted",
    },
    400: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Invalid request",
    },
  },
});

app.openapi(submitAppealRoute, async (c) => {
  const body = c.req.valid("json");

  try {
    const result = await callConvexMutation("audit:submitAppeal", {
      resumeId: body.resumeId,
      identityKey: body.identityKey,
      workspaceSlug: c.var.workspaceSlug,
      reason: body.reason,
    }) as { success: boolean; status: string };

    return c.json(AppealResponseSchema.parse({
      success: true as const,
      status: "appeal_submitted",
    }), 200);
  } catch (error) {
    logger.error("Failed to submit candidate appeal", error, { route: "candidate-appeal" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 400);
  }
});

export default app;
