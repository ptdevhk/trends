import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import { rateLimit } from "../rate-limit";
import { serverTimingMiddleware } from "../server-timing";
import { requireAdmin, workspaceMiddleware } from "../workspace";

function createTestApp() {
  return new OpenAPIHono();
}

describe("workspaceMiddleware", () => {
  it("defaults to dev workspace when no header or query is provided", async () => {
    const app = createTestApp();
    app.use("*", workspaceMiddleware);
    app.get("/test", (c) => c.json({ slug: c.var.workspaceSlug, level: c.var.accessLevel }));

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("dev");
    expect(body.level).toBe("user");
  });

  it("uses X-Workspace-Slug header when provided", async () => {
    const app = createTestApp();
    app.use("*", workspaceMiddleware);
    app.get("/test", (c) => c.json({ slug: c.var.workspaceSlug, level: c.var.accessLevel }));

    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("hr");
    expect(body.level).toBe("user");
  });

  it("falls back to workspaceSlug query parameter when header is missing", async () => {
    const app = createTestApp();
    app.use("*", workspaceMiddleware);
    app.get("/test", (c) => c.json({ slug: c.var.workspaceSlug }));

    const res = await app.request("/test?workspaceSlug=hr");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("hr");
  });

  it("prioritizes header over query parameter", async () => {
    const app = createTestApp();
    app.use("*", workspaceMiddleware);
    app.get("/test", (c) => c.json({ slug: c.var.workspaceSlug }));

    const res = await app.request("/test?workspaceSlug=hr", {
      headers: { "X-Workspace-Slug": "dev" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("dev");
  });

  it("rejects invalid workspace slugs with 400", async () => {
    const app = createTestApp();
    app.use("*", workspaceMiddleware);
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "invalid-workspace" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid workspace slug");
  });
});

describe("requireAdmin", () => {
  it("allows admin workspaces through", async () => {
    const app = createTestApp();
    app.use("*", workspaceMiddleware);
    app.use("*", requireAdmin);
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "admin" },
    });
    expect(res.status).toBe(200);
  });

  it("blocks dev workspace with 403", async () => {
    const app = createTestApp();
    app.use("*", workspaceMiddleware);
    app.use("*", requireAdmin);
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "dev" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Admin access required");
  });

  it("blocks non-admin workspaces with 403", async () => {
    const app = createTestApp();
    app.use("*", workspaceMiddleware);
    app.use("*", requireAdmin);
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Admin access required");
  });
});

describe("rateLimit", () => {
  it("allows requests within the limit", async () => {
    const app = createTestApp();
    app.use("*", rateLimit({ limit: 5, windowMs: 60_000 }));
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
  });

  it("blocks requests that exceed the limit with 429", async () => {
    const app = createTestApp();
    const limiter = rateLimit({ limit: 2, windowMs: 60_000, keyExtractor: () => "test-key" });
    app.use("*", limiter);
    app.get("/test", (c) => c.text("ok"));

    // First 2 requests should succeed
    await app.request("/test");
    await app.request("/test");

    // Third should be blocked
    const res = await app.request("/test");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("Too many requests");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("sets rate limit headers on every response", async () => {
    const app = createTestApp();
    app.use("*", rateLimit({ limit: 10, windowMs: 60_000 }));
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("uses custom key extractor when provided", async () => {
    const app = createTestApp();
    app.use("*", rateLimit({
      limit: 1,
      windowMs: 60_000,
      keyExtractor: (c) => c.req.header("X-API-Key") ?? "anonymous",
    }));
    app.get("/test", (c) => c.text("ok"));

    // Request with key A
    const res1 = await app.request("/test", { headers: { "X-API-Key": "key-a" } });
    expect(res1.status).toBe(200);

    // Request with key B (different bucket)
    const res2 = await app.request("/test", { headers: { "X-API-Key": "key-b" } });
    expect(res2.status).toBe(200);

    // Second request with key A should be blocked
    const res3 = await app.request("/test", { headers: { "X-API-Key": "key-a" } });
    expect(res3.status).toBe(429);
  });
});

describe("serverTimingMiddleware", () => {
  it("adds Server-Timing header to responses", async () => {
    const app = createTestApp();
    app.use("*", serverTimingMiddleware);
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const timing = res.headers.get("Server-Timing");
    expect(timing).toBeTruthy();
    expect(timing).toMatch(/^total;dur=\d+$/);
  });
});
