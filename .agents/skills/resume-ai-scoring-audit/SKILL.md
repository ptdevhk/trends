---
name: resume-ai-scoring-audit
description: Reproduce and audit Trends resume AI scoring against an HR-reviewed cohort. Use when restoring a target resume DB version, resetting/reingesting computed resume evidence, rerunning AI analysis for a JD/query, exporting current scores, or producing HR feedback audit CSV/JSON artifacts from a reference export.
---

# Resume AI Scoring Audit

## Overview

Run a repeatable Trends resume scoring audit from a known resume backup/version to HR-reviewable CSV and JSON artifacts. Prefer repo CLI commands for restore, reset, analysis, and export; use the bundled audit script to join current exports back to the HR reference cohort by stable profile resume ID, not Convex resume ID.

## Safety Rules

- Treat restore/reset/reingest commands as destructive. Confirm the target API/workspace and backup path before execution unless the user already approved the exact operation.
- Never match restored resumes by old Convex `Resume ID`; those IDs change after restore/reimport. Match by `Profile Resume ID`, `Profile URL resumeId=...`, or stable external ID.
- Export the full current DB when possible, then extract the HR cohort from that export. Query-limited exports can miss target resumes and create false audit gaps.
- Record the code commit, backup file, API URL, workspace, analysis target, output CSV, and audit JSON in the final report.
- Do not mix scoring-policy experiments with audit tooling. If a scoring fix is rejected, rollback the fix separately and keep this skill focused on reproducible measurement.

## Workflow

Run commands from the Trends repo root.

1. Confirm the local stack is aimed at the right API/workspace.

```bash
git rev-parse --short HEAD
./bin/trends system config --output json
./bin/trends resume list --limit 5 --output json
```

2. Restore the target resume DB backup in replace mode.

```bash
./bin/trends resume restore <backup-file-or-run-dir> --mode replace --yes --api-url http://localhost:3000 --workspace dev --output json
```

Use `make local-restore-from-prod FILE=<path>` only when the user specifically wants the Makefile wrapper. Prefer the CLI for audit logs because it is easier to parameterize.

3. Reset computed ingest and AI analysis, then schedule full reingest.

```bash
./bin/trends resume debug hard-reset-reingest --dry-run --api-url http://localhost:3000 --workspace dev --output json
./bin/trends resume debug hard-reset-reingest --yes --api-url http://localhost:3000 --workspace dev --output json
```

4. Watch reingest and analysis readiness.

```bash
./bin/trends resume debug diagnostics --api-url http://localhost:3000 --workspace dev --output json
./bin/trends resume debug analysis-tasks --api-url http://localhost:3000 --workspace dev --output json
```

If many resumes still lack ingest evidence, wait and re-check before dispatching AI scoring.

5. Export the current DB identity snapshot. Do not dispatch broad analysis for the audit cohort.

```bash
STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%3NZ)"
CURRENT_EXPORT="$HOME/Documents/resumes-export-current-db-${STAMP}.csv"
./bin/trends resume export --format csv --limit 5000 --out "$CURRENT_EXPORT" --api-url http://localhost:3000 --workspace dev
```

6. Extract the preliminary HR cohort audit CSV/JSON and stable target manifest.

```bash
REFERENCE_CSV="${REFERENCE_CSV:-$HOME/Documents/resumes-export-reference-hr-feedback-34.csv}"
AUDIT_CSV="$HOME/Documents/resumes-export-current-db-hr-feedback-34-${STAMP}.csv"
AUDIT_JSON="${AUDIT_CSV%.csv}.audit.json"
TARGET_MANIFEST="${AUDIT_CSV%.csv}.targets.json"
python3 .agents/skills/resume-ai-scoring-audit/scripts/audit_hr_feedback_export.py \
  --reference-csv "$REFERENCE_CSV" \
  --current-export "$CURRENT_EXPORT" \
  --out-csv "$AUDIT_CSV" \
  --out-json "$AUDIT_JSON" \
  --out-manifest "$TARGET_MANIFEST" \
  --expected-count 34
```

The target manifest preserves reference order and carries stable profile/external selectors plus the current Convex ID when available. Resolve it before any live target-scoped operation:

```bash
./bin/trends resume debug reingest --manifest "$TARGET_MANIFEST" --dry-run --api-url http://localhost:3000 --workspace dev --output json
./bin/trends resume debug reingest --manifest "$TARGET_MANIFEST" --yes --wait --api-url http://localhost:3000 --workspace dev --output json
```

Preview exact persisted analysis for the resolved cohort. This is non-mutating and must report `mode: "exact"`, `requestedCount: 34`, `resolvedCount: 34`, 34 ordered targets/current IDs, and the expected analysis job-description ID and prompt version:

```bash
./bin/trends resume analyze --manifest "$TARGET_MANIFEST" --query "CNC 销售" --dry-run --api-url http://localhost:3000 --workspace dev --output json
```

After checking the dry-run evidence, dispatch and wait on that exact task. The CLI polls only the task-by-ID endpoint:

```bash
./bin/trends resume analyze --manifest "$TARGET_MANIFEST" --query "CNC 销售" --yes --wait --wait-timeout 10m --poll-interval 2s --api-url http://localhost:3000 --workspace dev --output json
```

Retain the live JSON evidence: non-empty task ID, dispatch timestamp, expected analysis job-description ID, prompt version, and final verification with `allReady: true`, `ready: 34`, `pending: 0`, `invalid: 0`, and 34 ready targets. Each ready target's persisted `analyzedAt` must be newer than the dispatch timestamp. After readiness passes, repeat the export and audit extraction with a new timestamp so the final artifacts contain scores from this exact run.

7. Report audit facts.

Include cohort size, missing current resumes, missing AI scores, task ID, dispatch timestamp, expected analysis ID, prompt version, 34/34 readiness, high-score counts by HR category, min/median/max scores by HR category, output paths, and commands used.

## Script

- `scripts/audit_hr_feedback_export.py`: joins an HR reference CSV to a current Trends export by profile resume ID and writes audit CSV, summary JSON, and an optional versioned exact-target manifest.

The script accepts exports from both older custom audit files and the standard `trends resume export` output.
