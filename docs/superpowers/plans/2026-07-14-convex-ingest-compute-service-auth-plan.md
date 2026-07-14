# Convex Ingest Compute Service Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the secret-paired Convex ingest worker to invoke the protected local BFF ingest-compute endpoint without creating an anonymous access path.

**Architecture:** Keep the existing browser/admin authorization path intact. Add a route-specific service-auth alternative that accepts only a non-empty, constant-time match of the already-paired `CONVEX_WRITE_SECRET` carried in `X-Convex-Write-Secret`; the Convex worker sends that header only when its runtime secret is configured. Missing or incorrect service credentials still fall through to the existing admin gate and receive the same denial as before.

**Tech Stack:** TypeScript, Hono/OpenAPI middleware, Convex actions, Vitest, Bun.

## Global Constraints

- Local-only UAT; do not deploy, push, tag, release, SSH to production, or mutate production data.
- Do not read, source, print, or persist the repository-root `.env`.
- Preserve strict `CONVEX_WRITE_SECRET` enforcement; no anonymous or localhost-only bypass.
- Keep the existing admin-session route behavior and CSRF policy intact.
- Use `node --import tsx` only for disposable local auth/operator operations; this implementation uses no credentials or runtime secret values in files or command arguments.

---

### Task 1: Lock the service-authorization contract with failing tests

**Files:**
- Modify: `apps/api/src/routes/resumes_admin.test.ts`
- Modify: `packages/convex/__tests__/ingest-agent.test.ts`

**Interfaces:**
- Consumes: `POST /api/resumes/ingest-compute`, current `requireAdmin` behavior, and `processNewResumes`'s BFF `fetch` call.
- Produces: regression tests for valid/missing/wrong service credentials and worker header propagation.

- [ ] **Step 1: Add API route tests for the service credential boundary**

Add tests under `describe("POST /api/resumes/ingest-compute")` that construct an app with a fresh `AuthStorage` and send no browser cookie. Set `config.auth.convexWriteSecret` to a test-only non-empty value for the test and restore it in `afterEach`.

```ts
it("rejects an unauthenticated ingest compute request without the worker secret", async () => {
  const app = createTestApp(new AuthStorage(mkdtempSync(path.join(tmpdir(), "ingest-compute-auth-"))));
  const response = await app.request("/api/resumes/ingest-compute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumes: [{ resumeId: "r1", content: {} }] }),
  });
  expect(response.status).toBe(401);
});

it("accepts the exact Convex worker secret without a browser session", async () => {
  config.auth.convexWriteSecret = "ingest-compute-test-secret";
  const app = createTestApp(new AuthStorage(mkdtempSync(path.join(tmpdir(), "ingest-compute-secret-"))));
  const response = await app.request("/api/resumes/ingest-compute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Convex-Write-Secret": "ingest-compute-test-secret",
    },
    body: JSON.stringify({ resumes: [{ resumeId: "r1", content: {} }] }),
  });
  expect(response.status).toBe(200);
});

it("rejects a wrong worker secret without a browser session", async () => {
  config.auth.convexWriteSecret = "ingest-compute-test-secret";
  const app = createTestApp(new AuthStorage(mkdtempSync(path.join(tmpdir(), "ingest-compute-wrong-secret-"))));
  const response = await app.request("/api/resumes/ingest-compute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Convex-Write-Secret": "wrong-secret",
    },
    body: JSON.stringify({ resumes: [{ resumeId: "r1", content: {} }] }),
  });
  expect(response.status).toBe(401);
});
```

- [ ] **Step 2: Add a Convex worker header-propagation test**

Stub only the worker runtime secret and a successful BFF response, then assert the outbound request includes the exact test value. The test must not assert or log a real secret.

```ts
it("sends the configured Convex write secret to the BFF compute endpoint", async () => {
  vi.stubEnv("CONVEX_WRITE_SECRET", "worker-test-secret");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
    success: true,
    results: [{ resumeId: "r1", market: "CN", evidenceText: "", industryTags: [], synonymHits: [], ruleScores: {}, experienceLevel: "unknown", computedAt: 1, skillsVersion: 1 }],
  }));
  await processNewResumesHandler(successContext as never, { resumeIds: ["r1"] });
  expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    headers: expect.objectContaining({ "X-Convex-Write-Secret": "worker-test-secret" }),
  }));
  vi.unstubAllEnvs();
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
bunx vitest run apps/api/src/routes/resumes_admin.test.ts packages/convex/__tests__/ingest-agent.test.ts
```

Expected: the new API tests fail with `401` for the supposed valid service credential, and the new Convex test fails because the worker request has no `X-Convex-Write-Secret` header.

### Task 2: Add the narrow service-auth boundary and worker propagation

