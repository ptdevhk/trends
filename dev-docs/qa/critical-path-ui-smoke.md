# Critical Path UI Smoke (10 Minutes)

Run this after `verify-critical-path` script. Focus only on UI-visible behaviors automation cannot assert.

## 1) Collection Toast + Task Monitor
- Action: Trigger collection from UI (Quick Start / collection entry).
- Expected result: A start toast appears, and `TaskMonitor` shows a new active task with status + progress updates.
- Failure signal: No toast, no new task row, or progress never changes.

## 2) Collection Completion Visibility
- Action: Wait for collection terminal state.
- Expected result: Task status reaches `Completed`; resume list shows records.
- Failure signal: Task stuck in `pending`/`processing`, or completed task with empty resume list.

## 3) Search Narrowing + Empty State
- Action: Search with a known-positive keyword (example: `CNC`), then with sentinel no-hit keyword (`__nohit__`).
- Expected result: Positive keyword returns visible rows; no-hit keyword shows explicit empty state.
- Failure signal: Positive query returns nothing despite known matches, or no-hit query still shows stale rows.

## 4) Analysis Toast + Analysis Task Monitor
- Action: Run Analyze for current candidates.
- Expected result: Start toast appears; `AnalysisTaskMonitor` shows active task, then `Completed` with analyzed count and average score.
- Failure signal: Missing toast, missing monitor entry, failed/cancelled task without actionable error.

## 5) Score Badge Visibility
- Action: Inspect analyzed candidates in list/detail.
- Expected result: Score badges/score text is visible and consistent with analysis result.
- Failure signal: Analysis completed but score not shown in candidate UI.

## 6) Re-run No-New-Candidates Feedback
- Action: Re-run Analyze immediately without new ingestion.
- Expected result: UI shows explicit no-new-candidates feedback (toast/message), and no redundant analysis task is created.
- Failure signal: Silent no-op or duplicate analysis run for already analyzed candidates.

## Nightly Loop Expectations (2026-08-12)

The 6 steps above are exercised every ~30–40 min by the unattended nightly UAT loop.
Hard-won expectations — keep them true:

- **Empty state vs failure panel**: a genuinely empty search shows the explicit empty
  state; a dropped/failed search shows the failure panel with 重试. Assert the right
  one — `__nohit__` must show the empty state, never the panel (F11).
- **Search narrowing**: `CNC` → 200+ rows; `__nohit__` → empty state. Note the default
  new-only status filter: after e2e bulk actions shortlist results, `sales` looks empty
  until `?status=shortlisted` — expected, not a bug (F19).
- **Re-run feedback (step 6)**: the Analyze button disables when there is nothing to
  analyze; the "no new candidates" toast path is unreachable at
  `VITE_ANALYSIS_TOP_N=200`. The failure signal is a redundant task, not a missing toast (F5).
- **Console-error gate**: 0 app console errors per route walk. Foreign-page noise
  (extension tab-hijacks to job5156, unload permission violations) does not count (F18b).
- **Sessions**: the chrome-debug profile is shared across UAT roles; re-login per role
  (hr-demo → demo-admin → uat-reviewer). `/admin/*` routes silently bounce
  non-dev-admins to the workspace home (F2/F12).
- **Reviewer workflow**: 查看 opens detail with no SystemAccessGate bounce; prev/next is
  queue-ordered (no wrap to head/tail); scroll-to-detail requires the tab to be in
  foreground (backgrounded tabs throttle rAF — F16).
