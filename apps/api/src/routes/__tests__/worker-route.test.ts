import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import workerRoutes from "../worker";

function createTestApp() {
  const app = new OpenAPIHono();
  app.route("/", workerRoutes);
  return app;
}

function workerSuccess(data: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

describe("worker routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /status", () => {
    it("proxies to worker status endpoint", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        workerSuccess({ status: "idle", uptime: 12345 }),
      );

      const app = createTestApp();
      const response = await app.request("/status");

      expect(response.status).toBe(200);
      const payload = await response.json() as { status: string };
      expect(payload.status).toBe("idle");
    });

    it("returns 503 when worker is unreachable", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

      const app = createTestApp();
      const response = await app.request("/status");

      expect(response.status).toBe(503);
      const payload = await response.json() as { error: string };
      expect(payload.error).toContain("Failed to connect");
    });
  });

  describe("POST /crawl", () => {
    it("proxies crawl trigger to worker", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        workerSuccess({ triggered: true }),
      );

      const app = createTestApp();
      const response = await app.request("/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as { triggered: boolean };
      expect(payload.triggered).toBe(true);
    });
  });

  describe("POST /run", () => {
    it("proxies run trigger with default once=true", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        workerSuccess({ started: true }),
      );

      const app = createTestApp();
      const response = await app.request("/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(response.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("once=true"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("proxies run trigger with once=false", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        workerSuccess({ started: true }),
      );

      const app = createTestApp();
      const response = await app.request("/run?once=false", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(response.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("once=false"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("POST /summary", () => {
    it("proxies summary with request body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        workerSuccess({ summary: "done" }),
      );

      const app = createTestApp();
      const response = await app.request("/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "daily" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as { summary: string };
      expect(payload.summary).toBe("done");
    });
  });
});
