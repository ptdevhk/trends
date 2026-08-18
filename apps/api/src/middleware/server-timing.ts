import type { MiddlewareHandler } from "hono";

/**
 * Accumulator for named Server-Timing segments. Route handlers receive it via
 * `c.var.serverTiming` and record segments; the middleware emits them after
 * `next()` alongside the total request duration.
 */
export type ServerTimingAccumulator = {
  add: (name: string, durMs: number) => void;
};

declare module "hono" {
  interface ContextVariableMap {
    serverTiming: ServerTimingAccumulator;
  }
}

/**
 * Adds `Server-Timing` response header with total request duration and any
 * named segments recorded by route handlers via `c.var.serverTiming.add(...)`.
 * Browser DevTools shows this in the Network tab Timing section.
 *
 * Node-only today (see docs/runbooks/server-timing.md for porting caveats).
 */
export const serverTimingMiddleware: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  const named: Array<[string, number]> = [];
  c.set("serverTiming", {
    add: (name, durMs) => {
      named.push([name, Math.round(durMs)]);
    },
  });
  await next();
  const dur = Math.round(performance.now() - start);
  const header = [`total;dur=${dur}`];
  for (const [name, durMs] of named) {
    header.push(`${name};dur=${durMs}`);
  }
  c.header("Server-Timing", header.join(", "));
};
