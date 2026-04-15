# Resume Analyze Regressions And Score Debug Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reproduce and isolate the merged `resume analyze` regressions and the downstream `relatedExp` / `recommendation` issues on a deterministic local dataset, then produce a root-cause report that cleanly separates CLI packaging problems, analyze/search candidate-parity problems, and score-display problems.

**Architecture:** This investigation has two tracks. Track A is command-surface parity: compare the checked-in CLI source, the compiled `./bin/trends` binary, and the live API to determine whether `resume analyze` and `resume debug analysis-tasks` are missing because of stale packaging or actual backend defects. Track B is clean-dataset analysis parity: reset the local resume database, restore the shared sample snapshots, clear restored AI analyses, and then compare `resume search`, `resume analyze`, stored Convex analysis data, and the `/dev/resumes` UI using the same query family.

**Tech Stack:** Make, Go CLI, Hono API, Convex, React/Vite, browser dev UI

## Execution Status (2026-04-15)

- Completed all checklist tasks in this plan.
- Regression 1 primary root cause confirmed: stale compiled `./bin/trends` command surface diverged from source (`go run`) and API.
- Regression 2 primary root cause confirmed: analyze/search request-shape drift (notably `location` vs Convex paginated search contract) caused candidate-parity failures.
- `relatedExp` scoring behavior normalized at Convex write-time:
  - preserve raw `breakdown.related_exp` as `0-100`
  - score contribution uses `related_exp * 0.5`
  - recommendation derived from normalized score thresholds.
- `recommendation` pipeline aligned to normalized score thresholds:
  - `strong_match >= 85`, `match >= 70`, `potential >= 40`, else `no_match`.
- Prompt spec updated to v4 with explicit `related_exp` band guidance and sales-specific instruction.
- Target entry correction verified:
  - resume: `k176cmvm479sbj1chphgnz3zdx84wmg3`
  - rerun task: `j973asrnqmrsyc0jt5qrhzzzp184wx73`
  - latest stored analysis now consistent:
    - `score: 90`
    - `recommendation: strong_match`
    - `breakdown.related_exp: 80`
    - `breakdown.industry_db: 50`
    - summary no longer contains stale `score 58` / potential-match wording conflict.

---

## Scope Note

The request says four regressions appeared after merging `resume analyze`, but only two are currently specified:

1. `resume debug analysis-tasks` returns 404 / does not behave like a valid command.
2. `resume analyze` returns zero candidates while `resume search` finds hits.

This plan explicitly covers those two regressions plus the previously requested `relatedExp` and `recommendation` tracing, because those fields depend on successful analysis dispatch and retrieval. The remaining two regressions can be appended later once they are specified.

## Current Evidence Snapshot

Use this evidence to guide the first hypotheses, not as a substitute for rerunning the steps below:

- `packages/cli/cmd/resume.go` registers `newResumeAnalyzeCmd()`.
- `packages/cli/cmd/resume_debug.go` registers `newResumeDebugAnalysisTasksCmd()`.
- `apps/api/src/routes/resumes.ts` exposes `GET /api/resumes/analysis-tasks`.
- The checked-in source CLI works:
  - `cd packages/cli && go run . resume analyze --help`
  - `cd packages/cli && go run . resume debug analysis-tasks --help`
- The current compiled `./bin/trends` does **not** list those commands in help output.
- `curl http://localhost:3000/api/resumes/analysis-tasks` currently returns successful task data.
- `go run . resume analyze --query 'CNC 销售' --dry-run -o json` currently returns a non-zero `resumeCount`.
- `go run . resume analyze --query 'CNC 销售' --location China --dry-run -o json` currently fails with a Convex validator error because the analyze route passes an unsupported extra field `location` into `resumes:searchWithTagExpansionPaginated`.

## File Map

- `Makefile`
  - Canonical repo shortcuts for `cli-build`, `restore-sample-snapshots`, and `clear-resume-analyses`.
- `packages/cli/cmd/resume.go`
  - Registers `resume analyze`.
- `packages/cli/cmd/resume_debug.go`
  - Registers `resume debug analysis-tasks`.
- `packages/cli/internal/client/api.go`
  - CLI client methods for `/api/resumes/analyze` and `/api/resumes/analysis-tasks`.
- `packages/cli/cmd/resume_test.go`
  - Existing tests for `resume analyze`.
