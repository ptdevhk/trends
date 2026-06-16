/**
 * Shared test utilities for apps/api route/service tests.
 *
 * `parseJsonBody` centralizes the single audited cast over `Response.json()`,
 * which returns `unknown` under `@types/node` (undici) types. Route tests read
 * their own mocked JSON responses; rather than sprinkle `as any` (which would
 * defeat the test-file typecheck gate — see the Q3 phantom-filter blind spot),
 * the caller declares the expected response shape via `T`.
 *
 * Default `T` is `Record<string, unknown>` — the honest type for an untyped
 * JSON object — which suffices for tests that read only top-level fields
 * (e.g. `payload.success`, or pass `payload` whole to `expect()`). Tests that
 * read NESTED fields (e.g. `payload.summary.statusCounts`) must pass an
 * explicit `T` declaring those nested shapes; `any` is forbidden.
 */
export async function parseJsonBody<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
