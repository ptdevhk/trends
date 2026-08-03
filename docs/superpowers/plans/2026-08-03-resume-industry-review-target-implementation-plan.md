# Resume-to-Industry-Review Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a system administrator open the exact industry-evidence proposal for a legacy employer from a resume, using the existing Industry Verification Inbox UI, with the selected target as the first unobscured review row.

**Architecture:** A new system-admin resume companion endpoint resolves only exact server-side resume/work-entry-to-proposal relationships. A page-owned `IndustryReviewTargetController` fetches the existing review packet directly, treats packet status as authoritative, and normalizes the canonical proposal path into the current Inbox URL. The Inbox continues to own normal queue browsing, but receives controlled target state, renders one transient existing-style row when the real row is off-page, and reports row readiness for deterministic top-of-viewport positioning.

**Tech Stack:** React 18, React Router, TypeScript, Vitest + Testing Library, Hono + Zod OpenAPI, Convex, Tailwind, existing Trends i18n and authenticated settings request helpers.

## Global Constraints

- Preserve `/admin/system/settings/industry-verification` as the only review UI. Do not create a separate review panel, approval screen, or queue sort order.
- Add the canonical path `/admin/system/settings/industry-verification/proposals/:proposalId`; it must use the existing system-admin gate and load the existing Inbox experience.
- For a direct target, `GET /api/company-industry-proposals/:proposalId/review-packet` is the authoritative, read-only source of status and review state.
- Normalize open targets to `?status=<actual-open-status>&filter=all&proposalId=<proposalId>` and terminal targets to `?filter=history&proposalId=<proposalId>`.
- A target may be resolved only from server-stored resume identity, active workspace, and exact work-entry fingerprint/reference. Never resolve from company display name, location, Google/search text, or a browser-supplied company key.
- No navigation may approve, reject, select a verdict, map a company, select evidence, or start recomputation.
- Keep the existing nonnumeric warning that an approval can update linked resumes. Do not add an impact count from capped `sampleReferences`.
- Targeted initial navigation uses `filter=all` for open targets and `filter=history` for terminal targets. `inspect` is a recommendation, not a proposal status.
- On a direct target, put the selected real or transient row at the top of the page viewport below the existing sticky header using target-only `scroll-mt-16`; preserve normal queue order and keyboard behavior for all non-target navigation.
- Current worktree contains pre-existing uncommitted changes, including the legacy-provenance UI files. Never use `git add -A`, `git commit -a`, reset, checkout, or broad formatting. Stage only reviewed, task-owned paths/hunks if a code commit is later appropriate.
- Regenerate `apps/api/openapi.json` and `apps/web/src/lib/api-types.ts` through the repository scripts after changing the API contract; do not hand-edit generated type output.

---

## File structure and responsibility map

| File | Responsibility |
|---|---|
| `packages/convex/convex/companies.ts` | Secret-gated Convex query that resolves exact review-target candidates from a resume document, active workspace, and stored sample references. |
| `apps/api/src/services/industry-review-target-service.ts` | API-facing normalizer for the Convex result; enforces the exact target/availability contract without exposing sample references. |
| `apps/api/src/schemas/resumes.ts` | Zod OpenAPI schemas for the resume review-target route and response. |
| `apps/api/src/routes/resumes.ts` | Explicit system-admin-only `GET /api/resumes/{resumeId}/industry-review-targets` route. |
| `apps/api/src/routes/resumes.test.ts` | Authentication, no-name-match, exact-link, pending/unlinked, and privacy tests for the new endpoint. |
| `apps/web/src/App.tsx` | Canonical proposal alias nested under the existing `/admin/system/settings` route and gate. |
| `apps/web/src/pages/system-settings/industry-review-target.ts` | Pure target status/URL helpers and typed direct-target state normalizers, isolated from Inbox rendering. |
| `apps/web/src/pages/system-settings/useIndustryReviewTarget.ts` | Page-owned controller hook: resolve path/query target, fetch packet, normalize URL, retain direct-packet detail, and expose selection state/callbacks. |
| `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx` | Compose the controller, existing Inbox, existing detail panel, and canonical path parameter; remove/passivate conflicting hidden queue state. |
| `apps/web/src/pages/system-settings/IndustryReviewInbox.tsx` | Keep normal queue/history browse state, accept controlled direct target, render/suppress transient row, report target-row readiness, and preserve target during filter changes. |
| `apps/web/src/pages/system-settings/IndustryReviewRow.tsx` | Accept a row-ready ref callback while preserving existing `article`, `aria-current`, click, and keyboard behavior. |
| `apps/web/src/pages/system-settings/IndustryHistoryList.tsx` | Support the same controlled selected-row readiness for a terminal/history target. |
| `apps/web/src/components/industry-evidence/LegacyIndustryEvidenceNotice.tsx` | Render compact named employer actions for authoritative targets and retain the generic fallback exactly when no target is available. |
| `apps/web/src/components/ResumeDetail.tsx` | Fetch review targets only for a system admin, pair them with displayed legacy signals, and pass actions to the notice. |
| `apps/web/src/components/ResumeDetail.test.tsx` | Named target CTA, unresolved fallback, multi-target, and non-admin coverage. |
| `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx` | Direct target path/query, status normalization, packet/queue race, terminal, transient row, focus, and scroll coverage. |
| `apps/web/src/App.test.tsx` | Canonical alias access under system admin and anonymous/non-system-admin redirect coverage. |
| `apps/web/src/i18n/locales/{en,zh-Hans,zh-Hant}.json` | Identical industry-evidence key set for target, pending, unavailable, selected-target, hidden-target, and stale-target copy. |

