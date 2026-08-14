import { isRecord } from "@trends/shared";


import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";


import { callConvexQuery, callConvexMutation } from "../services/convex-utils.js";
import { getConvexWriteSecret, config } from "../services/config.js";
import { getAuthenticatedActorId, requireWorkspaceUser } from "../middleware/auth.js";
import { listCandidateBlocks } from "../services/candidate-block-service.js";

const app = new OpenAPIHono();

app.use("/api/blocks", async (c, next) => {
  if (["GET", "POST", "PATCH", "DELETE"].includes(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});


const CandidateBlockSchema = z.object({
  _id: z.string(),
  identityKey: z.string(),
  workspaceSlug: z.string(),
  reason: z.string().optional(),
  blockedBy: z.string().optional(),
  blockedAt: z.number(),
});

const ListBlocksResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(CandidateBlockSchema),
});

const UpsertBlockRequestSchema = z.object({
  identityKey: z.string().optional(),
  identityKeys: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

const PatchBlockRequestSchema = z.object({
  identityKey: z.string(),
  reason: z.string().optional(),
});

const UpsertBlockResponseSchema = z.object({
  success: z.literal(true),
  inserted: z.number().int().optional(),
  updated: z.number().int().optional(),
  total: z.number().int().optional(),
  id: z.string().optional(),
});

const PatchBlockResponseSchema = z.object({
  success: z.literal(true),
  updated: z.boolean(),
});

const DeleteBlockQuerySchema = z.object({
  identityKey: z.string().openapi({
    param: {
      name: "identityKey",
      in: "query",
    },
  }),
});

const DeleteBlockResponseSchema = z.object({
  success: z.literal(true),
  removed: z.boolean(),
});

const listRoute = createRoute({
  method: "get",
  path: "/api/blocks",
  tags: ["actions"],
  summary: "List blocked candidates",
  responses: {
    200: {
      content: { "application/json": { schema: ListBlocksResponseSchema } },
      description: "Blocked candidate list",
    },
  },
});

app.openapi(listRoute, async (c) => {
  const items = await listCandidateBlocks(c.var.workspaceSlug);
  return c.json({ success: true as const, items }, 200);
});

const upsertRoute = createRoute({
  method: "post",
  path: "/api/blocks",
  tags: ["actions"],
  summary: "Block candidate(s) by identity key",
  request: {
    body: {
      content: {
        "application/json": { schema: UpsertBlockRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: UpsertBlockResponseSchema } },
      description: "Block updated",
    },
  },
});

app.openapi(upsertRoute, async (c) => {
  const body = c.req.valid("json");
  const actorId = getAuthenticatedActorId(c);
  const identityKeySet = new Set(
    (body.identityKeys ?? []).map((key) => key.trim()).filter((key) => key.length > 0)
  );
  if (body.identityKey && body.identityKey.trim().length > 0) {
    identityKeySet.add(body.identityKey.trim());
  }
  const identityKeys = Array.from(identityKeySet);

  if (identityKeys.length === 0) {
    return c.json({ success: true as const, inserted: 0, updated: 0, total: 0 }, 200);
  }

  if (identityKeys.length === 1) {
    const id = await callConvexMutation( "candidate_blocks:upsert", {
      workspaceSlug: c.var.workspaceSlug,
      identityKey: identityKeys[0],
      reason: body.reason,
      blockedBy: actorId,
      writeSecret: getConvexWriteSecret(),
    });

    return c.json({
      success: true as const,
      id: typeof id === "string" ? id : String(id),
      inserted: 1,
      updated: 0,
      total: 1,
    }, 200);
  }

  let inserted = 0;
  let updated = 0;
  let total = 0;
  for (let offset = 0; offset < identityKeys.length; offset += 100) {
    const batch = identityKeys.slice(offset, offset + 100);
    const result = await callConvexMutation( "candidate_blocks:bulkUpsert", {
      workspaceSlug: c.var.workspaceSlug,
      identityKeys: batch,
      reason: body.reason,
      blockedBy: actorId,
      writeSecret: getConvexWriteSecret(),
    });

    const normalized = isRecord(result) ? result : {};
    inserted += typeof normalized.inserted === "number" ? normalized.inserted : 0;
    updated += typeof normalized.updated === "number" ? normalized.updated : 0;
    total += typeof normalized.total === "number" ? normalized.total : batch.length;
  }

  return c.json({
    success: true as const,
    inserted,
    updated,
    total,
  }, 200);
});

const patchRoute = createRoute({
  method: "patch",
  path: "/api/blocks",
  tags: ["actions"],
  summary: "Update blocked candidate reason",
  request: {
    body: {
      content: {
        "application/json": { schema: PatchBlockRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: PatchBlockResponseSchema } },
      description: "Block reason updated",
    },
  },
});

app.openapi(patchRoute, async (c) => {
  const body = c.req.valid("json");
  const identityKey = body.identityKey.trim();
  if (!identityKey) {
    return c.json({ success: true as const, updated: false }, 200);
  }

  const updated = await callConvexMutation( "candidate_blocks:updateReason", {
    workspaceSlug: c.var.workspaceSlug,
    identityKey,
    reason: body.reason,
    writeSecret: getConvexWriteSecret(),
  });

  return c.json({ success: true as const, updated: updated === true }, 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/blocks",
  tags: ["actions"],
  summary: "Unblock candidate by identity key",
  request: {
    query: DeleteBlockQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: DeleteBlockResponseSchema } },
      description: "Block removed",
    },
  },
});

app.openapi(deleteRoute, async (c) => {
  const query = c.req.valid("query");
  const removed = await callConvexMutation( "candidate_blocks:remove", {
    workspaceSlug: c.var.workspaceSlug,
    identityKey: query.identityKey,
    writeSecret: getConvexWriteSecret(),
  });

  return c.json({ success: true as const, removed: removed === true }, 200);
});

export default app;
