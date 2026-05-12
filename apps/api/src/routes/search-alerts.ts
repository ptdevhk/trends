import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { resolveConvexUrl } from "../services/resume-import-service.js";

const app = new OpenAPIHono();

const SearchAlertSchema = z.object({
    _id: z.string(),
    _creationTime: z.number(),
    workspaceSlug: z.string(),
    searchProfileId: z.string(),
    name: z.string(),
    keywords: z.optional(z.array(z.string())),
    minScore: z.number(),
    enabled: z.boolean(),
    lastNotifiedAt: z.optional(z.number()),
    createdBy: z.optional(z.string()),
});

async function convexQuery(path: string, args: Record<string, unknown>) {
    const convexUrl = resolveConvexUrl().replace(/\/$/, "");
    const response = await fetch(`${convexUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args }),
    });
    if (!response.ok) {
        throw new Error(`Convex query failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as { status: string; value?: unknown; errorMessage?: string };
    if (data.status !== "success") {
        throw new Error(`Convex error: ${data.errorMessage ?? "unknown"}`);
    }
    return data.value;
}

async function convexMutation(path: string, args: Record<string, unknown>) {
    const convexUrl = resolveConvexUrl().replace(/\/$/, "");
    const response = await fetch(`${convexUrl}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args }),
    });
    if (!response.ok) {
        throw new Error(`Convex mutation failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as { status: string; value?: unknown; errorMessage?: string };
    if (data.status !== "success") {
        throw new Error(`Convex error: ${data.errorMessage ?? "unknown"}`);
    }
    return data.value;
}

const listRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Search Alerts"],
    summary: "List search alerts for a workspace",
    responses: {
        200: {
            description: "Search alerts list",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        alerts: z.array(SearchAlertSchema),
                    }),
                },
            },
        },
    },
});

app.openapi(listRoute, async (c) => {
    const workspace = c.req.header("X-Workspace-Slug") ?? "default";
    const alerts = await convexQuery("search_alerts:list", {
        workspaceSlug: workspace,
    }) as z.infer<typeof SearchAlertSchema>[];
    return c.json({ success: true as const, alerts }, 200);
});

const createRoute_ = createRoute({
    method: "post",
    path: "/",
    tags: ["Search Alerts"],
    summary: "Create a search alert subscription",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: z.object({
                        searchProfileId: z.string(),
                        name: z.string().min(1).max(200),
                        keywords: z.optional(z.array(z.string())),
                        minScore: z.number().min(0).max(100),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: "Alert created",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        alertId: z.string(),
                    }),
                },
            },
        },
    },
});

app.openapi(createRoute_, async (c) => {
    const body = c.req.valid("json");
    const workspace = c.req.header("X-Workspace-Slug") ?? "default";
    const alertId = await convexMutation("search_alerts:create", {
        workspaceSlug: workspace,
        searchProfileId: body.searchProfileId,
        name: body.name,
        keywords: body.keywords,
        minScore: body.minScore,
    });
    return c.json({ success: true as const, alertId: String(alertId) }, 200);
});

const toggleRoute = createRoute({
    method: "patch",
    path: "/:id/toggle",
    tags: ["Search Alerts"],
    summary: "Toggle alert enabled/disabled state",
    request: {
        params: z.object({ id: z.string() }),
        body: {
            content: {
                "application/json": {
                    schema: z.object({
                        enabled: z.boolean(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: "Alert toggled",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                    }),
                },
            },
        },
    },
});

app.openapi(toggleRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    await convexMutation("search_alerts:toggle", {
        alertId: id,
        enabled: body.enabled,
    });
    return c.json({ success: true as const }, 200);
});

const deleteRoute = createRoute({
    method: "delete",
    path: "/:id",
    tags: ["Search Alerts"],
    summary: "Delete a search alert",
    request: {
        params: z.object({ id: z.string() }),
    },
    responses: {
        200: {
            description: "Alert deleted",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                    }),
                },
            },
        },
    },
});

app.openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    await convexMutation("search_alerts:remove", {
        alertId: id,
    });
    return c.json({ success: true as const }, 200);
});

export default app;
