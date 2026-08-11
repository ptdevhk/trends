# Dev Sync from Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command (`deploy/dev-sync-from-preview.sh`) that makes local dev behave like preview (same data + v0.4.23 semantics + auth roles) with an automated hard parity gate.

**Architecture:** Bash orchestrator running on the dev host, source-parametrized (default `preview` over SSH on ptcloud, `--prod-base` fallback). Reuses the preview flow's proven pieces: Convex export/import (`--replace-all`), the export-fix python step (extracted to a shared lib), SQLite `.backup` swap, `manage-user.ts` seeding, `lib-preview-common.sh` helpers. New: `lib-dev-common.sh` (dev-host helpers incl. API restart + digest epoch logic), `dev-parity-check.sh` (source-aware gate), Makefile target, npm script role change.

**Tech Stack:** Bash 4+, python3, sqlite3, unzip/zip, curl, ssh/scp to ptcloud, bunx/npx (Convex CLI, tsx), existing `deploy/lib-preview-common.sh`.

## Global Constraints

- Dev host = this machine (`/root/workspace`); ptcloud = `root@217.217.255.28` via `~/.ssh/config` alias `ptcloud`.
- **Never quiesce or write to prod/preview** — only read-only exports (`npx convex export`, `sqlite3 .backup`).
- Local Convex backend: `http://127.0.0.1:3210` (admin key auto from `packages/convex/.convex/local/default/config.json`).
- Local API on :3000 (tsx-watch child under `apps/api`), web :5173, worker :8000.
- Preview env on ptcloud: app `/home/ubuntu/trends-preview`, env `.env.preview`, Convex container `trends-preview-convex`, API `http://127.0.0.1:3002`.
- Prod env on ptcloud: app `/opt/trends`, env `/etc/trends/env`, Convex `http://127.0.0.1:3210`, API `http://127.0.0.1:3000`, service user `trends`.
- Auth after sync must match preview: `hr-demo` role **admin** in workspace `hr` (password `AUTH_HR_DEMO_PASSWORD` from dev `.env`, required); `admin` role **admin** in workspace `dev` (password `AUTH_BOOTSTRAP_PASSWORD` from dev `.env`, **required — fail with clear message when unset**).
- Digests: default = copy source digests verbatim (preview→dev same-version). Adaptive: if imported digest `ingestComputeEpoch` < local `CURRENT_INGEST_COMPUTE_EPOCH`, run `backfillResumeDigests` loop. `--digest-backfill=always|skip` overrides.
- File storage: skipped unless `--with-file-storage`.
- Spec: `docs/superpowers/specs/2026-08-10-dev-sync-from-preview-design.md`.

---

## File Map

| File | Responsibility |
|---|---|
| `deploy/lib-convex-export-fix.sh` (new) | `fix_convex_export <in.zip> <schema.ts> <out.zip>` — strip `showBlocked`, drop `system_settings`, materialize missing schema tables as empty |
| `deploy/restore-preview-from-prod.sh` (modify) | Replace inline step-1b python with a call to `fix_convex_export` |
| `deploy/lib-dev-common.sh` (new) | Dev-host helpers: paths, backup, API stop/start, import, SQLite swap, auth seed, digest epoch + backfill |
| `deploy/dev-parity-check.sh` (new) | Source-aware parity gate (curl + ssh + python3) |
| `deploy/dev-sync-from-preview.sh` (new) | Orchestrator (phases 0–5) |
| `deploy/lib-dev-common.test.sh`, `deploy/lib-convex-export-fix.test.sh`, `deploy/dev-parity-check.test.sh`, `deploy/dev-sync-from-preview.test.sh` (new) | Shell tests in repo style (see `deploy/search-freshness-gate.test.sh`) |
| `package.json` (modify) | `auth:bootstrap-hr-demo` → `--role admin` |
| `Makefile` (modify) | `on-host-dev-sync-from-preview` target |
| `docs/agent-runbook.md`, `docs/backup-restore-architecture.md` (modify) | Runbook section + dev target node |

---

### Task 1: Shared Convex export-fix lib

**Files:**
- Create: `deploy/lib-convex-export-fix.sh`
- Modify: `deploy/restore-preview-from-prod.sh` (step 1b → lib call)
- Test: `deploy/lib-convex-export-fix.test.sh`

**Interfaces:**
- Produces: `fix_convex_export IN_ZIP SCHEMA_TS OUT_ZIP` — exits non-zero on failure, writes fixed zip to OUT_ZIP. Strips `screening_sessions.config.filters.showBlocked`, removes `system_settings/` dir, creates `<table>/generated_schema.jsonl` (`"uniform"\n`) + empty `documents.jsonl` for every `defineTable` in SCHEMA_TS missing from the export.

- [ ] **Step 1: Write the failing test**

`deploy/lib-convex-export-fix.test.sh` (style of `deploy/search-freshness-gate.test.sh`):

```bash
#!/usr/bin/env bash
# Tests for lib-convex-export-fix.sh. Run: bash deploy/lib-convex-export-fix.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# shellcheck source=lib-convex-export-fix.sh
source "$ROOT/deploy/lib-convex-export-fix.sh"

# Build fixture export: one table with showBlocked, one to drop, one missing from schema
mkdir -p "$TMP/src/screening_sessions" "$TMP/src/system_settings" "$TMP/src/job_descriptions"
printf '{"_id":"s1","config":{"filters":{"showBlocked":true,"q":"cnc"}}}\n' > "$TMP/src/screening_sessions/documents.jsonl"
printf '"uniform"\n' > "$TMP/src/screening_sessions/generated_schema.jsonl"
printf '{"_id":"x","maintenanceMode":true}\n' > "$TMP/src/system_settings/documents.jsonl"
printf '"uniform"\n' > "$TMP/src/system_settings/generated_schema.jsonl"
printf '{"_id":"jd1"}\n' > "$TMP/src/job_descriptions/documents.jsonl"
printf '"uniform"\n' > "$TMP/src/job_descriptions/generated_schema.jsonl"
( cd "$TMP/src" && zip -rq "$TMP/in.zip" . )

cat > "$TMP/schema.ts" <<'SCHEMA'
export const schema = {
  job_descriptions: defineTable({}),
  resume_digests: defineTable({}),
  system_settings: defineTable({}),
}
SCHEMA

fix_convex_export "$TMP/in.zip" "$TMP/schema.ts" "$TMP/out.zip"

# 1. showBlocked stripped
unzip -p "$TMP/out.zip" screening_sessions/documents.jsonl | grep -q showBlocked && fail "showBlocked not stripped" || pass "showBlocked stripped"
# 2. system_settings dropped
unzip -l "$TMP/out.zip" | grep -q "system_settings/" && fail "system_settings still present" || pass "system_settings dropped"
# 3. missing schema table materialized empty
unzip -p "$TMP/out.zip" resume_digests/documents.jsonl | grep -q . && fail "resume_digests not empty" || pass "resume_digests materialized empty"
unzip -p "$TMP/out.zip" resume_digests/generated_schema.jsonl | grep -q uniform || fail "resume_digests schema marker missing"
# 4. existing tables survive
unzip -p "$TMP/out.zip" job_descriptions/documents.jsonl | grep -q '"jd1"' && pass "job_descriptions preserved" || fail "job_descriptions lost"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash deploy/lib-convex-export-fix.test.sh`
Expected: FAIL (function not defined — source fails).

