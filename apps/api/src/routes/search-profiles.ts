/**
 * Search Profiles API Routes
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { searchProfileService } from "../services/search-profile-service.js";

const app = new OpenAPIHono();

// Schemas
const ProfileSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    filename: z.string(),
    updatedAt: z.string(),
    status: z.enum(["active", "paused", "archived"]),
    location: z.string(),
    keywords: z.array(z.string()),
});

const StatsSchema = z.object({
    total: z.number(),
    active: z.number(),
    paused: z.number(),
    archived: z.number(),
});

const AutoMatchRequestSchema = z.object({
    keywords: z.array(z.string()).min(1),
    location: z.string().optional(),
});

const AutoMatchResponseSchema = z.object({
    success: z.literal(true),
    profileId: z.string().optional(),
    jobDescription: z.string().optional(),
    filterPreset: z.string().optional(),
    confidence: z.number(),
    matchedKeywords: z.array(z.string()),
});

// ============================================================
// GET /api/search-profiles/stats
// ============================================================
const statsRoute = createRoute({
    method: "get",
    path: "/stats",
    tags: ["Search Profiles"],
    summary: "Search profiles statistics",
    responses: {
        200: {
            description: "Profile statistics",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        stats: StatsSchema,
                    }),
                },
            },
        },
    },
});

app.openapi(statsRoute, (c) => {
    const stats = searchProfileService.getStats();
    return c.json({ success: true, stats } as const);
});

// ============================================================
// GET /api/search-profiles
// ============================================================
const listRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Search Profiles"],
    summary: "List all search profiles",
    responses: {
        200: {
            description: "List of search profiles",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        profiles: z.array(ProfileSummarySchema),
                    }),
                },
            },
        },
    },
});

app.openapi(listRoute, (c) => {
    const profiles = searchProfileService.listProfiles();
    return c.json({ success: true, profiles } as const);
});

// ============================================================
// GET /api/search-profiles/:id
// ============================================================
const getRoute = createRoute({
    method: "get",
    path: "/:id",
    tags: ["Search Profiles"],
    summary: "Get search profile by ID",
    request: {
        params: z.object({
            id: z.string(),
        }),
    },
    responses: {
        200: {
            description: "Profile details",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        profile: z.record(z.unknown()),
                    }),
                },
            },
        },
        404: {
            description: "Profile not found",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

app.openapi(getRoute, (c) => {
    const { id } = c.req.valid("param");
    try {
        const profile = searchProfileService.loadProfile(id);
        return c.json({ success: true as const, profile }, 200);
    } catch {
        return c.json({ success: false as const, error: `Profile not found: ${id}` }, 404);
    }
});

// ============================================================
// POST /api/search-profiles/auto-match
// ============================================================
const autoMatchRoute = createRoute({
    method: "post",
    path: "/auto-match",
    tags: ["Search Profiles"],
    summary: "Auto-match profile from keywords",
    description: "Find the best matching search profile based on input keywords and location",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: AutoMatchRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: "Match result",
            content: {
                "application/json": {
                    schema: AutoMatchResponseSchema,
                },
            },
        },
    },
});

app.openapi(autoMatchRoute, async (c) => {
    const { keywords, location } = c.req.valid("json");
    const result = searchProfileService.findByKeywords(keywords, location);

    return c.json({
        success: true,
        profileId: result.profile?.id,
        jobDescription: result.jobDescription,
        filterPreset: result.filterPreset,
        confidence: result.confidence,
        matchedKeywords: result.matchedKeywords,
    } as const);
});

// ============================================================
// POST /api/search-profiles/reload
// ============================================================
const reloadRoute = createRoute({
    method: "post",
    path: "/reload",
    tags: ["Search Profiles"],
    summary: "Clear cache and reload profiles",
    responses: {
        200: {
            description: "Cache cleared",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        message: z.string(),
                    }),
                },
            },
        },
    },
});

app.openapi(reloadRoute, (c) => {
    searchProfileService.clearCache();
    return c.json({ success: true, message: "Profile cache cleared" } as const);
});

export default app;
