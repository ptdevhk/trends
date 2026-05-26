import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { ResumeFiltersSchema } from "../schemas/index.js";
import { config } from "../services/config.js";
import { SessionManager } from "../services/session-manager.js";

const app = new OpenAPIHono();
const sessionManager = new SessionManager(config.projectRoot);

const SessionStatusSchema = z.enum(["active", "completed", "archived"]);
const CandidateStatusSchema = z.enum([
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
const SessionFiltersSchema = ResumeFiltersSchema.extend({
  minRoleYears: z.number().min(0).optional(),
  roleFilterType: z.string().optional(),
  minAge: z.number().min(0).optional(),
  maxAge: z.number().min(0).optional(),
  status: z.array(CandidateStatusSchema).optional(),
  showBlocked: z.boolean().optional(),
});
const SearchSessionCollectionSourceSchema = z.object({
  type: z.enum(["job5156", "51job", "seek"]),
  exactUrl: z.string().optional(),
});
const SearchSessionStateSchema = z.object({
  location: z.string().optional().openapi({ example: "Malaysia" }),
  keywords: z.array(z.string()).optional().openapi({ example: ["Sales Engineer", "CNC"] }),
  requiredKeywords: z.array(z.string()).optional().openapi({ example: ["machine tools"] }),
  jobDescriptionId: z.string().optional().openapi({ example: "lathe-sales" }),
  selectedTags: z.array(z.string()).optional().openapi({ example: ["STAR"] }),
  selectedCompanies: z.array(z.string()).optional().openapi({ example: ["fanuc"] }),
  selectedExperienceLevel: z.enum(["senior", "mid", "junior"]).optional().openapi({ example: "mid" }),
  collectionSource: SearchSessionCollectionSourceSchema.optional(),
  filters: SessionFiltersSchema.optional(),
  referenceNote: z.string().optional().openapi({ example: "Priority shortlist for HR sync" }),
});

const SearchSessionSchema = z.object({
  id: z.string().openapi({ example: "session-123" }),
  workspaceSlug: z.string().openapi({ example: "dev" }),
  userId: z.string().optional().openapi({ example: "user-1" }),
  jobDescriptionId: z.string().optional().openapi({ example: "lathe-sales" }),
  sampleName: z.string().optional().openapi({ example: "sample-initial" }),
  filters: SessionFiltersSchema.optional(),
  shareTitle: z.string().optional().openapi({ example: "Kuala Lumpur · Sales Engineer" }),
  searchState: SearchSessionStateSchema.optional(),
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
  filters: SessionFiltersSchema.optional(),
  shareTitle: z.string().optional(),
  searchState: SearchSessionStateSchema.optional(),
});

const SessionUpdateSchema = z.object({
  userId: z.string().optional(),
  jobDescriptionId: z.string().optional(),
  sampleName: z.string().optional(),
  filters: SessionFiltersSchema.optional(),
  shareTitle: z.string().nullable().optional(),
  searchState: SearchSessionStateSchema.nullable().optional(),
  status: SessionStatusSchema.optional(),
  expiresAt: z.string().optional(),
});

const SessionIdParamSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "session-123" }),
});

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

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
  const workspaceSlug = c.var.workspaceSlug;
  const session = sessionManager.createSession({
    workspaceSlug,
    userId: body.userId,
    jobDescriptionId: body.jobDescriptionId,
    sampleName: body.sampleName,
    filters: body.filters,
    shareTitle: normalizeOptionalString(body.shareTitle),
    searchState: body.searchState ?? undefined,
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
  const workspaceSlug = c.var.workspaceSlug;
  const session = sessionManager.getSession(id, workspaceSlug);
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
  const workspaceSlug = c.var.workspaceSlug;
  const session = sessionManager.updateSession(id, {
    userId: body.userId,
    jobDescriptionId: body.jobDescriptionId,
    sampleName: body.sampleName,
    filters: body.filters,
    shareTitle: body.shareTitle === null ? null : normalizeOptionalString(body.shareTitle),
    searchState: body.searchState === null ? null : body.searchState,
    status: body.status,
    expiresAt: body.expiresAt,
  }, workspaceSlug);

  if (!session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  return c.json({ success: true as const, session }, 200);
});

export default app;
