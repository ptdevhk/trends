import { describe, expect, it, vi, afterEach } from "vitest";

import { rateLimit } from "../rate-limit.js";
import type { RateLimitOptions } from "../rate-limit.js";

import { OpenAPIHono } from "@hono/zod-openapi";

function createTestApp(options?: RateLimitOptions) {
  const app = new OpenAPIHono();
  app.use(rateLimit(options));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows requests under the limit", async () => {
    const app = createTestApp({ limit: 5, windowMs: 60_000 });

    const res = await app.request("/test", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });

    expect(res.status).toBe(200);
  });

  it("blocks requests over the limit", async () => {
    const app = createTestApp({ limit: 2, windowMs: 60_000 });

    // Make 2 allowed requests
    await app.request("/test", { headers: { "X-Forwarded-For": "1.2.3.4" } });
    await app.request("/test", { headers: { "X-Forwarded-For": "1.2.3.4" } });

    // 3rd should be rate limited
    const res = await app.request("/test", { headers: { "X-Forwarded-For": "1.2.3.4" } });

    expect(res.status).toBe(429);
  });

  it("tracks limits per client key independently", async () => {
    const app = createTestApp({ limit: 1, windowMs: 60_000 });

    // First client
    const res1 = await app.request("/test", { headers: { "X-Forwarded-For": "1.2.3.4" } });
    expect(res1.status).toBe(200);

    // Second client
    const res2 = await app.request("/test", { headers: { "X-Forwarded-For": "5.6.7.8" } });
    expect(res2.status).toBe(200);
  });

  it("uses custom key extractor", async () => {
    const app = createTestApp({
      limit: 1,
      windowMs: 60_000,
      keyExtractor: (c) => c.req.header("X-Api-Key") ?? "anonymous",
    });

    // Request with key1
    const res1 = await app.request("/test", { headers: { "X-Api-Key": "key1" } });
    expect(res1.status).toBe(200);

    // Request with key1 again should be rate limited
    const res2 = await app.request("/test", { headers: { "X-Api-Key": "key1" } });
    expect(res2.status).toBe(429);

    // Request with different key should pass
    const res3 = await app.request("/test", { headers: { "X-Api-Key": "key2" } });
    expect(res3.status).toBe(200);
  });

  it("includes rate limit headers in response", async () => {
    const app = createTestApp({ limit: 5, windowMs: 60_000 });

    const res = await app.request("/test", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });

    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res.headers.get("X-RateLimit-Remaining")).not.toBeNull();
  });

  it("returns 429 with Retry-After header when rate limited", async () => {
    const app = createTestApp({ limit: 1, windowMs: 60_000 });

    await app.request("/test", { headers: { "X-Forwarded-For": "1.2.3.4" } });
    const res = await app.request("/test", { headers: { "X-Forwarded-For": "1.2.3.4" } });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
  })
})
