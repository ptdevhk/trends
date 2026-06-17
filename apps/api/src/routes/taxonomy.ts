import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireAdmin } from "../middleware/auth.js";
import { callConvexQuery, callConvexMutation } from "../services/convex-utils.js";
import { isRecord } from "@trends/shared";
import { logger } from "../services/logger.js";

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

const TaxonomyErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
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

function toTaxonomyItems(value: unknown): TaxonomyClusterResponse[] {
  return Array.isArray(value)
    ? value
        .map((item) => toTaxonomyCluster(item))
        .filter((item): item is NonNullable<ReturnType<typeof toTaxonomyCluster>> => item !== null)
    : [];
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
    500: {
      description: "Taxonomy request failed",
      content: {
        "application/json": {
          schema: TaxonomyErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(listRoute, async (c) => {
  try {
    const value = await callConvexQuery( "taxonomy_clusters:list", {
      workspaceSlug: c.var.workspaceSlug,
    });
    return c.json({ success: true as const, items: toTaxonomyItems(value) }, 200);
  } catch (error) {
    logger.error("Failed to load taxonomy clusters", error, { route: "taxonomy" });
    return c.json({ success: false as const, error: "Failed to load taxonomy clusters" }, 500);
  }
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
    500: {
      description: "Taxonomy request failed",
      content: {
        "application/json": {
          schema: TaxonomyErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(upsertRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    await callConvexMutation( "taxonomy_clusters:upsert", {
      ...body,
      workspaceSlug: c.var.workspaceSlug,
    });
    const value = await callConvexQuery( "taxonomy_clusters:list", {
      workspaceSlug: c.var.workspaceSlug,
    });
    return c.json({ success: true as const, items: toTaxonomyItems(value) }, 200);
  } catch (error) {
    logger.error("Failed to save taxonomy cluster", error, { route: "taxonomy" });
    return c.json({ success: false as const, error: "Failed to save taxonomy cluster" }, 500);
  }
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
    500: {
      description: "Taxonomy request failed",
      content: {
        "application/json": {
          schema: TaxonomyErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(suggestRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const value = await callConvexMutation( "taxonomy_clusters:suggest", {
      workspaceSlug: c.var.workspaceSlug,
      limit: body.limit,
    });
    return c.json({ success: true as const, items: toTaxonomyItems(value) }, 200);
  } catch (error) {
    logger.error("Failed to suggest taxonomy clusters", error, { route: "taxonomy" });
    return c.json({ success: false as const, error: "Failed to suggest taxonomy clusters" }, 500);
  }
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
    500: {
      description: "Taxonomy request failed",
      content: {
        "application/json": {
          schema: TaxonomyErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(deleteRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    await callConvexMutation( "taxonomy_clusters:remove", {
      id,
      workspaceSlug: c.var.workspaceSlug,
    });
    const value = await callConvexQuery( "taxonomy_clusters:list", {
      workspaceSlug: c.var.workspaceSlug,
    });
    return c.json({ success: true as const, items: toTaxonomyItems(value) }, 200);
  } catch (error) {
    logger.error("Failed to delete taxonomy cluster", error, { route: "taxonomy" });
    return c.json({ success: false as const, error: "Failed to delete taxonomy cluster" }, 500);
  }
});

export default app;
