# Design: Industry review workflow — navigation fix + entry points (2026-08-11)

Status: Approved by user (brainstorming, 3 sections)
Branch: `preview-v0.4.23` (local, not pushed)

## Problem

Workspace users (admins and the new `reviewer` role) reach the industry evidence
review inbox at `/{workspace}/system/settings/industry-verification` (e.g. via the
verified-only notice CTA `前往审核`). From there:

1. Clicking **查看** on a proposal row, clicking a row, or using Previous/Next
   redirects to the resumes home page instead of opening the proposal detail.
2. Even without the redirect, the detail section renders off-screen below the
   inbox — clicking a row appears to do nothing.
3. Entry points are weak: the workspace Settings sidebar has no industry review
   item, and the legacy "Industry evidence needs human review" notice is visible
   only to dev-workspace system admins.

## Root cause

`SystemSettingsIndustryVerificationPage.selectProposal()` builds the proposal
detail URL from the constant `SYSTEM_ROUTE_PREFIX` (`/admin/system`).
`/admin/system/*` is gated by `SystemAccessGate` (App.tsx), which redirects
anyone who is not a dev-workspace system admin to `/{fallbackSlug}/resumes`.
Workspace reviewers/admins always hit this bounce.

Why tests missed it: the page test renders the page standalone inside a bare
`MemoryRouter` (no `<Routes>`), so `useParams()` returns `{}` and the gate never
fires; the page's pathname-regex fallback (`proposalIdFromPath`) made navigation
appear to work regardless of base.

## Decisions (grilled with user)

| # | Question | Decision |
|---|----------|----------|
| 1 | Scope of "full workflow" | A + B + C: navigation fix + selection UX (A), settings sidebar entry (B), legacy notice for workspace reviewers (C) |
| 2 | Legacy notice audience | Active-workspace admin/reviewer OR dev system admin; link base workspace-scoped; members see no notice |
| 3 | Sidebar entry | Single 行业验证 entry in workspace Settings sidebar, visible to admins AND reviewers of the active workspace; no ops entry here |

## Design

### 1. Navigation fix + selection UX (A)

**`apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx`**

- Read the route param: `const { teamSlug, proposalId: proposalIdFromRoute } = useParams()`.
- Compute the active base once:
  `const reviewBasePath = teamSlug ? \`/${teamSlug}/system/settings/industry-verification\` : \`${SYSTEM_ROUTE_PREFIX}/settings/industry-verification\``
  (`teamSlug` is present on the workspace-scoped routes, absent on `/admin/system`).
- `selectProposal()` navigates to `${reviewBasePath}/proposals/${id}` (or
  `reviewBasePath` when deselecting). This fixes 查看, row click, and
  Previous/Next in one change — all funnel through `selectProposal`.
- Rationale: follows the existing `WorkspaceDebugPage` context-aware-base
  pattern; relative navigation was rejected (resolves against route hierarchy,
  throws in standalone renders); deriving from `useWorkspace().slug` was
  rejected (`/dev/system` is not a real route).

**Scroll-to-detail**

- Add a ref on the detail section and a `userInitiatedSelection` ref flag.
- On user-initiated selection (row click / 查看 / Previous / Next), smooth-scroll
  the detail section into view (`block: 'start'`).
- Initial deep links keep the existing targeted-row scroll behavior; no
  double-scroll on first load.
- History semantics unchanged: `selectProposal` keeps `replace: true`
  (Previous/Next must not spam history; the inbox is on the same page above the
  detail).

### 2. Legacy evidence notice for workspace reviewers (C)

**`apps/web/src/components/industry-evidence/LegacyIndustryEvidenceNotice.tsx`**

- Add a `reviewBasePath?: string` prop (defaults to `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`).
- `REVIEW_INBOX_HREF` and the `reviewTarget` deep link are built from
  `reviewBasePath` instead of the constant.
- Callers pass the workspace-scoped base; dev system admins keep the canonical
  base via the default.

**Call sites** (`SearchResultsList.tsx`, `ResumeCard.tsx`, `ResumeDetail.tsx`)

- The render gate changes from `hasSystemAdminAccess(memberships)` to:
  `hasSystemAdminAccess(memberships) || hasWorkspaceIndustryReviewAccess(memberships, activeWorkspaceSlug)`.
- Pass `reviewBasePath={/admin/system/... | /{slug}/system/...}` matching the
  same predicate (system admin → canonical; workspace reviewer/admin →
  workspace-scoped).
