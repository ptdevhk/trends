import { OpenAPIHono } from "@hono/zod-openapi";
import { config } from "../services/config.js";
import { logger } from "../services/logger.js";

const app = new OpenAPIHono();

async function proxyToWorker(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${config.workerUrl}${path}`, init);
    const body = await response.text();
    const contentType = response.headers.get("content-type") || "application/json";

    return new Response(body, {
        status: response.status,
        headers: {
            "Content-Type": contentType,
        },
    });
}

app.get("/status", async (c) => {
    try {
        return await proxyToWorker("/worker/status", { method: "GET" });
    } catch (error) {
        logger.error("Failed to proxy to worker status:", error, { route: "worker" });
        return c.json({ error: "Failed to connect to worker API" }, 503);
    }
});

app.post("/crawl", async (c) => {
    try {
        return await proxyToWorker("/worker/crawl", { method: "POST" });
    } catch (error) {
        logger.error("Failed to proxy crawl trigger:", error, { route: "worker" });
        return c.json({ error: "Failed to connect to worker API" }, 503);
    }
});

app.post("/run", async (c) => {
    const once = c.req.query("once") ?? "true";
    try {
        return await proxyToWorker(`/worker/run?once=${encodeURIComponent(once)}`, { method: "POST" });
    } catch (error) {
        logger.error("Failed to proxy worker run trigger:", error, { route: "worker" });
        return c.json({ error: "Failed to connect to worker API" }, 503);
    }
});

app.post("/summary", async (c) => {
    const body = await c.req.text();
    const contentType = c.req.header("Content-Type") || "application/json";
    try {
        return await proxyToWorker("/worker/summary", {
            method: "POST",
            headers: {
                "Content-Type": contentType,
            },
            body,
        });
    } catch (error) {
        logger.error("Failed to proxy summary trigger:", error, { route: "worker" });
        return c.json({ error: "Failed to connect to worker API" }, 503);
    }
});

export default app;
