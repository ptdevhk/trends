#!/usr/bin/env bash
# Complete production backup on ptcloud before any preview work.
# Production is READ-ONLY except for: Convex export (quiesce), SQLite .backup.
# Never imports into production. Never modifies /opt/trends application code.
#
# Usage (on ptcloud as root):
#   sudo bash deploy/backup-prod-complete.sh
#   sudo ASSUME_YES=1 bash /opt/trends/deploy/backup-prod-complete.sh
#
# Optional env:
#   PROD_DIR, BACKUP_ROOT, INCLUDE_FILE_STORAGE=1, SKIP_RESUME_EXPORT=1
#   ASSUME_YES=1
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Prefer sourcing from the same tree as this script
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"

LOG_DIR="${LOG_DIR:-/var/log/trends}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="${BACKUP_ROOT}/prod-complete-${TS}"
MANIFEST="$RUN_DIR/MANIFEST.txt"
LOG_FILE="${LOG_DIR}/backup-prod-complete-${TS}.log"

mkdir -p "$LOG_DIR" "$BACKUP_ROOT"
exec > >(tee -a "$LOG_FILE") 2>&1

on_err() {
    log_error "Backup failed at line $1. Inspect $LOG_FILE and $RUN_DIR"
    exit 1
}
trap 'on_err $LINENO' ERR

require_root
require_command git
require_command sqlite3
require_command curl
require_command tar
require_command python3

log_step "Production complete backup"
print_context_report "production-source" "$PROD_DIR" "$PROD_ENV_FILE"

if ! is_prod_path "$PROD_DIR"; then
    log_error "PROD_DIR does not look like production: $PROD_DIR"
    exit 1
fi
if [[ ! -d "$PROD_DIR/.git" ]]; then
    log_error "Production install is not a git checkout: $PROD_DIR"
    exit 1
fi

confirm_or_exit "Create complete production backup under $RUN_DIR?"

mkdir -p "$RUN_DIR"/{config,git,sqlite,convex,output,systemd,caddy,meta}
# trends user must be able to write Convex export into RUN_DIR/convex
chown -R root:"$PROD_SERVICE_USER" "$RUN_DIR"
chmod 770 "$RUN_DIR" "$RUN_DIR/convex"
chmod 750 "$RUN_DIR"/{config,git,sqlite,output,systemd,caddy,meta} 2>/dev/null || true
: > "$MANIFEST"
chown root:"$PROD_SERVICE_USER" "$MANIFEST"
write_manifest_line "$MANIFEST" created_at "$TS"
write_manifest_line "$MANIFEST" hostname "$(hostname -f 2>/dev/null || hostname)"
write_manifest_line "$MANIFEST" prod_dir "$PROD_DIR"
write_manifest_line "$MANIFEST" backup_dir "$RUN_DIR"

# --- Git / version identity (read-only) ---
log_step "1/8 Capture production identity"
PROD_SHA="$(sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" rev-parse HEAD)"
PROD_BRANCH="$(sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
PROD_VERSION="$(tr -d '[:space:]' < "$PROD_DIR/version" 2>/dev/null || echo unknown)"
{
    echo "sha=$PROD_SHA"
    echo "branch=$PROD_BRANCH"
    echo "version=$PROD_VERSION"
    echo "status:"
    sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" status -sb || true
    echo "log:"
    sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" log -5 --oneline || true
} > "$RUN_DIR/git/identity.txt"
sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" rev-parse HEAD > "$RUN_DIR/git/HEAD"
sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" show-ref > "$RUN_DIR/git/show-ref.txt" 2>/dev/null || true
write_manifest_line "$MANIFEST" prod_sha "$PROD_SHA"
write_manifest_line "$MANIFEST" prod_branch "$PROD_BRANCH"
write_manifest_line "$MANIFEST" prod_version "$PROD_VERSION"
log_info "prod $PROD_BRANCH @ $PROD_SHA (v$PROD_VERSION)"

# --- Configuration & secrets (copy only) ---
log_step "2/8 Backup configuration and secrets"
if [[ -f "$PROD_ENV_FILE" ]]; then
    cp -a "$PROD_ENV_FILE" "$RUN_DIR/config/etc-trends-env"
    chmod 600 "$RUN_DIR/config/etc-trends-env"
    write_manifest_line "$MANIFEST" config_env "config/etc-trends-env"
    write_manifest_line "$MANIFEST" config_env_sha256 "$(sha256_file "$RUN_DIR/config/etc-trends-env")"
