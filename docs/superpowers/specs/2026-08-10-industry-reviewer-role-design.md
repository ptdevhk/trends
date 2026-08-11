# Industry Reviewer Role — Design

**Status:** grilled design (2026-08-10)
**Branch:** preview-v0.4.23

## Problem statement

The industry-verification workflow — review proposals (`company-industry-proposals`),
evidence sources, verdict revisions, and identity resolution — is gated `requireAdmin`
across the board (`apps/api/src/routes/companies.ts:116-126`). Real HR seats with
workspace role `user` cannot see or approve any pending company approval workflow,
even though the industry data is HR-domain knowledge. The notice-visibility fix
(`8506acb7`) made the verified-employer count readable by all workspace users, which
raises the follow-up: who curates the catalog?

**Decision:** introduce a dedicated workspace role **`reviewer`** with full
review-workflow rights (proposals, evidence sources, verdict revisions, identity
resolution). Operations surfaces (recompute runs, link-backfill, maintenance runs,
coverage) stay admin-only.

## Grilled decisions

| # | Question | Decision |
|---|---|---|
| Q1 | Who can approve? | Full rights via a **dedicated reviewer role** — not blanket role=user access |
| Q2 | Role model | Third `workspace_memberships.role` value **`reviewer`** (TEXT column — no migration); `manage-user.ts` gains `--role reviewer`; `hasWorkspaceRole` accepts it |
| Q3 | Route split | **Reviewer**: proposals, evidence-sources, revisions, identity resolution. **Admin only**: recompute-runs, link-backfill, maintenance-runs, coverage. Reviewer inherits member permissions (resume/candidate). Verified-employer-count is already workspace-user (`8506acb7`); bundles + refresh-requests already workspace-user |
| Q4 | UI gating | Mirrors API: `WorkspaceIndustryAccessGate` accepts **admin or reviewer** for review surfaces; ops tabs render only for admin |
| Q5 | Policy & audit | **Same one-click approval policy** (approval-safe gating unchanged); audit entries (verdict revisions, identity audits, proposal actions) record the acting **role** (`reviewer` vs `admin`) alongside `userId` |
| Q6 | Seats | **No demo account.** Role-change only: `manage-user.ts --role reviewer` on any existing account; preview/prod assignment is a documented operator step |
| Q7 | Delivery | Full spec + plan + subagent execution (SDD flow) |

## Assumptions (stated, not grilled)

- Reviewer inherits `MEMBER_PERMISSIONS` (resume search, candidate actions, analysis)
  plus the industry-review set; it grants **no admin powers** outside the industry
  review surfaces (company-policy settings, system settings, ops tabs remain admin).
- Admin remains a strict superset (admin = member + industry-review + ops + admin surfaces).
- Roles are per-workspace memberships — a user can be `reviewer` in `hr` and `user` in `dev`.
- `scripts/route-auth-policy.json` + `check-route-auth.sh` (CI-enforced route/auth
  contract) must be updated to the new matrix.

## Anticipated touch points (implementation plan will pin exact files)

- `apps/api/src/services/workspace-permissions.ts` — add `reviewer` to the role set;
  add industry-review permission(s); admin keeps superset + ops
- `apps/api/src/middleware/auth.ts` — `requireIndustryReviewer` (admin-or-reviewer)
  or reuse `requireWorkspaceRole(..., ["admin","reviewer"])` style helper
- `apps/api/src/routes/companies.ts` — gate split per Q3
- `apps/api/src/services/auth-storage.ts` / role validation — accept `reviewer`
- `scripts/auth/manage-user.ts` — `--role reviewer`
- Web: `workspace-access` helpers, `WorkspaceIndustryAccessGate`, nav/settings route
  gating per Q4
- Audit write sites (verdict revisions, identity audits, proposal actions) — record
  acting role
- `scripts/route-auth-policy.json` + `scripts/check-route-auth.sh` — matrix update
- Tests: `workspace-permissions.test.ts`, `companies.test.ts` (role matrix),
  web gate tests, `auth-workspace-smoke`/route-auth policy tests

## Non-goals

- Role-assignment UI (managed via `manage-user.ts` CLI / seed scripts)
- Two-person approval rules or reviewer-specific stricter policies (Q5 rejected)
- Changing the notice copy or the verified-employer-count endpoint (already shipped)
- Ops surfaces for reviewers (Q3 rejected)

## Sources Used

- Local repository: `apps/api/src/routes/companies.ts` (gates 116-126),
  `apps/api/src/services/workspace-permissions.ts` (MEMBER/ADMIN sets),
  `apps/api/src/middleware/auth.ts` (requireAdmin/requireWorkspaceUser),
  `scripts/auth/manage-user.ts`, `scripts/route-auth-policy.json`,
  web `WorkspaceIndustryAccessGate`, commit `8506acb7` (notice fix),
  `docs/superpowers/handoffs/2026-08-09-industry-drain-perf-complexity-handoff.md`
- Live evidence: this session's grill (Q1–Q7), preview hr-demo admin role,
  dev-sync parity gate results
