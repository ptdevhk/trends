# Resume-to-Industry-Review Target — Design

- **Date:** 2026-08-03
- **Status:** Conversation design approved; awaiting review of this written specification
- **Scope:** Make the legacy-industry-evidence action on a resume open the exact employer proposal in the existing Industry Verification Inbox, without creating a second review UI or relaxing human approval.
- **Related:** The legacy-provenance work in `apps/web/src/components/industry-evidence/`; current Industry Verification Inbox at `/admin/system/settings/industry-verification`.

## Problem

The current neutral notice correctly prevents a historical `industryVerified` rules flag from appearing as green human-approved evidence. Its action is deliberately broad:

```text
/admin/system/settings/industry-verification?status=ready_for_review
```

This is valid, but not a useful destination for an individual legacy employer:

1. `status=ready_for_review` selects only one lifecycle bucket. `filter=all` means all rows in that bucket, not all proposal states.
2. A proposal can be `new`, `researching`, `needs_more_evidence`, or terminal rather than `ready_for_review`. In the observed Vision Machine Tools case, the matching proposal is currently `new` and therefore never appears in the ready queue.
3. The current `proposalId` query behavior only selects an item if it happens to occur in the currently fetched queue page. It does not directly load the target first, resolve a stale status, or cover terminal/history items.
4. A legacy resume signal does not always include a canonical company key, verdict revision, work-entry fingerprint, or proposal ID. It is unsafe to infer a target proposal from a rendered company name such as `Vision Machine Tools`.
5. Approval is a human action that can affect multiple linked resumes. A direct link must open evidence review, not infer truth or become an approval shortcut.

The product goal is a direct, intelligible path from a specific resume employer to its exact review target while retaining the current Inbox layout and human-review safeguards.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Review UI | Retain the existing Industry Verification Inbox, queue tabs, row cards, detail panel, evidence controls, and approval flow. No second review screen. |
| Canonical deep link | Add `/admin/system/settings/industry-verification/proposals/:proposalId` as a stable route for a review target. |
| Existing query URL | Preserve `/admin/system/settings/industry-verification?status=<open-status>&filter=all&proposalId=<proposalId>` for open targets, and `?filter=history&proposalId=<proposalId>` for terminal targets, as normalized internal Inbox URLs and for backward compatibility. |
| Target precedence | When `proposalId` is present, resolve the proposal directly and treat its current server status as authoritative. URL `status` is a display hint only. |
| Initial filter for a target | Normalize an open targeted link to `filter=all`, so a target with an `inspect` or `needs_more_evidence` **recommendation** cannot be hidden by the `approvable` tab. Normalize a terminal target to `filter=history`. |
| Target positioning | Once the selected target row is rendered, scroll it into the page viewport just below the existing sticky header so it is the first unobscured review row. Do not reorder the queue. |
| Resume CTA | Render a specific action per legacy employer/work-history target only when the backend resolves an authoritative proposal relationship. Otherwise retain a generic Inbox fallback. |
| Matching policy | Never resolve a proposal from a display name, title, location, Google result, or client-supplied company key. Resolve server-side from stored resume/proposal linkage only. |
| Approval | Remains attended and manual. A deep link performs no mutation and never selects a verdict or evidence source. |
| Impact statement | Retain the existing safe nonnumeric statement that an approval can update linked resumes. An exact linked-resume count is deferred until a separate authoritative aggregation is designed; never derive a count from the capped proposal sample-reference list. |
| Search result banner | Remains generic because it can represent multiple resumes and employers. It must not claim to target one company. |

## User experience

### Individual resume detail

The existing neutral notice remains the visual container. When an exact target is available, it becomes employer-specific without changing the surrounding layout:

```text
Industry evidence needs human review
Vision Machine Tools has a new evidence proposal with no durable sources.
[Review Vision Machine Tools evidence]
```

The button opens the canonical target route. The user then sees the current Inbox with the matching row selected and the existing review detail panel open.