## Shared interfaces

The backend exposes only this safe public representation:

```ts
export type IndustryReviewTargetStatus =
  | 'new'
  | 'researching'
  | 'ready_for_review'
  | 'needs_more_evidence'
  | 'approved'
  | 'rejected'
  | 'superseded'

export type IndustryReviewTarget = {
  // The existing deterministic, opaque workEntryFingerprint for this resume entry.
  // It is used only to correlate the target to already-rendered resume data.
  workEntryKey: string
  employerLabel: string
  proposalId?: string
  status?: IndustryReviewTargetStatus
  availability: 'target_available' | 'collection_pending' | 'not_linked'
}

export type IndustryReviewTargetsResponse = {
  success: true
  targets: IndustryReviewTarget[]
}
```

`workEntryKey` is the existing server-issued deterministic `workEntryFingerprint`, which is already opaque in the resume data and is used only for exact client-side correlation to a displayed work entry. The resolver returns `target_available` only when `proposalId` is non-empty and the resume/work-entry link is exact. `collection_pending` is used only when the server has an actual in-flight exact proposal/task relationship; otherwise absence is `not_linked`. A legacy entry with no stored fingerprint cannot receive a named target action and remains on the generic fallback.

The page controller consumes a direct packet from the existing route and exposes this stable shape to the page and Inbox:

```ts
export type DirectReviewTarget = {
  proposal: IndustryProposal
  packet: ReviewPacket
  normalizedFilter: 'all' | 'history'
  normalizedStatus?: ReviewQueueStatus
}
```

`normalizedStatus` is defined only for open queue statuses. A terminal target uses `normalizedFilter: 'history'` and has no `status` query parameter.

## Task 1: Add the secret-gated exact resolver in Convex

**Files:**

- Modify: `packages/convex/convex/companies.ts`
- Test: `packages/convex/__tests__/companies-convex-test.test.ts`

**Interfaces:**

- Consumes: `company_industry_review_proposals.sampleReferences`, the resume document, `company_resume_links`, the active workspace, and `writeSecret`.
- Produces: `companies:resolveIndustryReviewTargetsForResume({ writeSecret, workspaceSlug, resumeId })` returning safe target metadata only.

- [ ] **Step 1: Write failing Convex resolver tests**

  Add fixtures for a resume in workspace `dev`, two legacy work entries with distinct stored fingerprints, and proposal rows whose `sampleReferences` cover: exact current-workspace match, another-workspace match, same resume but mismatched fingerprint, ambiguous multiple open proposals, one open plus one older terminal proposal, and no reference.

  ```ts
  const result = await t.query(api.companies.resolveIndustryReviewTargetsForResume, {
    writeSecret: TEST_WRITE_SECRET,
    workspaceSlug: 'dev',
    resumeId,
  })

  expect(result.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({
      availability: 'target_available',
      proposalId: 'proposal-open-exact',
      status: 'new',
    }),
    expect.objectContaining({ availability: 'not_linked' }),
  ]))
  expect(JSON.stringify(result)).not.toContain('other-workspace-resume')
  ```

