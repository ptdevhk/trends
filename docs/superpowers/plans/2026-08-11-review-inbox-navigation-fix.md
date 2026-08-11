# Plan: Fix review inbox proposal navigation (2026-08-11)

## Bug report

From the review inbox (`/hr/system/settings/industry-verification`), clicking
**查看** (View) on a proposal row — or selecting a row, or using prev/next —
redirects the user to the resumes home page instead of opening the proposal
detail.

## Root cause (verified in code)

`SystemSettingsIndustryVerificationPage.selectProposal()` builds the proposal
detail URL from the constant `SYSTEM_ROUTE_PREFIX` (`/admin/system`):

```ts
navigate({
  pathname: `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification/proposals/${id}`,
})
```

`/admin/system/*` is gated by `SystemAccessGate` (App.tsx:306-320), which
redirects anyone who is not a **dev-workspace system admin** to
`/{fallbackSlug}/resumes`. Workspace admins and reviewers (the audience of the
reviewer-role feature) are bounced to their workspace home — exactly the
reported symptom.

Why tests missed it: the page test renders the page standalone inside a bare
`MemoryRouter` (no `<Routes>`), so `useParams()` always returns `{}` and the
`SystemAccessGate` redirect never fires. The page's pathname-regex fallback
(`proposalIdFromPath`) made navigation work in tests regardless of base.

Contexts the page renders in:
- `/:teamSlug/system/settings/industry-verification` — workspace admins/reviewers
  (route param `teamSlug` present).
- `/admin/system/settings/industry-verification` — dev-workspace system admins
  (no route param).

## Fix

Make the navigation base context-aware, following the existing
`WorkspaceDebugPage` pattern (`isSystemSurface ? SYSTEM_ROUTE_PREFIX : /{slug}/system`):

In `SystemSettingsIndustryVerificationPage`:

```ts
const { teamSlug, proposalId: proposalIdFromRoute } = useParams()
// The page renders at two bases: the canonical dev system surface
// (/admin/system) and the workspace-scoped surface (/:teamSlug/system).
// In-page navigation must stay on the active base — hardcoding
// /admin/system sends workspace admins/reviewers into SystemAccessGate,
// which bounces them to their workspace home.
const reviewBasePath = teamSlug
  ? `/${teamSlug}/system/settings/industry-verification`
  : `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`
```

`selectProposal()` uses `reviewBasePath` instead of
`${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`.

`moveSelection` and the row `onSelect` both flow through `selectProposal`, so
the one change fixes 查看, row click, and prev/next.

Not changed (verified correct):
- `LegacyIndustryEvidenceNotice` — only rendered when `hasSystemAdminAccess`
  (dev system admins), so its `/admin/system` href is correct for its audience.
- App.tsx workspace→canonical redirect for system admins — intentional.
- API layer, review packets, approve/undo — already workspace-scoped and
  verified in the reviewer-role rehearsal.

## Files

1. `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx`
   — context-aware `reviewBasePath`; `selectProposal` uses it.
2. `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx`
   — regression tests:

   - `renderPageAtRoute()` helper: renders inside `<Routes>` with
     `/:teamSlug/system/settings/industry-verification/*`,
     `/admin/system/settings/industry-verification/*`, and a `*` fallback
     rendering `data-testid="wrong-route"` (fails if any navigation leaves the
     review surface); LocationProbe extended with a pathname output.
   - Workspace context (`/hr/system/settings/industry-verification`, hr
     reviewer membership): click row `industry-review-row-proposal-1` →
     pathname stays `/hr/system/settings/industry-verification/proposals/proposal-1`,
     `requestJsonMock` called with `/api/company-industry-proposals/proposal-1/review-packet`,
     no `wrong-route`.
   - System context (`/admin/system/settings/industry-verification`, dev admin):
     click row → pathname stays under `/admin/system/.../proposals/proposal-1`.
   - Existing standalone tests keep passing unchanged (no `teamSlug` param →
     falls back to `/admin/system`).

## Verification

- Targeted: `npx vitest run src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx`
  + the earlier CTA suites (SearchResultsList, ResumeSearchPage).
- Full web suite + typecheck (`npm test -- --run`, `npm run typecheck`).
- Browser E2E as hr-reviewer (playwright-cli): gated search → 前往审核 →
  inbox → click 查看 → proposal detail opens (no bounce) → back → select
  another row; then approve → undo to prove the action loop end-to-end.
- Commit locally on `preview-v0.4.23` (not pushed).
