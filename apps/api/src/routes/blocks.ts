import fs from "node:fs";
import path from "node:path";
import { isRecord } from "@trends/shared";


import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";


import { config } from "../services/config.js";

const app = new OpenAPIHono();


function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readEnvVarFromFile(filePath: string, key: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || match[1] !== key) {
      continue;
    }

    let value = match[2].trim();
    const hasDoubleQuotes = value.startsWith("\"") && value.endsWith("\"");
    const hasSingleQuotes = value.startsWith("'") && value.endsWith("'");
    if (hasDoubleQuotes || hasSingleQuotes) {
      value = value.slice(1, -1);
    }

    return value;
  }

  return null;
}

function resolveConvexUrl(): string {
  if (process.env.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }
  if (process.env.VITE_CONVEX_URL) {
    return process.env.VITE_CONVEX_URL;
  }

  const candidateFiles = [
    path.join(config.projectRoot, "packages", "convex", ".env.local"),
    path.join(config.projectRoot, "apps", "web", ".env.local"),
    path.join(config.projectRoot, ".env.local"),
    path.join(config.projectRoot, ".env"),
  ];

  for (const filePath of candidateFiles) {
    const direct = readEnvVarFromFile(filePath, "CONVEX_URL");
    if (direct) {
      return direct;
    }
    const vite = readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
    if (vite) {
      return vite;
    }
  }

  return "http://127.0.0.1:3210";
}

async function callConvex(
  type: "query" | "mutation",
  pathName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/${type}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ path: pathName, args }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Convex ${type} failed (${response.status}): ${message}`);
  }

  const payload = await response.json() as unknown;
  if (!isRecord(payload) || payload.status !== "success") {
    const errorMessage = isRecord(payload) ? readString(payload.errorMessage) : undefined;
    throw new Error(errorMessage ?? `Convex ${type} failed for ${pathName}`);
  }

  return payload.value;
}

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
  blockedBy: z.string().optional(),
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
  const value = await callConvex("query", "candidate_blocks:list", {
    workspaceSlug: c.var.workspaceSlug,
  });
  const items = Array.isArray(value) ? value : [];
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
  const identityKeys = Array.from(
    new Set((body.identityKeys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))
  );
  if (body.identityKey && body.identityKey.trim().length > 0) {
    identityKeys.push(body.identityKey.trim());
  }

  if (identityKeys.length === 0) {
    return c.json({ success: true as const, inserted: 0, updated: 0, total: 0 }, 200);
  }

  if (identityKeys.length === 1) {
    const id = await callConvex("mutation", "candidate_blocks:upsert", {
      workspaceSlug: c.var.workspaceSlug,
      identityKey: identityKeys[0],
      reason: body.reason,
      blockedBy: body.blockedBy,
    });

    return c.json({
      success: true as const,
      id: typeof id === "string" ? id : String(id),
      inserted: 1,
      updated: 0,
      total: 1,
    }, 200);
  }

  const result = await callConvex("mutation", "candidate_blocks:bulkUpsert", {
    workspaceSlug: c.var.workspaceSlug,
    identityKeys,
    reason: body.reason,
    blockedBy: body.blockedBy,
  });

  const normalized = isRecord(result) ? result : {};
  const inserted = typeof normalized.inserted === "number" ? normalized.inserted : 0;
  const updated = typeof normalized.updated === "number" ? normalized.updated : 0;
  const total = typeof normalized.total === "number" ? normalized.total : identityKeys.length;

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

  const updated = await callConvex("mutation", "candidate_blocks:updateReason", {
    workspaceSlug: c.var.workspaceSlug,
    identityKey,
    reason: body.reason,
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
  const removed = await callConvex("mutation", "candidate_blocks:remove", {
    workspaceSlug: c.var.workspaceSlug,
    identityKey: query.identityKey,
  });

  return c.json({ success: true as const, removed: removed === true }, 200);
});

export default app;