- `packages/cli/cmd/resume_debug_test.go`
  - Existing tests for `resume debug analysis-tasks`.
- `apps/api/src/schemas/resumes.ts`
  - Analyze request/response schemas.
- `apps/api/src/routes/resumes.ts`
  - API routes for `GET /api/resumes`, `POST /api/resumes/analyze`, and `GET /api/resumes/analysis-tasks`.
- `apps/api/src/services/resume-service.ts`
  - Keyword expansion and local resume filtering behavior.
- `scripts/resume/restore-resumes.ts`
  - Restore semantics. Important: restore defaults to `MODE=upsert`; `RECOMPUTE_DERIVED_FIELDS=1` does not clear AI analysis state.
- `packages/convex/convex/resumes.ts`
  - `searchWithTagExpansionPaginated` validator and implementation.
- `packages/convex/convex/analysis_tasks.ts`
  - Analysis dispatch, task processing, and stored `breakdown` / `recommendation`.
- `config/resume/ai-prompts.en.md`
  - Prompt contract for raw `related_exp` and AI `recommendation`.
- `apps/web/src/lib/resume-scoring.ts`
  - Web normalization for `related_exp` and recommendation coercion.
- `apps/web/src/hooks/useResumeSearchState.ts`
  - `/dev/resumes` result construction and AI-score wiring.
- `apps/web/src/pages/DebugAI.tsx`
  - Raw analysis JSON debug surface for inspecting stored `breakdown.related_exp` and `recommendation`.
- `apps/web/src/components/ResumeDetail.tsx`
  - UI translation of recommendation labels.

### Task 1: Verify CLI Command Surface Against Source And API

**Files:**
- Verify: `Makefile:703-705`
- Verify: `packages/cli/cmd/resume.go:15-31`
- Verify: `packages/cli/cmd/resume_debug.go:250-269`
- Verify: `packages/cli/internal/client/api.go:558-646`
- Verify: `packages/cli/cmd/resume_test.go:233-319`
- Verify: `packages/cli/cmd/resume_debug_test.go:626-749`
- Verify: `apps/api/src/routes/resumes.ts:4776-4809`

- [x] **Step 1: Capture the current compiled CLI surface**

Run:
```bash
./bin/trends resume --help
./bin/trends resume debug --help
./bin/trends resume debug analysis-tasks
```

Expected:
- The output is captured verbatim.
- The matrix records whether `analyze` and `analysis-tasks` appear in help.
- If `analysis-tasks` is missing, the command behavior is recorded exactly instead of summarized from memory.

- [x] **Step 2: Capture the source-of-truth CLI surface from `go run`**

Run:
```bash
cd packages/cli && go run . resume analyze --help
cd packages/cli && go run . resume debug analysis-tasks --help
```

Expected:
- Both commands are available from source.
- Any difference from `./bin/trends` is now proven to be a binary or build artifact problem, not a missing source implementation.

- [x] **Step 3: Probe the live API directly**

Run:
```bash
curl -sS http://localhost:3000/api/resumes/analysis-tasks
```

Expected:
- Response is captured as raw JSON.
- If the route returns `success: true`, the backend is not missing the endpoint.

- [x] **Step 4: Rebuild the local CLI binary**

Run:
```bash
make cli-build
./bin/trends resume --help
./bin/trends resume debug --help
```

Expected:
- The rebuilt binary reflects the current source tree.
- If the rebuilt binary now lists `analyze` and `analysis-tasks`, the primary root cause is stale packaging or an outdated checked-in binary.
- If the rebuilt binary still omits them, inspect the build target and command registration before any deeper backend work.

- [x] **Step 5: Record the command-surface root cause**

Choose one:
- Stale compiled `./bin/trends` binary.
- CLI source registration bug.
- API endpoint bug.
- More than one layer is broken.

Expected:
- Exactly one primary root cause is chosen for regression 1.

### Task 2: Reset And Restore A Deterministic Dataset

**Files:**
- Verify: `Makefile:401-411`
- Verify: `scripts/resume/restore-resumes.ts:17-44`
- Verify: `scripts/resume/restore-resumes.ts:263-304`
- Verify: `apps/api/src/routes/resumes.ts:670-698`
- Verify: `apps/api/src/routes/resumes.ts:4950-5084`
- Verify: `packages/cli/cmd/resume_debug.go:383-424`
- Verify: `packages/cli/cmd/resume_debug.go:814-861`

