import type { MiddlewareHandler } from "hono";

/**
 * Adds `Server-Timing` response header with total request duration.
 * Browser DevTools shows this in the Network tab Timing section.
 */
export const serverTimingMiddleware: MiddlewareHandler = async (c, next) => {
    const start = performance.now();
    await next();
    const dur = Math.round(performance.now() - start);
    c.header("Server-Timing", `total;dur=${dur}`);
};
