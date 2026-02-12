/**
 * Search Profiles API Routes
 */

import fs from "node:fs";
import path from "node:path";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { searchProfileService, type SearchProfile } from "../services/search-profile-service.js";

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

const ProfilePayloadSchema = z.record(z.unknown());

const RunProfileRequestSchema = z.object({
    keyword: z.string().optional(),
    location: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    maxPages: z.number().int().min(1).max(50).optional(),
    autoAnalyze: z.boolean().optional(),
    analysisTopN: z.number().int().min(1).max(100).optional(),
});

const RunProfileResponseSchema = z.object({
    success: z.literal(true),
    profileId: z.string(),
    taskId: z.string(),
    dispatch: z.object({
        keyword: z.string(),
        location: z.string(),
        limit: z.number(),
        maxPages: z.number(),
        autoAnalyze: z.boolean(),
        analysisTopN: z.number(),
        convexUrl: z.string(),
    }),
});

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

    const projectRoot = searchProfileService.projectRoot;
    const candidateFiles = [
        path.join(projectRoot, "packages", "convex", ".env.local"),
        path.join(projectRoot, "apps", "web", ".env.local"),
        path.join(projectRoot, ".env.local"),
        path.join(projectRoot, ".env"),
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

async function dispatchCollectionTask(args: {
    keyword: string;
    location: string;
    limit: number;
    maxPages: number;
    autoAnalyze: boolean;
    analysisTopN: number;
}): Promise<{ taskId: string; convexUrl: string }> {
    const convexUrl = resolveConvexUrl().replace(/\/$/, "");
    const response = await fetch(`${convexUrl}/api/mutation`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            path: "resume_tasks:dispatch",
            args,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Convex dispatch failed (${response.status}): ${text}`);
    }

    const payload = await response.json() as {
        status?: string;
        value?: unknown;
        errorMessage?: string;
    };

    if (payload.status !== "success") {
        throw new Error(payload.errorMessage || "Convex mutation failed.");
    }

    return {
        taskId: String(payload.value),
        convexUrl,
    };
}

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
// POST /api/search-profiles
// ============================================================
const createProfileRoute = createRoute({
    method: "post",
    path: "/",
    tags: ["Search Profiles"],
    summary: "Create search profile",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: ProfilePayloadSchema,
                },
            },
        },
    },
    responses: {
        201: {
            description: "Profile created",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        profile: ProfilePayloadSchema,
                    }),
                },
            },
        },
        400: {
            description: "Invalid payload",
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

app.openapi(createProfileRoute, async (c) => {
    try {
        const payload = c.req.valid("json");
        const profile = searchProfileService.createProfile(payload);
        return c.json({ success: true as const, profile }, 201);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create profile";
        return c.json({ success: false as const, error: message }, 400);
    }
});

// ============================================================
// POST /api/search-profiles/:id/run
// ============================================================
const runProfileRoute = createRoute({
    method: "post",
    path: "/:id/run",
    tags: ["Search Profiles"],
    summary: "Execute profile (collection dispatch)",
    request: {
        params: z.object({
            id: z.string(),
        }),
        body: {
            required: false,
            content: {
                "application/json": {
                    schema: RunProfileRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: "Task dispatched",
            content: {
                "application/json": {
                    schema: RunProfileResponseSchema,
                },
            },
        },
        400: {
            description: "Invalid payload",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
        404: {
            description: "Profile not found",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
        502: {
            description: "Dispatch failed",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
    },
});

app.openapi(runProfileRoute, async (c) => {
    const { id } = c.req.valid("param");

    let profile: SearchProfile;
    try {
        profile = searchProfileService.loadProfile(id);
    } catch {
        return c.json({ success: false as const, error: `Profile not found: ${id}` }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = RunProfileRequestSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false as const, error: "Invalid run payload" }, 400);
    }

    const keyword = parsed.data.keyword?.trim() || profile.keywords.join(" ").trim();
    const location = parsed.data.location?.trim() || profile.location;
    const limit = parsed.data.limit ?? profile.schedule?.maxCandidates ?? 120;
    const maxPages = parsed.data.maxPages ?? 10;
    const autoAnalyze = parsed.data.autoAnalyze ?? Boolean(profile.ai);
    const analysisTopN = parsed.data.analysisTopN ?? 10;

    if (!keyword || !location) {
        return c.json({ success: false as const, error: "Profile keyword/location is required to run" }, 400);
    }

    try {
        const { taskId, convexUrl } = await dispatchCollectionTask({
            keyword,
            location,
            limit,
            maxPages,
            autoAnalyze,
            analysisTopN,
        });

        return c.json({
            success: true,
            profileId: profile.id,
            taskId,
            dispatch: {
                keyword,
                location,
                limit,
                maxPages,
                autoAnalyze,
                analysisTopN,
                convexUrl,
            },
        } as const, 200);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to dispatch profile run";
        return c.json({ success: false as const, error: message }, 502);
    }
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
                        profile: ProfilePayloadSchema,
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
// PUT /api/search-profiles/:id
// ============================================================
const updateProfileRoute = createRoute({
    method: "put",
    path: "/:id",
    tags: ["Search Profiles"],
    summary: "Update search profile",
    request: {
        params: z.object({
            id: z.string(),
        }),
        body: {
            content: {
                "application/json": {
                    schema: ProfilePayloadSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: "Profile updated",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        profile: ProfilePayloadSchema,
                    }),
                },
            },
        },
        400: {
            description: "Invalid payload",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
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

app.openapi(updateProfileRoute, async (c) => {
    const { id } = c.req.valid("param");
    const payload = c.req.valid("json");

    try {
        const profile = searchProfileService.updateProfile(id, payload);
        return c.json({ success: true as const, profile }, 200);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update profile";
        if (message.toLowerCase().includes("not found")) {
            return c.json({ success: false as const, error: message }, 404);
        }
        return c.json({ success: false as const, error: message }, 400);
    }
});

// ============================================================
// DELETE /api/search-profiles/:id
// ============================================================
const deleteProfileRoute = createRoute({
    method: "delete",
    path: "/:id",
    tags: ["Search Profiles"],
    summary: "Delete search profile",
    request: {
        params: z.object({
            id: z.string(),
        }),
    },
    responses: {
        200: {
            description: "Profile deleted",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(true) }),
                },
            },
        },
        404: {
            description: "Profile not found",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
    },
});

app.openapi(deleteProfileRoute, (c) => {
    const { id } = c.req.valid("param");
    const deleted = searchProfileService.deleteProfile(id);

    if (!deleted) {
        return c.json({ success: false as const, error: `Profile not found: ${id}` }, 404);
    }

    return c.json({ success: true as const }, 200);
});

export default app;