- [x] **Step 1: Preview the destructive reset before changing state**

Run:
```bash
./bin/trends resume debug reset-database --dry-run
```

Expected:
- Command succeeds.
- Output includes `would_delete_total`.
- The report confirms this will clear resume, analysis, and related review data in the local debug workspace.

- [x] **Step 2: Reset the local resume database completely**

Run:
```bash
./bin/trends resume debug reset-database --yes
```

Expected:
- Command succeeds.
- Output includes `deleted_total`.
- No old resumes, old analyses, old analysis tasks, or old search-profile state remain in the local debug workspace.

- [x] **Step 3: Restore the shared sample snapshot dataset**

Run:
```bash
make restore-sample-snapshots
```

Expected:
- Pull step succeeds.
- Restore summary points at `output/resume-samples`.
- Restore summary shows `"recomputeDerivedFields": true`.

- [x] **Step 4: Clear restored AI analyses so the next analysis run is fresh**

Run:
```bash
./bin/trends resume debug clear-analyses --dry-run
./bin/trends resume debug clear-analyses
```

Expected:
- Dry-run returns `would_clear`.
- Execute returns `cleared`.
- Restored snapshot resumes no longer carry stale `analysis` / `analyses` state from the backup payload.

- [x] **Step 5: Verify the clean dataset is queryable**

Run:
```bash
cd packages/cli && go run . --workspace dev --api-url http://localhost:3000 resume search 'CNC 销售' --source convex --limit 10 -o json
cd packages/cli && go run . --workspace dev --api-url http://localhost:3000 resume debug workflow-dataset --query 'CNC 销售' --location China --limit 50 --top 10 --output json
```

Expected:
- Search returns non-empty results.
- Workflow dataset output shows deterministic `queryMatchCount` / `visibleCount` for the restored sample dataset.

### Task 3: Compare `resume analyze` Candidate Selection With `resume search`

**Files:**
- Verify: `apps/api/src/schemas/resumes.ts:1206-1237`
- Verify: `apps/api/src/routes/resumes.ts:5167-5303`
- Verify: `apps/api/src/routes/resumes.ts:2280-2410`
- Verify: `apps/api/src/services/resume-service.ts:565-570`
- Verify: `packages/convex/convex/resumes.ts:1948-1983`

- [x] **Step 1: Capture the no-location parity baseline**

Run:
```bash
cd packages/cli && go run . --workspace dev --api-url http://localhost:3000 resume search 'CNC 销售' --source convex --limit 10 -o json
cd packages/cli && go run . --workspace dev --api-url http://localhost:3000 resume analyze --query 'CNC 销售' --dry-run -o json
```

Expected:
- Both commands return successful responses.
- A parity table records:
  - search `summary.total`
  - analyze `resumeCount`
  - whether the counts are equal, near-equal, or materially different

- [x] **Step 2: Capture the location-filter parity case**

Run:
```bash
cd packages/cli && go run . --workspace dev --api-url http://localhost:3000 resume debug workflow-dataset --query 'CNC 销售' --location China --limit 50 --top 10 --output json
cd packages/cli && go run . --workspace dev --api-url http://localhost:3000 resume analyze --query 'CNC 销售' --location China --dry-run -o json
```

Expected:
- Workflow dataset returns non-zero query/visible counts if the clean dataset has China-matching candidates.
- Analyze either:
  - returns a non-zero `resumeCount`,
  - returns zero while workflow/search show hits,
  - or errors.
- Any mismatch is captured as the reproducible regression shape.

- [x] **Step 3: Probe the analyze API directly with and without `location`**

Run:
```bash
curl -sS -X POST http://localhost:3000/api/resumes/analyze \
  -H 'Content-Type: application/json' \
  -H 'X-Workspace-Slug: dev' \
  -d '{"query":"CNC 销售","dryRun":true}'

curl -sS -X POST http://localhost:3000/api/resumes/analyze \
  -H 'Content-Type: application/json' \
  -H 'X-Workspace-Slug: dev' \
  -d '{"query":"CNC 销售","location":"China","dryRun":true}'
```

Expected:
- The exact API response for each case is captured.
- If the location case fails or diverges, the regression is isolated to request-shape translation rather than CLI formatting.

