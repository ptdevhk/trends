import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";

// Mock the Convex helper so we don't need a live backend.
vi.mock("../services/convex-utils.js", () => ({
  callConvexQuery: vi.fn(),
  callConvexAction: vi.fn(),
}));

import { maintenanceGuard, _resetMaintenanceCache } from "./maintenance.js";
import { callConvexQuery } from "../services/convex-utils.js";
import { parseJsonBody } from "../test-utils";

const mockedCallConvexQuery = vi.mocked(callConvexQuery);

describe("maintenanceGuard middleware", () => {
  beforeEach(() => {
    _resetMaintenanceCache();
    mockedCallConvexQuery.mockReset();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  function createApp() {
    const app = new Hono();
    app.use("*", maintenanceGuard);
    app.get("/api/test", (c) => c.json({ ok: true }));
    app.post("/api/test", (c) => c.json({ ok: true }));
    app.put("/api/test", (c) => c.json({ ok: true }));
    app.patch("/api/test", (c) => c.json({ ok: true }));
    app.delete("/api/test", (c) => c.json({ ok: true }));
    return app;
  }

  it("allows GET when maintenance is off", async () => {
    mockedCallConvexQuery.mockResolvedValue(false);
    const app = createApp();
    const res = await app.request("/api/test", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("allows POST when maintenance is off", async () => {
    mockedCallConvexQuery.mockResolvedValue(false);
    const app = createApp();
    const res = await app.request("/api/test", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("blocks POST when maintenance is on, returns 503", async () => {
    mockedCallConvexQuery.mockResolvedValue(true);
    const app = createApp();
    const res = await app.request("/api/test", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await parseJsonBody<{ success: boolean; error: string }>(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Maintenance");
  });

  it("allows GET when maintenance is on", async () => {
    mockedCallConvexQuery.mockResolvedValue(true);
    const app = createApp();
    const res = await app.request("/api/test", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("blocks PUT when maintenance is on", async () => {
    mockedCallConvexQuery.mockResolvedValue(true);
    const app = createApp();
    const res = await app.request("/api/test", { method: "PUT" });
    expect(res.status).toBe(503);
  });

  it("blocks PATCH when maintenance is on", async () => {
    mockedCallConvexQuery.mockResolvedValue(true);
    const app = createApp();
    const res = await app.request("/api/test", { method: "PATCH" });
    expect(res.status).toBe(503);
  });

  it("blocks DELETE when maintenance is on", async () => {
    mockedCallConvexQuery.mockResolvedValue(true);
    const app = createApp();
    const res = await app.request("/api/test", { method: "DELETE" });
    expect(res.status).toBe(503);
  });

  it("fails open when Convex query throws (allows writes)", async () => {
    mockedCallConvexQuery.mockRejectedValue(new Error("convex down"));
    const app = createApp();
    const res = await app.request("/api/test", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("caches maintenance flag within TTL window", async () => {
    mockedCallConvexQuery.mockResolvedValue(true);
    const app = createApp();
    // First request triggers a fetch
    await app.request("/api/test", { method: "POST" });
    // Second request within TTL should reuse cache (still blocked)
    await app.request("/api/test", { method: "POST" });
    // callConvexQuery should only have been invoked once
    expect(mockedCallConvexQuery).toHaveBeenCalledTimes(1);
  });

  it("logs error to console when Convex fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedCallConvexQuery.mockRejectedValue(new Error("convex down"));
    const app = createApp();
    await app.request("/api/test", { method: "POST" });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
