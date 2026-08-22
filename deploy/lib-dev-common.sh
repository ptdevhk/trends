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

    # Backups taken with backup-prod-complete.sh set maintenanceMode=true during
    # the writer-quiesce window. The export captures this flag. Clear it after
    # import so the restored stack can accept writes (logins, mutations).
    # Set RESTORE_KEEP_MAINTENANCE=1 to preserve (e.g., debugging quiesce state).
    if [ "${RESTORE_KEEP_MAINTENANCE:-}" != "1" ]; then
        log_step "Clearing maintenanceMode (export may have captured quiesce flag)"
        ( cd "$DEV_ROOT/packages/convex" && CONVEX_URL="$DEV_CONVEX_URL" \
          npx convex run system_settings:set \
          '{"key":"maintenanceMode","value":false,"updatedBy":"dev-import"}' 2>/dev/null ) || true
    fi
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
    ( cd "$DEV_ROOT" && npm run auth:bootstrap-hr-demo >/dev/null && npm run auth:bootstrap-admin >/dev/null ) || return 1
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
        out="$(cd "$DEV_ROOT/packages/convex" && CONVEX_URL="$DEV_CONVEX_URL" npx convex run resumes_search:backfillResumeDigests "$args" 2>/dev/null)"
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