- [x] **Step 4: Trace the analyze request-shape mismatch**

Focus on:
- `apps/api/src/routes/resumes.ts` currently builds `searchArgs` with `location`
- `packages/convex/convex/resumes.ts` validator accepts `locations`, not `location`

Expected:
- A yes/no conclusion is recorded for this hypothesis:
  - `resume analyze` diverges because the route passes unsupported or inconsistent filter fields into the Convex paginated search query.

- [x] **Step 5: Record the candidate-parity root cause**

Choose one:
- Request-shape mismatch between analyze and paginated search.
- Keyword-expansion mismatch.
- Filter-default mismatch.
- Dataset-state mismatch.
- More than one layer is broken.

Expected:
- Exactly one primary root cause is chosen for regression 2.

### Task 4: Dispatch Analysis And Validate Task Listing End To End

**Files:**
- Verify: `packages/convex/convex/analysis_tasks.ts:180-257`
- Verify: `packages/convex/convex/analysis_tasks.ts:360-463`
- Verify: `packages/convex/convex/analysis_tasks.ts:620-778`
- Verify: `apps/api/src/routes/resumes.ts:4776-4809`
- Verify: `apps/api/src/routes/resumes.ts:5239-5298`

- [x] **Step 1: Dispatch a small deterministic analysis batch**

Run:
```bash
cd packages/cli && go run . --workspace dev --api-url http://localhost:3000 resume analyze --query 'CNC 销售' --limit 5 -o json
```

Expected:
- Response includes `taskId`.
- Response includes non-zero `resumeCount`.

- [x] **Step 2: Verify the task is visible through all three surfaces**

Run:
```bash
curl -sS http://localhost:3000/api/resumes/analysis-tasks
cd packages/cli && go run . --workspace dev --api-url http://localhost:3000 resume debug analysis-tasks -o json
./bin/trends --workspace dev --api-url http://localhost:3000 resume debug analysis-tasks
```

Expected:
- API and source CLI show the task.
- The compiled binary either shows the task too, or still fails because of the command-surface regression from Task 1.

- [x] **Step 3: Wait for completion and capture the final task record**

Run:
```bash
curl -sS http://localhost:3000/api/resumes/analysis-tasks
```

Expected:
- A completed task record exists with:
  - `status`
  - `config.resumeCount`
  - `results.analyzed`
  - `results.avgScore`

### Task 5: Trace `relatedExp` From Stored Raw Analysis To Search-Page Display

**Files:**
- Verify: `config/resume/ai-prompts.en.md:66-84`
- Verify: `packages/convex/convex/analysis_tasks.ts:117-138`
- Verify: `packages/convex/convex/analysis_tasks.ts:681-714`
- Verify: `apps/web/src/pages/DebugAI.tsx:57-95`
- Verify: `apps/web/src/lib/resume-scoring.ts:474-489`
- Verify: `apps/web/src/hooks/useResumeSearchState.ts:775-802`

- [x] **Step 1: Open the exact search-page reproduction on the clean dataset**

Navigate:
```text
http://localhost:5173/dev/resumes?location=China&q=CNC+%E9%94%80%E5%94%AE&minRoleYears=2&minAge=25&maxAge=40
```

Expected:
- The page loads using the restored clean dataset.
- The visible list is stable and no longer contaminated by older local data.

- [x] **Step 2: Sample 5-10 analyzed resumes from the result set**

Record:
- resume ID
- displayed AI score
- displayed `relatedExp`
- displayed recommendation label
- latest work title

Expected:
- One evidence table exists before any root-cause claim is made.

- [x] **Step 3: Inspect raw stored analysis data**

Navigate:
```text
http://localhost:5173/dev/system/ai-debugger
```

For the sampled resumes, record:
- `analysis.score`
- `analysis.breakdown.related_exp`
- `analysis.recommendation`
- `analysis.summary`

Expected:
- Raw stored Convex analysis data is visible for the same sampled resumes.

- [x] **Step 4: Compare raw `related_exp` against displayed `relatedExp`**

Use this relation:
```text
displayed relatedExp = Math.round(clamp(raw related_exp, 0, 100) * 0.5)
```

Expected:
- If the formula holds, the UI transform is working as coded.
- If the formula does not hold, the bug is in frontend normalization or stale-analysis selection.

- [x] **Step 5: Decide which layer compresses the `relatedExp` range**

