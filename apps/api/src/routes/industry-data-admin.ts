import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  getAuthenticatedActorId,
  requireAdmin,
} from "../middleware/auth.js";
import { listTimeline } from "../services/industry-audit-service.js";
import {
  createEntry,
  deleteEntry,
  exportEntries,
  getSchedulePaused,
  importEntries,
  listEntries,
  setSchedulePaused,
  updateEntry,
} from "../services/industry-data-admin-service.js";
import { seedIndustryDataFromFiles } from "../services/industry-data-seed.js";
import { EntryTypeSchema } from "../services/industry-data-validators.js";
import { enqueueIndustryMaintenance } from "../services/industry-maintenance-pipeline-service.js";
import { callConvexMutation } from "../services/convex-utils.js";
import { config } from "../services/config.js";
import { logger } from "../services/logger.js";

const app = new OpenAPIHono();

app.use("/api/industry-data", requireAdmin);
app.use("/api/industry-data/*", requireAdmin);

const ErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

function actorFrom(c: {
  var: { auth?: { user?: { id?: string } } };
  req: { json: () => Promise<unknown> };
}, body?: { actor?: string }): string {
  try {
    return getAuthenticatedActorId(c as Parameters<typeof getAuthenticatedActorId>[0]);
  } catch {
    return body?.actor?.trim() || "admin";
  }
}

// ---------------------------------------------------------------------------
// GET /api/industry-data/entries
// ---------------------------------------------------------------------------
const listEntriesRoute = createRoute({
  method: "get",
  path: "/api/industry-data/entries",
  tags: ["industry-data"],
  request: {
    query: z.object({
      entryType: EntryTypeSchema.optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            entries: z.array(z.unknown()),
          }),
        },
      },
      description: "List industry data entries",
    },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Auth required" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Admin required" },
  },
});

app.openapi(listEntriesRoute, async (c) => {
  const { entryType } = c.req.valid("query");
  const entries = await listEntries(entryType);
  return c.json({ success: true as const, entries }, 200);
});

// ---------------------------------------------------------------------------
// POST /api/industry-data/entries  (bulk import)
// ---------------------------------------------------------------------------
const importRoute = createRoute({
  method: "post",
  path: "/api/industry-data/entries",
  tags: ["industry-data"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            entries: z.array(
              z.object({
                entryType: EntryTypeSchema,
                entryId: z.string().min(1),
                data: z.unknown(),
                sortOrder: z.number().optional(),
                companyKey: z.string().optional(),
              }),
            ),
            actor: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            imported: z.number(),
            gitSha: z.string().nullable(),
            warning: z.string().optional(),
          }),
        },
      },
      description: "Bulk import entries",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Validation failed" },
  },
});

app.openapi(importRoute, async (c) => {
  const body = c.req.valid("json");
  try {
    const result = await importEntries({
      entries: body.entries,
      actor: actorFrom(c, body),
    });
    return c.json(
      {
        success: true as const,
        imported: result.imported,
        gitSha: result.gitSha,
        ...(result.warning ? { warning: result.warning } : {}),
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false as const, error: message }, 400);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/industry-data/entries/:entryId
// ---------------------------------------------------------------------------
const updateRoute = createRoute({
  method: "put",
  path: "/api/industry-data/entries/{entryId}",
  tags: ["industry-data"],
  request: {
    params: z.object({ entryId: z.string().min(1) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            entryType: EntryTypeSchema,
            data: z.unknown(),
            sortOrder: z.number().optional(),
            companyKey: z.string().optional(),
            actor: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            entry: z.unknown(),
            gitSha: z.string().nullable(),
            warning: z.string().optional(),
          }),
        },
      },
      description: "Update entry",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Validation failed" },
  },
});

app.openapi(updateRoute, async (c) => {
  const { entryId } = c.req.valid("param");
  const body = c.req.valid("json");
  try {
    const result = await updateEntry({
      entryId,
      entryType: body.entryType,
      data: body.data,
      sortOrder: body.sortOrder,
      companyKey: body.companyKey,
      actor: actorFrom(c, body),
    });
    return c.json(
      {
        success: true as const,
        entry: result.entry,
        gitSha: result.gitSha,
        ...(result.warning ? { warning: result.warning } : {}),
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false as const, error: message }, 400);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/industry-data/entries/:entryId
// ---------------------------------------------------------------------------
const deleteRoute = createRoute({
  method: "delete",
  path: "/api/industry-data/entries/{entryId}",
  tags: ["industry-data"],
  request: {
    params: z.object({ entryId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            gitSha: z.string().nullable(),
            warning: z.string().optional(),
          }),
        },
      },
      description: "Delete entry",
    },
  },
});

app.openapi(deleteRoute, async (c) => {
  const { entryId } = c.req.valid("param");
  const result = await deleteEntry({
    entryId,
    actor: actorFrom(c),
  });
  return c.json(
    {
      success: true as const,
      gitSha: result.gitSha,
      ...(result.warning ? { warning: result.warning } : {}),
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// GET /api/industry-data/export
// ---------------------------------------------------------------------------
const exportRoute = createRoute({
  method: "get",
  path: "/api/industry-data/export",
  tags: ["industry-data"],
  request: {
    query: z.object({ entryType: EntryTypeSchema.optional() }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            entries: z.array(z.unknown()),
          }),
        },
      },
      description: "Export entries as JSON",
    },
  },
});

app.openapi(exportRoute, async (c) => {
  const { entryType } = c.req.valid("query");
  const entries = await exportEntries(entryType);
  return c.json({ success: true as const, entries }, 200);
});

// ---------------------------------------------------------------------------
// GET /api/industry-data/audit
// ---------------------------------------------------------------------------
const auditRoute = createRoute({
  method: "get",
  path: "/api/industry-data/audit",
  tags: ["industry-data"],
  request: {
    query: z.object({
      companyKey: z.string().optional(),
      limit: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(z.unknown()),
          }),
        },
      },
      description: "Unified audit timeline",
    },
  },
});