- [ ] **Step 3: Write the lib**

`deploy/lib-convex-export-fix.sh`:

```bash
#!/usr/bin/env bash
# Shared Convex export fixer for restore flows (preview + dev).
# Source this file; do not execute it directly.
#
# fix_convex_export IN_ZIP SCHEMA_TS OUT_ZIP
#   - strips screening_sessions.config.filters.showBlocked (v0.3.0+ schema drop)
#   - removes system_settings/ (maintenance flag is environment-local)
#   - materializes schema tables missing from the export as EMPTY
#     (import --replace-all would otherwise leave them absent)
# Exits non-zero on failure; writes fixed zip to OUT_ZIP.

fix_convex_export() {
    local in_zip="$1"
    local schema_ts="$2"
    local out_zip="$3"
    local work
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' RETURN

    ( cd "$work" && unzip -q "$in_zip" ) || return 1

    python3 - "$schema_ts" <<'PY'
import json, os, pathlib, re, shutil, sys

schema_path = pathlib.Path(sys.argv[1])

# 1. Strip schema-incompatible field
path = "screening_sessions/documents.jsonl"
if os.path.exists(path):
    docs = [json.loads(line) for line in open(path) if line.strip()]
    changed = 0
    for d in docs:
        if isinstance(d.get("config"), dict) and isinstance(d["config"].get("filters"), dict):
            if d["config"]["filters"].pop("showBlocked", None) is not None:
                changed += 1
    with open(path, "w") as f:
        f.write("\n".join(json.dumps(d, ensure_ascii=False) for d in docs) + "\n")
    print(f"Stripped showBlocked from {changed}/{len(docs)} screening_sessions documents")

# 2. Drop system_settings (environment-local maintenance flag)
if os.path.exists("system_settings"):
    shutil.rmtree("system_settings")
    print("Excluded system_settings/ from import")

# 3. Materialize schema tables missing from the export as empty
if not schema_path.exists():
    raise SystemExit(f"Missing target Convex schema: {schema_path}")
schema_tables = re.findall(
    r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*defineTable\(",
    schema_path.read_text(),
    flags=re.MULTILINE,
)
created = []
for table in schema_tables:
    if pathlib.Path(table).exists():
        continue
    pathlib.Path(table).mkdir()
    (pathlib.Path(table) / "generated_schema.jsonl").write_text('"uniform"\n')
    (pathlib.Path(table) / "documents.jsonl").write_text("")
    created.append(table)
if created:
    print("Materialized missing schema tables as empty: " + ", ".join(created))
PY

    rm -f "$out_zip"
    ( cd "$work" && zip -rq "$out_zip" . ) || return 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash deploy/lib-convex-export-fix.test.sh`
Expected: ALL PASS (4 checks).

- [ ] **Step 5: Refactor `restore-preview-from-prod.sh` to use the lib**

In `deploy/restore-preview-from-prod.sh`, after the existing `source "$SCRIPT_DIR/lib-preview-common.sh"` block add:

```bash
# shellcheck source=lib-convex-export-fix.sh
source "$SCRIPT_DIR/lib-convex-export-fix.sh"
```

Replace the inline step-1b block (from `echo ""` + `echo "=== Step 1b: ..."` through the final `ls -lh "$EXPORT_PATH"` before `echo ""` + `echo "=== Step 2: ..."`) with:

```bash
echo ""
echo "=== Step 1b: Strip schema-incompatible fields from export ==="
fix_convex_export "$EXPORT_PATH" "$PREVIEW_DIR/packages/convex/convex/schema.ts" /tmp/prod-convex-export-fixed.zip || {
    echo "fix_convex_export failed" >&2
    exit 1
}
ls -lh /tmp/prod-convex-export-fixed.zip
```

- [ ] **Step 6: Verify refactor**

Run: `bash deploy/lib-convex-export-fix.test.sh` (still ALL PASS); then `grep -n "fix_convex_export" deploy/restore-preview-from-prod.sh` shows source + call, and `grep -c "showBlocked" deploy/restore-preview-from-prod.sh` = 0.

- [ ] **Step 7: Commit**

```bash
git add deploy/lib-convex-export-fix.sh deploy/lib-convex-export-fix.test.sh deploy/restore-preview-from-prod.sh
git commit -m "refactor(deploy): extract shared convex export-fix lib for restore flows"
```

---

### Task 2: Dev-host helper library

**Files:**
- Create: `deploy/lib-dev-common.sh`
- Test: `deploy/lib-dev-common.test.sh`

