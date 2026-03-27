import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireAdmin } from "../middleware/workspace.js";
import { resolveConvexUrl } from "../services/resume-import-service.js";

const app = new OpenAPIHono();

const TaxonomyClusterSchema = z.object({
  id: z.string(),
  workspaceSlug: z.string(),
  name: z.string(),
  slug: z.string(),
  parentSlug: z.string().optional(),
  tags: z.array(z.string()),
  source: z.enum(["human", "ai", "merged"]),
  confidence: z.number().optional(),
  status: z.enum(["active", "draft", "archived"]),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const TaxonomyResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(TaxonomyClusterSchema),
});

const TaxonomyUpsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  parentSlug: z.string().optional(),
  tags: z.array(z.string()).min(1),
  source: z.enum(["human", "ai", "merged"]).default("human"),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(["active", "draft", "archived"]).default("active"),
});

const SuggestTaxonomySchema = z.object({
  limit: z.number().int().min(1).max(24).optional(),
});

const DeleteTaxonomyParamsSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" } }),
});

type TaxonomyClusterResponse = z.infer<typeof TaxonomyClusterSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function callConvex(
  type: "query" | "mutation",
  pathName: string,
  args: Record<string, unknown>,
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
    throw new Error(`Convex ${type} failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json() as unknown;
  if (!isRecord(payload) || payload.status !== "success") {
    throw new Error(`Convex ${type} failed for ${pathName}`);
  }

  return payload.value;
}

function toTaxonomyCluster(value: unknown): TaxonomyClusterResponse | null {
  if (!isRecord(value) || typeof value._id !== "string") {
    return null;
  }

  const source = value.source === "human" || value.source === "ai" || value.source === "merged"
    ? value.source
    : "human";
  const status = value.status === "active" || value.status === "draft" || value.status === "archived"
    ? value.status
    : "active";

  return {
    id: value._id,
    workspaceSlug: typeof value.workspaceSlug === "string" ? value.workspaceSlug : "",
    name: typeof value.name === "string" ? value.name : "",
    slug: typeof value.slug === "string" ? value.slug : "",
    parentSlug: typeof value.parentSlug === "string" && value.parentSlug.trim().length > 0 ? value.parentSlug : undefined,
    tags: Array.isArray(value.tags) ? value.tags.filter((item): item is string => typeof item === "string") : [],
    source,
    confidence: typeof value.confidence === "number" ? value.confidence : undefined,
    status,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

app.use("/api/taxonomy", requireAdmin);
app.use("/api/taxonomy/*", requireAdmin);

const listRoute = createRoute({
  method: "get",
  path: "/api/taxonomy",
  tags: ["Config"],
  summary: "List taxonomy clusters for the current workspace",
  responses: {
    200: {
      description: "Taxonomy clusters",
      content: {
        "application/json": {
          schema: TaxonomyResponseSchema,
        },
      },
    },
  },
});

app.openapi(listRoute, async (c) => {
  const value = await callConvex("query", "taxonomy_clusters:list", {
    workspaceSlug: c.var.workspaceSlug,
  });
  const items = Array.isArray(value)
    ? value.map((item) => toTaxonomyCluster(item)).filter((item): item is NonNullable<ReturnType<typeof toTaxonomyCluster>> => item !== null)
    : [];
  return c.json({ success: true as const, items }, 200);
});

const upsertRoute = createRoute({
  method: "post",
  path: "/api/taxonomy",
  tags: ["Config"],
  summary: "Create or update a taxonomy cluster",
  request: {
    body: {
      content: {
        "application/json": {
          schema: TaxonomyUpsertSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated taxonomy clusters",
      content: {
        "application/json": {
          schema: TaxonomyResponseSchema,
        },
      },
    },
  },
});

app.openapi(upsertRoute, async (c) => {
  const body = c.req.valid("json");
  await callConvex("mutation", "taxonomy_clusters:upsert", {
    ...body,
    workspaceSlug: c.var.workspaceSlug,
  });
  const value = await callConvex("query", "taxonomy_clusters:list", {
    workspaceSlug: c.var.workspaceSlug,
  });
  const items = Array.isArray(value)
    ? value.map((item) => toTaxonomyCluster(item)).filter((item): item is NonNullable<ReturnType<typeof toTaxonomyCluster>> => item !== null)
    : [];
  return c.json({ success: true as const, items }, 200);
});

const suggestRoute = createRoute({
  method: "post",
  path: "/api/taxonomy/suggest",
  tags: ["Config"],
  summary: "Create draft taxonomy suggestions from uncategorized resume tags",
  request: {
    body: {
      content: {
        "application/json": {
          schema: SuggestTaxonomySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Suggested taxonomy clusters",
      content: {
        "application/json": {
          schema: TaxonomyResponseSchema,
        },
      },
    },
  },
});

app.openapi(suggestRoute, async (c) => {
  const body = c.req.valid("json");
  const value = await callConvex("mutation", "taxonomy_clusters:suggest", {
    workspaceSlug: c.var.workspaceSlug,
    limit: body.limit,
  });
  const items = Array.isArray(value)
    ? value.map((item) => toTaxonomyCluster(item)).filter((item): item is NonNullable<ReturnType<typeof toTaxonomyCluster>> => item !== null)
    : [];
  return c.json({ success: true as const, items }, 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/taxonomy/{id}",
  tags: ["Config"],
  summary: "Delete a taxonomy cluster",
  request: {
    params: DeleteTaxonomyParamsSchema,
  },
  responses: {
    200: {
      description: "Remaining taxonomy clusters",
      content: {
        "application/json": {
          schema: TaxonomyResponseSchema,
        },
      },
    },
  },
});

app.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid("param");
  await callConvex("mutation", "taxonomy_clusters:remove", {
    id,
    workspaceSlug: c.var.workspaceSlug,
  });
  const value = await callConvex("query", "taxonomy_clusters:list", {
    workspaceSlug: c.var.workspaceSlug,
  });
  const items = Array.isArray(value)
    ? value.map((item) => toTaxonomyCluster(item)).filter((item): item is NonNullable<ReturnType<typeof toTaxonomyCluster>> => item !== null)
    : [];
  return c.json({ success: true as const, items }, 200);
});

export default app;
