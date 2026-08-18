# Server-Timing in the Trends BFF (apps/api)

## Pattern

`serverTimingMiddleware` (`apps/api/src/middleware/server-timing.ts`) is
registered for all routes in `createApp` and emits a `Server-Timing` response
header:

```
Server-Timing: total;dur=123, idx-cache;dur=2
```

- `total` is the full middleware-chain duration (all handlers + middleware).
- Named segments are recorded by route handlers via the typed accumulator
  `c.var.serverTiming.add(name, durMs)` and appended in insertion order.

Adding a named metric to a route:

```ts
const start = performance.now();
const result = await someExpensiveCall();
c.var.serverTiming.add("my-segment", performance.now() - start);
```

When the expensive work lives in a service, pass an optional observer instead
of timing at the route:

```ts
await someServiceCall({
  ...input,
  timing: (name, durMs) => c.var.serverTiming.add(name, durMs),
});
```

The service keeps its `timing?: (name: string, durMs: number) => void` param
optional, so non-HTTP callers (scripts, tests) stay unaffected.

## Review-queue `idx-cache` metric

`GET /api/company-industry-proposals/review-queue` reports `idx-cache`, which
covers the advisory review-index segment inside
`listIndustryReviewQueue` (`apps/api/src/services/company-industry-review-service.ts`):
the cache lookup plus, on miss, the full index build (proposals + sources +
profiles + per-proposal recommendation computation). The advisory index cache
has a 15 s TTL (`REVIEW_INDEX_CACHE_TTL_MS`), so:

- cache hit: `idx-cache;dur=0` (or near-0 ms);
- cache miss: `idx-cache;dur` equals the index build cost (tens of ms when
  few proposals, much higher under churn).

This distinguishes cache misses from route latency at a glance in DevTools —
no metrics backend consumes it yet (diagnostic-only).

## Streaming / SSE caveats

The only streaming route is `POST /api/resumes/match-stream`
(`apps/api/src/routes/resumes_match.ts`). It returns a `ReadableStream`
wrapped in `Response`; the matching work (rule + AI batches) runs inside the
stream's `start()` callback, after the handler has returned.

Consequences for timing:

- `total;dur` for SSE routes measures time-to-response-construction, NOT the
  stream duration. Long-running streams do not inflate it, and stream-internal
  work is invisible to the header.
- Named segments recorded after the handler returns (e.g., from inside the
  stream's async callback) are silently dropped: the middleware emits the
  header only after `next()` resolves. Record segments before returning the
  `Response`, or measure stream work explicitly (e.g., a `processing` event
  with timestamps in the SSE payload, which `match-stream` already carries as
  progress/`stats`).

## OpenAPI streaming typing

`match-stream` is typed in the OpenAPI 3.1 document as:

```ts
responses: {
  200: {
    content: {
      "text/event-stream": { schema: z.string() },
    },
  },
}
```

- `z.string()` is the accepted schema shape for SSE media types in
  `@hono/zod-openapi` — do NOT type streaming bodies as `application/json`
  or arrays of JSON events.
- No `streamText`/`streamSSE` (hono/streaming) usage exists in this codebase;
  the manual `ReadableStream` + `text/event-stream` shape is the pattern.
- `apps/api/src/openapi.test.ts` regenerates the document and asserts the
  streaming route keeps `text/event-stream` (and not `application/json`).
  Keep that guard when touching the route.

## Node / Workers porting notes

- The BFF runs on Node (`@hono/node-server`); `performance.now()` is available
  on both Node and Cloudflare Workers, so the middleware itself ports as-is.
- `Server-Timing` is a plain response header — no Worker-specific restriction,
  but proxy/CDN layers may strip it; treat it as diagnostic-only.
- The header is emitted only on the success path: if a handler throws,
  `next()` rejects and no `Server-Timing` header is written (existing
  behavior, unchanged by the named-metrics extension).
- Segment names should match `[a-z0-9-]+` (per the Server-Timing spec) and
  never contain PII or user input.
