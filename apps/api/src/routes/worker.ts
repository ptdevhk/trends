import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { requireAdmin } from "../middleware/auth.js";
import { config } from "../services/config.js";
import { logger } from "../services/logger.js";
import { enqueueIndustryMaintenance } from "../services/industry-maintenance-pipeline-service.js";

const app = new OpenAPIHono();

// Admin-gate the manual industry-maintenance trigger (other worker proxy routes
// are intentionally open - they are also reachable from internal callers).
app.use("/industry-maintenance", requireAdmin);

async function proxyToJson(path: string, init: RequestInit): Promise<{ data: unknown; status: number }> {
    const response = await fetch(`${config.workerUrl}${path}`, init);
    const text = await response.text();
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (error) {
        logger.error("Failed to parse worker proxy JSON response", error, {
            route: "worker",
            path,
            status: response.status,
        });
        data = text;
    }
    return { data, status: response.status };
}

const SimpleErrorSchema = z.object({ error: z.string() });
const WorkerRunQuerySchema = z.object({ once: z.string().optional().default("true") });

const statusRoute = createRoute({
    method: "get",
    path: "/status",
    tags: ["worker"],
    summary: "Get worker status",
    responses: {
        200: { content: { "application/json": { schema: z.unknown() } }, description: "Worker status" },
        503: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Worker unavailable" },
    },
});
app.openapi(statusRoute, async (c) => {
    try {
        const { data, status } = await proxyToJson("/worker/status", { method: "GET" });
        return c.json(data, status as 200);
    } catch (error) {
        logger.error("Failed to proxy to worker status:", error, { route: "worker" });
        return c.json({ error: "Failed to connect to worker API" }, 503);
    }
});

const crawlRoute = createRoute({
    method: "post",
    path: "/crawl",
    tags: ["worker"],
    summary: "Trigger crawl job",
    responses: {
        200: { content: { "application/json": { schema: z.unknown() } }, description: "Crawl triggered" },
        503: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Worker unavailable" },
    },
});
app.openapi(crawlRoute, async (c) => {
    try {
        const { data, status } = await proxyToJson("/worker/crawl", { method: "POST" });
        return c.json(data, status as 200);
    } catch (error) {
        logger.error("Failed to proxy crawl trigger:", error, { route: "worker" });
        return c.json({ error: "Failed to connect to worker API" }, 503);
    }
});

const runRoute = createRoute({
    method: "post",
    path: "/run",
    tags: ["worker"],
    summary: "Trigger worker run",
    request: {
        query: WorkerRunQuerySchema,
    },
    responses: {
        200: { content: { "application/json": { schema: z.unknown() } }, description: "Run triggered" },
        503: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Worker unavailable" },
    },
});
app.openapi(runRoute, async (c) => {
    const { once } = c.req.valid("query");
    try {
        const { data, status } = await proxyToJson(`/worker/run?once=${encodeURIComponent(once)}`, { method: "POST" });
        return c.json(data, status as 200);
    } catch (error) {
        logger.error("Failed to proxy worker run trigger:", error, { route: "worker" });
        return c.json({ error: "Failed to connect to worker API" }, 503);
    }
});

const summaryRoute = createRoute({
    method: "post",
    path: "/summary",
    tags: ["worker"],
    summary: "Trigger summary job",
    request: {
        body: { content: { "application/json": { schema: z.unknown() } } },
    },
    responses: {
        200: { content: { "application/json": { schema: z.unknown() } }, description: "Summary triggered" },
        503: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Worker unavailable" },
    },
});
app.openapi(summaryRoute, async (c) => {
    const body = await c.req.text();
    const contentType = c.req.header("Content-Type") || "application/json";
    try {
        const { data, status } = await proxyToJson("/worker/summary", {
            method: "POST",
            headers: { "Content-Type": contentType },
            body,
        });
        return c.json(data, status as 200);
    } catch (error) {
        logger.error("Failed to proxy summary trigger:", error, { route: "worker" });
        return c.json({ error: "Failed to connect to worker API" }, 503);
    }
});

const industryMaintenanceRoute = createRoute({
    method: "post",
    path: "/industry-maintenance",
    tags: ["worker"],
    summary: "Trigger industry-evidence maintenance run",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: z.object({ note: z.string().optional() }).optional(),
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
            description: "Maintenance run enqueued",
        },
        503: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Worker unavailable" },
    },
});
app.openapi(industryMaintenanceRoute, async (c) => {
    const body = await c.req.json().catch(() => ({} as { note?: string }));
    try {
        const result = await enqueueIndustryMaintenance({
            workspaceSlug: c.var.workspaceSlug,
            triggerSource: "manual",
            ...(body.note ? { triggerContext: body.note } : {}),
        });
        return c.json({ success: true as const, ...result }, 200);
    } catch (error) {
        logger.error("Failed to enqueue industry maintenance:", error, { route: "worker" });
        return c.json({ error: "Failed to enqueue industry maintenance" }, 503);
    }
});

export default app;
