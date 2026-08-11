# Industry Reviewer Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third workspace role `reviewer` with full industry-verification review rights (proposals, evidence sources, verdict revisions, identity resolution) while ops surfaces (recompute, link-backfill, maintenance, coverage) stay admin-only.

**Architecture:** Extend the existing role/permission model (`WorkspaceRole` gains `"reviewer"`; `WorkspacePermission` gains `"industry:review"`), add a `requireIndustryReviewer` middleware (admin-or-reviewer), split the `companies.ts` (and related) route gates per the spec, mirror in the web gate, record acting role in audit writes, and exercise via role-change only (no demo seat).

**Tech Stack:** TypeScript (Hono API, Convex schema, React web), vitest, bash (`manage-user.ts` via tsx), existing `scripts/route-auth-policy.json` + `check-route-auth.sh` CI gate.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-industry-reviewer-role-design.md` (grilled Q1–Q7).
- Reviewer inherits `MEMBER_PERMISSIONS` + `industry:review`; **no admin powers** outside industry review surfaces. Admin remains strict superset (member + industry review + ops + admin).
- Roles are per-workspace memberships; a user can be `reviewer` in `hr` and `user` in `dev`.
- **No demo seat** — role-change only: `manage-user.ts --role reviewer` on existing accounts; preview/prod assignment documented, not scripted.
- Same one-click approval policy for reviewer and admin (approval-safe gating unchanged).
- `scripts/check-route-auth.sh` (CI) must stay green.
- Verified-employer-count endpoint stays `requireWorkspaceUser` (already shipped, `8506acb7`); bundles + refresh-requests stay `requireWorkspaceUser`.
- Existing deploy shell suites must stay green (they exercise auth as hr-demo admin).
- Branch: `preview-v0.4.23`, base `b077b49c`.

---

## File Map

| File | Responsibility |
|---|---|
| `apps/api/src/services/auth-types.ts` | `WorkspaceRole` gains `"reviewer"` |
| `apps/api/src/services/workspace-permissions.ts` | `"industry:review"` permission; REVIEWER permission set; `hasWorkspacePermission` reviewer branch |
| `apps/api/src/middleware/auth.ts` | `requireIndustryReviewer` (admin-or-reviewer) |
| `apps/api/src/routes/companies.ts` | Gate split per Q3 (review routes → reviewer; ops routes → admin) |
| `apps/api/src/routes/industry.ts`, `apps/api/src/routes/industry-data-admin.ts` | Same gate split (inspect: review-facing → reviewer, ops-facing → admin) |
| `apps/api/src/services/workspace-permissions.test.ts`, `apps/api/src/routes/companies.test.ts` (+ industry tests) | Role matrices |
| `scripts/auth/manage-user.ts` (+ `scripts/auth/manage-user.test.ts`) | `--role reviewer` |
| `apps/web/src/lib/workspace-access.ts` (+ tests) | `hasWorkspaceIndustryReviewAccess` (admin-or-reviewer) |
| `apps/web/src/App.tsx` | `WorkspaceIndustryAccessGate` accepts reviewer; ops tabs admin-only |
| Audit write sites (API → Convex mutations; schema `company_industry_verdict_revisions`, `industry_identity_resolution_audits`, proposal actions) | Record acting role |
| `docs/agent-runbook.md` | Operator note: assign reviewer via manage-user |

---

### Task 1: Role model + permission core

**Files:**
- Modify: `apps/api/src/services/auth-types.ts:2`, `apps/api/src/services/workspace-permissions.ts`, `scripts/auth/manage-user.ts`
- Test: `apps/api/src/services/workspace-permissions.test.ts`, `scripts/auth/manage-user.test.ts`

**Interfaces:**
- Produces: `WorkspaceRole = "user" | "reviewer" | "admin"`; `WorkspacePermission` includes `"industry:review"`; `hasWorkspacePermission` grants `industry:review` to reviewer and admin (not user); reviewer gets all MEMBER_PERMISSIONS; manage-user accepts `--role reviewer`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/services/workspace-permissions.test.ts` add:

