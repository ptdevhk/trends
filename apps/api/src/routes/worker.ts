import { OpenAPIHono } from "@hono/zod-openapi";
import { config } from "../services/config.js";

const app = new OpenAPIHono();

app.get("/status", async (c) => {
    try {
        const workerUrl = `${config.workerUrl}/worker/status`;
        const response = await fetch(workerUrl);

        if (!response.ok) {
            return c.json({ error: `Worker API returned ${response.status}` }, response.status as any);
        }

        const data = await response.json();
        return c.json(data);
    } catch (error) {
        console.error("Failed to proxy to worker status:", error);
        return c.json({ error: "Failed to connect to worker API" }, 503);
    }
});

export default app;
