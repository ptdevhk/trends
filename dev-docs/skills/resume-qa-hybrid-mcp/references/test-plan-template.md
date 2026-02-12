# Resume Screening QA Test Plan (DevTools MCP Hybrid Execution Template)

> **Status**: Execution Template (Not a Completed Report)
> **Default Mode**: Hybrid (`make verify-critical-path` + `make e2e` + DevTools MCP manual validation)
> **Last Updated**: 2026-02-12

## 1. Run Metadata

| Field | Value |
|------|-------|
| Run ID | `RUN-YYYYMMDD-XX` |
| Date | `YYYY-MM-DD` |
| Operator | `name` |
| Env | `local / staging` |
| Build/Commit | `git sha` |
| CONVEX_URL | `http://127.0.0.1:3210` (or actual) |
| Base UI URL | `http://localhost:5173` |
| API URL | `http://localhost:3000` |
| Notes | |

---

## 2. Scope and Defaults

- This plan is reusable for repeat validation runs.
- Automated gates run first, manual DevTools MCP checks run second.
- Default verification parameters:
  - `MODE=dual`
  - `KEYWORD=CNC`
  - `LOCATION=广东`
- Status values used in this plan:
  - `PENDING`
  - `PASS`
  - `DEGRADED_PASS`
  - `FAIL`
  - `BLOCKED`

Rule: every executed case must include non-empty Evidence. Missing Evidence means the case is invalid and must be marked `FAIL` or `BLOCKED`.

---

## 3. Deterministic Preflight and Environment Bootstrap

### 3.1 Command Order (must follow in sequence)

1. Start core services:

```bash
make dev-fast
```

2. Start/reuse Chrome debug instance (CDP):

```bash
make chrome-debug
```

3. Run critical-path verifier in dual mode:

```bash
make verify-critical-path MODE=dual KEYWORD=CNC LOCATION=广东
```

4. Run E2E smoke script:

```bash
make e2e
```

### 3.2 Readiness Checks

| Check ID | Check | Expected | Evidence | Status |
|---------|-------|----------|----------|--------|
| RF-1 | `dev-fast` services | Web/API/Convex reachable without fatal startup errors | terminal snippet/log path | `PENDING` |
| RF-2 | CDP endpoint | Chrome responds on debug port (default 9222) | terminal output from `make chrome-debug` | `PENDING` |
| RF-3 | Verify script run | `verify-critical-path` exits and prints stage statuses | command output snippet/report | `PENDING` |
| RF-4 | E2E script run | `make e2e` completes; critical-path smoke flows executed | command output snippet | `PENDING` |

### 3.3 Execution Decision Rules

1. If `RF-1` or `RF-2` is `FAIL`, stop and mark run `BLOCKED` (do not execute manual MCP cases).
2. Execute Gate A, then Gate B, in that order.
3. If Gate A is `FAIL`, continue only for defect reproduction; release decision remains `NO-GO` unless rerun passes.
4. Execute manual MCP matrix only after Gate A and Gate B outputs are captured as evidence.
5. Any executed row with empty evidence must be downgraded to `FAIL` or `BLOCKED`.

---

## 4. Automated Gates (Scripted)

### Gate Status Semantics (`verify-critical-path`)

- `PASS`: all stage outcomes satisfied.
- `DEGRADED_PASS`: fallback path succeeded; degradation is captured with evidence.
- `FAIL`: critical stage failed or timed out.

### Known Script Limitation (`make e2e`)

- `scripts/e2e-smoke.ts` currently skips error-state test by default (`runErrorStateTest` is commented out). Error handling must be validated manually via MCP cases below.

### Automated Gate Matrix

| Gate | Command | Expected | Observed | Evidence | Status |
|------|---------|----------|----------|----------|--------|
| Gate A | `make verify-critical-path MODE=dual KEYWORD=CNC LOCATION=广东` | Collection/Search/Analysis stage statuses emitted; overall status is `PASS` or accepted `DEGRADED_PASS` | | include stage evidence payload and terminal summary | `PENDING` |
| Gate B | `make e2e` | Smoke script covers collection/search/analysis/bulk action flows and exits successfully | | include terminal output (pass/fail lines) | `PENDING` |

