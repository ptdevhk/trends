/**
 * Filter Presets API Routes
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { filterPresetService } from "../services/filter-preset-service.js";

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

app.openapi(listRoute, (c) => {
    const { category } = c.req.valid("query");
    const presets = filterPresetService.listPresets(category);
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

app.openapi(categoriesRoute, (c) => {
    const categories = filterPresetService.listCategories();
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
                            byCategory: z.record(z.number()),
                        }),
                    })
                }
            },
            description: "Statistics",
        },
    },
});

app.openapi(statsRoute, (c) => {
    const stats = filterPresetService.getStats();
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

app.openapi(getRoute, (c) => {
    const { id } = c.req.valid("param");
    const preset = filterPresetService.getPreset(id);
    if (!preset) {
        return c.json({ success: false as const, error: `Preset not found: ${id}` }, 404);
    }
    return c.json({ success: true as const, preset }, 200);
});

export default app;
