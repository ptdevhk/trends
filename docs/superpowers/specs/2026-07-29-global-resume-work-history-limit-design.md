# Global Resume Work-History Limit Design

## Status

Implemented and verified on 2026-07-29.

## Problem

The latest SEEK detail-enrichment change correctly preserved richer work-history descriptions, but it also removed the existing latest-three boundary from several resume presentation paths. As a result, some UI surfaces can render the full stored career history. The application must keep complete fetched work-history data while restoring a bounded, globally configurable limit for presentation and analysis.

## Goals

- Store all fetched work-history entries and their detailed descriptions.
- Default to the latest three work-history entries.
- Allow a Trends system administrator to configure the global limit from 1 through 10.
- Apply the effective limit consistently to resume UI and future analysis requests.
- Fall back safely to three when the setting is missing, invalid, or unavailable.
- Preserve chronological recency selection through the shared `selectLatestWorkHistory` helper rather than relying on stored array order.

## Non-Goals

- Do not delete or truncate stored resume history.
- Do not add an unlimited or "all entries" mode.
- Do not rewrite existing AI analysis results when the setting changes.
- Do not bulk-reingest historical resumes solely because the setting changes.
- Do not change SEEK detail fetching or the work-history description quality rules.

## Configuration Contract

The global Convex `system_settings` table stores the setting under the key `resumeWorkHistoryLimit`.

- Default: `3`
- Minimum: `1`
- Maximum: `10`
- Effective-value behavior: invalid numbers, non-integers, missing values, and read failures resolve to `3`
- Write behavior: reject values outside the allowed integer range

Shared code exposes the constants and normalization function so the Convex backend, BFF, and web application use one contract.

## Architecture

### Persistence And API

Add typed Convex queries for the public and internal effective limit and a validated mutation for updates. The generic system-setting storage remains the persistence layer, but consumers do not read the unvalidated raw value directly.

Expose a BFF system endpoint for reading the effective value and an admin-protected endpoint for updating it. The update records the authenticated administrator as `updatedBy`. Reads fail closed to the default value of three; invalid writes return a validation error.

### Admin UI

Add a `Resume work-history limit` card to `/admin/system/settings/runtime`.

The card contains:

- A numeric input with `min=1`, `max=10`, and integer stepping.
- The currently effective value.
- Copy explaining that complete history remains stored while display and future analysis use only the latest configured entries.
- A dedicated save button and loading, success, and error states.

The UI rejects invalid input before submission, while server validation remains authoritative.

### Admin Navigation And Ownership

The two system-settings pages have different responsibilities:

- `/admin/system/settings/runtime` is the **editable source of control**. Administrators change and save the global limit here.
- `/admin/system/settings/config-sources` is a **read-only inspection surface**. Its `Resume display limits` card reports the currently effective value and identifies the source as `system_settings.resumeWorkHistoryLimit`; it does not edit the setting.

Changing the value on Runtime updates the shared web context immediately. Config Sources reports the same persisted effective value after loading or refreshing, preventing the former hard-coded default from being mistaken for a separate configuration.

### UI Data Flow

Provide a small web hook/context for the effective global limit. If loading fails, the hook returns three. Resume presentation surfaces call `selectLatestWorkHistory(workHistory, { limit })` after field-usage sanitization.

Covered presentation surfaces include:

- Resume cards.
- Resume detail dialogs.
- Expanded search-result cards.
- Compact search-result work-history summaries.

Convex list and detail projections must retain enough recent entries to support the maximum configurable value without exposing unbounded arrays. They project at most the latest ten entries, preserving detailed descriptions. The web layer then applies the effective configured limit. This keeps the configuration immediately responsive without truncating persisted source data.

### Analysis Data Flow

Every analysis entry point resolves the global setting when an analysis request begins and passes the limit explicitly into work-history preparation.

Covered analysis paths include:

- BFF sample and Convex resume matching.
- Convex single-resume and batch analysis.
- Rule-scoring and strict work-history evidence preparation used by those workflows.

Candidate companies and textual work-history evidence are derived from the selected latest entries. Derived role-signal and company-hit inputs must not reintroduce evidence tied exclusively to entries outside the selected set. Existing stored analysis results are not mutated; rerunning analysis uses the new setting.

### Failure Behavior

- Setting read unavailable: use `3` and continue the request.
- Stored value invalid: use `3` and surface the effective fallback in the admin UI.
- Admin save invalid: reject without modifying the stored value.
- Analysis receives no work history: preserve the existing empty-evidence behavior.
- Detailed descriptions unavailable: preserve existing fallback formatting from structured fields and `raw` text.

## Testing

### Shared

- Default selection returns the latest three entries.
- Explicit limits from 1 through 10 are honored.
- Invalid configuration values normalize to three.
- Recency ordering remains date-based and stable.

### Convex And BFF

- Setting queries return three when no row exists or the stored value is invalid.
- Setting writes reject non-integers and values outside 1 through 10.
- List/detail projections retain no more than ten entries and preserve descriptions.
- Analysis preparation excludes the fourth-oldest entry under the default setting.
- Analysis preparation includes the configured fourth/fifth entries when the limit is raised.
- Lowering the limit excludes companies, evidence, and matched-role details from older entries.

### Web

- Admin Runtime settings loads, edits, validates, and saves the limit.
- Resume detail and expanded search cards render only three entries by default.
- UI surfaces honor a non-default configured limit.
- A configuration fetch failure still renders only three entries.

### Regression Verification

- The Nicole Lim SEEK fixture continues to retain and render full detailed descriptions for the selected entries.
- Browser-extension extraction and enrichment tests remain green because storage and detail fetching are unchanged.
- Browser verification confirms the default UI shows three entries and the admin setting changes the visible count without recollection.

## Rollout

No data migration is required. Deploying without a `resumeWorkHistoryLimit` row produces the current intended default of three. An administrator may change the value after deployment. Existing analysis records remain valid snapshots of the configuration in effect when they were generated and update only when analysis is rerun.

## Implementation Closeout

The implementation is complete in the current working tree.

- Shared, Convex, API, and SEEK regression suites: `491/491` passed.
- Affected web suites: `102/102` passed.
- `bun run check`: passed across package typechecks and web/browser-extension lint.
- Shared, Convex, API, and web production builds: passed.
- Browser verification changed the setting from `3` to `4`, confirmed Nicole Lim immediately displayed four detailed roles without recollection, then reset the value to `3` and confirmed only the latest three roles remained visible.
- Nicole Lim's detailed TERRAN responsibilities remained intact throughout the verification.
- Live API closeout returned `limit: 3`, and Config Sources reported `system_settings.resumeWorkHistoryLimit` with effective value `3`.