- [ ] **Step 2: Run the focused Convex test and confirm it fails**

  Run the repository’s existing Convex Vitest command for the selected test file. The expected initial failure is that `resolveIndustryReviewTargetsForResume` does not exist.

- [ ] **Step 3: Implement a read-secret-protected query**

  Add a Convex query next to existing proposal queries. It must call `requireReadSecret(args.writeSecret)`, load the resume server-side, derive the only accepted identities from `String(resume._id)`, `resume.identityKey`, and `resume.externalId`, and inspect only proposal sample references where `reference.workspaceSlug === args.workspaceSlug`.

  For an exact work-entry match, require the stored work-entry fingerprint to equal the target fingerprint. Do not use `normalizedEmployerSurface`, `companyKey`, `companyName`, job title, or location as a lookup condition. Return a single open exact proposal in preference to an older terminal exact proposal. If two open exact candidates exist, return `not_linked` rather than choose one.

  ```ts
  if (reference.workspaceSlug !== args.workspaceSlug) return false
  if (!authoritativeResumeIdentities.has(reference.resumeIdentity)) return false
  return reference.workEntryFingerprint === legacyEntry.workEntryFingerprint
  ```

  Set `workEntryKey` to that exact legacy entry’s non-empty `workEntryFingerprint`. Return only `{ workEntryKey, employerLabel, proposalId?, status?, availability }`. Do not return `sampleReferences`, source URLs, identity values, company keys, or evidence-source data.

- [ ] **Step 4: Run the focused Convex test and confirm it passes**

  Re-run the exact test command from Step 2. Confirm the cross-workspace, mismatched-fingerprint, ambiguous, and terminal-preference assertions all pass.

- [ ] **Step 5: Run the relevant Convex typecheck/test suite**

  Run the existing package-level Convex test command that covers proposal queries. Confirm no existing proposal lookup contract changes.

## Task 2: Publish the system-admin resolver endpoint and generated contract

**Files:**

- Create: `apps/api/src/services/industry-review-target-service.ts`
- Modify: `apps/api/src/schemas/resumes.ts`
- Modify: `apps/api/src/routes/resumes.ts`
- Modify (generated): `apps/api/openapi.json`
- Modify (generated): `apps/web/src/lib/api-types.ts`
- Test: `apps/api/src/routes/resumes.test.ts`

**Interfaces:**

- Consumes: Task 1’s Convex query and `config.auth.convexWriteSecret`.
- Produces: `GET /api/resumes/{resumeId}/industry-review-targets` with `IndustryReviewTargetsResponse` and strict system-admin authorization.

- [ ] **Step 1: Write failing API route tests**

  Add cases using the project’s existing authenticated Hono test helpers:

  ```ts
  const response = await app.request(
    '/api/resumes/resume-123/industry-review-targets',
    { headers: createAuthHeaders({ workspaceSlug: 'dev', role: 'admin' }) },
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    success: true,
    targets: [expect.objectContaining({ proposalId: 'proposal-open-exact' })],
  })
  ```

  Assert `401` unauthenticated, `403` non-admin, `403` active non-system workspace, `404` missing resume, no sample-reference/identity/source fields in the payload, and no target when a mocked candidate is available only by display-name similarity.

- [ ] **Step 2: Run API tests and confirm they fail**

  Run:

  ```bash
  npm --workspace @trends/api run test -- src/routes/resumes.test.ts
  ```

  Expected: the requested route is absent or returns a route-not-found response.

- [ ] **Step 3: Define the Zod OpenAPI contract**

  In `schemas/resumes.ts`, add a path schema compatible with existing `ResumeDetailPathParamSchema`, the status union, target availability union, target object, and successful response schema. Keep all target relationship identifiers except `proposalId` out of the response.

  ```ts
  export const IndustryReviewTargetSchema = z.object({
    workEntryKey: z.string().min(1),
    employerLabel: z.string().min(1),
    proposalId: z.string().min(1).optional(),
    status: IndustryProposalStatusSchema.optional(),
    availability: z.enum(['target_available', 'collection_pending', 'not_linked']),
  }).superRefine((value, ctx) => {
    if (value.availability === 'target_available' && !value.proposalId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'proposalId is required for an available target' })
    }
  })
  ```