### Gate A Evidence Capture (required)

| Field | Value |
|------|-------|
| Collection status | |
| Search status | |
| Analysis status | |
| Overall status | |
| Fallback used | |
| Collection evidence payload | |
| Search evidence payload | |
| Analysis evidence payload | |

---

## 5. DevTools MCP Manual Validation Matrix

Use DevTools MCP action hints in each row (`navigate`, `fill`, `click`, `wait/snapshot`, `console check`).

| Case ID | MCP Actions | Expected UI/State | Evidence | Status | Blocking |
|--------|----------------------|-------------------|----------|--------|----------|
| CP1-Collection | `navigate('/system/settings')` -> `fill(keyword=CNC, location=广东, limit=10)` -> `click(Start Agent Collection)` -> `wait/snapshot(TaskMonitor)` | Collection toast appears; task row created; progress updates; terminal completion | snapshot + toast text + task status | `PENDING` | Yes |
| CP2-SearchFilter | `navigate('/resumes')` -> `fill(QuickStart keyword)` -> `click(FilterPanel expand)` -> `fill(min exp=3)` -> `click(Clear)` -> `fill('__nohit__')` | Debounced list updates; filter narrows list; clear restores; no-hit shows explicit EmptyState | snapshots before/after each filter state | `PENDING` | Yes |
| CP3-AIAnalysis | `navigate('/resumes')` -> `click(JD selector)` -> `click(Analyze All)` -> `wait/snapshot(AnalysisTaskMonitor)` -> rerun Analyze | Analyze toast shown; progress visible; completion with analyzed count > 0; rerun shows no-new-candidates feedback | task snapshot + toast text + score UI | `PENDING` | Yes |
| CP4-BulkActions | `navigate('/resumes')` -> `click(select checkboxes / select all)` -> `click(Shortlist/Star/Reject/Export)` | Selection count updates; bulk toasts appear; export action confirmed | action snapshots + toast text | `PENDING` | Yes |
| EH-APIFailure | `navigate('/resumes')` + induce API failure -> `click(Retry)` -> recover API -> `click(Retry)` | Error fallback appears with retry; retry behavior deterministic; recovery restores list | error snapshot + recovery snapshot | `PENDING` | Yes |
| TM-ToastMatrix | `console check` + UI actions for success/info/error paths | Toast type/message pairs match expected matrix below | toast log/snapshot set | `PENDING` | No |
| VP-VisualPolish | `wait/snapshot` under loading/empty/error states + optional network throttle | Skeleton/EmptyState/Error visuals render correctly; layout spacing and labels consistent | UI screenshots/snapshots | `PENDING` | No |

### Toast Matrix (manual confirmation)

| Action | Expected Type | Expected Message Pattern | Evidence | Status |
|--------|---------------|--------------------------|----------|--------|
| Analyze All (success path) | `success` | `Analyzing top N candidates` or i18n equivalent | | `PENDING` |
| Analyze All (no new candidates) | `info` | `No new candidates` or i18n equivalent | | `PENDING` |
| Analyze All (error path) | `error` | `aiTasks.error` or localized equivalent | | `PENDING` |
| Bulk shortlist/reject/star | `success` | `N resumes [action]` pattern | | `PENDING` |
| Export | `success` | `Exported N resumes` or localized equivalent | | `PENDING` |
| Bulk action fail | `error` | `Bulk action failed` pattern | | `PENDING` |
| Collection dispatch | `success` | `Collection task dispatched` | | `PENDING` |

### Visual Polish Checklist (manual)

| Item | Expected | Evidence | Status |
|------|----------|----------|--------|
| Skeleton loading | Visible during loading states | | `PENDING` |
| EmptyState | Explicit icon + explanatory text | | `PENDING` |
| Error state | Retry-capable error fallback | | `PENDING` |
| Toast positioning/styling | Consistent placement and auto-dismiss behavior | | `PENDING` |
| Form labels | Readable and consistent typography | | `PENDING` |
| Card/list spacing | No overlap or clipped content | | `PENDING` |
| ErrorBoundary fallback | Graceful fallback on runtime errors | | `PENDING` |