**Interfaces:**
- Consumes: `lib-preview-common.sh` (`log_info`, `log_step`, `log_error`, `confirm_or_exit`, `wait_for_http`).
- Produces (used by Tasks 3–4):
  - `DEV_ROOT` (default: repo root via `git rev-parse --show-toplevel` from script dir), `DEV_API_PORT` (3000), `DEV_CONVEX_URL` (http://127.0.0.1:3210)
  - `dev_require_stack` — asserts local Convex `/version` 200, required CLIs present; exit 1 otherwise
  - `dev_backup_local BACKUP_TS` — exports local Convex to `/tmp/trends-sync/local-backup-$BACKUP_TS.zip`, copies `output/resume_screening.db*` to `output/backups/pre-sync-$BACKUP_TS/`; exit 1 on any failure
  - `dev_stop_api` — kills the tsx-watch tree holding :3000 (via `ss -tlnp` → pid, then parent `tsx watch`); no-op when port free
  - `dev_start_api` — `cd apps/api`, `set -a; source .env; set +a`, `setsid nohup env PORT=3000 bun run dev > logs/api.log 2>&1 < /dev/null &`; then `wait_for_http http://127.0.0.1:3000/api/blocks 120`
  - `dev_import_convex ZIP` — `cd packages/convex && CONVEX_URL=... npx convex import --replace-all "$ZIP" --yes`
  - `dev_swap_sqlite BACKUP_DB` — `rm -f output/resume_screening.db{-wal,-shm,}` + `cp BACKUP_DB output/resume_screening.db`
  - `dev_seed_auth` — runs `manage-user.ts` for `hr-demo` (role **admin**, `--password-env AUTH_HR_DEMO_PASSWORD`) and `admin` (role **admin**, `--password-env AUTH_BOOTSTRAP_PASSWORD`); exits 1 with a clear message if either env var is unset
  - `digest_epoch_from_export ZIP` — echoes max `ingestComputeEpoch` in `resume_digests/documents.jsonl` (0 if absent)
  - `local_digest_epoch` — echoes `CURRENT_INGEST_COMPUTE_EPOCH` via `npx tsx -e "process.stdout.write(String(require('./packages/shared/src/ingest-compute-epoch.ts').CURRENT_INGEST_COMPUTE_EPOCH))"`
  - `backfill_dev_digests` — cursor loop over `npx convex run resumes_search:backfillResumeDigests '{"limit":100,...}'` until `isDone`, logging batch progress; exit 1 on parse failure

- [ ] **Step 1: Write the failing test**

`deploy/lib-dev-common.test.sh`:

```bash
#!/usr/bin/env bash
# Tests for lib-dev-common.sh. Run: bash deploy/lib-dev-common.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# shellcheck source=lib-preview-common.sh
source "$ROOT/deploy/lib-preview-common.sh"
# shellcheck source=lib-dev-common.sh
source "$ROOT/deploy/lib-dev-common.sh"

[[ -n "${DEV_ROOT:-}" ]] && pass "DEV_ROOT set" || fail "DEV_ROOT unset"

# digest_epoch_from_export: fixture zip with mixed epochs + missing field
mkdir -p "$TMP/e/resume_digests"
printf '"uniform"\n' > "$TMP/e/resume_digests/generated_schema.jsonl"
printf '{"_id":"a","ingestComputeEpoch":1}\n{"_id":"b","ingestComputeEpoch":3}\n{"_id":"c"}\n' > "$TMP/e/resume_digests/documents.jsonl"
( cd "$TMP/e" && zip -rq "$TMP/digests.zip" . )
EPOCH="$(digest_epoch_from_export "$TMP/digests.zip")"
[ "$EPOCH" = "3" ] && pass "digest_epoch_from_export max=3" || fail "digest_epoch_from_export got $EPOCH"

# missing epoch field -> 0
printf '{"_id":"a"}\n' > "$TMP/e/resume_digests/documents.jsonl"
( cd "$TMP/e" && zip -rq "$TMP/digests0.zip" . )
EPOCH0="$(digest_epoch_from_export "$TMP/digests0.zip")"
[ "$EPOCH0" = "0" ] && pass "digest_epoch_from_export missing->0" || fail "got $EPOCH0"

# local_digest_epoch parses the shared registry
LOCAL="$(cd "$ROOT" && local_digest_epoch)"
[[ "$LOCAL" =~ ^[0-9]+$ ]] && pass "local_digest_epoch=$LOCAL" || fail "local_digest_epoch unparsable"

# seed command construction uses --role admin for both accounts
SEED_CMD="$(cd "$ROOT" && sed -n 's|^ *"auth:bootstrap-hr-demo": "\(.*\)",$|\1|p' package.json | head -1)"
echo "$SEED_CMD" | grep -q -- "--role admin" && pass "npm script seeds hr-demo admin" || fail "npm script not admin yet"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash deploy/lib-dev-common.test.sh`
Expected: FAIL (lib missing; npm script still `--role user`).

- [ ] **Step 3: Write the lib**

`deploy/lib-dev-common.sh` (key functions; keep style of `lib-preview-common.sh`):

```bash
#!/usr/bin/env bash
# Shared helpers for dev-host sync scripts (run on the DEV host).
# Source this file; do not execute it directly.
# shellcheck disable=SC2034

DEV_ROOT="${DEV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEV_API_PORT="${DEV_API_PORT:-3000}"
DEV_CONVEX_URL="${DEV_CONVEX_URL:-http://127.0.0.1:3210}"
SYNC_TMP="${SYNC_TMP:-/tmp/trends-sync}"

dev_require_stack() {
    require_command sqlite3; require_command unzip; require_command zip
    require_command python3; require_command curl; require_command ssh; require_command scp
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$DEV_CONVEX_URL/version" 2>/dev/null || echo 000)"
    if [ "$code" != "200" ]; then
        log_error "Local Convex backend not healthy at $DEV_CONVEX_URL (http=$code). Start it with: bun run dev"
        return 1
    fi
    return 0
}

dev_backup_local() {
    local ts="$1"
    local zip_path="$SYNC_TMP/local-backup-$ts.zip"
    mkdir -p "$SYNC_TMP" "$DEV_ROOT/output/backups/pre-sync-$ts"
    log_step "Backing up local Convex"
    ( cd "$DEV_ROOT/packages/convex" && CONVEX_URL="$DEV_CONVEX_URL" npx convex export --path "$zip_path" >/dev/null ) || return 1
    log_step "Backing up local SQLite"
    cp -a "$DEV_ROOT/output/resume_screening.db" \
          "$DEV_ROOT/output/resume_screening.db-wal" \
          "$DEV_ROOT/output/resume_screening.db-shm" \
          "$DEV_ROOT/output/backups/pre-sync-$ts/" 2>/dev/null || true
    [ -f "$DEV_ROOT/output/backups/pre-sync-$ts/resume_screening.db" ] || return 1
    log_info "Local backup: $zip_path + output/backups/pre-sync-$ts/"
    return 0
}

dev_stop_api() {
    local pid
    pid="$(ss -tlnp 2>/dev/null | grep ":$DEV_API_PORT " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)"
    if [ -z "$pid" ]; then log_info "API port $DEV_API_PORT already free"; return 0; fi
    local watch_pid
    watch_pid="$(ps -o ppid= -p "$pid" | tr -d ' ' || true)"
    log_info "Stopping API (pid=$pid watch=${watch_pid:-none})"
    [ -n "$watch_pid" ] && kill "$watch_pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    sleep 2
    if ss -tlnp 2>/dev/null | grep -q ":$DEV_API_PORT "; then
        log_error "API still holds :$DEV_API_PORT after stop"
        return 1
    fi
    return 0
}

dev_start_api() {
    log_step "Starting API detached (logs: $DEV_ROOT/logs/api.log)"
    ( cd "$DEV_ROOT/apps/api" && set -a && source "$DEV_ROOT/.env" && set +a \
      && setsid nohup env PORT="$DEV_API_PORT" bun run dev > "$DEV_ROOT/logs/api.log" 2>&1 < /dev/null & )
    wait_for_http "http://127.0.0.1:$DEV_API_PORT/api/blocks" 120
}

dev_import_convex() {
    local zip_path="$1"
    log_step "Importing Convex export (replace-all): $zip_path"
    ( cd "$DEV_ROOT/packages/convex" && CONVEX_URL="$DEV_CONVEX_URL" npx convex import --replace-all "$zip_path" --yes )
}

dev_swap_sqlite() {
    local backup_db="$1"
    log_step "Swapping SQLite from $backup_db"
    rm -f "$DEV_ROOT/output/resume_screening.db" \
          "$DEV_ROOT/output/resume_screening.db-wal" \
          "$DEV_ROOT/output/resume_screening.db-shm"
    cp "$backup_db" "$DEV_ROOT/output/resume_screening.db"
}

dev_seed_auth() {
    local hr_pw admin_pw
    hr_pw="${AUTH_HR_DEMO_PASSWORD:-}"
    admin_pw="${AUTH_BOOTSTRAP_PASSWORD:-}"
    [ -n "$hr_pw" ] || { log_error "AUTH_HR_DEMO_PASSWORD is required in dev .env (hr-demo seed)"; return 1; }
    [ -n "$admin_pw" ] || { log_error "AUTH_BOOTSTRAP_PASSWORD is required in dev .env (admin seed)"; return 1; }
    log_step "Seeding auth: hr-demo (admin@hr) + admin (admin@dev)"
    ( cd "$DEV_ROOT" && npm run auth:bootstrap-hr-demo >/dev/null && npm run auth:bootstrap-demo >/dev/null ) || return 1
}

digest_epoch_from_export() {
    local zip_path="$1"
    unzip -p "$zip_path" resume_digests/documents.jsonl 2>/dev/null | python3 -c '
import json, sys
max_epoch = 0
for line in sys.stdin:
    if not line.strip(): continue
    try: d = json.loads(line)
    except Exception: continue
    e = d.get("ingestComputeEpoch")
    if isinstance(e, (int, float)) and e > max_epoch: max_epoch = int(e)
print(max_epoch)'
}

local_digest_epoch() {
    ( cd "$DEV_ROOT" && npx tsx -e "process.stdout.write(String(require('./packages/shared/src/ingest-compute-epoch.ts').CURRENT_INGEST_COMPUTE_EPOCH))" 2>/dev/null ) || echo 0
}

backfill_dev_digests() {
    local cursor="" total=0 iter=0 out proc done
    while true; do
        iter=$((iter + 1))
        local args='{"limit":100}'
        [ -n "$cursor" ] && args="{\"limit\":100,\"cursor\":\"$cursor\"}"
        out="$(CONVEX_URL="$DEV_CONVEX_URL" npx convex run resumes_search:backfillResumeDigests "$args" 2>/dev/null)"
        out="$(printf '%s' "$out" | python3 -c '
import json, sys
t = sys.stdin.read(); s = t.find("{"); e = t.rfind("}")
sys.exit(1) if s < 0 or e < 0 else print(t[s:e+1])' 2>/dev/null || true)"
        [ -n "$out" ] || { log_error "backfill batch $iter parse failed"; return 1; }
        proc="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("processed",0))')"
        done="$(printf '%s' "$out" | python3 -c 'import json,sys; print(1 if json.load(sys.stdin).get("isDone") else 0)')"
        cursor="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cursor") or "")')"
        total=$((total + proc))
        log_info "digest backfill batch $iter: processed=$proc total=$total done=$done"
        [ "$done" = "1" ] && break
        [ -n "$cursor" ] || { log_error "backfill ended without cursor"; return 1; }
    done
    log_info "digest backfill complete: $total"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash deploy/lib-dev-common.test.sh`
Expected: ALL PASS. (Note: this requires the local stack running for `local_digest_epoch`; if `tsx` is unavailable the test fails — stack is up in the standard dev workflow.)

- [ ] **Step 5: Commit**

```bash
git add deploy/lib-dev-common.sh deploy/lib-dev-common.test.sh
git commit -m "feat(deploy): dev-host sync helper library"
```

---

### Task 3: Source-aware parity checker

**Files:**
- Create: `deploy/dev-parity-check.sh`
- Test: `deploy/dev-parity-check.test.sh`

**Interfaces:**
- Consumes: `lib-preview-common.sh`, `lib-dev-common.sh`; functions `api_login_hr_demo URL` (echoes cookie jar path), `query_total COOKIE URL QUERY_STRING` (echoes `summary.total` int or `NA`), `verified_employer_count COOKIE URL` (echoes int or `NA`), `sqlite_count PATH` (echoes int), `compare_field LABEL A B HARD_IF_SOURCE` — the last one is the testable core: `echo "$A" | grep -qx "$B"` semantics with tolerance env `TOTAL_TOLERANCE` for numeric fields.
- Produces: exit code 0 = parity OK, 1 = hard failure; always prints a report table.

- [ ] **Step 1: Write the failing test**

`deploy/dev-parity-check.test.sh` (fixture-driven; no network):

```bash
#!/usr/bin/env bash
# Tests for dev-parity-check.sh. Run: bash deploy/dev-parity-check.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

# shellcheck source=lib-preview-common.sh
source "$ROOT/deploy/lib-preview-common.sh"
# shellcheck source=lib-dev-common.sh
source "$ROOT/deploy/lib-dev-common.sh"
# shellcheck source=dev-parity-check.sh
source "$ROOT/deploy/dev-parity-check.sh"

compare_field "corpus" "8958" "8958" 1 && pass "equal hard pass" || fail "equal hard failed"
compare_field "corpus" "8957" "8958" 1 && fail "unequal hard passed" || pass "unequal hard fails"
TOTAL_TOLERANCE=1 compare_field "query" "48" "49" 1 && pass "tolerance 1 ok" || fail "tolerance 1 failed"
TOTAL_TOLERANCE=0 compare_field "query" "48" "49" 1 && fail "tolerance 0 passed" || pass "tolerance 0 fails"
compare_field "query" "48" "NA" 0 && pass "informational NA ok" || fail "informational NA failed"
compare_field "query" "48" "49" 0 && pass "informational mismatch ok" || fail "informational mismatch failed"
compare_field "query" "NA" "48" 0 && pass "informational dev-NA ok" || fail "informational dev-NA failed"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash deploy/dev-parity-check.test.sh`
Expected: FAIL (script missing).

- [ ] **Step 3: Write the parity checker**

`deploy/dev-parity-check.sh`:

```bash
#!/usr/bin/env bash
# Source-aware parity gate for dev sync. Runs on the DEV host.
# Usage: bash deploy/dev-parity-check.sh [--source preview|prod] [--dry-run]
#   preview (default): query totals + verified-employer count are HARD gates.
#   prod: those are informational (v0.4.16 semantics differ by design).
#   Corpus + candidate_actions + auth smoke are always hard.
# Env: TOTAL_TOLERANCE (default 0), ASSUME_YES (not used here).
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-dev-common.sh
source "$SCRIPT_DIR/lib-dev-common.sh"

SOURCE="preview"
for arg in "$@"; do
    case "$arg" in
        --source) SOURCE="preview" ;;
        --source=prod) SOURCE="prod" ;;
        --source=preview) SOURCE="preview" ;;
        --dry-run) echo "dry-run: parity gate would run against source=$SOURCE"; exit 0 ;;
        *) log_error "Unknown argument: $arg"; exit 2 ;;
    esac
done

# --- local (dev) side -------------------------------------------------------
dev_login() {
    local jar="$1" pw="${AUTH_HR_DEMO_PASSWORD:-}"
    [ -n "$pw" ] || { log_error "AUTH_HR_DEMO_PASSWORD unset"; return 1; }
    curl -s -c "$jar" -X POST "http://127.0.0.1:$DEV_API_PORT/api/auth/login" \
        -H "Content-Type: application/json" -H "X-Workspace-Slug: hr" \
        -d "{\"username\":\"hr-demo\",\"password\":\"$pw\"}"
}

# --- source side (ptcloud) --------------------------------------------------
# Runs queries INSIDE ptcloud so source credentials never leave the server.
SOURCE_SSH() { ssh ptcloud 'bash -s' "$@"; }

# compare_field LABEL DEV_VALUE SRC_VALUE HARD_IF_SOURCE
# Numeric fields honor TOTAL_TOLERANCE; "NA" never fails informational checks.
compare_field() {
    local label="$1" dev_v="$2" src_v="$3" hard="$4"
    local ok=1
    if [ "$src_v" = "NA" ] || [ "$dev_v" = "NA" ]; then
        [ "$hard" = "1" ] && ok=0
    elif [[ "$dev_v" =~ ^[0-9]+$ ]] && [[ "$src_v" =~ ^[0-9]+$ ]]; then
        local diff=$(( dev_v - src_v )); [ ${diff#-} -le "${TOTAL_TOLERANCE:-0}" ] || ok=0
    else
        [ "$dev_v" = "$src_v" ] || ok=0
    fi
    if [ "$ok" = "1" ]; then
        log_info "parity OK   $label: dev=$dev_v src=$src_v${hard:+ (hard)}"
        return 0
    fi
    if [ "$hard" = "1" ]; then
        log_error "parity FAIL $label: dev=$dev_v src=$src_v (hard)"
        return 1
    fi
    log_warn "parity INFO $label: dev=$dev_v src=$src_v (informational)"
    return 0
}

# --- gather -----------------------------------------------------------------
HARD="1"; [ "$SOURCE" = "prod" ] && HARD="0"
DEV_JAR="$(mktemp)"; SRC_JAR="$(mktemp)"; FAILED=0
set +e
dev_login "$DEV_JAR" >/dev/null 2>&1
compare_field "auth-smoke(hr-demo login)" 200 200 1 || FAILED=$((FAILED + 1))

# corpus (resumes) via convex scan on both backends
DEV_CORPUS="$(CONVEX_URL="$DEV_CONVEX_URL" npx convex run resumes_search:scanResumePageSlim '{"numItems":100000}' 2>/dev/null | python3 -c 'import json,sys; t=sys.stdin.read(); s=t.find("{"); e=t.rfind("}"); print(len(json.loads(t[s:e+1]).get("docs") or []) if s>=0 and e>s else "NA")')"
SRC_CORPUS="$(SOURCE_SSH --source-cmd corpus "$SOURCE" 2>/dev/null)"
compare_field "corpus(resumes)" "$DEV_CORPUS" "$SRC_CORPUS" 1 || FAILED=$((FAILED + 1))

# candidate_actions via sqlite counts
DEV_ACTIONS="$(sqlite3 "$DEV_ROOT/output/resume_screening.db" 'SELECT count(*) FROM candidate_actions;')"
SRC_ACTIONS="$(SOURCE_SSH --source-cmd actions "$SOURCE" 2>/dev/null)"
compare_field "candidate_actions" "$DEV_ACTIONS" "$SRC_ACTIONS" 1 || FAILED=$((FAILED + 1))

# verified employers via API (admin-only; hr-demo is admin post-sync)
DEV_VEC="$(curl -s -b "$DEV_JAR" "http://127.0.0.1:$DEV_API_PORT/api/company-industry-verified-employer-count" -H "X-Workspace-Slug: hr" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("count","NA") if d.get("success") else "NA")' 2>/dev/null)"
SRC_VEC="$(SOURCE_SSH --source-cmd vec "$SOURCE" 2>/dev/null)"
compare_field "verified-employers" "$DEV_VEC" "$SRC_VEC" "$HARD" || FAILED=$((FAILED + 1))

# baseline query totals (UAT query + no-gate query)
for Q in "q=CNC+Sales&location=Malaysia&minRoleYears=1&roleFilterType=sales" "q=CNC+Sales&location=Malaysia"; do
    DEV_T="$(curl -s -b "$DEV_JAR" "http://127.0.0.1:$DEV_API_PORT/api/resumes?source=convex&paged=true&limit=1&offset=0&$Q" -H "X-Workspace-Slug: hr" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("summary",{}).get("total","NA"))' 2>/dev/null)"
    SRC_T="$(SOURCE_SSH --source-cmd query "$SOURCE" "$Q" 2>/dev/null)"
    compare_field "query[$Q]" "$DEV_T" "$SRC_T" "$HARD" || FAILED=$((FAILED + 1))
done
set -e
rm -f "$DEV_JAR" "$SRC_JAR"

log_step "Parity report (source=$SOURCE) done"
[ "$FAILED" -eq 0 ] || { log_error "$FAILED parity check(s) failed"; exit 1; }
log_info "All parity checks passed."
```

Note for the implementer: `SOURCE_SSH` dispatches on `--source-cmd`; the remote heredoc (in `lib-dev-common.sh` or inline in this script) must: for `corpus` — `docker exec trends-preview-convex ... npx convex run resumes_search:scanResumePageSlim '{"numItems":100000}'` (preview) or `sudo -u trends ...` (prod); for `actions` — `sqlite3 <source-db> 'SELECT count(*)...'`; for `vec` — source env → login hr-demo → curl the count endpoint; for `query` — same login, curl `/api/resumes?...`. Source env files: preview `.env.preview`, prod `/etc/trends/env` (passwords stay on ptcloud). Implement this as a `source_cmd_remote` function in this script using a heredoc — do not print credentials.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash deploy/dev-parity-check.test.sh`
Expected: ALL PASS (fixture path only — no live calls in tests).

- [ ] **Step 5: Commit**

```bash
git add deploy/dev-parity-check.sh deploy/dev-parity-check.test.sh
git commit -m "feat(deploy): source-aware dev parity gate"
```

---

### Task 4: Sync orchestrator

**Files:**
- Create: `deploy/dev-sync-from-preview.sh`
- Test: `deploy/dev-sync-from-preview.test.sh`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Flags: `--prod-base`, `--with-file-storage`, `--digest-backfill=auto|always|skip`, `--dry-run`, env `ASSUME_YES=1`.
- Produces: synced dev (Convex + SQLite + auth + API restarted), parity report; log at `logs/dev-sync-<ts>.log`.

- [ ] **Step 1: Write the failing test**

`deploy/dev-sync-from-preview.test.sh`:

```bash
#!/usr/bin/env bash
# Structural + dry-run tests for dev-sync-from-preview.sh. Run: bash deploy/dev-sync-from-preview.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

[ -x "$ROOT/deploy/dev-sync-from-preview.sh" ] && pass "orchestrator executable" || fail "orchestrator missing/not executable"
grep -q 'lib-preview-common.sh' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "sources lib-preview-common" || fail "missing lib-preview-common"
grep -q 'lib-dev-common.sh' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "sources lib-dev-common" || fail "missing lib-dev-common"
grep -q 'lib-convex-export-fix.sh' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "sources lib-convex-export-fix" || fail "missing lib-convex-export-fix"
grep -q 'dev-parity-check.sh' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "invokes parity gate" || fail "missing parity gate call"
grep -q -- '--prod-base' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "--prod-base flag" || fail "missing --prod-base"
grep -q -- '--with-file-storage' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "--with-file-storage flag" || fail "missing --with-file-storage"
grep -q -- '--digest-backfill' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "--digest-backfill flag" || fail "missing --digest-backfill"
grep -q -- '--dry-run' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "--dry-run flag" || fail "missing --dry-run"
grep -q 'dev_backup_local' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "calls dev_backup_local" || fail "missing backup gate"
grep -q 'dev_stop_api' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "calls dev_stop_api" || fail "missing api stop"
grep -q 'fix_convex_export' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "calls fix_convex_export" || fail "missing fix step"

# Dry-run must stop before the destructive swap
OUT="$(cd "$ROOT" && ASSUME_YES=1 bash deploy/dev-sync-from-preview.sh --dry-run 2>&1 || true)"
echo "$OUT" | grep -qi "dry-run" && pass "dry-run prints marker" || fail "dry-run marker missing"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash deploy/dev-sync-from-preview.test.sh`
Expected: FAIL (script missing).

- [ ] **Step 3: Write the orchestrator**

`deploy/dev-sync-from-preview.sh` (structure; implement all phases):

```bash
#!/usr/bin/env bash
# Make local dev behave like preview (or prod, with --prod-base).
# Runs on the DEV host; ptcloud is only read (export + .backup).
#
# Usage:
#   bash deploy/dev-sync-from-preview.sh                  # preview -> dev
#   bash deploy/dev-sync-from-preview.sh --prod-base      # prod -> dev
#   bash deploy/dev-sync-from-preview.sh --with-file-storage
#   bash deploy/dev-sync-from-preview.sh --digest-backfill=always|skip
#   bash deploy/dev-sync-from-preview.sh --dry-run
#   ASSUME_YES=1 bash deploy/dev-sync-from-preview.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-dev-common.sh
source "$SCRIPT_DIR/lib-dev-common.sh"
# shellcheck source=lib-convex-export-fix.sh
source "$SCRIPT_DIR/lib-convex-export-fix.sh"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$DEV_ROOT/logs"; mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/dev-sync-$TS.log"
exec > >(tee -a "$LOG_FILE") 2>&1

SOURCE="preview"; WITH_STORAGE=0; DIGEST_MODE="auto"; DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --prod-base) SOURCE="prod" ;;
        --with-file-storage) WITH_STORAGE=1 ;;
        --digest-backfill=auto|--digest-backfill=always|--digest-backfill=skip) DIGEST_MODE="${arg#*=}" ;;
        --dry-run) DRY_RUN=1 ;;
        -h|--help) sed -n '1,16p' "$0"; exit 0 ;;
        *) log_error "Unknown argument: $arg"; exit 2 ;;
    esac
