import { createHash } from "node:crypto";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { AuthEventStorage } from "../services/auth-event-storage.js";
import { config } from "../services/config.js";
import {
  PublicShareStorage,
  type PublicShareSnapshotPayload,
} from "../services/public-share-storage.js";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../services/workspace-permissions.js";

const app = new OpenAPIHono();
const publicShareStorage = new PublicShareStorage(config.projectRoot);
const authEventStorage = new AuthEventStorage(config.projectRoot);

const SnapshotResultSchema = z.object({
  resumeKey: z.string().min(1),
  displayName: z.string().optional(),
  name: z.string().optional(),
  headline: z.string().optional(),
  location: z.string().optional(),
  summary: z.string().optional(),
  score: z.number().optional(),
  recommendation: z.string().optional(),
  highlights: z.array(z.string()).optional(),
  concerns: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
}).catchall(z.unknown());

const PublicShareSearchSchema = z.object({
  query: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
}).optional();

const PublicShareAnalysisSchema = z.object({
  scoringMode: z.string().min(1),
  promptVersion: z.string().min(1),
  skillConfigVersion: z.string().min(1),
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
  resultSetHash: z.string().optional(),
});

const CreatePublicShareSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  sessionId: z.string().optional(),
  search: PublicShareSearchSchema,
  analysis: PublicShareAnalysisSchema,
  results: z.array(SnapshotResultSchema).min(1),
  expiresAt: z.string().optional(),
});

const PublicShareParamSchema = z.object({
  token: z.string().openapi({ param: { name: "token", in: "path" }, example: "public-token" }),
});

const SnapshotPayloadSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  search: z.object({
    query: z.string().optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  results: z.array(SnapshotResultSchema),
});

const AnalysisSnapshotResponseSchema = z.object({
  id: z.string(),
  searchRunId: z.string(),
  scoringMode: z.string(),
  promptVersion: z.string(),
  skillConfigVersion: z.string(),
  modelProvider: z.string(),
  modelName: z.string(),
  resultSetHash: z.string(),
  payload: SnapshotPayloadSchema,
  createdAt: z.string(),
});

const PublicShareCreateResponseSchema = z.object({
  success: z.literal(true),
  share: z.object({
    id: z.string(),
    publicPath: z.string(),
    title: z.string().optional(),
    targetType: z.enum(["search_run", "analysis_snapshot"]),
    targetId: z.string(),
    createdAt: z.string(),
    expiresAt: z.string().optional(),
  }),
});

const PublicShareReadResponseSchema = z.object({
  success: z.literal(true),
  share: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    createdAt: z.string(),
    expiresAt: z.string().optional(),
    snapshot: AnalysisSnapshotResponseSchema,
  }),
});

