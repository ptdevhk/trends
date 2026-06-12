import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { formatWorkspaceSlugList, getAccessLevel, listWorkspaceSlugs } from "@trends/shared";

import { workspaceMiddleware, requireAdmin, denyIfNotAdmin } from "./workspace.js";
import { serverTimingMiddleware } from "./server-timing.js";

function createTestApp() {
  const app = new Hono();
  app.use("*", workspaceMiddleware);
  app.get("/test", (c) => {
    return c.json({
      workspaceSlug: c.var.workspaceSlug,
      accessLevel: c.var.accessLevel,
    });
  });
  return app;
}

function createAdminApp() {
  const app = new Hono();
  app.use("*", workspaceMiddleware);
  app.use("*", requireAdmin);
  app.get("/admin", (c) => {
    return c.json({ ok: true, workspaceSlug: c.var.workspaceSlug });
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
    const body = await res.json();
    expect(body.workspaceSlug).toBe("dev");
    expect(body.accessLevel).toBe("user");
  });

  it("uses workspace from X-Workspace-Slug header", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceSlug).toBe("hr");
  });

  it("uses workspace from workspaceSlug query param when header is absent", async () => {
    const app = createTestApp();
    const res = await app.request("/test?workspaceSlug=hr");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceSlug).toBe("hr");
  });

  it("prefers header over query param", async () => {
    const app = createTestApp();
    const res = await app.request("/test?workspaceSlug=hr", {
      headers: { "X-Workspace-Slug": "dev" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceSlug).toBe("dev");
  });

  it("trims whitespace from header value", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "  hr  " },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceSlug).toBe("hr");
  });

  it("trims whitespace from query param", async () => {
    const app = createTestApp();
    const res = await app.request("/test?workspaceSlug=%20hr%20");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceSlug).toBe("hr");
  });

  it("rejects invalid workspace slug", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "invalid-workspace" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid workspace slug");
    expect(body.error).toContain(`Allowed: ${formatWorkspaceSlugList()}`);
  });

  it.each(listWorkspaceSlugs())("accepts registered workspace %s with its shared access level", async (slug) => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": slug },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceSlug).toBe(slug);
    expect(body.accessLevel).toBe(getAccessLevel(slug));
  });
});

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe("requireAdmin", () => {
  it("rejects the admin namespace before admin access is evaluated", async () => {
    const app = createAdminApp();
    const res = await app.request("/admin", {
      headers: { "X-Workspace-Slug": "admin" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid workspace slug");
  });

  it("rejects dev workspace because it is not the admin workspace", async () => {
    const app = createAdminApp();
    const res = await app.request("/admin", {
      headers: { "X-Workspace-Slug": "dev" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Admin access required");
  });

  it("rejects non-admin workspace (hr)", async () => {
    const app = createAdminApp();
    const res = await app.request("/admin", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Admin access required");
  });

  it("rejects request without workspace middleware (undefined accessLevel)", async () => {
    const app = createAdminApp();
    const res = await app.request("/admin");
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// denyIfNotAdmin
// ---------------------------------------------------------------------------

describe("denyIfNotAdmin", () => {
  it("returns false for admin access level", () => {
    expect(denyIfNotAdmin("admin")).toBe(false);
  });

  it("returns true for user access level", () => {
    expect(denyIfNotAdmin("user")).toBe(true);
  });

  it("returns true for undefined access level", () => {
    expect(denyIfNotAdmin(undefined)).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(denyIfNotAdmin("")).toBe(true);
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
});