done

# set -E trap: restart API if we stopped it
API_STOPPED=0
on_err() {
    log_error "dev-sync-from-preview failed at line $1 (log: $LOG_FILE)"
    [ "$API_STOPPED" = "1" ] && { log_warn "Restarting dev API..."; dev_start_api || true; }
    exit 1
}
trap 'on_err $LINENO' ERR

log_step "Dev sync from $SOURCE (dry-run=$DRY_RUN)"
print_context_report "dev" "$DEV_ROOT" "$DEV_ROOT/.env"
confirm_or_exit "Replace local dev data with $SOURCE data? (local backup taken first)"

# Phase 0 — preflight + backup
dev_require_stack
if [ "$DRY_RUN" = "1" ]; then log_info "DRY-RUN: would back up local state, export $SOURCE, import, swap, seed, verify."; exit 0; fi
dev_backup_local "$TS"

# Phase 1 — source export (read-only on ptcloud)
log_step "1/5 Export $SOURCE Convex + SQLite (read-only)"
SRC_ZIP="$SYNC_TMP/$SOURCE-convex-export-$TS.zip"
SRC_DB="$SYNC_TMP/$SOURCE-rs-sync-$TS.db"
# NOTE: implement via ssh ptcloud — preview: docker exec trends-preview-convex
#   npx convex export --path /app/$SOURCE-convex-export-$TS.zip (bind mount)
#   + --include-file-storage when WITH_STORAGE=1; then scp from
#   /home/ubuntu/trends-preview/. prod: sudo -u trends npx convex export
#   --path /tmp/... (CONVEX_URL=http://127.0.0.1:3210); scp from /tmp/.
#   SQLite: sqlite3 <db> ".backup" then scp. Mirror restore-preview-from-prod.sh.
ssh ptcloud "bash /home/ubuntu/trends/deploy/dev-sync-source-export.sh '$SOURCE' '$TS' '$WITH_STORAGE'" || true
# (If the helper on ptcloud is not deployed yet, fall back to inline ssh heredoc
#  implementing the same steps; see the source-export snippet in the runbook.)
scp "ptcloud:/tmp/$SOURCE-export-$TS.zip" "$SRC_ZIP"
scp "ptcloud:/tmp/$SOURCE-rs-$TS.db" "$SRC_DB"

