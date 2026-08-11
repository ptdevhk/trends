# Plan: Verified-only notice review CTA (2026-08-11)

## Context

HR users who open a gated resume search (`minRoleYears` / `roleFilterType`) see the
notice `结果仅限行业认证雇主 · 目录中 35 家认证雇主` on the results list. Today the
notice is a static status strip (`role="status"` div in `SearchResultsList.tsx`) with
no way to reach the industry evidence review feature, even for users who have review
access (workspace admin or the new `reviewer` role, shipped 2026-08-10).

The review inbox lives at `/{workspace}/system/settings/industry-verification`
(gated by `WorkspaceIndustryAccessGate` = workspace admin|reviewer; plain members get
a denial page). The page already reads `?status=` from the URL and defaults to
`ready_for_review`.

## Grilled decisions

The user invoked `/grill-with-docs` but declined the interactive Q&A, so the
recommended answers (offered during grilling) are applied:

| # | Question | Decision (recommended) |
|---|----------|------------------------|
| 1 | What do plain members (role=user) see? | Notice stays text-only for them — no dead link to a denial page, no extra hint line. Keeps the strip scannable. |
| 2 | CTA style | Inline text link with `ExternalLink` icon, mirroring the sibling `LegacyIndustryEvidenceNotice` "Review industry evidence" pattern. Plain `<a href>` — `SearchResultsList` tests render without a Router wrapper, and the sibling notice already does this. |
| 3 | Scope | This task = CTA on the notice only. A settings-sidebar entry for reviewers (`SETTINGS_NAV_ITEMS` is shared constants with a `requiresAdmin` flag that hides items from reviewers) is a separate follow-up. |
| 4 | Link destination | `/{workspace}/system/settings/industry-verification?status=ready_for_review` — explicit status param mirrors the legacy notice and is robust to default changes. |
| 5 | Wiring | Prop-driven: `ResumeSearchPage` computes eligibility (`hasWorkspaceIndustryReviewAccess(memberships, slug)`, already exists) and passes `verifiedOnlyReviewHref` down. `SearchResultsList` stays presentational; its tests already mock `useAuth`. |
| 6 | Tests | Unit tests only: component test (link renders with href / absent without) + page test (href for admin, reviewer; undefined for member and public share). Matches existing coverage style; no E2E. |
| 7 | Delivery | Direct implementation (small change), TDD-style with tests, `make test`-gated verification, local commit (not pushed — branch stays local like the prior 30 commits). |

## Files

1. **`apps/web/src/components/search/SearchResultsList.tsx`**
   - New prop `verifiedOnlyReviewHref?: string` (JSDoc: workspace admin/reviewer only).
   - In the notice block, when `verifiedOnlyReviewHref` is set, render an inline
     `<a>` (primary color, underline, `ExternalLink` icon) with copy from
     `industryEvidence.verifiedOnlyReviewAction`. Link sits inside the existing
     `flex flex-wrap items-center justify-between` notice container.
   - Extend the lucide-react import with `ExternalLink`.

2. **`apps/web/src/pages/ResumeSearchPage.tsx`**
   - Import `hasWorkspaceIndustryReviewAccess` alongside the existing
     `hasSystemAdminAccess` from `@/lib/workspace-access`.
   - Compute:
     `const verifiedOnlyReviewHref = !isPublicSurface && hasWorkspaceIndustryReviewAccess(memberships, workspaceSlug) ? \`/${workspaceSlug}/system/settings/industry-verification?status=ready_for_review\` : undefined`
   - Pass `verifiedOnlyReviewHref` to `SearchResultsList`.

3. **Locales** (`industryEvidence.verifiedOnlyReviewAction`, inserted alphabetically
   between `undoSuccess` and `verifiedQuickPick` in all three files):
   - `en.json`: `"Review industry evidence"`
   - `zh-Hans.json`: `"前往审核"`
   - `zh-Hant.json`: `"前往審核"`

4. **Tests**
   - `SearchResultsList.test.tsx`:
     - Link renders inside the notice (`within(getByTestId('resume-verified-only-notice'))`)
       with the exact href when the prop is provided.
     - No link inside the notice when the prop is absent (extend existing notice test).
   - `ResumeSearchPage.test.tsx`:
     - Extend `AuthMockValue` with `memberships?: WorkspaceMembership[]`
       (import type from `@/lib/auth`); default `memberships: []` in `beforeEach`.
     - Mock `SearchResultsList` already renders `VerifiedOnlyNotice: {...}`; add
       `VerifiedOnlyReviewHref: {verifiedOnlyReviewHref ?? 'none'}` for assertions.
     - Cases: reviewer membership → href `/dev/system/settings/industry-verification?status=ready_for_review`;
       admin membership → href; plain user membership → `none`; public share surface
       (`routeMock.isPublicSurface = true`) with reviewer membership → `none`.

## Verification

- `cd apps/web && npx vitest run src/components/search/SearchResultsList.test.tsx src/pages/ResumeSearchPage.test.tsx`
- Full web suite: `npm --workspace @trends/web test` (or `make test-coverage` gate if quick).
- Typecheck via the web workspace `typecheck` script if present.
- Manual browser sanity (optional, dev server): hr-reviewer sees the link on a gated
  query; hr-demo member sees text-only notice.
- Commit locally on `preview-v0.4.23` (not pushed).
