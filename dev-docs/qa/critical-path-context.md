# Critical Path Context: Collection -> Search -> Analysis

## Scope
This document is the in-repo source of truth for verifying the resume critical path in a fresh worktree.

## Preconditions
- Services are running with project-standard commands (`make dev` or equivalent split services).
- `CONVEX_URL` is reachable by scripts and UI.
- At least one resume source is available (live crawl or seeded sample).

## Expected Outcomes

### 1) Collection
- Dispatch succeeds and a collection task is created.
- Task progress is observable (`pending`/`processing` updates with current/page changes).
- Task reaches a terminal state.
- Success terminal state is `completed`.
- Resumes are visible after completion (`resumes.list` returns records and UI list is not empty).

### 2) Search
- Keyword search narrows the visible list for matching content.
- Active filters (keyword/location/min score) reduce or preserve list deterministically, never expanding for stricter criteria.
- Empty-state behavior is explicit when no records match (no silent failure, no stale previous list).

### 3) Analysis
- Analysis dispatch succeeds for selected candidates.
- Analysis progress is observable (`pending`/`processing` with progress counters).
- Task reaches `completed` with `results.analyzed > 0`.
- Candidate score visibility is present (score badges/cards/summary).
- Re-running analysis without new candidates shows explicit "no new candidates" feedback.

## Status Definitions
- `PASS`: All expected outcomes for a stage are satisfied.
- `DEGRADED_PASS`: Core outcome satisfied via fallback path, with non-blocking degradation clearly captured in evidence.
- `FAIL`: Stage cannot satisfy critical expected outcomes (dispatch/progress/completion/searchability/analysis results), or times out.

## Evidence Requirements
- Stage status (`PASS` / `DEGRADED_PASS` / `FAIL`).
- Direct evidence payload (task IDs, progress snapshots, hit counts, analyzed counts).
- Search-stage evidence must include `rawHitCount`, `identityDistinctHitCount`, and sentinel `sentinelNoHitCount`.
- Error message when status is not `PASS`.
- `fallbackUsed` flag for fallback execution visibility.