# Phase 2 — adaptive fix
log_step "2/5 Fix export"
FIXED_ZIP="$SYNC_TMP/$SOURCE-convex-export-fixed-$TS.zip"
fix_convex_export "$SRC_ZIP" "$DEV_ROOT/packages/convex/convex/schema.ts" "$FIXED_ZIP"

# Phase 3 — import
dev_import_convex "$FIXED_ZIP"

# Phase 4 — adaptive digests
log_step "4/5 Digest policy (mode=$DIGEST_MODE)"
SRC_EPOCH="$(digest_epoch_from_export "$SRC_ZIP")"
LOCAL_EPOCH="$(local_digest_epoch)"
log_info "source digest epoch=$SRC_EPOCH local code epoch=$LOCAL_EPOCH"
BACKFILL=0
case "$DIGEST_MODE" in
    always) BACKFILL=1 ;;
    skip) BACKFILL=0 ;;
    auto) [ "$SRC_EPOCH" -lt "$LOCAL_EPOCH" ] && BACKFILL=1 ;;
esac
if [ "$BACKFILL" = "1" ]; then backfill_dev_digests; else log_info "Keeping source digests verbatim."; fi

# Phase 5 — SQLite swap + auth + API restart
log_step "5/5 SQLite swap, auth, API restart"
dev_stop_api && API_STOPPED=1
dev_swap_sqlite "$SRC_DB"
# load dev .env for seed passwords
set -a; source "$DEV_ROOT/.env"; set +a
dev_seed_auth
API_STOPPED=0
dev_start_api