function hashResultSet(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function getEventStorage(c: { var: { authEventStorage?: AuthEventStorage } }): AuthEventStorage {
  return c.var.authEventStorage ?? authEventStorage;
}

const createPublicShareRoute = createRoute({
  method: "post",
  path: "/api/public-shares",
  tags: ["public-shares"],
  summary: "Create a public immutable resume search snapshot",
  middleware: [requireWorkspacePermission("resume:share:public:create")] as const,
  request: {
    body: {
      content: {
        "application/json": { schema: CreatePublicShareSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: PublicShareCreateResponseSchema } },
      description: "Public share created",
    },
    401: { description: "Authentication required" },
    403: { description: "Workspace permission required" },
  },
});

app.openapi(createPublicShareRoute, (c) => {
  const body = c.req.valid("json");
  const workspaceSlug = c.var.workspaceSlug;
  const actorId = c.var.auth?.user.id;
  const resultSetHash = normalizeOptionalString(body.analysis.resultSetHash)
    ?? hashResultSet({
      search: body.search,
      results: body.results.map((result) => result.resumeKey),
      analysis: body.analysis,
    });
  const payload: PublicShareSnapshotPayload = {
    title: normalizeOptionalString(body.title),
    description: normalizeOptionalString(body.description),
    search: body.search
      ? {
        query: normalizeOptionalString(body.search.query),
        filters: body.search.filters,
      }
      : undefined,
    results: body.results,
  };
  const run = publicShareStorage.createSearchRun({
    workspaceSlug,
    sessionId: normalizeOptionalString(body.sessionId),
    query: { text: normalizeOptionalString(body.search?.query) ?? "" },
    safeFilters: body.search?.filters ?? {},
    resultSetHash,
    resumeKeys: body.results.map((result) => result.resumeKey),
    createdBy: actorId,
  });
  const snapshot = publicShareStorage.createAnalysisSnapshot({
    workspaceSlug,
    searchRunId: run.id,
    scoringMode: body.analysis.scoringMode,
    promptVersion: body.analysis.promptVersion,
    skillConfigVersion: body.analysis.skillConfigVersion,
    modelProvider: body.analysis.modelProvider,
    modelName: body.analysis.modelName,
    resultSetHash,
    payload,
    createdBy: actorId,
  });
  const share = publicShareStorage.createPublicShare({
    workspaceSlug,
    targetType: "analysis_snapshot",
    targetId: snapshot.id,
    title: body.title,
    description: body.description,
    createdBy: actorId,
    expiresAt: body.expiresAt,
  });
  getEventStorage(c).append({
    type: "public_share_created",
    userId: actorId,
    workspaceSlug,
    sessionId: c.var.auth?.sessionId,
    metadata: {
      shareId: share.id,
      targetType: share.targetType,
      targetId: share.targetId,
    },
  });

  return c.json({
    success: true as const,
    share: {
      id: share.id,
      publicPath: `/s/${share.token}`,
      title: share.title,
      targetType: share.targetType,
      targetId: share.targetId,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
    },
  }, 200);
});

const getPublicShareRoute = createRoute({
  method: "get",
  path: "/api/public-shares/{token}",
  tags: ["public-shares"],
  summary: "Read a public immutable resume search snapshot",
  request: {
    params: PublicShareParamSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: PublicShareReadResponseSchema } },
      description: "Public share snapshot",
    },
    404: { description: "Public share not found" },
    410: { description: "Public share revoked or expired" },
  },
});

app.openapi(getPublicShareRoute, (c) => {
  const { token } = c.req.valid("param");
  const lookup = publicShareStorage.lookupPublicShareByToken(token);
  if (!lookup) {
    return c.json({ success: false as const, error: "Public share not found" }, 404);
  }

  const principal = {
    type: "public-token" as const,
    shareId: lookup.share.id,
    workspaceSlug: lookup.share.workspaceSlug,
  };
  if (!hasWorkspacePermission({
    principal,
    workspaceSlug: lookup.share.workspaceSlug,
    permission: "resume:share:public:read",
  })) {
    return c.json({ success: false as const, error: "Public share access denied" }, 403);
  }

  if (lookup.status !== "active") {
    getEventStorage(c).append({
      type: "public_share_unavailable",
      workspaceSlug: lookup.share.workspaceSlug,
      reason: lookup.status,
      metadata: {
        shareId: lookup.share.id,
        targetType: lookup.share.targetType,
      },
    });
    return c.json({ success: false as const, error: "Public share unavailable" }, 410);
  }

  if (!lookup.snapshot) {
    return c.json({ success: false as const, error: "Public share snapshot not found" }, 404);
  }
  getEventStorage(c).append({
    type: "public_share_read",
    workspaceSlug: lookup.share.workspaceSlug,
    metadata: {
      shareId: lookup.share.id,
      targetType: lookup.share.targetType,
      targetId: lookup.share.targetId,
    },
  });

  return c.json({
    success: true as const,
    share: {
      id: lookup.share.id,
      title: lookup.share.title,
      description: lookup.share.description,
      createdAt: lookup.share.createdAt,
      expiresAt: lookup.share.expiresAt,
      snapshot: {
        id: lookup.snapshot.id,
        searchRunId: lookup.snapshot.searchRunId,
        scoringMode: lookup.snapshot.scoringMode,
        promptVersion: lookup.snapshot.promptVersion,
        skillConfigVersion: lookup.snapshot.skillConfigVersion,
        modelProvider: lookup.snapshot.modelProvider,
        modelName: lookup.snapshot.modelName,
        resultSetHash: lookup.snapshot.resultSetHash,
        payload: lookup.snapshot.payload,
        createdAt: lookup.snapshot.createdAt,
      },
    },
  }, 200);
});

export default app;
