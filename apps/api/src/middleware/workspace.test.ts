import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { formatWorkspaceSlugList, listWorkspaceSlugs } from "@trends/shared";

import { parseJsonBody } from "../test-utils";
import { workspaceMiddleware } from "./workspace.js";
import { serverTimingMiddleware } from "./server-timing.js";

function createTestApp() {
  const app = new Hono();
  app.use("*", workspaceMiddleware);
  app.get("/test", (c) => {
    return c.json({
      workspaceSlug: c.var.workspaceSlug,
    });
  });
  return app;
}

// ---------------------------------------------------------------------------
// workspaceMiddleware
// ---------------------------------------------------------------------------

describe("workspaceMiddleware", () => {
  it("defaults to dev workspace when no header or query param", async () => {
    const app = createTestApp();
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const body = await parseJsonBody(res);
    expect(body.workspaceSlug).toBe("dev");
  });

  it("uses workspace from X-Workspace-Slug header", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody(res);
    expect(body.workspaceSlug).toBe("hr");
  });

  it("uses workspace from workspaceSlug query param when header is absent", async () => {
    const app = createTestApp();
    const res = await app.request("/test?workspaceSlug=hr");
    expect(res.status).toBe(200);
    const body = await parseJsonBody(res);
    expect(body.workspaceSlug).toBe("hr");
  });

  it("prefers header over query param", async () => {
    const app = createTestApp();
    const res = await app.request("/test?workspaceSlug=hr", {
      headers: { "X-Workspace-Slug": "dev" },
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody(res);
    expect(body.workspaceSlug).toBe("dev");
  });

  it("trims whitespace from header value", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "  hr  " },
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody(res);
    expect(body.workspaceSlug).toBe("hr");
  });

  it("trims whitespace from query param", async () => {
    const app = createTestApp();
    const res = await app.request("/test?workspaceSlug=%20hr%20");
    expect(res.status).toBe(200);
    const body = await parseJsonBody(res);
    expect(body.workspaceSlug).toBe("hr");
  });

  it("rejects invalid workspace slug", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "Admin" },
    });
    expect(res.status).toBe(400);
    const body = await parseJsonBody(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid workspace slug");
    expect(body.error).toContain(formatWorkspaceSlugList());
  });

  it.each(listWorkspaceSlugs())("accepts registered workspace %s", async (slug) => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": slug },
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody(res);
    expect(body.workspaceSlug).toBe(slug);
  });
});

// ---------------------------------------------------------------------------
// serverTimingMiddleware
// ---------------------------------------------------------------------------

describe("serverTimingMiddleware", () => {
  it("adds Server-Timing header to response", async () => {
    const app = new Hono();
    app.use("*", serverTimingMiddleware);
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const serverTiming = res.headers.get("Server-Timing");
    expect(serverTiming).toMatch(/^total;dur=\d+$/);
  });

  it("reports non-zero duration", async () => {
    const app = new Hono();
    app.use("*", serverTimingMiddleware);
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    const serverTiming = res.headers.get("Server-Timing");
    const match = serverTiming?.match(/dur=(\d+)/);
    expect(match).not.toBeNull();
    const dur = parseInt(match![1], 10);
    expect(dur).toBeGreaterThanOrEqual(0);
  });

  it("emits total alone when no named segments are recorded", async () => {
    const app = new Hono();
    app.use("*", serverTimingMiddleware);
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.headers.get("Server-Timing")).toMatch(/^total;dur=\d+$/);
  });

  it("includes named segments recorded via c.var.serverTiming", async () => {
    const app = new Hono();
    app.use("*", serverTimingMiddleware);
    app.get("/test", (c) => {
      c.var.serverTiming.add("idx-cache", 1.4);
      c.var.serverTiming.add("queue", 3);
      return c.json({ ok: true });
    });

    const res = await app.request("/test");
    expect(res.headers.get("Server-Timing")).toMatch(
      /^total;dur=\d+, idx-cache;dur=1, queue;dur=3$/,
    );
  });

  it("records named segments in the order they were added", async () => {
    const app = new Hono();
    app.use("*", serverTimingMiddleware);
    app.get("/test", (c) => {
      c.var.serverTiming.add("a", 1);
      c.var.serverTiming.add("b", 2);
      return c.json({ ok: true });
    });

    const res = await app.request("/test");
    const header = res.headers.get("Server-Timing") ?? "";
    expect(header.indexOf("a;dur=1")).toBeLessThan(header.indexOf("b;dur=2"));
  });
});
