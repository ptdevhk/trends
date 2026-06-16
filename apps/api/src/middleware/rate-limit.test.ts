import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseJsonBody } from "../test-utils";
import { rateLimit } from "./rate-limit.js";

function createRateLimitedApp(limit: number = 5, windowMs: number = 10_000) {
  const app = new Hono();
  app.use("*", rateLimit({ limit, windowMs }));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// rateLimit middleware
// ---------------------------------------------------------------------------

describe("rateLimit middleware", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", async () => {
    const app = createRateLimitedApp(5);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("blocks requests over the limit with 429", async () => {
    const app = createRateLimitedApp(2);
    await app.request("/test");
    await app.request("/test");
    const res = await app.request("/test");
    expect(res.status).toBe(429);
    const body = await parseJsonBody(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Too many requests");
  });

  it("sets X-RateLimit-Limit header", async () => {
    const app = createRateLimitedApp(10);
    const res = await app.request("/test");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
  });

  it("sets X-RateLimit-Remaining header", async () => {
    const app = createRateLimitedApp(5);
    const res = await app.request("/test");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
  });

  it("decrements remaining on each request", async () => {
    const app = createRateLimitedApp(5);
    await app.request("/test");
    await app.request("/test");
    const res = await app.request("/test");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("2");
  });

  it("sets X-RateLimit-Reset header as unix timestamp", async () => {
    const app = createRateLimitedApp(5);
    const res = await app.request("/test");
    const resetHeader = res.headers.get("X-RateLimit-Reset");
    expect(resetHeader).not.toBeNull();
    const resetTime = parseInt(resetHeader!, 10);
    expect(resetTime).toBeGreaterThan(0);
  });

  it("sets Retry-After header when rate limited", async () => {
    const app = createRateLimitedApp(1);
    await app.request("/test");
    const res = await app.request("/test");
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  it("resets the window after windowMs expires", async () => {
    vi.useFakeTimers({ now: new Date("2024-01-01T00:00:00Z") });
    const app = createRateLimitedApp(1, 5_000);

    const res1 = await app.request("/test");
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test");
    expect(res2.status).toBe(429);

    vi.advanceTimersByTime(6_000);

    const res3 = await app.request("/test");
    expect(res3.status).toBe(200);
  });

  it("uses custom keyExtractor when provided", async () => {
    let extractedKey = "";
    const app = new Hono();
    app.use("*", rateLimit({
      limit: 1,
      windowMs: 10_000,
      keyExtractor: (c) => {
        const key = c.req.header("X-Api-Key") ?? "anonymous";
        extractedKey = key;
        return key;
      },
    }));
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test", {
      headers: { "X-Api-Key": "custom-key-1" },
    });
    expect(extractedKey).toBe("custom-key-1");
  });

  it("tracks different keys independently", async () => {
    const app = new Hono();
    app.use("*", rateLimit({
      limit: 1,
      windowMs: 10_000,
      keyExtractor: (c) => c.req.header("X-Api-Key") ?? "anonymous",
    }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res1 = await app.request("/test", {
      headers: { "X-Api-Key": "key-a" },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", {
      headers: { "X-Api-Key": "key-b" },
    });
    expect(res2.status).toBe(200);

    const res3 = await app.request("/test", {
      headers: { "X-Api-Key": "key-a" },
    });
    expect(res3.status).toBe(429);
  });

  it("defaults to X-Forwarded-For for key extraction", async () => {
    const app = createRateLimitedApp(5);
    const res = await app.request("/test", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });
    expect(res.status).toBe(200);
  });

  it("falls back to X-Real-Ip when X-Forwarded-For is absent", async () => {
    const app = createRateLimitedApp(5);
    const res = await app.request("/test", {
      headers: { "X-Real-Ip": "5.6.7.8" },
    });
    expect(res.status).toBe(200);
  });

  it("clamps remaining to 0 when over limit", async () => {
    const app = createRateLimitedApp(1);
    await app.request("/test");
    const res = await app.request("/test");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});