# Parity gate
bash "$SCRIPT_DIR/dev-parity-check.sh" --source="$SOURCE" || {
    log_error "Parity gate failed. Rollback: restore output/backups/pre-sync-$TS/ + re-import $SYNC_TMP/local-backup-$TS.zip"
    exit 1
}

cat <<EOF

=== Dev sync from $SOURCE complete ===
log=$LOG_FILE
source=$SOURCE digest_mode=$DIGEST_MODE file_storage=$WITH_STORAGE
backups: $SYNC_TMP/local-backup-$TS.zip + output/backups/pre-sync-$TS/
EOF
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash deploy/dev-sync-from-preview.test.sh`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy/dev-sync-from-preview.sh deploy/dev-sync-from-preview.test.sh
git commit -m "feat(deploy): dev sync orchestrator (preview default, prod fallback)"
```

---

### Task 5: Wiring — npm script, Makefile, docs

**Files:**
- Modify: `package.json` (`auth:bootstrap-hr-demo` → `--role admin`), `Makefile`, `docs/agent-runbook.md`, `docs/backup-restore-architecture.md`
- Test: extend `deploy/dev-sync-from-preview.test.sh` (or a new `deploy/dev-sync-wiring.test.sh`)

- [ ] **Step 1: Update npm script**

In `package.json`, change `auth:bootstrap-hr-demo` to use `--role admin` (was `--role user`):