For the currently observed Vision proposal, the selected panel must make its state clear:

- Proposal state: `new`.
- Canonical-company mapping: missing.
- Evidence sources: none.
- Recommendation: inspect / low confidence.
- Appropriate attended next action: request more evidence or complete canonical mapping, not approval.

### Multiple legacy employers on one resume

The notice contains a compact list of employer-specific actions, one per authoritative target. Each action has its own visible employer label and status. This avoids a single ambiguous link when several work-history entries have legacy signals.

### No matching proposal

When the backend cannot establish an exact relationship, the notice stays neutral and must not invent an employer-specific route. It shows:

```text
Evidence collection or matching is not yet available for this employer.
[Open industry review inbox]
```

The fallback opens the current broad Inbox URL at `status=ready_for_review&filter=all`. This intentionally preserves the existing default human-review queue; it is not an employer lookup and does not promise that every lifecycle state is visible there.

The resolver maps availability to UI as follows:

| Availability | Notice copy | Action |
|---|---|---|
| `target_available` with `proposalId` | Name the employer and its current proposal state | Named employer-specific canonical route |
| `collection_pending` | “Evidence collection is still in progress for this employer.” | Generic Inbox fallback only |
| `not_linked` | “No exact review target is linked to this employer yet.” | Generic Inbox fallback only |

An employer-specific route is emitted only when `availability === 'target_available'` and a non-empty `proposalId` are both present.

### Aggregate search results

The aggregate search-results notice remains broad. Its copy may say that one or more results have legacy signals, but it does not contain a named-employer CTA because it lacks a single safe target.

## Route and state design

### Canonical external route

```text
/admin/system/settings/industry-verification/proposals/:proposalId
```

This route is an entry alias, not a new review application. It uses the existing system-admin gate and renders the same Industry Verification page after resolving the target.

It uses the existing admin-gated direct-packet endpoint:

```text
GET /api/company-industry-proposals/:proposalId/review-packet
```

The packet supplies the proposal identity and current lifecycle status, recommendation, input fingerprint, evidence sources, and review context. A `404` means the proposal no longer exists; a `403` is handled by the existing system-admin authorization path. Loading the packet is read-only. Any later decision continues to send the packet's current fingerprint/version through the existing attended decision API, which may reject a stale packet with a conflict.

Resolution flow:

1. Read `proposalId` from the path.
2. Fetch the direct review packet for that ID using the authenticated system-admin request path.
3. Read the proposal's actual current status from the returned packet.
4. Replace the URL with the existing Inbox URL. For an open proposal:

   ```text
   /admin/system/settings/industry-verification?status=<actual-status>&filter=all&proposalId=<proposalId>
   ```

   For an approved, rejected, or superseded proposal:

   ```text
   /admin/system/settings/industry-verification?filter=history&proposalId=<proposalId>
   ```

5. Seed the selected review target from the direct packet. The detail panel must render even if the proposal is absent from the first queue page.
6. Load the current queue independently for normal Inbox browsing, then position the selected row as the first unobscured list row if it is present. Offer a visible target-state message if it is not.

The canonical route is useful for durable links. The normalized query URL preserves the current UI's navigation and back-button behavior.

### Existing query route

The existing route continues to accept `status`, `filter`, and `proposalId`.

When a `proposalId` is supplied:

- Direct target resolution happens before relying on the status-filtered queue.
- The server's current status wins over the query value.
- An open target uses `filter=all`; a terminal target uses `filter=history`.
- `inspect` is a recommendation, not a lifecycle status. The lifecycle status remains one of `new`, `researching`, `ready_for_review`, `needs_more_evidence`, `approved`, `rejected`, or `superseded`.
- A user can still change tabs after opening the target. If a later filter hides the selected row, the UI retains the selected detail or displays a short “target hidden by this filter” notice with a `Show target` action.

When no `proposalId` is supplied, the existing queue behavior remains unchanged.

### Target row positioning