else
    log_error "Missing production env: $PROD_ENV_FILE"
    exit 1
fi
if [[ -f "$PROD_DIR/.env.production" ]]; then
    cp -a "$PROD_DIR/.env.production" "$RUN_DIR/config/install-env.production"
    chmod 600 "$RUN_DIR/config/install-env.production"
fi
if [[ -f "$PROD_DIR/packages/convex/.env.local" ]]; then
    cp -a "$PROD_DIR/packages/convex/.env.local" "$RUN_DIR/config/convex.env.local"
    chmod 600 "$RUN_DIR/config/convex.env.local"
fi
if [[ -f "$PROD_DIR/apps/web/.env.production" ]]; then
    cp -a "$PROD_DIR/apps/web/.env.production" "$RUN_DIR/config/web.env.production"
fi
# Unit files
for unit in trends-api.service trends-worker.service trends-worker-api.service \
            trends-mcp.service trends-convex.service trends-preview-api.service; do
    if [[ -f "/etc/systemd/system/$unit" ]]; then
        cp -a "/etc/systemd/system/$unit" "$RUN_DIR/systemd/$unit"
    fi
done
if [[ -f /etc/caddy/Caddyfile ]]; then
    cp -a /etc/caddy/Caddyfile "$RUN_DIR/caddy/Caddyfile"
fi
systemctl list-units --type=service --all 'trends*' --no-pager > "$RUN_DIR/meta/systemd-trends-units.txt" 2>/dev/null || true
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' > "$RUN_DIR/meta/docker-ps.txt" 2>/dev/null || true

# --- SQLite (consistent online backup) ---
log_step "3/8 Backup production SQLite"
if [[ ! -f "$PROD_DB" ]]; then
    log_error "Production SQLite missing: $PROD_DB"
    exit 1
fi
SQLITE_BACKUP="$RUN_DIR/sqlite/resume_screening.db"
sqlite3 "$PROD_DB" ".timeout 10000" ".backup '$SQLITE_BACKUP'"
if [[ ! -s "$SQLITE_BACKUP" ]]; then
    log_error "SQLite backup empty: $SQLITE_BACKUP"
    exit 1
fi
PROD_CA_COUNT="$(sqlite3 "$PROD_DB" "SELECT count(*) FROM candidate_actions;")"
BACKUP_CA_COUNT="$(sqlite3 "$SQLITE_BACKUP" "SELECT count(*) FROM candidate_actions;")"
if [[ "$PROD_CA_COUNT" != "$BACKUP_CA_COUNT" ]]; then
    log_error "candidate_actions count mismatch: prod=$PROD_CA_COUNT backup=$BACKUP_CA_COUNT"
    exit 1
fi
write_manifest_line "$MANIFEST" sqlite_path "sqlite/resume_screening.db"
write_manifest_line "$MANIFEST" sqlite_bytes "$(wc -c < "$SQLITE_BACKUP" | tr -d ' ')"
write_manifest_line "$MANIFEST" sqlite_sha256 "$(sha256_file "$SQLITE_BACKUP")"
write_manifest_line "$MANIFEST" candidate_actions_count "$BACKUP_CA_COUNT"
log_info "SQLite backup OK (candidate_actions=$BACKUP_CA_COUNT)"

# --- Persistent output data (excluding huge DBs already backed up) ---
log_step "4/8 Backup production output/ persistent data"
if [[ -d "$PROD_DIR/output" ]]; then
    tar -C "$PROD_DIR" \
        --exclude='output/resume_screening.db' \
        --exclude='output/resume_screening.db-shm' \
        --exclude='output/resume_screening.db-wal' \
        --exclude='output/*.db-shm' \
        --exclude='output/*.db-wal' \
        -czf "$RUN_DIR/output/output-persistent.tgz" output || true
    if [[ -f "$RUN_DIR/output/output-persistent.tgz" ]]; then
        write_manifest_line "$MANIFEST" output_tgz "output/output-persistent.tgz"
        write_manifest_line "$MANIFEST" output_tgz_sha256 "$(sha256_file "$RUN_DIR/output/output-persistent.tgz")"
    fi
