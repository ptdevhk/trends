import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { callConvexQuery, callConvexMutation } from "../services/convex-utils.js";
import { requireAdmin } from "../middleware/auth.js";
import { logger } from "../services/logger.js";

const app = new OpenAPIHono();

// Workspace snapshots (export/import) are admin-only, workspace-scoped
// operations: replace-mode import wipes the target workspace's tables.
app.use("/api/workspace/export", requireAdmin);
app.use("/api/workspace/import", requireAdmin);

// Envelope schema version; must stay in lockstep with
// packages/convex/convex/workspace_snapshots.ts (SNAPSHOT_SCHEMA_VERSION).
const SNAPSHOT_SCHEMA_VERSION = 1 as const;

const ProfileSchema = z.enum(["hr-ops", "full"]);
const ModeSchema = z.enum(["replace", "merge"]);

const TablesSchema = z.object({
  candidateStatus: z.array(z.record(z.string(), z.unknown())),
  candidateBlocks: z.array(z.record(z.string(), z.unknown())),
  searchProfiles: z.array(z.record(z.string(), z.unknown())),
  workspaceConfig: z.array(z.record(z.string(), z.unknown())),
});

const ExportQuerySchema = z.object({
  profile: ProfileSchema.default("hr-ops").openapi({
    param: {
      name: "profile",
      in: "query",
    },
  }),
});

const ExportResponseSchema = z.object({
  success: z.literal(true),
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  profile: ProfileSchema,
  workspaceSlug: z.string(),
  exportedAt: z.number(),
  tables: TablesSchema,
});

const ImportRequestSchema = z.object({
  schemaVersion: z.number().optional(),
  profile: ProfileSchema,
  mode: ModeSchema,
  tables: TablesSchema,
});

const CountsSchema = z.object({
  candidateStatus: z.number().int(),
  candidateBlocks: z.number().int(),
  searchProfiles: z.number().int(),
  workspaceConfig: z.number().int(),
});

const ImportResponseSchema = z.object({
  success: z.literal(true),
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  profile: ProfileSchema,
  workspaceSlug: z.string(),
  mode: ModeSchema,
  applied: CountsSchema,
  deleted: CountsSchema,
});

const SimpleErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const exportRoute = createRoute({
  method: "get",
  path: "/api/workspace/export",
  tags: ["actions"],
  summary: "Export a workspace snapshot (hr-ops or full profile)",
  request: {
    query: ExportQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: ExportResponseSchema } },
      description: "Workspace snapshot envelope",
    },
     500: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Export failed",
    },
  },
});

app.openapi(exportRoute, async (c) => {
  const { profile } = c.req.valid("query");
  const workspaceSlug = c.var.workspaceSlug;
  try {
    const result = await callConvexQuery("workspace_snapshots:exportWorkspaceSnapshot", {
      workspaceSlug,
      profile,
    });
    const tables = (result as { tables?: unknown })?.tables;
    if (!tables || typeof tables !== "object") {
      throw new Error("workspace_snapshots:exportWorkspaceSnapshot returned no tables");
    }
    return c.json(
      {
        success: true as const,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        profile,
        workspaceSlug,
        exportedAt: Date.now(),
        tables,
      },
      200,
    );
  } catch (error) {
    logger.error("Failed to export workspace snapshot", error, { route: "workspace_export" });
    const message = error instanceof Error ? error.message : "Failed to export workspace snapshot";
    return c.json({ success: false as const, error: message }, 500);
  }
});

const importRoute = createRoute({
  method: "post",
  path: "/api/workspace/import",
  tags: ["actions"],
  summary: "Import a workspace snapshot (replace or merge mode)",
  request: {
    body: {
      content: {
        "application/json": { schema: ImportRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ImportResponseSchema } },
      description: "Import result",
    },
    400: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Envelope rejected",
    },
  },
});

app.openapi(importRoute, async (c) => {
  const body = c.req.valid("json");
  if (body.schemaVersion !== undefined && body.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return c.json(
      { success: false as const, error: `Unsupported snapshot schemaVersion ${body.schemaVersion} (expected ${SNAPSHOT_SCHEMA_VERSION})` },
      400,
    );
  }
  const workspaceSlug = c.var.workspaceSlug;
  try {
    const result = await callConvexMutation("workspace_snapshots:importWorkspaceSnapshot", {
      workspaceSlug,
      profile: body.profile,
      mode: body.mode,
      tables: body.tables,
    });
    const parsed = ImportResponseSchema.parse({ success: true, ...(result as object) });
    return c.json(parsed, 200);
  } catch (error) {
    logger.error("Failed to import workspace snapshot", error, { route: "workspace_import" });
    const message = error instanceof Error ? error.message : "Failed to import workspace snapshot";
    return c.json({ success: false as const, error: message }, 400);
  }
});

export default app;
