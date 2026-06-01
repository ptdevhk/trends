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

5. Dispatch AI scoring for the exact audit target.

For a JD-backed audit:

```bash
./bin/trends resume analyze --job-description <jd-id> --limit 500 --api-url http://localhost:3000 --workspace dev --output json
```

For a keyword-backed audit:

```bash
./bin/trends resume analyze --query "CNC 销售" --limit 500 --api-url http://localhost:3000 --workspace dev --output json
```

Poll until recent tasks complete:

```bash
./bin/trends resume debug analysis-tasks --api-url http://localhost:3000 --workspace dev --output json
```

6. Export current DB scores.

```bash
STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%3NZ)"
CURRENT_EXPORT="$HOME/Documents/resumes-export-current-db-${STAMP}.csv"
./bin/trends resume export --format csv --limit 5000 --out "$CURRENT_EXPORT" --api-url http://localhost:3000 --workspace dev
```

7. Extract the HR cohort audit CSV/JSON.

```bash
REFERENCE_CSV="$HOME/Documents/resumes-export-v0.3.0-hr-feedback-42-2026-06-01T02-44-02-472699Z.csv"
AUDIT_CSV="$HOME/Documents/resumes-export-current-db-hr-feedback-42-${STAMP}.csv"
AUDIT_JSON="${AUDIT_CSV%.csv}.audit.json"
python3 .agents/skills/resume-ai-scoring-audit/scripts/audit_hr_feedback_export.py \
  --reference-csv "$REFERENCE_CSV" \
  --current-export "$CURRENT_EXPORT" \
  --out-csv "$AUDIT_CSV" \
  --out-json "$AUDIT_JSON" \
  --expected-count 42
```

8. Report audit facts.

Include cohort size, missing current resumes, missing AI scores, high-score counts by HR category, min/median/max scores by HR category, output paths, and commands used.

## Script

- `scripts/audit_hr_feedback_export.py`: joins an HR reference CSV to a current Trends export by profile resume ID and writes audit CSV plus summary JSON.

The script accepts exports from both older custom audit files and the standard `trends resume export` output.