Opening a canonical target link must not leave the selected employer halfway down the review list or only visible in the detail panel. After the target row is rendered:

1. Keep the queue's normal relevance/order; do not sort or permanently move the row to the beginning of the queue.
2. The current Inbox is page-scrolled, so scroll the selected article into the document viewport with `block: 'start'`; if a dedicated scrolling ancestor is introduced later, use that ancestor instead.
3. Apply the target-only `scroll-mt-16` offset so the row begins below the existing sticky header and is not obscured by navigation.
4. Give the row programmatic focus after positioning, using `focus({ preventScroll: true })` when available so focus does not undo the measured scroll position. Preserve the existing selected/`aria-current` semantics.
5. Use immediate scrolling for direct navigation. If motion is introduced later, respect `prefers-reduced-motion`.

If the row is not in the current queue page, the direct packet remains selected and the Inbox renders one transient, visually identical **Selected target** row at the top of the current list. It does not auto-paginate or attempt to derive a cursor. This deterministic fallback gives the user the exact target as the first visible row without changing persistent queue order.

The transient row is rendered only while all of the following are true: the direct target remains selected, the current tab is the target's normalized tab (`all` for an open target or `history` for a terminal target), and the regular queue/history list does not contain that proposal ID. It is suppressed as soon as the regular row arrives, and removed when the target is cleared, changes state, becomes unavailable, or the user switches to another tab/status. It uses the existing row component, one proposal ID, and the same selected/`aria-current` semantics, so it cannot create duplicate queue entries or a second keyboard target.

### State transitions and history

| Target condition | Required behavior |
|---|---|
| Open target changed from `new` to `ready_for_review` | Resolve its new status, replace the stale URL state, select the same target. |
| Target is on a later queue page | Render the selected direct packet and one transient Selected target row first. Do not auto-paginate or silently clear the selection; replace the transient row only when normal browsing loads the regular row. |
| Target is approved, rejected, or superseded | Show the same existing review detail in its terminal state and a clear “already resolved” message; do not produce an empty queue panel. |
| Target does not exist or is inaccessible | Show “This review target is no longer available” and a safe generic Inbox fallback; do not attempt name-based recovery. |
| Packet becomes stale during a decision | Refresh the packet, explain that the record changed, and require the human to review current evidence before any further action. |

## Authoritative resume-target resolver

### Contract

Add an authenticated, system-admin-only resume-detail companion endpoint:

```text
GET /api/resumes/:resumeId/industry-review-targets
```

It returns only safe review-target metadata for the viewed resume:

```ts
type IndustryReviewTarget = {
  workEntryKey: string // opaque, server-issued identifier for one displayed legacy entry
  employerLabel: string
  proposalId?: string
  status?: 'new' | 'researching' | 'ready_for_review' | 'needs_more_evidence' | 'approved' | 'rejected' | 'superseded'
  availability: 'target_available' | 'collection_pending' | 'not_linked'
}
```

The endpoint accepts the resume identity from the authenticated route, not a company identity supplied by the browser. It performs matching server-side using authoritative stored relationships, such as the proposal sample reference for the same source resume identity and stored work-entry fingerprint where available.

`employerLabel` is presentation-only. It must never be used as a lookup key.

### Resolution rules

1. Start from legacy-signaled work-history entries on the viewed resume.
2. Match to a proposal only through a stored source-resume relationship and, where available, the stored work-entry fingerprint. Prefer one current open proposal; a single exact terminal proposal may be returned for audit/history navigation.
3. Return `target_available` only for one unambiguous proposal. If a single open and older terminal record share the same exact link, use the open record.
4. If several candidates remain, return `collection_pending` / `not_linked` rather than choosing one by employer-name similarity.
5. Do not expose other resume identities, sample references, source URLs, or a guessed company key in the response or URL.
6. The existing system-admin authorization remains required. This feature must not widen proposal or evidence visibility across workspaces.

The resolver may return multiple targets for a resume, but the web client renders only those that correspond to currently displayed legacy work-history entries.