---

## 6. CNC Tokenization and Search Parity Regression Section

Goal: explicitly validate mixed-script token behavior and parity between `/resumes` and debug data page results.

| Regression ID | Query/Input | Expected Count/Parity | Evidence | Status |
|--------------|-------------|-----------------------|----------|--------|
| R-CNC-1 | Query `CNC` on `/resumes` | Positive hits (`> 0`), includes mixed-script content candidates | resume list snapshot + count | `PENDING` |
| R-CNC-2 | Query `__nohit__` on `/resumes` | Explicit EmptyState, no stale rows remain visible | empty-state snapshot | `PENDING` |
| R-CNC-3 | Query `CNC` on `/resumes` vs `/system/data/raw` | Result count parity (or documented expected delta with root-cause note) | side-by-side count evidence | `PENDING` |
| R-CNC-4 | Mixed-script samples (e.g., `东莞CNC编程`, `车床CNC技术员`) | Evidence that mixed-script resumes are discoverable by `CNC` query | sampled card snapshots / extracted text | `PENDING` |

### Regression MCP Hints

- `navigate('/resumes')`, `fill(search=CNC)`, `wait/snapshot`
- `navigate('/system/data/raw')`, `fill(search=cnc)`, `wait/snapshot`
- `console check` for warnings/errors during both queries

---

## 7. Pass/Fail Rubric and Release Gate

### 7.1 Blocking Failures

Any of the following is release-blocking:

- Automated Gate A is `FAIL`.
- Automated Gate B is `FAIL`.
- Any blocking MCP case (`CP1`, `CP2`, `CP3`, `CP4`, `EH-APIFailure`) is `FAIL`.
- Any regression case `R-CNC-*` is `FAIL`.
- Missing required evidence for executed blocking cases.

### 7.2 Degraded-Pass Policy

- `DEGRADED_PASS` is acceptable only when:
  - fallback behavior is expected/documented,
  - no blocking manual case fails,
  - risk and follow-up are logged in Run Log.

### 7.3 Required Artifacts Checklist

| Artifact | Required | Collected | Location/Reference |
|---------|----------|-----------|--------------------|
| `verify-critical-path` output | Yes | `PENDING` | |
| `make e2e` output | Yes | `PENDING` | |
| MCP snapshots/screenshots (critical flows) | Yes | `PENDING` | |
| Error-state evidence | Yes | `PENDING` | |
| Regression evidence (`R-CNC-*`) | Yes | `PENDING` | |
| Console warning/error capture | Yes | `PENDING` | |

Release decision:

- `GO`: all blocking checks pass (or accepted degraded conditions documented).
- `NO-GO`: any blocking failure or missing required artifact.

---

## 8. Run Log (append per execution)

### Run Entry Template

| Field | Value |
|------|-------|
| Run ID | |
| Date/Time | |
| Operator | |
| Env | |
| Build/Commit | |
| Gate A status | |
| Gate B status | |
| Manual blocking cases summary | |
| Regression summary | |
| Final decision (`GO`/`NO-GO`) | |
| Follow-up actions | |

### Defect Log

| Defect ID | Area | Severity | Repro | Evidence | Owner | Status |
|----------|------|----------|-------|----------|-------|--------|
| | | | | | | |

---

## 9. References (Execution Inputs)

- `Makefile`
- `scripts/verify-critical-path.ts`
- `scripts/e2e-smoke.ts`
- `scripts/e2e-utils.ts`
- `dev-docs/qa/critical-path-context.md`
- `dev-docs/qa/critical-path-ui-smoke.md`
- `packages/convex/convex/search_text.ts`
- `packages/convex/convex/migrations.ts`
- `apps/web/src/pages/DebugPage.tsx`
- `apps/api/src/services/__tests__/search-text-builder.test.ts`
- `apps/api/src/services/__tests__/verify-critical-path.test.ts`