Interpretation rules:
- Raw `related_exp` already clustered around `40-60`:
  prompt/model calibration or dataset composition is the issue, not the weighting formula.
- Raw `related_exp` spans wide values such as `10-95`, but `/dev/resumes` still shows `20-30`:
  frontend transformation or wrong analysis selection is the issue.
- Raw values are stale or unexpectedly identical:
  restored-state or analysis-reuse behavior is the issue.

### Task 6: Trace `recommendation` From Analysis Storage To UI Label

**Files:**
- Verify: `packages/convex/convex/analysis_tasks.ts:117-138`
- Verify: `apps/web/src/lib/resume-scoring.ts:99-113`
- Verify: `apps/web/src/hooks/useResumeListState.ts:1541-1570`
- Verify: `apps/web/src/hooks/useResumeSearchState.ts:374-392`
- Verify: `apps/web/src/components/ResumeDetail.tsx:169-174`
- Verify: `apps/api/src/services/ai-matching.ts:638-645`
- Verify: `apps/api/src/services/ai-matching.ts:783-798`

- [x] **Step 1: Compare raw stored `analysis.recommendation` against the UI label**

For each sampled resume, record:
- raw Convex `analysis.recommendation`
- rendered UI label on `/dev/resumes` or the detail panel
- total AI score

Expected:
- Every sampled row shows whether the UI faithfully surfaces the stored recommendation or coerces it.

- [x] **Step 2: Check recommendation-score consistency**

Use this consistency table:
- `score >= 85` should usually align with `strong_match`
- `70-84` should usually align with `match`
- `50-69` should usually align with `potential`
- `< 50` should usually align with `no_match`

Expected:
- A mismatch table exists.

- [x] **Step 3: Separate the two recommendation pipelines**

Interpretation rules:
- `/dev/resumes` keyword-analysis path uses `packages/convex/convex/analysis_tasks.ts`, which stores the LLM-provided recommendation string or defaults to `potential`.
- The API-side `AIMatchingService` normalizes recommendation from score, but that is **not** the main source of truth for the `/dev/resumes` analysis-task flow.
- The web `toRecommendation()` helper only coerces invalid strings; it does not realign a valid but inconsistent recommendation with score thresholds.

Expected:
- The debug report names the correct pipeline instead of mixing Convex-analysis behavior with API-matching behavior.

- [x] **Step 4: State a single recommendation root-cause hypothesis**

Choose one:
- Stored recommendation is wrong because the model is inconsistent with its own score.
- Stored recommendation is acceptable, but the UI expectation is wrong.
- UI coercion or translation is masking the true stored recommendation.

Expected:
- Exactly one primary hypothesis is chosen for the next implementation step.

### Task 7: Produce A Root-Cause Report And Minimal Fix Order

**Files:**
- Verify: `packages/cli/cmd/resume_test.go`
- Verify: `packages/cli/cmd/resume_debug_test.go`
- Verify: `apps/api/src/routes/resumes.ts`
- Verify: `packages/convex/convex/analysis_tasks.ts`
- Verify: `apps/web/src/lib/resume-scoring.test.ts`
- Verify: `apps/web/src/hooks/useResumeSearchState.test.tsx`

- [x] **Step 1: Write the regression report**

The report must include:
- command-surface parity matrix (`./bin/trends` vs `go run` vs API)
- clean-dataset reset / restore commands actually used
- analyze/search parity table
- raw `related_exp` vs weighted `relatedExp`
- raw `recommendation` vs displayed label
- one primary root cause for regression 1
- one primary root cause for regression 2
- one primary root cause for `relatedExp`
- one primary root cause for `recommendation`

- [x] **Step 2: Define the fix order**

Prioritize in this order:
1. CLI packaging / stale binary issue, if confirmed
2. analyze/search request-shape parity issue
3. `relatedExp` range issue
4. `recommendation` inconsistency issue

- [x] **Step 3: Queue failing tests before any code fix**

If fixes are required, start with tests in:
```text
packages/cli/cmd/resume_test.go
packages/cli/cmd/resume_debug_test.go
apps/api/src/routes/resumes.ts route tests
apps/web/src/lib/resume-scoring.test.ts
apps/web/src/hooks/useResumeSearchState.test.tsx
```

Expected:
- No implementation starts until the debug report points to one clear failing behavior per regression.