## Inbox state ownership

The existing page currently has overlapping parent and Inbox queue/detail state. The implementation must consolidate target selection into one authoritative state path.

`IndustryReviewTargetController`, owned by `SystemSettingsIndustryVerificationPage`, is the single source of truth for the selected proposal ID, direct packet, target-loading/error state, and URL normalization. It has this one-way data flow:

```text
route params → IndustryReviewTargetController → IndustryReviewInbox + detail panel
Inbox row selection → IndustryReviewTargetController.selectTarget() → URL + detail panel
```

Required result:

- One direct-target resolution path shared by the canonical route and query URL.
- `IndustryReviewInbox` owns normal queue fetching, filtering, pagination, and transient-row presentation, but does not fetch review packets or independently set/clear target selection from URL state.
- The visible Inbox row, detail panel, URL, and queue status always refer to the controller's selected proposal snapshot.
- `IndustryReviewInbox` reports the rendered selected-row element through an `onTargetRowReady(proposalId, element)` callback. One controller-driven post-render positioning effect calls `element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' })`, relying on the target-only `scroll-mt-16` offset, then applies focus without another implicit scroll.
- The hidden legacy queue subtree is removed or made fully passive; it must not independently clear a selected target or issue a conflicting queue request.
- With no direct target, the Inbox's DOM order, tab behavior, keyboard order, and scroll behavior stay unchanged from today.

This is a focused stability refactor in service of reliable deep links, not a broad Inbox redesign.

## Safety and data boundaries

- The route is inside the existing system-admin surface and keeps its authorization gate.
- The CTA is visible only where the existing design authorizes the system-admin review action.
- No decision, source selection, canonical-company mapping, or recompute starts when a target is opened.
- The target detail uses the existing evidence-risk acknowledgement and review decision safeguards.
- Before approval, retain the existing safe nonnumeric statement that the decision can update linked resumes. Exact impact aggregation is outside this increment, and the capped sample-reference collection is never a count source.
- This increment does not alter approval policy. For a `new` target with no approval-safe source, the existing policy keeps approval unavailable; the direct-target UX must visibly guide the reviewer toward the existing “Request more evidence” or canonical-mapping workflow. Targets that have usable sources retain the existing attended acknowledgement and approval controls.
- The direct-link feature does not solve broader company-industry tenancy/storage architecture. It must not worsen it: no cross-workspace source-resume details are added to URLs, targets, or cards. A separate scope is required before changing cross-workspace visibility rules.

## API and component boundaries

| Layer | Responsibility |
|---|---|
| System router | Mount the canonical proposal path under the existing system-admin gate and send it to the same Inbox experience. |
| `IndustryReviewTargetController` | Directly fetch and normalize a proposal packet, reconcile status, and own all target loading/error/selection state. |
| Review Inbox | Load/filter/browse normal queue rows and receive the selected target state; it must not independently guess or clear direct targets. |
| Resume detail target resolver | Return authoritative employer-level target metadata for the current resume. |
| `LegacyIndustryEvidenceNotice` | Accept optional per-employer target/action data and render the current generic fallback when none exists. |
| Search results notice | Continue to use only generic aggregate guidance. |
| Approval service | Remain unchanged in authority and impact semantics; exact linked-resume aggregation is a separate follow-up. |

## Error handling

- **Resume target endpoint fails:** Keep the neutral notice and offer the generic Inbox fallback. Do not block viewing the resume.
- **Target route packet request returns 404/403:** Explain the target is unavailable and link to the generic Inbox. Do not silently redirect to a different employer.
- **Target state changed after the resume was rendered:** Use the packet's status, update the normalized URL with `replace`, and display the current state.
- **Target has no durable sources or canonical mapping:** Surface the existing evidence warnings. When the existing source policy marks approval unavailable, keep it unavailable and guide the reviewer to Request more evidence; otherwise retain the existing attended approval safeguards unchanged.
- **Queue request fails after target packet succeeds:** Keep the target detail visible with a queue-unavailable message; never discard a valid direct target merely because browsing rows failed.
- **A decision request returns a stale-fingerprint conflict:** Refresh the target packet and require a new attended review.