**Files:**
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/routes/resumes_admin.ts`
- Modify: `packages/convex/convex/ingest_agent.ts`

**Interfaces:**
- Consumes: `config.auth.convexWriteSecret`, `requireAdmin`, and Node `timingSafeEqual`.
- Produces: `requireAdminOrConvexWorker` route middleware and worker requests authenticated by `X-Convex-Write-Secret`.

- [ ] **Step 1: Add a route-specific worker-or-admin middleware**

In `apps/api/src/middleware/auth.ts`, define the header name and a constant-time comparison helper. The middleware must allow only a configured non-empty exact secret match; otherwise it invokes `requireAdmin` unchanged.

```ts
import { timingSafeEqual } from "node:crypto";

export const CONVEX_WRITE_SECRET_HEADER = "X-Convex-Write-Secret";

function matchesConfiguredConvexWriteSecret(value: string | undefined): boolean {
  const expected = config.auth.convexWriteSecret;
  if (!expected || !value) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(value);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export const requireAdminOrConvexWorker: MiddlewareHandler = async (c, next) => {
  if (matchesConfiguredConvexWriteSecret(c.req.header(CONVEX_WRITE_SECRET_HEADER))) {
    await next();
    return;
  }
  await requireAdmin(c, next);
};
```

- [ ] **Step 2: Use that middleware only on the ingest-compute route**

Replace the route middleware declaration without changing its request schema, handler, or ordinary admin behavior.

```ts
middleware: [requireAdminOrConvexWorker] as const,
```

- [ ] **Step 3: Send the worker credential only when configured**

In `processNewResumes`, build headers explicitly so an absent secret is never serialized as the string `"undefined"`.

```ts
const headers: Record<string, string> = { "Content-Type": "application/json" };
const writeSecret = process.env.CONVEX_WRITE_SECRET?.trim();
if (writeSecret) headers["X-Convex-Write-Secret"] = writeSecret;

const response = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
bunx vitest run apps/api/src/routes/resumes_admin.test.ts packages/convex/__tests__/ingest-agent.test.ts
```

Expected: all focused API and Convex tests pass, including valid worker-secret access and missing/wrong-secret rejection.

### Task 3: Verify the scope and resume the local exact audit

**Files:**
- Verify only: `apps/api/src/middleware/auth.ts`, `apps/api/src/routes/resumes_admin.ts`, `packages/convex/convex/ingest_agent.ts`, and their focused tests.

**Interfaces:**
- Consumes: green focused tests and the already-approved 34-target manifest.
- Produces: verified local-only exact re-ingest evidence, ready for exact analysis.

- [ ] **Step 1: Run type and policy checks**

Run:

```bash
bun --filter @trends/api typecheck
bun --filter @trends/api typecheck:tests
bun --filter @trends/convex typecheck
make check-route-auth
git diff --check
```

Expected: every command exits zero; no route other than ingest-compute has a changed authorization path.

- [ ] **Step 2: Review the scoped diff for secret safety**

Verify manually that no secret is persisted, logged, returned to clients, inserted in an OpenAPI schema, or added to an unauthenticated broad route.

- [ ] **Step 3: Re-run the exact local re-ingest through the isolated disposable-auth lane**

Use a clean child environment, `node --import tsx scripts/auth/manage-user.ts --no-load-project-env`, paired `TRENDS_AUTH_USERNAME`/`TRENDS_AUTH_PASSWORD`, `http://localhost:3000`, workspace `dev`, and the approved manifest. Require `requested=34`, `resolved=34`, `scheduled=34`, `ready=34`, `pending=0`, and `invalid=0` before analysis.

- [ ] **Step 4: Commit the scoped repair after review**

```bash
git add \
  docs/superpowers/plans/2026-07-14-convex-ingest-compute-service-auth-plan.md \
  apps/api/src/middleware/auth.ts \
  apps/api/src/routes/resumes_admin.ts \
  apps/api/src/routes/resumes_admin.test.ts \
  packages/convex/convex/ingest_agent.ts \
  packages/convex/__tests__/ingest-agent.test.ts
git commit -m "fix(ingest): authenticate Convex compute requests"
```

Expected: a local-only commit on `codex/uat-recommendations`; do not push or deploy.

## Plan Self-Review

- **Spec coverage:** Tests prove denial of missing/wrong secrets, acceptance of the configured secret, worker propagation, and retained admin behavior; implementation changes only the worker-to-BFF boundary; verification resumes the exact audit only after the authorization contract is green.
- **Placeholder scan:** No TODO/TBD items or unspecified tests remain.
- **Type consistency:** The sole new public middleware symbol is `requireAdminOrConvexWorker`; the sole wire header is `X-Convex-Write-Secret` in both worker and BFF middleware.