```ts
describe("reviewer role", () => {
  it("grants industry:review to reviewer", () => {
    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "hr", role: "reviewer" }),
      workspaceSlug: "hr", permission: "industry:review",
    })).toBe(true);
  });
  it("grants industry:review to admin", () => {
    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "hr", role: "admin" }),
      workspaceSlug: "hr", permission: "industry:review",
    })).toBe(true);
  });
  it("denies industry:review to user", () => {
    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "hr", role: "user" }),
      workspaceSlug: "hr", permission: "industry:review",
    })).toBe(false);
  });
  it("reviewer inherits member permissions", () => {
    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "hr", role: "reviewer" }),
      workspaceSlug: "hr", permission: "candidate:mutate",
    })).toBe(true);
  });
  it("reviewer is not workspace:admin", () => {
    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "hr", role: "reviewer" }),
      workspaceSlug: "hr", permission: "workspace:admin",
    })).toBe(false);
  });
});
```

In `scripts/auth/manage-user.test.ts` add: `--role reviewer` parses and validates (mirror the existing user/admin cases; check the file's current harness for how it invokes/asserts).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/services/workspace-permissions.test.ts scripts/auth/manage-user.test.ts`
Expected: FAIL — `createAuthContext` may need a `role: "reviewer"` case (if its type rejects the literal, update the helper's type — the helper lives in `apps/api/src/routes/test-auth-helpers.ts`; extend its `role` param type), permission union lacks `industry:review`, manage-user rejects the flag.

- [ ] **Step 3: Implement**

`apps/api/src/services/auth-types.ts:2`:
```ts
export type WorkspaceRole = "user" | "reviewer" | "admin";
```

`apps/api/src/services/workspace-permissions.ts`:
- add `| "industry:review"` to the `WorkspacePermission` union;
- add `const REVIEWER_PERMISSIONS: ReadonlySet<WorkspacePermission> = new Set([...MEMBER_PERMISSIONS, "industry:review"]);`
- in `hasWorkspacePermission`, add before the admin branch:
```ts
if (hasWorkspaceRole(auth.memberships, workspaceSlug, ["reviewer"])) {
  return REVIEWER_PERMISSIONS.has(input.permission);
}
```

`scripts/auth/manage-user.ts`: role type `"user" | "reviewer" | "admin"` (line 28), parse default stays `"user"`, validation list (line 255) → `["user", "reviewer", "admin"]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/services/workspace-permissions.test.ts scripts/auth/manage-user.test.ts`
Expected: PASS. Then `npx tsc --noEmit` in `apps/api` and `scripts` context (repo root typecheck: `bun run check:typecheck` if affordable — at minimum api tsc).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/auth-types.ts apps/api/src/services/workspace-permissions.ts apps/api/src/services/workspace-permissions.test.ts apps/api/src/routes/test-auth-helpers.ts scripts/auth/manage-user.ts scripts/auth/manage-user.test.ts
git commit -m "feat(auth): reviewer workspace role with industry:review permission"
```

---

### Task 2: API route gate split

**Files:**
- Modify: `apps/api/src/middleware/auth.ts`, `apps/api/src/routes/companies.ts`, `apps/api/src/routes/industry.ts`, `apps/api/src/routes/industry-data-admin.ts`
- Test: `apps/api/src/routes/companies.test.ts` (+ `industry.test.ts` / `industry-data-admin.test.ts` as needed)

**Interfaces:**
- Consumes: Task 1 (`industry:review`, `reviewer` role).
- Produces: `requireIndustryReviewer` middleware export (admin-or-reviewer in the active workspace, 403 otherwise, mirroring `requireAdmin`'s error/audit shape). Route split: review routes → `requireIndustryReviewer`; ops routes → `requireAdmin` unchanged.

- [ ] **Step 1: Write the failing test**

In `apps/api/src/routes/companies.test.ts` add a role matrix (mirror the existing verified-employer-count matrix style from `8506acb7`):
- reviewer on `/api/company-industry-proposals` (or a review route that exists in tests) → 200
- reviewer on a review mutation route (e.g., the one-click approve or identity-resolution route) → 200/expected
- reviewer on an ops route (`/api/company-industry-recompute-runs` or `/api/company-industry-maintenance-runs`) → 403
- user on a review route → 403
- admin on ops route → 200 (unchanged)
Use whatever seeded fixtures the file already has for these routes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/routes/companies.test.ts`
Expected: FAIL — reviewer gets 403 on review routes (no reviewer-aware middleware).

- [ ] **Step 3: Implement**

`apps/api/src/middleware/auth.ts` — add (mirror `requireAdmin`'s structure; reuse `getAdminAccessError`-style or a new `getIndustryReviewAccessError`; simplest: new middleware that checks `hasWorkspaceRole(memberships, workspaceSlug, ["admin","reviewer"])` and returns 403 with `admin_access_denied` audit event otherwise):

```ts
const requireIndustryReviewer: MiddlewareHandler = async (c, next) => {
  const auth = c.var.auth;
  const workspaceSlug = c.var.workspaceSlug;
  if (auth && hasWorkspaceRole(auth.memberships, workspaceSlug, ["admin", "reviewer"])) {
    await next();
    return;
  }
  // 401 when unauthenticated, 403 otherwise (mirror requireAdmin shape incl. audit event)
};
export const requireIndustryReviewer = defaultAuthMiddleware.requireIndustryReviewer;
```
(Import `hasWorkspaceRole` from `./services/auth-types.js` — verify it's exported there or via auth-types barrel.)

`apps/api/src/routes/companies.ts` — re-gate per spec Q3:
- `requireIndustryReviewer`: `/api/company-industry-proposals`, `/api/company-industry-evidence-sources`, `/api/company-industry-revisions/*` (review workflow)
- keep `requireAdmin`: `/api/company-industry-recompute-runs`, `/api/company-industry-link-backfill`, `/api/company-industry-maintenance-runs`, `/api/company-industry-coverage`
- unchanged: `/api/company-industry-verified-employer-count` (requireWorkspaceUser), `/api/company-industry-bundles/*`, `/api/company-industry-refresh-requests` (requireWorkspaceUser)
- the identity-resolution route (`/api/company-industry-proposals/:proposalId/identity-resolution`) is under the proposals prefix → reviewer.

`apps/api/src/routes/industry.ts` and `industry-data-admin.ts` — inspect their gates; classify each route by spec Q3 (review-facing → requireIndustryReviewer, ops-facing → requireAdmin) and re-gate; add reviewer cases to their tests if they have matrices.

Verify `scripts/check-route-auth.sh` still passes: `bash scripts/check-route-auth.sh` (run from repo root; if it fails, update `scripts/route-auth-policy.json` class/reason for the touched files to match the new reality and document why).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/routes/companies.test.ts apps/api/src/routes/industry.test.ts apps/api/src/routes/industry-data-admin.test.ts` and `bash scripts/check-route-auth.sh` and `bash scripts/check-route-auth.test.sh` (if present).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/routes/companies.ts apps/api/src/routes/industry.ts apps/api/src/routes/industry-data-admin.ts apps/api/src/routes/companies.test.ts scripts/route-auth-policy.json
git commit -m "feat(auth): industry review routes for reviewer role; ops stay admin"
```

---

### Task 3: Web gate split

**Files:**
- Modify: `apps/web/src/lib/workspace-access.ts` (+ test file if present), `apps/web/src/App.tsx`
- Test: existing web gate tests (e.g., `apps/web/src/lib/workspace-access.test.ts`, App-level tests)

**Interfaces:**
- Consumes: Task 2's role semantics.
- Produces: `hasWorkspaceIndustryReviewAccess(memberships, workspaceSlug)` = admin OR reviewer in that workspace; `WorkspaceIndustryAccessGate` uses it; ops tabs (maintenance runs, coverage, recompute) render only for admin (`hasWorkspaceAdminAccess` unchanged).

- [ ] **Step 1: Write the failing test**

In `apps/web/src/lib/workspace-access.test.ts` (or create if missing, mirroring existing tests):
- reviewer membership in hr → `hasWorkspaceIndustryReviewAccess` true
- admin → true; user → false; empty memberships → false.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @trends/web run test -- src/lib/workspace-access.test.ts` (check the web test invocation in package.json).
Expected: FAIL (helper missing).

- [ ] **Step 3: Implement**

`apps/web/src/lib/workspace-access.ts`: add `hasWorkspaceIndustryReviewAccess` (role in `["admin","reviewer"]` for the workspace) — mirror `hasWorkspaceAdminAccess`'s shape.

`apps/web/src/App.tsx:372` `WorkspaceIndustryAccessGate`: replace `hasWorkspaceAdminAccess` check with `hasWorkspaceIndustryReviewAccess`; update the denial copy ("Industry review requires a {workspace} workspace admin or reviewer account"). Ops sub-routes (maintenance/coverage/recompute) inside the industry settings area: keep their admin check via `hasWorkspaceAdminAccess` (inspect the current route elements around App.tsx:648-666 and add the admin-only guard for ops tabs; reviewers see the review tabs only).

- [ ] **Step 4: Run tests to verify they pass**

Run: web workspace-access tests + the App/route tests that cover the industry gate; then `npx tsc -b` in `apps/web`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workspace-access.ts apps/web/src/lib/workspace-access.test.ts apps/web/src/App.tsx
git commit -m "feat(web): industry review surfaces for reviewer role; ops tabs admin-only"
```

---

### Task 4: Audit records acting role

**Files:**
- Modify: audit write sites — the API routes/services that create verdict revisions, identity-resolution audits, and proposal actions (likely in `apps/api/src/routes/companies.ts` + its services, calling Convex mutations with `updatedBy`); Convex schema/types for `company_industry_verdict_revisions` (schema:1137) and `industry_identity_resolution_audits` (schema:1073) if a role field is absent
- Test: `apps/api/src/routes/companies.test.ts` (assert the mutation payload / stored audit includes the acting role)

**Interfaces:**
- Consumes: Task 1/2 (role known at API layer from membership).
- Produces: every industry review audit write carries `updatedByRole: "admin" | "reviewer"` (or the audit table's equivalent field), sourced from the acting user's membership in the active workspace (never from client input).

- [ ] **Step 1: Inspect + write failing test**

First inspect: where do verdict revisions / identity audits / proposal actions get written (grep `updatedBy`, `industry_identity_resolution_audits`, `verdict` in `apps/api/src/routes/companies.ts` and `apps/api/src/services/`), and the schema fields for both audit tables. Then add a test asserting the acting role is recorded (e.g., approve a proposal as a reviewer in the test harness and assert the revision/audit doc contains role "reviewer").

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL (role absent or not passed).

- [ ] **Step 3: Implement**

Add `updatedByRole` (name per existing field conventions) to the audit write path: API route resolves the role from `auth.memberships` for the active workspace, passes it through to the Convex mutation args (mutations already receive `updatedBy`; add the role alongside). If the Convex schema table lacks the column, add it (schema + any typegen) — note the Convex local backend schema push happens on dev restart; tests that need the column must run against the dev backend after `bun run dev` restart or use mocked mutations per existing test patterns.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/routes/companies.test.ts` (+ affected service tests).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/companies.ts apps/api/src/services/ packages/convex/convex/schema.ts packages/convex/__tests__/ apps/api/src/routes/companies.test.ts
git commit -m "feat(audit): record acting role on industry review writes"
```

---

### Task 5: Docs, runbook, full sweep

**Files:**
- Modify: `docs/agent-runbook.md`, possibly `docs/backup-restore-architecture.md` (no) — runbook only
- Test: extend `deploy/dev-sync-from-preview.test.sh` if useful (no — reviewer is role-change only); instead run the full local test sweep

- [ ] **Step 1: Runbook note**

In `docs/agent-runbook.md`, add under auth/seeding gotchas:

```markdown
- Industry review roles: workspace role `reviewer` grants the industry-verification
  review workflow (proposals, evidence sources, verdict revisions, identity
  resolution) without admin powers; ops surfaces (recompute, link-backfill,
  maintenance, coverage) stay admin-only. Assign with
  `npm run auth:manage -- --username <u> --workspace hr --role reviewer ...`
  (or `tsx scripts/auth/manage-user.ts --role reviewer`). No demo seat exists;
  UAT by role-changing an existing dev account.
```

(Check the actual manage-user invocation used in runbook docs and mirror it; adjust the snippet to match reality.)

- [ ] **Step 2: Full sweep**

Run:
- `npx vitest run apps/api/src/services/workspace-permissions.test.ts apps/api/src/routes/companies.test.ts scripts/auth/manage-user.test.ts`
- `npm --workspace @trends/web run test -- src/lib/workspace-access.test.ts src/components/search/SearchResultsList.test.tsx`
- `bash scripts/check-route-auth.sh`
- `bash deploy/dev-parity-check.test.sh && bash deploy/dev-sync-from-preview.test.sh`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add docs/agent-runbook.md
git commit -m "docs: reviewer role assignment note in runbook"
```

---

### Task 6: Rehearsal (operator + agent, role-change only)

**Files:** none (operational).

- [ ] **Step 1: Role-change a dev account**

Run (dev stack must be up): `npm run auth:manage -- --username <existing-dev-account> --workspace hr --role reviewer --replace-memberships --no-password` — or re-seed an existing account with role reviewer via `tsx scripts/auth/manage-user.ts --username <u> --workspace hr --role reviewer --password-env AUTH_HR_DEMO_PASSWORD --replace-memberships`. Choose an account that is NOT hr-demo (hr-demo stays admin for parity/UAT). If no suitable account exists, create one (e.g., `hr-reviewer`) — creating a NEW account for rehearsal is allowed; the "no demo seat" constraint means no env-wide seeding/scripts, not a ban on a local test account.

- [ ] **Step 2: Browser UAT as reviewer**

In the CDP browser (login as the reviewer account): open `/hr/system/settings/industry-verification` — expect the review queue to render (proposals, approve buttons), identity-resolution dialog usable; ops tabs (maintenance runs / coverage) show the admin-only denial; `/hr/resumes` still works with member permissions. As hr-demo admin: everything unchanged (ops tabs visible).

- [ ] **Step 3: API spot-check**

As reviewer: `GET /api/company-industry-proposals?...` → 200; `GET /api/company-industry-maintenance-runs` → 403. As user: review route → 403.

- [ ] **Step 4: Record results**

Record observed behavior; if a defect surfaces, fix per TDD and re-run affected suites.

---

## Self-Review Notes (for the plan author)

- Spec coverage: Q1 (dedicated role) → Task 1; Q2 (third role value) → Task 1; Q3 (route split) → Task 2; Q4 (UI mirror) → Task 3; Q5 (same policy + role in audit) → Task 4; Q6 (role-change only) → Tasks 5/6; Q7 (spec+plan+SDD) → this plan.
- Placeholder scan: Task 4 Step 1 requires inspection before test-writing (audit write sites) — intentional, the implementer must read the code first; all other tasks carry exact code or precise instructions. `industry.ts`/`industry-data-admin.ts` classification requires inspection — flagged explicitly.
- Type consistency: `WorkspaceRole` union, `industry:review`, `requireIndustryReviewer`, `hasWorkspaceIndustryReviewAccess`, `updatedByRole` are the cross-task names; keep them verbatim.