## Testing

### Unit and component coverage

- Target resolver returns a proposal only for an authoritative source-resume/work-entry relationship.
- No target is returned from a company display-name match alone.
- Resume detail renders one named CTA per target, generic fallback for unresolved entries, and no action for non-admins.
- Search-results banner remains generic when multiple employers/resumes are represented.
- Direct canonical route and query URL resolve a matching direct packet, normalize to the actual status, and retain the existing Inbox layout.
- For an open target, `filter=all` exposes every recommendation, including `inspect` and `needs_more_evidence`; a later hidden-by-filter state is explained and recoverable. Terminal targets use `filter=history`.
- Target selection works when the row is beyond the first queue page and when it is terminal/history.
- Opening a target whose normal row is loaded positions that row as the first unobscured review-list row, with selected/focus semantics preserved and no queue reordering.
- Opening a target beyond the loaded page renders the transient Selected target row first, then removes it when the regular row becomes available.
- Positioning respects the sticky-header offset and reduced-motion preference.
- Target missing/inaccessible/stale states render explicit non-mutating fallbacks.
- Only one queue/detail state owner exists; race tests prove that a delayed queue response cannot clear a direct target.
- The current safe nonnumeric impact text remains; no count is inferred from capped sample references.
- With no direct target, Inbox DOM order, row count, tab/keyboard behavior, and scroll position remain unchanged.

### API and authorization coverage

- Canonical route and direct packet request require the existing system-admin authorization.
- Resume target resolver requires the same authorization and returns no other resume identities/source references.
- Query/status normalization uses the packet status over a stale query parameter: open statuses normalize to `status=<actual>&filter=all`; terminal statuses normalize to `filter=history`.
- No endpoint accepts a browser-supplied display name as a proposal lookup input.
- Existing approval/recompute behavior remains unchanged; opening any deep link makes no mutation.

### Attended local verification

1. Open a legacy resume with a known exact proposal, including the Vision case.
2. Click its employer-specific action and confirm the existing Inbox selects the correct row/panel.
3. Confirm the selected row is the first unobscured row in the review-list viewport, below the sticky Inbox controls, rather than merely selected off-screen.
4. Confirm a `new`/low-confidence/no-source proposal is visible under `filter=all`, not `approvable`; approval remains unavailable under the existing source policy and the attended next action is Request more evidence.
5. Change the proposal's status in a controlled test fixture and reopen the old link; confirm the target normalizes to its current state.
6. Open an unresolved legacy signal and confirm it receives only generic neutral guidance.
7. Confirm browser console has no errors and no evidence/approval mutation was performed by navigation.

## Non-goals

- A redesign of the Industry Verification Inbox.
- Automatic evidence collection, canonical-company mapping, or approval of Vision Machine Tools.
- Inferring a company/proposal from Google, employer display text, location, or a legacy boolean.
- Making the generic search-results banner employer-specific.
- A broad cross-workspace/tenant data-model migration; that requires a separate security-focused design.
- Changing the existing human evidence-approval policy.

## Acceptance criteria

1. The existing Inbox remains the only review UI.
2. A resume with an authoritative target has a clearly named, employer-specific action.
3. For an authoritative, accessible target at resolution time, that action reaches the exact target regardless of the proposal's current lifecycle status or queue page position.
4. A stale URL updates to the proposal's current status without selecting a different record.
5. Unresolved legacy signals remain neutral and never generate name-inferred routes.
6. Opening a target does not mutate evidence, company mapping, verdict, or recompute state.
7. The review experience accurately communicates source/canonical-mapping risk and safe impact before any human decision.
8. When a target row is available, direct navigation makes it the first unobscured review row in the Inbox viewport without changing the queue's persistent order.