```json
"auth:bootstrap-hr-demo": "tsx scripts/auth/manage-user.ts --username hr-demo --email hr-demo@local --display-name \"hr-demo\" --workspace hr --role admin --replace-memberships --password-env AUTH_HR_DEMO_PASSWORD --output json",
```

- [ ] **Step 2: Add Makefile target**

In `Makefile`, next to `on-host-preview-seed-auth` (line ~556):

```make
# On-host: sync preview (default) or prod data into local dev + parity gate
on-host-dev-sync-from-preview:
	bash ./deploy/dev-sync-from-preview.sh
```

- [ ] **Step 3: Update runbook**

In `docs/agent-runbook.md`, in the dev section (near line 133), add:

```markdown
- Refresh dev data to mirror preview (prod data + industry evidence + same code):
  `bash deploy/dev-sync-from-preview.sh` (preview source, parity-gated).
  `--prod-base` syncs from prod instead; `--with-file-storage` adds raw
  attachments; `--digest-backfill=always|skip` overrides the adaptive digest
  policy. Requires `AUTH_HR_DEMO_PASSWORD` and `AUTH_BOOTSTRAP_PASSWORD` in
  `.env` (seeds hr-demo as admin, matching preview roles). Local state is
  backed up first; a failed parity gate prints rollback instructions.
```

- [ ] **Step 4: Update architecture doc**

In `docs/backup-restore-architecture.md`, add a `dev` node to the state-model diagram and a short paragraph:

```markdown
Local dev (this host) is refreshed from preview by `deploy/dev-sync-from-preview.sh`
— same Convex export/import + SQLite swap mechanics as preview, with a hard
source-aware parity gate (corpus, candidate_actions, verified-employer count,
baseline query totals) and preview-matching auth roles (hr-demo = admin).
```

- [ ] **Step 5: Extend wiring test**

Append to `deploy/dev-sync-from-preview.test.sh`:

```bash
grep -q '"auth:bootstrap-hr-demo".*--role admin' "$ROOT/package.json" && pass "npm hr-demo seeds admin" || fail "npm hr-demo not admin"
grep -q 'on-host-dev-sync-from-preview' "$ROOT/Makefile" && pass "Makefile target present" || fail "Makefile target missing"
grep -q 'dev-sync-from-preview' "$ROOT/docs/agent-runbook.md" && pass "runbook documents dev sync" || fail "runbook missing dev sync"
grep -q 'dev-sync-from-preview' "$ROOT/docs/backup-restore-architecture.md" && pass "arch doc mentions dev sync" || fail "arch doc missing dev sync"
```

- [ ] **Step 6: Run all deploy tests**

Run: `for f in deploy/lib-convex-export-fix.test.sh deploy/lib-dev-common.test.sh deploy/dev-parity-check.test.sh deploy/dev-sync-from-preview.test.sh; do echo "== $f"; bash "$f"; done`
Expected: ALL PASS in each.

- [ ] **Step 7: Commit**

```bash
git add package.json Makefile docs/agent-runbook.md docs/backup-restore-architecture.md deploy/dev-sync-from-preview.test.sh
git commit -m "feat(dev-sync): wire npm role, Makefile target, docs"
```