- [ ] **Step 4: Implement the isolated API service and route**

  The service must call Task 1’s query with `config.auth.convexWriteSecret`, active `workspaceSlug`, and the route resume ID; normalize no additional identity client-side.

  Add the Hono OpenAPI route directly in `resumes.ts`:

  ```ts
  path: '/api/resumes/{resumeId}/industry-review-targets',
  method: 'get',
  middleware: [requireAdmin],
  ```

  Immediately reject a non-`dev` active workspace using the repository’s existing system-workspace policy before invoking the service. Do not broaden `resumes.ts` middleware to every resume route. Map only a missing server-side resume to `404`; map authorization normally; return a generic `500` without target data for service failures.

- [ ] **Step 5: Regenerate OpenAPI and web API types**

  Run:

  ```bash
  npm --workspace @trends/web run gen:api
  ```

  Confirm it updates `apps/api/openapi.json` and `apps/web/src/lib/api-types.ts` rather than hand-editing either file.

- [ ] **Step 6: Run API tests and contract checks**

  Re-run the focused API suite, then run:

  ```bash
  npm --workspace @trends/api run openapi:gen
  npm --workspace @trends/web run gen:api
  git diff --check -- apps/api/openapi.json apps/web/src/lib/api-types.ts
  ```

  Confirm all authorization and privacy assertions pass and that generated files are the only contract artifacts changed by generation.

## Task 3: Add canonical route and direct target state controller

**Files:**

- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/system-settings/industry-review-target.ts`
- Create: `apps/web/src/pages/system-settings/useIndustryReviewTarget.ts`
- Modify: `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx`
- Test: `apps/web/src/App.test.tsx`
- Test: `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx`

**Interfaces:**

- Consumes: generated direct-packet and resolver API types, `useSettingsRequestJson`, `useParams`, and `useSearchParams`.
- Produces: one page-owned controller state `{ selectedProposalId, directTarget, detailPacket, loading, error, selectTarget, clearTarget }` shared by query and canonical-path navigation.

- [ ] **Step 1: Write failing canonical-path and direct-packet tests**

  Cover these routes with the existing system admin test wrapper:

  ```tsx
  '/admin/system/settings/industry-verification/proposals/direct-id'
  '/admin/system/settings/industry-verification?status=ready_for_review&filter=approvable&proposalId=direct-id'
  ```

  Mock the packet as `status: 'new'` while the queue omits `direct-id`. Assert the detail is rendered from the packet, the URL becomes `status=new&filter=all&proposalId=direct-id`, and a delayed/empty queue response never clears it. Add an `approved` packet test that normalizes to `filter=history&proposalId=direct-id`.

- [ ] **Step 2: Run route/page tests and confirm they fail**

  Run:

  ```bash
  npm --workspace @trends/web run test -- src/App.test.tsx src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx
  ```

  Expected: canonical proposal route is unmatched and off-page packet detail is not rendered.

- [ ] **Step 3: Implement pure status/URL helpers**

  Add `industry-review-target.ts` with functions that distinguish open from terminal statuses and generate exact normalized query strings. Keep it independent of React:

  ```ts
  export function toIndustryReviewTargetLocation(proposal: Pick<IndustryProposal, 'proposalId' | 'status'>): string {
    const params = new URLSearchParams({ proposalId: proposal.proposalId })
    if (isTerminalProposalStatus(proposal.status)) params.set('filter', 'history')
    else {
      params.set('status', proposal.status)
      params.set('filter', 'all')
    }
    return `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification?${params}`
  }
  ```

- [ ] **Step 4: Implement `useIndustryReviewTarget` as the only target owner**

  Resolve `proposalId` from `useParams().proposalId` first, then query params. Fetch the existing read-only packet route with `encodeURIComponent(proposalId)`. Store packet-backed detail independently from the queue. On success, call `setSearchParams` with `replace: true` using Task 3’s helper; on a `404`/`403`, expose an unavailable-target state and a generic Inbox fallback without trying an employer-name lookup.

  `selectTarget(proposal)` updates URL and requests a direct packet. `clearTarget()` clears only target state when the user explicitly closes it; filter/status changes must not silently delete a direct target.

- [ ] **Step 5: Mount the canonical alias under the existing gate**

  In `App.tsx`, add the `industry-verification/proposals/:proposalId` sibling route under the existing `settings` branch, using the same lazy page component and `RouteSuspense`. Do not add a new layout or bypass `SystemAccessGate`.

- [ ] **Step 6: Replace competing page-level queue selection state**

  In `SystemSettingsIndustryVerificationPage.tsx`, consume the controller state for selected proposal/packet/detail. Remove or fully passivate the hidden legacy queue fetch/selection subtree so it cannot clear target state after a delayed response. Keep normal queue browsing inside `IndustryReviewInbox` and retain existing detail/decision controls bound to packet data.

- [ ] **Step 7: Run direct route/page tests and confirm they pass**

  Re-run Step 2. Confirm canonical and query routes, stale status normalization, off-page detail persistence, terminal history normalization, and unauthenticated route behavior pass.

## Task 4: Preserve Inbox browsing and render the target row first

**Files:**

- Modify: `apps/web/src/pages/system-settings/IndustryReviewInbox.tsx`
- Modify: `apps/web/src/pages/system-settings/IndustryReviewRow.tsx`
- Modify: `apps/web/src/pages/system-settings/IndustryHistoryList.tsx`
- Test: `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx`
- Create only if existing page tests become unwieldy: `apps/web/src/pages/system-settings/IndustryReviewInbox.test.tsx`

**Interfaces:**

- Consumes: controller-owned `directTarget`, selected ID, target status/filter, and `onTargetRowReady(proposalId, element)` callback.
- Produces: unchanged normal queue browsing plus a duplicate-suppressed transient selected row and deterministic scroll/focus behavior.

- [ ] **Step 1: Write failing row-order and positioning tests**

  Mock a direct `new` packet whose proposal is absent from the first queue page. Assert:

  ```ts
  expect(screen.getAllByTestId(/industry-review-row-/)[0])
    .toHaveAttribute('data-testid', 'industry-review-row-direct-id')
  expect(targetRow.scrollIntoView).toHaveBeenCalledWith({ block: 'start', inline: 'nearest', behavior: 'auto' })
  expect(targetRow).toHaveClass('scroll-mt-16')
  expect(targetRow.focus).toHaveBeenCalledWith({ preventScroll: true })
  ```

  Add cases where: the regular row later arrives (exactly one row remains), a user changes away from the normalized tab (transient row disappears and a `Show target` action restores the normalized view), a no-target Inbox preserves current row order/scroll behavior, and a terminal target uses the history-row equivalent.

- [ ] **Step 2: Run Inbox/page tests and confirm they fail**

  Run the focused page or Inbox test file selected in Step 1. Expected: no transient row and no `scrollIntoView` call.

- [ ] **Step 3: Add controlled target props and duplicate suppression**

  Extend `IndustryReviewInbox` props with controller-owned target state and callbacks. It continues to own `items`, history, filters, pagination, and session operations, but it must not fetch direct packets or derive/clear target selection from URL query effects.

  Build a transient `ReviewInboxItem` only for an open target that is absent from `items`, using packet data:

  ```ts
  const transientItem: ReviewInboxItem = {
    proposal: directTarget.packet.proposal,
    recommendation: directTarget.packet.recommendation,
    inputFingerprint: directTarget.packet.dataset.inputFingerprint,
    sourceCount: directTarget.packet.sources.length,
  }
  ```

  Prepend it only in the target’s normalized tab. Suppress it once a normal queue/history item shares the same `proposalId`; never mutate normal queue ordering or counts.

- [ ] **Step 4: Add row-ready refs without changing ordinary behavior**

  Add an optional `onRowReady` prop to `IndustryReviewRow` and terminal history row component. Call it with the actual article element only when it is the current selected target. Retain existing `data-testid`, `aria-current`, `tabIndex`, click, Enter, and Space behavior for every row.

- [ ] **Step 5: Implement target-first positioning**

  When the controller receives `onTargetRowReady` for the selected target, position its article in the page-scrolled Inbox using:

  ```ts
  element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' })
  element.focus({ preventScroll: true })
  ```

  Add the target-only Tailwind class `scroll-mt-16` to the selected real/transient row so the existing 56px sticky header cannot obscure it. Assert that exact class in the focused positioning test. Do not run this effect for normal non-target Inbox rendering.

- [ ] **Step 6: Keep direct selection across filter/status interactions**

  Do not delete `proposalId` simply because a user selects a filter or changes queue status. If a selected direct target is hidden by that choice, retain packet detail and render the short target-hidden state with `Show target`; that action restores the actual status and normalized `all`/`history` filter.

- [ ] **Step 7: Run focused tests and confirm they pass**

  Re-run Step 2. Confirm first-row position, focus semantics, no duplicate rows, terminal behavior, no-target regressions, and target-hidden recovery all pass.

## Task 5: Expose named actions from resume detail while keeping generic search guidance

**Files:**

- Modify: `apps/web/src/components/industry-evidence/LegacyIndustryEvidenceNotice.tsx`
- Modify: `apps/web/src/components/ResumeDetail.tsx`
- Modify: `apps/web/src/components/ResumeDetail.test.tsx`
- Modify: `apps/web/src/i18n/locales/en.json`
- Modify: `apps/web/src/i18n/locales/zh-Hans.json`
- Modify: `apps/web/src/i18n/locales/zh-Hant.json`
- Verify unchanged: `apps/web/src/components/search/SearchResultsList.tsx`
- Verify unchanged: `apps/web/src/components/search/SearchResultsList.test.tsx`

**Interfaces:**

- Consumes: generated `IndustryReviewTargetsResponse`, current resume ID, system-admin state, and legacy provenance display state.
- Produces: named canonical actions only for exact targets; generic fallback for absent/pending/unlinked targets; no change to aggregate search notice.

- [ ] **Step 1: Write failing resume-detail tests**

  Add three target endpoint fixtures:

  ```ts
  { availability: 'target_available', employerLabel: 'Vision Machine Tools', proposalId: 'direct-id', status: 'new', workEntryKey: 'entry-1' }
  { availability: 'collection_pending', employerLabel: 'Other Employer', workEntryKey: 'entry-2' }
  { availability: 'not_linked', employerLabel: 'Unresolved Employer', workEntryKey: 'entry-3' }
  ```

  Assert a system admin sees `Review Vision Machine Tools evidence` linking only to `/admin/system/settings/industry-verification/proposals/direct-id`; pending/unlinked entries show their precise neutral copy plus the existing broad generic Inbox fallback; a non-admin performs no request and sees no review action. Assert the existing `SearchResultsList` generic href remains unchanged.

- [ ] **Step 2: Run focused component tests and confirm they fail**

  Run:

  ```bash
  npm --workspace @trends/web run test -- src/components/ResumeDetail.test.tsx src/components/search/SearchResultsList.test.tsx
  ```

  Expected: current notice has only the generic static action and no resolver request.

- [ ] **Step 3: Fetch targets only for authorized resume detail**

  Add a small local hook or effect in `ResumeDetail` that calls `/api/resumes/${encodeURIComponent(resume.id)}/industry-review-targets` through the existing authenticated request path only when the viewer has system-admin access and legacy evidence is present. Treat endpoint failure as `not_linked`/generic fallback; do not delay or fail the resume detail view.

  Filter returned target actions with strict fingerprint equality: `target.workEntryKey === workEntry.workEntryFingerprint`, and require a non-empty stored fingerprint. Do not compare employer labels to determine identity. If the current resume source cannot supply an exact fingerprint mapping, render only the generic fallback.

- [ ] **Step 4: Extend the notice with target-aware but visually compatible content**

  Add a typed `targets?: IndustryReviewTarget[]` prop. For each `target_available` with a proposal ID, render a compact named action linking to the canonical route. For `collection_pending` and `not_linked`, render the approved neutral copy and only the generic Inbox fallback. Preserve the existing compact legacy badge and broad static link behavior when `targets` is absent.

- [ ] **Step 5: Add translations in all three locales**

  Add the same `industryEvidence` keys to English, Simplified Chinese, and Traditional Chinese for:

  ```text
  targetAvailableAction
  targetStateNew
  collectionPending
  notLinked
  genericInboxFallback
  selectedTarget
  targetHiddenByFilter
  showTarget
  targetUnavailable
  ```

  Use the project’s `t(..., { defaultValue })` pattern and interpolation for employer label only. Keep generic existing copy intact for current tests and non-target contexts.

- [ ] **Step 6: Run component tests and typecheck**

  Re-run Step 2, then:

  ```bash
  npm --workspace @trends/web run typecheck
  ```

  Confirm the exact Vision action, neutral fallback, non-admin suppression, and unchanged generic search guidance pass.

## Task 6: Execute regression suites and attended Vision verification

**Files:**

- Verify: all files touched in Tasks 1–5
- Verify: `docs/superpowers/specs/2026-08-03-resume-industry-review-target-design.md`
- Verify: `docs/superpowers/plans/2026-08-03-resume-industry-review-target-implementation-plan.md`

**Interfaces:**

- Consumes: completed API, generated contract, canonical route, Inbox controller, target-row positioning, and ResumeDetail action.
- Produces: a verified local direct target flow with no evidence mutation.

- [ ] **Step 1: Run focused API and web suites**

  Run the exact focused tests added/changed in Tasks 1–5. Record every command and result in the final handoff.

- [ ] **Step 2: Run static quality checks**

  Run:

  ```bash
  npm --workspace @trends/api run typecheck
  npm --workspace @trends/web run typecheck
  npm --workspace @trends/web run lint
  git diff --check
  ```

  If the API package does not expose `typecheck`, run its documented equivalent from `apps/api/package.json` and record that command instead.

- [ ] **Step 3: Attach to the existing local Chrome session**

  Use the attach-first Playwright workflow. Do not restart, close, or replace the user’s normal Chrome session.

  Verify the direct Vision route resolves to the existing Inbox and leaves all evidence state untouched:

  ```text
  /admin/system/settings/industry-verification/proposals/industry-maintenance-cbfdf88f589eb3f6545d
  ```

  Confirm `VISION MACHINE TOOLS` is selected, the regular or transient row is the first unobscured review row below sticky controls, the review detail describes the current `new`/no-source state, and approval is not performed.

- [ ] **Step 4: Verify fallback and error states live where safe**

  Use non-mutating test URLs/fixtures to verify the generic fallback, stale/missing target message, and console-free loading. Do not create, approve, reject, or alter real evidence merely to test a state.

- [ ] **Step 5: Final worktree and handoff check**

  Inspect `git status --short` and `git diff --check`. Do not sweep existing unrelated changes into a commit. Report exact files changed, all tests, direct live verification, any pre-existing lint warnings, and the fact that no evidence decision was made.

## Plan self-review

### Spec coverage

| Approved-spec requirement | Implementing task |
|---|---|
| Existing Inbox remains the only review UI | Tasks 3–4 |
| Canonical proposal path and robust query behavior | Task 3 |
| Packet status is authoritative; open/history normalization | Task 3 |
| Exact server-side resolver; no display-name inference | Tasks 1–2 |
| Per-employer action plus neutral fallback | Task 5 |
| Generic aggregate search guidance stays generic | Task 5 verification |
| First unobscured target row, no reordering | Task 4 |
| Off-page transient row with duplicate suppression | Task 4 |
| Human approval stays manual; no impact-count invention | Global constraints, Tasks 3–6 |
| System-admin authorization and workspace privacy | Tasks 1–2 |
| Terminal, stale, unavailable, and queue-failure states | Tasks 3–4 and Task 6 |
| Generated API contract and regression validation | Tasks 2 and 6 |

### Placeholder scan

The plan contains no `TODO`, `TBD`, “implement later”, or unbounded “add appropriate handling” instructions. Every task specifies paths, interfaces, failure-first tests, a concrete implementation contract, and verification commands.

### Type consistency

- `IndustryReviewTargetStatus` is the proposal lifecycle union; `inspect` remains recommendation-only.
- `IndustryReviewTarget.availability === 'target_available'` requires `proposalId`.
- `DirectReviewTarget.normalizedStatus` is only an open `ReviewQueueStatus`; terminal targets normalize using `filter=history`.
- `IndustryReviewTargetController` is the only selected packet/URL owner; `IndustryReviewInbox` owns browse state only.

## Execution mode

The user explicitly approved the written design, this plan, and immediate execution without another approval checkpoint. Execute inline in this session, validate each task before advancing, and preserve the dirty worktree safeguards above.