app.openapi(auditRoute, async (c) => {
  const { companyKey, limit } = c.req.valid("query");
  const items = await listTimeline({ companyKey, limit });
  return c.json({ success: true as const, items }, 200);
});

// ---------------------------------------------------------------------------
// POST /api/industry-data/trigger  (scoped research)
// ---------------------------------------------------------------------------
const triggerRoute = createRoute({
  method: "post",
  path: "/api/industry-data/trigger",
  tags: ["industry-data"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            companyKey: z.string().min(1),
            workspaceSlug: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            runId: z.string().nullable(),
            coalesced: z.boolean(),
          }),
        },
      },
      description: "Scoped maintenance trigger",
    },
    503: { content: { "application/json": { schema: ErrorSchema } }, description: "Enqueue failed" },
  },
});

app.openapi(triggerRoute, async (c) => {
  const body = c.req.valid("json");
  const workspaceSlug =
    body.workspaceSlug?.trim() || c.var.workspaceSlug || "dev";
  try {
    const result = await enqueueIndustryMaintenance({
      workspaceSlug,
      triggerSource: "manual",
      triggerContext: body.companyKey,
    });
    return c.json(
      {
        success: true as const,
        runId: result.runId,
        coalesced: result.coalesced,
      },
      200,
    );
  } catch (error) {
    logger.error("Failed scoped industry-data trigger:", error, {
      route: "industry-data",
    });
    return c.json(
      { success: false as const, error: "Failed to enqueue industry maintenance" },
      503,
    );
  }
});

// ---------------------------------------------------------------------------
// GET/POST /api/industry-data/schedule
// ---------------------------------------------------------------------------
const getScheduleRoute = createRoute({
  method: "get",
  path: "/api/industry-data/schedule",
  tags: ["industry-data"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            paused: z.boolean(),
          }),
        },
      },
      description: "Schedule pause flag",
    },
  },
});

app.openapi(getScheduleRoute, async (c) => {
  const { paused } = await getSchedulePaused();
  return c.json({ success: true as const, paused }, 200);
});

const setScheduleRoute = createRoute({
  method: "post",
  path: "/api/industry-data/schedule",
  tags: ["industry-data"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ paused: z.boolean() }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            paused: z.boolean(),
          }),
        },
      },
      description: "Set schedule pause flag",
    },
  },
});

app.openapi(setScheduleRoute, async (c) => {
  const body = c.req.valid("json");
  const { paused } = await setSchedulePaused(body.paused);
  return c.json({ success: true as const, paused }, 200);
});

// ---------------------------------------------------------------------------
// POST /api/industry-data/seed  (Task 6 — included here for single router)
// ---------------------------------------------------------------------------
const seedRoute = createRoute({
  method: "post",
  path: "/api/industry-data/seed",
  tags: ["industry-data"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            imported: z.number(),
          }),
        },
      },
      description: "Seed Convex from on-disk industry-data files",
    },
  },
});

app.openapi(seedRoute, async (c) => {
  const actor = actorFrom(c);
  const result = await seedIndustryDataFromFiles(config.projectRoot, {
    upsert: async (entry) => {
      await callConvexMutation("companies:upsertIndustryDataEntry", {
        entryType: entry.entryType,
        entryId: entry.entryId,
        data: entry.data,
        sortOrder: entry.sortOrder,
        actor,
        writeSecret: config.auth.convexWriteSecret,
      });
      return { entryId: entry.entryId };
    },
  });
  return c.json({ success: true as const, imported: result.imported }, 200);
});

export default app;