fi

# --- Application file inventory (not full tree — large node_modules) ---
log_step "5/8 Snapshot application file inventory + tracked tree"
{
    echo "path=$PROD_DIR"
    echo "sha=$PROD_SHA"
    du -sh "$PROD_DIR"/* 2>/dev/null | head -50 || true
    find "$PROD_DIR" -maxdepth 3 \( -name node_modules -o -name .git -o -name .venv -o -name .cache \) -prune -o -type f -print 2>/dev/null | wc -l
} > "$RUN_DIR/meta/app-inventory.txt"
# Lightweight archive of critical non-dependency paths
tar -C "$PROD_DIR" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='.venv' \
    --exclude='.cache' \
    --exclude='output' \
    --exclude='logs' \
    --exclude='coverage' \
    -czf "$RUN_DIR/meta/app-source-lite.tgz" \
    apps packages config scripts deploy version Makefile package.json package-lock.json \
    2>/dev/null || log_warn "Lite app archive incomplete (non-fatal if paths missing)"
if [[ -f "$RUN_DIR/meta/app-source-lite.tgz" ]]; then
    write_manifest_line "$MANIFEST" app_source_lite "meta/app-source-lite.tgz"
    write_manifest_line "$MANIFEST" app_source_lite_sha256 "$(sha256_file "$RUN_DIR/meta/app-source-lite.tgz")"
fi

# --- Convex export ---
log_step "6/8 Export production Convex"
CONVEX_ZIP="$RUN_DIR/convex/convex-export.zip"
CONVEX_TMP="/tmp/trends-prod-convex-export-${TS}.zip"
CONVEX_DIR="$PROD_DIR/packages/convex"
rm -f "$CONVEX_TMP"
if [[ ! -f "$CONVEX_DIR/.env.local" ]]; then
    log_error "Missing Convex CLI env: $CONVEX_DIR/.env.local"
    exit 1
fi
# shellcheck source=quiesce.sh
if [[ -f "$SCRIPT_DIR/quiesce.sh" ]]; then
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/quiesce.sh"
    if [[ -n "${CONVEX_WRITE_SECRET:-}" ]] || [[ -n "$(read_env_value "$PROD_ENV_FILE" CONVEX_WRITE_SECRET)" ]]; then
        export CONVEX_WRITE_SECRET="${CONVEX_WRITE_SECRET:-$(read_env_value "$PROD_ENV_FILE" CONVEX_WRITE_SECRET)}"
        quiesce_writers "$CONVEX_DIR" "$PROD_CONVEX_URL" "prod-complete-backup" || log_warn "Quiesce skipped/failed; continuing export"
        trap 'release_writers "$CONVEX_DIR" "$PROD_CONVEX_URL" || true; rm -f "$CONVEX_TMP"' EXIT
    else
        log_warn "CONVEX_WRITE_SECRET unset; exporting without quiesce"
        trap 'rm -f "$CONVEX_TMP"' EXIT
    fi
fi
# Export to /tmp first (writable by trends), then move into backup dir as root
EXPORT_CMD="set -a && source '$PROD_ENV_FILE' && set +a && cd '$CONVEX_DIR' && npx convex export --path '$CONVEX_TMP' --env-file '$CONVEX_DIR/.env.local'"
if [[ "${INCLUDE_FILE_STORAGE:-}" =~ ^(1|true|yes)$ ]]; then
    EXPORT_CMD="$EXPORT_CMD --include-file-storage"
    write_manifest_line "$MANIFEST" include_file_storage "true"
else
    write_manifest_line "$MANIFEST" include_file_storage "false"
fi
sudo -u "$PROD_SERVICE_USER" bash -lc "$EXPORT_CMD"
if [[ ! -s "$CONVEX_TMP" ]]; then
    log_error "Convex export missing or empty: $CONVEX_TMP"
    exit 1
fi
cp -a "$CONVEX_TMP" "$CONVEX_ZIP"
rm -f "$CONVEX_TMP"
chmod 640 "$CONVEX_ZIP"
write_manifest_line "$MANIFEST" convex_zip "convex/convex-export.zip"
write_manifest_line "$MANIFEST" convex_zip_bytes "$(wc -c < "$CONVEX_ZIP" | tr -d ' ')"
write_manifest_line "$MANIFEST" convex_zip_sha256 "$(sha256_file "$CONVEX_ZIP")"
log_info "Convex export OK: $(ls -lh "$CONVEX_ZIP" | awk '{print $5}')"
# release via trap

# --- Optional resume portable export ---
log_step "7/8 Optional portable resume export"
if [[ "${SKIP_RESUME_EXPORT:-}" =~ ^(1|true|yes)$ ]]; then
    log_info "SKIP_RESUME_EXPORT set; skipping"
else
    RESUME_TMP="/tmp/trends-prod-resumes-${TS}.tar.gz"
    RESUME_OUT="$RUN_DIR/convex/resumes-portable.tar.gz"
    rm -f "$RESUME_TMP"
    if curl -fsS --max-time 5 "$PROD_API_URL/health" >/dev/null 2>&1 || \
       curl -fsS --max-time 5 "$PROD_API_URL/api/blocks" >/dev/null 2>&1; then
        if sudo -u "$PROD_SERVICE_USER" bash -lc \
            "set -a && source '$PROD_ENV_FILE' && set +a && cd '$PROD_DIR' && \
             API_URL='$PROD_API_URL' WORKSPACE='${DEPLOY_BACKUP_RESUME_WORKSPACE:-dev}' OUT='$RESUME_TMP' \
             npx tsx scripts/resume/backup-resumes.ts"; then
            cp -a "$RESUME_TMP" "$RESUME_OUT"
            rm -f "$RESUME_TMP"
            write_manifest_line "$MANIFEST" resume_export "convex/resumes-portable.tar.gz"
            write_manifest_line "$MANIFEST" resume_export_sha256 "$(sha256_file "$RESUME_OUT")"
            log_info "Resume portable export OK"
        else
            log_warn "Resume portable export failed (non-fatal)"
            rm -f "$RESUME_TMP"
        fi
    else
        log_warn "Production API not healthy; skipping resume portable export"
    fi
fi

# --- Verify backup integrity ---
log_step "8/8 Verify backup"
FAIL=0
for required in \
    "$RUN_DIR/git/HEAD" \
    "$RUN_DIR/config/etc-trends-env" \
    "$RUN_DIR/sqlite/resume_screening.db" \
    "$RUN_DIR/convex/convex-export.zip" \
    "$MANIFEST"
do
    if [[ ! -s "$required" ]]; then
        log_error "Required backup artifact missing: $required"
        FAIL=1
    else
        log_info "OK $(basename "$(dirname "$required")")/$(basename "$required") ($(wc -c < "$required" | tr -d ' ') bytes)"
    fi
done

# Re-check SQLite integrity
if ! sqlite3 "$SQLITE_BACKUP" "PRAGMA integrity_check;" | grep -qx ok; then
    log_error "SQLite integrity_check failed on backup"
    FAIL=1
else
    log_info "SQLite integrity_check: ok"
fi

# Zip test for convex
if command -v unzip >/dev/null 2>&1; then
    if ! unzip -t "$CONVEX_ZIP" >/dev/null; then
        log_error "Convex zip integrity test failed"
        FAIL=1
    else
        log_info "Convex zip integrity: ok"
    fi
fi

write_manifest_line "$MANIFEST" verified_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
write_manifest_line "$MANIFEST" log_file "$LOG_FILE"
if [[ "$FAIL" -ne 0 ]]; then
    write_manifest_line "$MANIFEST" status "FAILED"
    log_error "Backup verification failed. STOP. Do not proceed with preview changes."
    exit 1
fi
write_manifest_line "$MANIFEST" status "OK"
chmod -R go-rwx "$RUN_DIR/config" 2>/dev/null || true

cat <<EOF

=== Backup complete ===
backup_dir=$RUN_DIR
manifest=$MANIFEST
log=$LOG_FILE
prod_sha=$PROD_SHA
prod_branch=$PROD_BRANCH
prod_version=$PROD_VERSION
candidate_actions=$BACKUP_CA_COUNT

Next (preview-only work):
  1. sudo bash $SCRIPT_DIR/preview-preflight.sh
  2. sudo bash $SCRIPT_DIR/preview-clone-from-prod.sh
  3. sudo bash $SCRIPT_DIR/restore-preview-full-state-from-prod.sh
  4. sudo bash $SCRIPT_DIR/preview-upgrade.sh
EOF