---

### Task 6: Acceptance rehearsal (operator + agent)

**Files:** none (operational).

- [ ] **Step 1: Add `AUTH_BOOTSTRAP_PASSWORD` to dev `.env`**

Append (or set) in `/root/workspace/.env` (never commit `.env`):

```bash
AUTH_BOOTSTRAP_PASSWORD=<choose-a-dev-only-password>
```

- [ ] **Step 2: Ensure dev stack up + clean git tree**

Run: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3210/version` → 200; `git status --short` clean.

- [ ] **Step 3: Run the real sync**

Run: `cd /root/workspace && ASSUME_YES=1 bash deploy/dev-sync-from-preview.sh 2>&1 | tee /tmp/trends-sync/rehearsal.log`
Expected: phases 0–5 complete; parity gate prints all-OK; final counts: corpus 8,958 (capped-equal), candidate_actions 266, verified-employers 35, UAT query 48 (matches preview), no-gate query matches preview.

- [ ] **Step 4: Browser spot-check**

In the CDP browser (hr-demo logged in, localhost): open
`http://localhost:5173/hr/resumes?location=Malaysia&q=CNC+Sales&minRoleYears=1&roleType=sales`.
Expected: 48 results, notice "结果仅限行业认证雇主 · 目录中 35 家认证雇主", status facets render, no console errors beyond benign 403-free state.

- [ ] **Step 5: Record results + commit**

Record observed numbers in the task log; no code changes expected unless a defect surfaces — if so, fix per TDD and re-run affected tests.

---

## Self-Review Notes (for the plan author)

- Spec coverage: requirements 1–7 map to Tasks 1–6 (data source default preview + `--prod-base` → Task 4 flags; adaptive migration → Tasks 1/2/4; auth roles → Tasks 2/5; hard gate → Task 3; file-storage opt-in → Task 4; safety → Tasks 2/4; testing → Tasks 1–6).
- Placeholder scan: the only intentional TODO is the ptcloud source-export ssh snippet in Task 4 Step 3 (marked NOTE) — implement it inline in the orchestrator mirroring `restore-preview-from-prod.sh` (docker exec for preview, sudo -u trends for prod), with the same `--include-file-storage` gating; the runbook references it. Resolve before execution.
- Type consistency: function names match across tasks (`fix_convex_export`, `dev_backup_local`, `dev_stop_api`, `dev_start_api`, `dev_import_convex`, `dev_swap_sqlite`, `dev_seed_auth`, `digest_epoch_from_export`, `local_digest_epoch`, `backfill_dev_digests`, `compare_field`, `dev-parity-check.sh --source=`).

### Task 4a: Concrete source-export implementation (resolves the Task 4 NOTE)

**Files:** Modify `deploy/dev-sync-from-preview.sh` (replace the `ssh ptcloud "bash /home/ubuntu/trends/deploy/dev-sync-source-export.sh ..." || true` + scp block in Phase 1 with the code below).

**Interfaces:** Same as Task 4 — produces `$SRC_ZIP` and `$SRC_DB` on the dev host.

- [ ] **Step 1: Replace Phase 1 with exact commands**

In `deploy/dev-sync-from-preview.sh`, Phase 1 becomes:

```bash
# Phase 1 — source export (read-only on ptcloud)
log_step "1/5 Export $SOURCE Convex + SQLite (read-only)"
SRC_ZIP="$SYNC_TMP/$SOURCE-convex-export-$TS.zip"
SRC_DB="$SYNC_TMP/$SOURCE-rs-sync-$TS.db"
SRC_EXPORT_REMOTE="/tmp/$SOURCE-convex-export-$TS.zip"
SRC_DB_REMOTE="/tmp/$SOURCE-rs-sync-$TS.db"

if [ "$SOURCE" = "preview" ]; then
    # Preview Convex runs in Docker; export inside the container to the
    # bind-mounted /app dir (lands in /home/ubuntu/trends-preview/ on host),
    # then move to /tmp for scp. Mirror restore-preview-from-prod.sh mechanics.
    ssh ptcloud "bash -s" "$TS" "$WITH_STORAGE" <<'REMOTE'
set -euo pipefail
TS="$1"; WITH_STORAGE="$2"
F="/app/preview-convex-export-$TS.zip"
docker exec trends-preview-convex bash -c \
  "cd /app/packages/convex && npx convex export --path $F${WITH_STORAGE:+ --include-file-storage}" >/dev/null
sudo mv "/home/ubuntu/trends-preview/preview-convex-export-$TS.zip" "/tmp/preview-convex-export-$TS.zip"
sudo chmod 0644 "/tmp/preview-convex-export-$TS.zip"
sqlite3 /home/ubuntu/trends-preview/output/resume_screening.db ".timeout 5000" ".backup '/tmp/preview-rs-sync-$TS.db'"
ls -lh "/tmp/preview-convex-export-$TS.zip" "/tmp/preview-rs-sync-$TS.db"
REMOTE
else
    # Prod Convex runs as the trends service user (like restore-preview-from-prod.sh)
    ssh ptcloud "bash -s" "$TS" "$WITH_STORAGE" <<'REMOTE'
set -euo pipefail
TS="$1"; WITH_STORAGE="$2"
cd /opt/trends/packages/convex
sudo -u trends env CONVEX_URL=http://127.0.0.1:3210 npx convex export \
  --path "/tmp/prod-convex-export-$TS.zip"${WITH_STORAGE:+ --include-file-storage} >/dev/null
sudo chmod 0644 "/tmp/prod-convex-export-$TS.zip"
sudo -u trends sqlite3 /opt/trends/output/resume_screening.db ".timeout 5000" ".backup '/tmp/prod-rs-sync-$TS.db'"
ls -lh "/tmp/prod-convex-export-$TS.zip" "/tmp/prod-rs-sync-$TS.db"
REMOTE
fi

scp "ptcloud:$SRC_EXPORT_REMOTE" "$SRC_ZIP"
scp "ptcloud:$SRC_DB_REMOTE" "$SRC_DB"
log_info "Downloaded: $(ls -lh "$SRC_ZIP" | awk '{print $5}') export, $(ls -lh "$SRC_DB" | awk '{print $5}') sqlite"
```

- [ ] **Step 2: Re-run structural test**

Run: `bash deploy/dev-sync-from-preview.test.sh`
Expected: ALL PASS (structural greps unchanged).

- [ ] **Step 3: Commit**

```bash
git add deploy/dev-sync-from-preview.sh
git commit -m "feat(deploy): concrete source export for dev sync (preview docker exec, prod service user)"
```
