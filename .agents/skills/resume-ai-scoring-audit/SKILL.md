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
- Use only the exact-task-bound full Convex export as persisted-analysis audit evidence. The sample/browser export accepts client-owned match data, is capped, and must not be used to prove current Convex scores.
- Start with an approved, versioned exact-target manifest for the HR cohort. Stop if it is missing; do not rebuild audit identity from a capped sample export.
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

5. Create a local run directory and select the approved exact-target manifest.

```bash
STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%3NZ)"
RUN_DIR="output/resume-ai-scoring-audit/${STAMP}"
mkdir -p "$RUN_DIR"
REFERENCE_CSV="${REFERENCE_CSV:-output/resume-ai-scoring-audit/reference/resumes-export-reference-hr-feedback-34.csv}"
TARGET_MANIFEST="${TARGET_MANIFEST:-$RUN_DIR/targets.json}"
test -f "$REFERENCE_CSV"
test -f "$TARGET_MANIFEST"
```

The target manifest must preserve reference order and stable profile/external selectors. Resolve it before any target-scoped operation:

```bash
./bin/trends resume debug reingest --manifest "$TARGET_MANIFEST" --dry-run --api-url http://localhost:3000 --workspace dev --output json
./bin/trends resume debug reingest --manifest "$TARGET_MANIFEST" --yes --wait --api-url http://localhost:3000 --workspace dev --output json
```

6. Preview, dispatch, and wait on exact persisted analysis for the resolved cohort.

The dry run is non-mutating and must report `mode: "exact"`, `requestedCount: 34`, `resolvedCount: 34`, 34 ordered targets/current IDs, and the expected analysis job-description ID and prompt version:

```bash
DRY_RUN_JSON="$RUN_DIR/exact-analysis-dry-run.json"
./bin/trends resume analyze --manifest "$TARGET_MANIFEST" --query "CNC 销售" --dry-run --api-url http://localhost:3000 --workspace dev --output json | tee "$DRY_RUN_JSON"
```

After checking the dry-run evidence, dispatch and wait on that exact task. The CLI polls only the task-by-ID endpoint:

```bash
ANALYSIS_JSON="$RUN_DIR/exact-analysis.json"
./bin/trends resume analyze --manifest "$TARGET_MANIFEST" --query "CNC 销售" --yes --wait --wait-timeout 10m --poll-interval 2s --api-url http://localhost:3000 --workspace dev --output json | tee "$ANALYSIS_JSON"
TASK_ID="$(python3 - "$ANALYSIS_JSON" <<'PY'
import json
import sys

task_id = str(json.load(open(sys.argv[1], encoding="utf-8"))["taskId"]).strip()
if not task_id:
    raise SystemExit("exact analysis did not return a taskId")
print(task_id)
PY
)"
```

Retain the live JSON evidence: non-empty task ID, dispatch timestamp, expected analysis job-description ID, prompt version, and final verification with `allReady: true`, `ready: 34`, `pending: 0`, `invalid: 0`, and 34 ready targets. Each ready target's persisted `analyzedAt` must be newer than the dispatch timestamp.

7. Export every active workspace resume through the completed exact task, then verify the installed artifact and CLI evidence.

```bash
CURRENT_EXPORT="$RUN_DIR/resumes-exact-task-audit.csv"
EXPORT_JSON="$RUN_DIR/resumes-exact-task-audit.export.json"
./bin/trends resume export \
  --source convex \
  --all \
  --analysis-task "$TASK_ID" \
  --format csv \
  --out "$CURRENT_EXPORT" \
  --api-url http://localhost:3000 \
  --workspace dev \
  --output json | tee "$EXPORT_JSON"
```

Require the exported active-row count, exact task ID, dispatch/completion timestamps, 34 cohort members, 34 ready rows, private mode, byte count, and SHA-256 to agree with the file on disk:

```bash
python3 - "$EXPORT_JSON" "$CURRENT_EXPORT" "$TASK_ID" <<'PY'
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

report = json.load(open(sys.argv[1], encoding="utf-8"))
path = Path(sys.argv[2]).resolve()
task_id = sys.argv[3]
data = path.read_bytes()
checks = {
    "active row count": isinstance(report.get("count"), int) and report["count"] >= 34,
    "task ID": report.get("taskId") == task_id,
    "dispatch timestamp": isinstance(report.get("dispatchedAt"), int),
    "completion timestamp": isinstance(report.get("completedAt"), int),
    "cohort members": report.get("cohortMembers") == 34,
    "ready rows": report.get("ready") == 34,
    "reported mode": report.get("mode") == "0600",
    "disk mode": stat.S_IMODE(os.stat(path).st_mode) == 0o600,
    "byte count": report.get("bytes") == len(data),
    "sha256": report.get("sha256") == hashlib.sha256(data).hexdigest(),
    "resolved path": Path(report.get("file", "")).resolve() == path,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("audit export verification failed: " + ", ".join(failed))
print(json.dumps({"verified": True, **report}, ensure_ascii=False, sort_keys=True))
PY
```

8. Extract the final HR cohort audit CSV/JSON from that authoritative task-bound export.

```bash
AUDIT_CSV="$RUN_DIR/hr-feedback-audit.csv"
AUDIT_JSON="$RUN_DIR/hr-feedback-audit.json"
RESOLVED_TARGET_MANIFEST="$RUN_DIR/targets-resolved.json"
python3 .agents/skills/resume-ai-scoring-audit/scripts/audit_hr_feedback_export.py \
  --reference-csv "$REFERENCE_CSV" \
  --current-export "$CURRENT_EXPORT" \
  --out-csv "$AUDIT_CSV" \
  --out-json "$AUDIT_JSON" \
  --out-manifest "$RESOLVED_TARGET_MANIFEST" \
  --expected-count 34
```

9. Report audit facts.

Include exported active-row count, cohort size, missing current resumes, missing AI scores, task ID, dispatch and completion timestamps, expected analysis ID, prompt version, cohort-member and ready counts, file mode, byte count, SHA-256, high-score counts by HR category, min/median/max scores by HR category, output paths, and commands used.

## Script

- `scripts/audit_hr_feedback_export.py`: joins an HR reference CSV to a current Trends export by profile resume ID and writes audit CSV, summary JSON, and an optional versioned exact-target manifest.

The script accepts older custom audit files and the task-bound `trends resume export --source convex --all --analysis-task <task-id>` CSV output.
