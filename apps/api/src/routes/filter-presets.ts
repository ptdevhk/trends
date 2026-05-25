/**
 * Filter Presets API Routes
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { workspaceConfigService } from "../services/workspace-config-service.js";
import { denyIfNotAdmin } from "../middleware/workspace.js";

const app = new OpenAPIHono();

// Schemas
const PresetSchema = z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    filters: z.object({
        minExperience: z.number().optional(),
        maxExperience: z.number().nullable().optional(),
        education: z.array(z.string()).optional(),
        salaryRange: z.object({
            min: z.number().optional(),
            max: z.number().optional(),
        }).optional(),
    }),
});

const CategorySchema = z.object({
    id: z.string(),
    name: z.string(),
    icon: z.string().optional(),
});

const PresetUpdateSchema = z.object({
    name: z.string().optional(),
    category: z.string().optional(),
    filters: PresetSchema.shape.filters.optional(),
});

// ============================================================
// GET /api/filter-presets
// ============================================================
const listRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Filter Presets"],
    summary: "List filter presets",
    request: {
        query: z.object({
            category: z.string().optional().openapi({
                param: { name: "category", in: "query" },
                description: "Filter by category",
            }),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        presets: z.array(PresetSchema),
                    })
                }
            },
            description: "List of presets",
        },
    },
});

app.openapi(listRoute, async (c) => {
    const { category } = c.req.valid("query");
    const merged = await workspaceConfigService.getFilterPresets(c.var.workspaceSlug);
    const presets = category
        ? merged.presets.filter((preset) => preset.category === category)
        : merged.presets;
    return c.json({ success: true as const, presets }, 200);
});

// ============================================================
// GET /api/filter-presets/categories
// ============================================================
const categoriesRoute = createRoute({
    method: "get",
    path: "/categories",
    tags: ["Filter Presets"],
    summary: "List preset categories",
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        categories: z.array(CategorySchema),
                    })
                }
            },
            description: "List of categories",
        },
    },
});

app.openapi(categoriesRoute, async (c) => {
    const merged = await workspaceConfigService.getFilterPresets(c.var.workspaceSlug);
    const categories = merged.categories;
    return c.json({ success: true as const, categories }, 200);
});

// ============================================================
// GET /api/filter-presets/stats
// ============================================================
const statsRoute = createRoute({
    method: "get",
    path: "/stats",
    tags: ["Filter Presets"],
    summary: "Preset statistics",
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        stats: z.object({
                            total: z.number(),
                            byCategory: z.record(z.string(), z.number()),
                        }),
                    })
                }
            },
            description: "Statistics",
        },
    },
});

app.openapi(statsRoute, async (c) => {
    const merged = await workspaceConfigService.getFilterPresets(c.var.workspaceSlug);
    const byCategory: Record<string, number> = {};
    for (const preset of merged.presets) {
        byCategory[preset.category] = (byCategory[preset.category] || 0) + 1;
    }
    const stats = {
        total: merged.presets.length,
        byCategory,
    };
    return c.json({ success: true as const, stats }, 200);
});

// ============================================================
// GET /api/filter-presets/:id
// ============================================================
const getRoute = createRoute({
    method: "get",
    path: "/:id",
    tags: ["Filter Presets"],
    summary: "Get preset by ID",
    request: {
        params: z.object({
            id: z.string(),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        preset: PresetSchema,
                    })
                }
            },
            description: "Preset details",
        },
        404: { description: "Not found" },
    },
});

app.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const merged = await workspaceConfigService.getFilterPresets(c.var.workspaceSlug);
  const preset = merged.presets.find((item) => item.id === id);
    if (!preset) {
        return c.json({ success: false as const, error: `Preset not found: ${id}` }, 404);
  }
  return c.json({ success: true as const, preset }, 200);
});

// ============================================================
// POST /api/filter-presets
// ============================================================
const createPresetRoute = createRoute({
    method: "post",
    path: "/",
    tags: ["Filter Presets"],
    summary: "Create workspace filter preset",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: PresetSchema,
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        preset: PresetSchema,
                    }),
                },
            },
            description: "Created",
        },
        409: { description: "Already exists" },
        403: { description: "Forbidden" },
    },
});

app.openapi(createPresetRoute, async (c) => {
    if (denyIfNotAdmin(c.var.accessLevel)) {
        return c.json({ success: false as const, error: "Admin access required" }, 403);
    }
    const payload = c.req.valid("json");
    const workspaceConfig = await workspaceConfigService.getWorkspaceFilterPresets(c.var.workspaceSlug);
    const exists = workspaceConfig.presets.some((preset) => preset.id === payload.id);
    if (exists) {
        return c.json({ success: false as const, error: `Preset already exists: ${payload.id}` }, 409);
    }

    workspaceConfig.presets.push(payload);
    const categoryExists = workspaceConfig.categories.some((category) => category.id === payload.category);
    if (!categoryExists) {
        workspaceConfig.categories.push({
            id: payload.category,
            name: payload.category,
        });
    }

    await workspaceConfigService.setWorkspaceFilterPresets(c.var.workspaceSlug, workspaceConfig);
    return c.json({ success: true as const, preset: payload }, 201);
});

// ============================================================
// PUT /api/filter-presets/:id
// ============================================================
const updatePresetRoute = createRoute({
    method: "put",
    path: "/:id",
    tags: ["Filter Presets"],
    summary: "Update workspace filter preset",
    request: {
        params: z.object({
            id: z.string(),
        }),
        body: {
            content: {
                "application/json": {
                    schema: PresetUpdateSchema,
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
                        preset: PresetSchema,
                    }),
                },
            },
            description: "Updated",
        },
        404: { description: "Not found" },
        403: { description: "Forbidden" },
    },
});

app.openapi(updatePresetRoute, async (c) => {
    if (denyIfNotAdmin(c.var.accessLevel)) {
        return c.json({ success: false as const, error: "Admin access required" }, 403);
    }
    const { id } = c.req.valid("param");
    const updates = c.req.valid("json");
    const workspaceConfig = await workspaceConfigService.getWorkspaceFilterPresets(c.var.workspaceSlug);
    const index = workspaceConfig.presets.findIndex((preset) => preset.id === id);
    if (index === -1) {
        return c.json({ success: false as const, error: `Preset not found in workspace override: ${id}` }, 404);
    }

    const existing = workspaceConfig.presets[index];
    const nextPreset = {
        ...existing,
        ...updates,
        id: existing.id,
    };
    workspaceConfig.presets[index] = nextPreset;

    const categoryExists = workspaceConfig.categories.some((category) => category.id === nextPreset.category);
    if (!categoryExists) {
        workspaceConfig.categories.push({ id: nextPreset.category, name: nextPreset.category });
    }

    await workspaceConfigService.setWorkspaceFilterPresets(c.var.workspaceSlug, workspaceConfig);
    return c.json({ success: true as const, preset: nextPreset }, 200);
});

// ============================================================
// DELETE /api/filter-presets/:id
// ============================================================
const deletePresetRoute = createRoute({
    method: "delete",
    path: "/:id",
    tags: ["Filter Presets"],
    summary: "Delete workspace filter preset",
    request: {
        params: z.object({
            id: z.string(),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                    }),
                },
            },
            description: "Deleted",
        },
        404: { description: "Not found" },
        403: { description: "Forbidden" },
    },
});

app.openapi(deletePresetRoute, async (c) => {
    if (denyIfNotAdmin(c.var.accessLevel)) {
        return c.json({ success: false as const, error: "Admin access required" }, 403);
    }
    const { id } = c.req.valid("param");
    const workspaceConfig = await workspaceConfigService.getWorkspaceFilterPresets(c.var.workspaceSlug);
    const nextPresets = workspaceConfig.presets.filter((preset) => preset.id !== id);

    if (nextPresets.length === workspaceConfig.presets.length) {
        return c.json({ success: false as const, error: `Preset not found in workspace override: ${id}` }, 404);
    }

    await workspaceConfigService.setWorkspaceFilterPresets(c.var.workspaceSlug, {
        ...workspaceConfig,
        presets: nextPresets,
    });
    return c.json({ success: true as const }, 200);
});

export default app;
