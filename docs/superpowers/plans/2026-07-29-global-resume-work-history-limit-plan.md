# Global Resume Work-History Limit Implementation Plan

**Goal:** Preserve complete fetched work histories while applying a global admin-configurable latest-entry limit to resume UI and future analysis, defaulting safely to three.

**Design:** `docs/superpowers/specs/2026-07-29-global-resume-work-history-limit-design.md`

## Constraints

- Store complete work history; never truncate persisted resume content.
- Default and fallback limit is `3`.
- Valid admin range is integer `1..10`; no unlimited mode.
- Preserve detailed SEEK descriptions in projected and selected entries.
- Existing analysis results remain unchanged until rerun.
- Do not bulk-reingest historical resumes.

## Tasks

- [ ] Add shared constants and normalization for the global limit; extend selector tests.
- [ ] Add typed Convex system-setting read/write functions with fallback and validation tests.
- [ ] Add BFF GET/PUT system routes, with admin-only writes and route tests.
- [ ] Bound Convex resume list/detail projections to the latest ten detailed entries.
- [ ] Resolve and pass the effective limit through BFF and Convex analysis preparation.
- [ ] Add a web hook that reads the effective limit and falls back to three.
- [ ] Apply the hook to resume card, detail, compact search, and expanded search surfaces.
- [ ] Add the admin Runtime settings card with validation and save feedback.
- [ ] Run shared, Convex, API, web, and browser-extension regression suites.
- [ ] Verify the default and a changed limit in the running browser UI.

## Verification Commands

```bash
bunx vitest run packages/shared/src/__tests__/work-history-evidence.test.ts
cd packages/convex && bunx vitest run __tests__/system-settings.test.ts __tests__/resumes-list-projections.test.ts __tests__/analysis-strict-evidence.test.ts
cd apps/api && bunx vitest run src/routes/system.test.ts src/routes/resumes.latest-work-history.test.ts
cd apps/web && bunx vitest run src/pages/system-settings/SystemSettingsRuntimePage.test.tsx src/components/ResumeCard.test.tsx src/components/ResumeDetail.test.tsx src/components/search/SnippetCard.test.tsx src/components/search/SnippetCardExpanded.test.tsx
cd apps/browser-extension && bunx vitest run src/lib/__tests__/seek-extractor.test.ts src/lib/__tests__/seek-work-history-quality.test.ts
```

Run affected package typechecks/lint/build plus `git diff --check` after focused tests pass.