- Plain members: no notice, no dead links.
- Public share surfaces: memberships are empty there, so the gate is false —
  the legacy notice never renders on public share.

### 3. Settings sidebar entry (B)

**`packages/shared/src/system-debug-metadata.ts`**

- `SETTINGS_NAV_ITEMS` gains an `industry-verification` item after "Policies":
  `{ id: 'industry-verification', titleKey: 'debugConfig.settingsNavIndustryVerification', defaultTitle: 'Industry verification', hrefSuffix: '/system/settings/industry-verification', matchesSuffixes: ['/system/settings/industry-verification'], requiresReviewAccess: true }`.
- New optional flag `requiresReviewAccess?: boolean` on `SurfaceNavDefinition`
  (checked after `requiresAdmin`).

**`apps/web/src/components/SettingsSidebar.tsx`**

- Filter becomes role-aware: show `requiresAdmin` items when
  `hasWorkspaceAdminAccess(memberships, slug)`; show `requiresReviewAccess`
  items when `hasWorkspaceIndustryReviewAccess(memberships, slug)`.
- Icon: reuse `Scale`-style mapping — add `'industry-verification': Factory` to
  `NAV_ICONS` (import `Factory` from lucide-react; DebugConfig already uses it
  for the same id).

**`packages/shared/src/system-debug-metadata.test.ts`** — assert the new item
exists with the flag.

### 4. Testing

- **Navigation base regression** (route-rendered): `renderPageAtRoute()` renders
  inside `<Routes>` with `/:teamSlug/system/settings/industry-verification/*`,
  `/admin/system/settings/industry-verification/*`, and a `*` fallback rendering
  `data-testid="wrong-route"`. Cases: workspace reviewer at `/hr/...` stays under
  `/hr/system/.../proposals/proposal-1` and fetches the review packet; dev admin
  at `/admin/...` stays canonical; no `wrong-route` in either.
- **Scroll-to-detail**: fires on user-initiated selection, not on deep link
  (`scrollIntoView` mocked via jsdom).
- **Legacy notice**: gate matrix at call sites (member hidden; workspace
  reviewer/admin visible with workspace-scoped href; dev system admin canonical)
  + `LegacyIndustryEvidenceNotice` renders `reviewBasePath`-based hrefs.
- **Sidebar**: `SETTINGS_NAV_ITEMS` flag test (shared) + `SettingsSidebar`
  visibility (admin sees, reviewer sees, member doesn't, wrong-workspace
  reviewer doesn't).
- Existing standalone page tests keep passing unchanged (no `teamSlug` param →
  fallback base).

### 5. Verification

- `npm --workspace @trends/web test -- --run` (full web suite) + `npm --workspace @trends/web run typecheck`.
- Browser E2E (playwright-cli, dev server, hr-reviewer session):
  1. Gated search → notice CTA 前往审核 → inbox.
  2. 查看 a row → detail opens with evidence, no bounce; Previous/Next walk the queue.
  3. Approve → undo → row returns to ready state (reversible in-session).
  4. Settings sidebar shows 行业验证 for hr-reviewer.
  5. Canonical `/admin/system` path still works for a dev system admin.
- Commit locally on `preview-v0.4.23` (not pushed).

## Files

| File | Change |
|------|--------|
| `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx` | `reviewBasePath` + scroll-to-detail |
| `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx` | route-rendered regression tests + scroll test |
| `apps/web/src/components/industry-evidence/LegacyIndustryEvidenceNotice.tsx` | `reviewBasePath` prop |
| `apps/web/src/components/search/SearchResultsList.tsx` | gate + base for legacy notice |
| `apps/web/src/components/ResumeCard.tsx` | gate + base for legacy notice |
| `apps/web/src/components/ResumeDetail.tsx` | gate + base for legacy notice |
| `packages/shared/src/system-debug-metadata.ts` | `requiresReviewAccess` flag + sidebar item |
| `packages/shared/src/system-debug-metadata.test.ts` | item/flag assertions |
| `apps/web/src/components/SettingsSidebar.tsx` | role-aware filter + icon |
| `apps/web/src/components/SettingsSidebar.test.tsx` | visibility matrix |

## Notes

- A draft of the navigation fix + regression tests exists in the working tree
  (pre-brainstorming); it matches this design (Option 1) and will be reconciled
  and completed during implementation.
- Deferred (out of scope): ops entry in workspace settings; workspace-scoped
  `listIndustryVerdictRevisionsPage`; copy cosmetics; desk-token login for
  reviewers; evidence-source role field.
