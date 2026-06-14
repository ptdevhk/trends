import type { MiddlewareHandler } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Maximum requests per window. Default: 100 */
  limit?: number;
  /** Window duration in milliseconds. Default: 60_000 (1 minute) */
  windowMs?: number;
  /** Extract client key from the request. Default: IP from X-Forwarded-For or 'unknown' */
  keyExtractor?: (c: { req: { header: (name: string) => string | undefined } }) => string;
}

/**
 * Extract the client IP from request headers.
 *
 * Reads `X-Forwarded-For` (first hop) then falls back to `X-Real-Ip`, then
 * `"unknown"`. Trusts the headers as-is — the deployment MUST sit behind a
 * trusted proxy that overwrites `X-Forwarded-For` for this to be meaningful.
 */
export function extractClientIp(headers: { header: (name: string) => string | undefined }): string {
  const forwarded = headers.header("X-Forwarded-For");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return headers.header("X-Real-Ip") ?? "unknown";
}

const DEFAULT_OPTIONS: Required<RateLimitOptions> = {
  limit: 100,
  windowMs: 60_000,
  keyExtractor: (c) => extractClientIp(c.req),
};

/**
 * In-memory sliding-window rate limiter for Hono.
 * No external dependencies — suitable for single-instance deployments.
 */
export function rateLimit(options?: RateLimitOptions): MiddlewareHandler {
  const limit = options?.limit ?? DEFAULT_OPTIONS.limit;
  const windowMs = options?.windowMs ?? DEFAULT_OPTIONS.windowMs;
  const keyExtractor = options?.keyExtractor ?? DEFAULT_OPTIONS.keyExtractor;

  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup of expired entries (every 60s)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, 60_000);

  // Allow the interval to not keep the process alive in tests
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return async (c, next) => {
    const key = keyExtractor(c);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, limit - entry.count);
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > limit) {
      c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json(
        { success: false as const, error: "Too many requests" },
        429,
      );
    }

    await next();
  };
}
