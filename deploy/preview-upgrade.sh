#!/usr/bin/env bash
# Upgrade the preview site to the latest Trends application version.
# Safe replacement for running `make deploy` / `install.sh upgrade` on preview:
# those production entrypoints target /opt/trends and must never run against prod
# from a preview workflow.
#
# This script:
#   - Confirms cwd/env are preview
#   - Backs up preview env
#   - Syncs code from REPO_MIRROR (origin/main) or SOURCE_REF
#   - Preserves .env.preview + isolation
#   - Rebuilds, restarts preview Docker + trends-preview-api only
#   - Runs doctor + smoke checks
#
# Usage (on ptcloud as root, preferably from preview dir):
#   cd /home/ubuntu/trends-preview
#   sudo bash deploy/preview-upgrade.sh
#   sudo ASSUME_YES=1 FORCE=1 bash deploy/preview-upgrade.sh
#
# Env:
#   SOURCE_REF=origin/main   # git ref in REPO_MIRROR to deploy
#   REPO_MIRROR=/home/ubuntu/trends
#   SKIP_DATA_RESTORE=1      # default; data restore is separate
#   SKIP_ISOLATE=0
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve preview dir: prefer PREVIEW_DIR, else script's grandparent if under preview
if [[ -z "${PREVIEW_DIR:-}" ]]; then
    if [[ -f "$SCRIPT_DIR/../.env.preview" ]]; then
        PREVIEW_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
    fi
fi
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="${LOG_DIR:-/var/log/trends}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/preview-upgrade-${TS}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

on_err() {
    log_error "preview-upgrade failed at line $1 (log: $LOG_FILE)"
    exit 1
}
trap 'on_err $LINENO' ERR

require_root
require_command rsync
require_command git
require_command curl
require_command docker

# --- Hard safety: never upgrade production ---
if is_prod_path "$(pwd -P)"; then
    log_error "cwd is production ($PROD_DIR). Refusing preview upgrade."
    log_error "cd $PREVIEW_DIR and re-run."
    exit 1
fi
assert_not_prod_install_dir "$PREVIEW_DIR" || exit 1
if [[ "$PREVIEW_DIR" == "$PROD_DIR" ]]; then
    log_error "PREVIEW_DIR equals PROD_DIR — abort"
    exit 1
fi

# Capture before any context helpers source .trends-source-meta (which also
# defines SOURCE_REF and would otherwise pin upgrades to the previous tag).
REQUESTED_SOURCE_REF="${SOURCE_REF:-origin/main}"
SOURCE_REF="$REQUESTED_SOURCE_REF"

log_step "Preview upgrade preflight"
print_context_report "preview-before" "$PREVIEW_DIR" "$PREVIEW_ENV_FILE"
SOURCE_REF="$REQUESTED_SOURCE_REF"

# Prefer cwd check when operator is in preview tree
if is_preview_path "$(pwd -P)"; then
    log_info "cwd is preview installation — OK"
elif [[ -d "$PREVIEW_DIR" ]]; then
    log_warn "cwd is not preview dir; using PREVIEW_DIR=$PREVIEW_DIR"
    cd "$PREVIEW_DIR"
else
    log_error "Preview directory missing: $PREVIEW_DIR"
    exit 1
fi

if [[ -f "$PREVIEW_ENV_FILE" ]]; then
    assert_preview_env_file "$PREVIEW_ENV_FILE" || exit 1
else
    log_error "Missing preview env: $PREVIEW_ENV_FILE"
    exit 1
fi

BEFORE_META=""
if [[ -f "$PREVIEW_DIR/.trends-source-meta" ]]; then
    BEFORE_META="$(cat "$PREVIEW_DIR/.trends-source-meta")"
fi
BEFORE_VERSION="$(tr -d '[:space:]' < "$PREVIEW_DIR/version" 2>/dev/null || echo unknown)"

confirm_or_exit "Upgrade preview at $PREVIEW_DIR from $REPO_MIRROR ($SOURCE_REF)? (production will NOT be modified)"

# --- Ensure mirror is current ---
log_step "Update repo mirror $REPO_MIRROR → $SOURCE_REF"
if [[ ! -d "$REPO_MIRROR/.git" ]]; then
    log_info "Cloning trends repo to $REPO_MIRROR"
    sudo -u "$PREVIEW_SERVICE_USER" git clone https://github.com/ptdevhk/trends.git "$REPO_MIRROR"
fi
sudo -u "$PREVIEW_SERVICE_USER" git -C "$REPO_MIRROR" fetch --prune origin
# Resolve ref
if [[ "$SOURCE_REF" == origin/* ]]; then
    sudo -u "$PREVIEW_SERVICE_USER" git -C "$REPO_MIRROR" checkout -B "${SOURCE_REF#origin/}" "$SOURCE_REF"
    sudo -u "$PREVIEW_SERVICE_USER" git -C "$REPO_MIRROR" reset --hard "$SOURCE_REF"
else
    sudo -u "$PREVIEW_SERVICE_USER" git -C "$REPO_MIRROR" checkout -f "$SOURCE_REF"
    sudo -u "$PREVIEW_SERVICE_USER" git -C "$REPO_MIRROR" reset --hard "$SOURCE_REF"
fi
TARGET_SHA="$(sudo -u "$PREVIEW_SERVICE_USER" git -C "$REPO_MIRROR" rev-parse HEAD)"
TARGET_SHA_SHORT="$(sudo -u "$PREVIEW_SERVICE_USER" git -C "$REPO_MIRROR" rev-parse --short HEAD)"
TARGET_BRANCH="$(sudo -u "$PREVIEW_SERVICE_USER" git -C "$REPO_MIRROR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
TARGET_VERSION="$(tr -d '[:space:]' < "$REPO_MIRROR/version" 2>/dev/null || echo unknown)"
log_info "Target: $TARGET_BRANCH @ $TARGET_SHA_SHORT (v$TARGET_VERSION)"
sudo -u "$PREVIEW_SERVICE_USER" git -C "$REPO_MIRROR" log -1 --oneline

# --- Backup env ---
ENV_BACKUP="/tmp/preview-env-upgrade-${TS}.env"
cp -a "$PREVIEW_ENV_FILE" "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP"
log_info "Preview env backup: $ENV_BACKUP"

# Optional tree backup (move-aside heavy; use rsync into bak instead for speed)
BAK_DIR="${PREVIEW_DIR}.upgrade-bak.${TS}"
if [[ "${SKIP_TREE_BACKUP:-}" =~ ^(1|true|yes)$ ]]; then
    log_warn "SKIP_TREE_BACKUP set"
else
    log_info "Snapshotting preview tree → $BAK_DIR (excluding node_modules)"
    mkdir -p "$BAK_DIR"
    rsync -a \
        --exclude 'node_modules' \
        --exclude '.cache' \
        --exclude 'logs' \
        "$PREVIEW_DIR/" "$BAK_DIR/"
fi

log_step "Sync $REPO_MIRROR → $PREVIEW_DIR"
rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.venv' \
    --exclude '.cache' \
    --exclude 'logs' \
    --exclude 'coverage' \
    --exclude 'output' \
    --exclude '.env.preview' \
    --exclude '.env.production' \
    --exclude 'packages/convex/.env.local' \
    --exclude 'packages/convex/.convex' \
    --exclude 'apps/web/dist' \
    --exclude 'docker-compose.preview.yml' \
    --exclude 'start-convex.sh' \
    --exclude 'prod-convex-export.zip' \
    --exclude '.digest-restore-epoch' \
    "$REPO_MIRROR/" "$PREVIEW_DIR/"

# Restore env first
cp -a "$ENV_BACKUP" "$PREVIEW_ENV_FILE"
chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_ENV_FILE"
chmod 600 "$PREVIEW_ENV_FILE"

# Refresh compose helpers from tree
cp "$PREVIEW_DIR/deploy/docker/docker-compose.preview.yml" "$PREVIEW_DIR/docker-compose.preview.yml"
cp "$PREVIEW_DIR/deploy/docker/start-convex.sh" "$PREVIEW_DIR/start-convex.sh"
chmod +x "$PREVIEW_DIR/start-convex.sh"
chown -R "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_DIR"

cat > "$PREVIEW_DIR/.trends-source-meta" <<EOF
SOURCE=mirror
SOURCE_DIR=$REPO_MIRROR
SOURCE_SHA=$TARGET_SHA
SOURCE_SHA_SHORT=$TARGET_SHA_SHORT
SOURCE_BRANCH=$TARGET_BRANCH
SOURCE_VERSION=$TARGET_VERSION
SOURCE_REF=$SOURCE_REF
UPGRADED_AT=$TS
PREVIOUS_VERSION=$BEFORE_VERSION
EOF
chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_DIR/.trends-source-meta"

if [[ ! "${SKIP_ISOLATE:-}" =~ ^(1|true|yes)$ ]]; then
    ASSUME_YES=1 bash "$SCRIPT_DIR/preview-isolate-integrations.sh" --apply
fi
assert_preview_env_file "$PREVIEW_ENV_FILE" || exit 1

log_step "Dependencies + build"
sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && npm install --no-audit --no-fund"
sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && npm rebuild better-sqlite3" || true
if [[ -x "$PREVIEW_DIR/scripts/build-extension-zip.sh" ]]; then
    sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && bash scripts/build-extension-zip.sh" || true
fi
sudo -u "$PREVIEW_SERVICE_USER" tee "$PREVIEW_DIR/apps/web/.env.local" >/dev/null <<EOF
VITE_CONVEX_URL=https://${PREVIEW_PUBLIC_HOST}/convex
EOF
sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && npm --workspace @trends/shared run build"
sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && npm --workspace @trends/web run build"
# Record build meta
sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && mkdir -p apps/web/dist && printf 'git_sha=%s\ngit_branch=%s\nbuilt_at=%s\n' '$TARGET_SHA' '$TARGET_BRANCH' '$(date -u +%Y-%m-%dT%H:%M:%SZ)' > apps/web/dist/.trends-build-meta"

log_step "Restart preview Convex (force-recreate after tree sync)"
# Force-recreate so bind mounts track the current preview tree inode.
cd "$PREVIEW_DIR"
docker compose -f docker-compose.preview.yml up -d --force-recreate convex mcp
# Give convex time; start-convex.sh runs convex dev --once for schema
for i in $(seq 1 48); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$PREVIEW_CONVEX_URL/version" || echo 000)"
    if [[ "$code" == "200" ]]; then
        log_info "Preview Convex /version → 200"
        break
    fi
    sleep 5
done
if [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$PREVIEW_CONVEX_URL/version" || echo 000)" != "200" ]]; then
    log_error "Preview Convex did not become healthy after upgrade"
    log_error "Try: bash $PREVIEW_DIR/deploy/preview-doctor.sh --recover --full"
    exit 1
fi

# Sync AI env into Convex; push schema if container tooling available
if [[ -x "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" ]]; then
    PREVIEW_DIR="$PREVIEW_DIR" bash "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" || true
fi

# Best-effort schema deploy inside container (start-convex already does this; re-run once)
docker exec trends-preview-convex bash -c \
    'cd /app/packages/convex && npx convex dev --once --url http://127.0.0.1:3210' \
    2>&1 | tail -20 || log_warn "convex dev --once returned non-zero (inspect if schema push failed)"

log_step "Restart preview API only"
systemctl daemon-reload || true
# Ensure unit still points at preview paths
if [[ -f "$PREVIEW_DIR/deploy/systemd/trends-preview-api.service" ]]; then
    cp "$PREVIEW_DIR/deploy/systemd/trends-preview-api.service" /etc/systemd/system/trends-preview-api.service
    systemctl daemon-reload
fi
systemctl restart "$PREVIEW_API_SERVICE"
wait_for_http "$PREVIEW_API_URL/health" 120

log_step "Seed canonical preview auth (admin@dev + hr-demo@hr)"
if [[ -x "$SCRIPT_DIR/preview-seed-auth.sh" ]]; then
    bash "$SCRIPT_DIR/preview-seed-auth.sh" || log_warn "preview-seed-auth failed (run manually)"
elif [[ -x "$PREVIEW_DIR/deploy/preview-seed-auth.sh" ]]; then
    bash "$PREVIEW_DIR/deploy/preview-seed-auth.sh" || log_warn "preview-seed-auth failed (run manually)"
fi
# Ensure CONVEX_WRITE_SECRET is in Convex deployment env (status overlays)
if [[ -x "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" ]]; then
    PREVIEW_DIR="$PREVIEW_DIR" bash "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" --sync-only || true
elif [[ -x "$SCRIPT_DIR/sync-preview-convex-env.sh" ]]; then
    PREVIEW_DIR="$PREVIEW_DIR" bash "$SCRIPT_DIR/sync-preview-convex-env.sh" --sync-only || true
fi

log_step "Verification"
print_context_report "preview-after" "$PREVIEW_DIR" "$PREVIEW_ENV_FILE"
HEALTH="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$PREVIEW_API_URL/health" || echo 000)"
BLOCKS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$PREVIEW_API_URL/api/blocks" || echo 000)"
RESUMES="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$PREVIEW_API_URL/api/resumes?source=convex&paged=true&limit=1" || echo 000)"
PUB="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PREVIEW_PUBLIC_HOST/" || echo 000)"
CV="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$PREVIEW_CONVEX_URL/version" || echo 000)"
log_info "health=$HEALTH api/blocks=$BLOCKS resumes=$RESUMES public=$PUB convex=$CV"
# blocks/resumes may be 401 when auth is enforced (expected)
if [[ "$BLOCKS" != "200" && "$BLOCKS" != "401" ]]; then
    log_warn "unexpected /api/blocks code=$BLOCKS"
fi

# Confirm production still untouched
PROD_SHA_NOW="$(sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" rev-parse --short HEAD 2>/dev/null || echo n/a)"
log_info "Production SHA unchanged check: $PROD_SHA_NOW (informational)"

if [[ -x "$SCRIPT_DIR/preview-doctor.sh" ]]; then
    bash "$SCRIPT_DIR/preview-doctor.sh" || log_warn "preview-doctor reported issues"
elif [[ -x "$PREVIEW_DIR/deploy/preview-doctor.sh" ]]; then
    bash "$PREVIEW_DIR/deploy/preview-doctor.sh" || log_warn "preview-doctor reported issues"
fi

if [[ "$HEALTH" != "200" || "$CV" != "200" ]]; then
    log_error "Post-upgrade health checks failed. STOP and investigate before further changes."
    exit 1
fi

# Always ensure + repair BFF_API_URL on live .env.preview (missing OR container-local wrong).
PREVIEW_BFF_DEFAULT="$(default_bff_api_url_for_role preview)"
set +e
ensure_bff_env_lines "$PREVIEW_ENV_FILE" preview "$PREVIEW_BFF_DEFAULT"
ensure_rc=$?
set -e
case "$ensure_rc" in
  1) log_info "Added BFF_API_URL=${PREVIEW_BFF_DEFAULT} to $PREVIEW_ENV_FILE" ;;
  2) log_info "Repaired BFF_API_URL → ${PREVIEW_BFF_DEFAULT} in $PREVIEW_ENV_FILE" ;;
esac
chmod 600 "$PREVIEW_ENV_FILE"
chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_ENV_FILE" || true
if [[ -x "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" ]]; then
    PREVIEW_DIR="$PREVIEW_DIR" bash "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" --sync-only || true
fi

log_step "Digest rebuild after code upgrade (stale-digest drift prevention)"
# When a production→preview data restore (DIGEST_BACKFILL_MODE=skip or
# if-epoch-changed) preserves old production digests, a subsequent code upgrade
# may change the role-year algorithm (e.g. verified-only gate at epoch 2/3).
# The imported digests still carry stale roleYearsByType computed by the old
# algorithm, causing inconsistent search results. Rebuild digests when the
# code epoch has changed since the restore.
SKIP_DIGEST_REBUILD="${SKIP_DIGEST_REBUILD:-0}"
DIGEST_REBUILD_BATCH_SIZE="${DIGEST_REBUILD_BATCH_SIZE:-50}"
RESTORE_EPOCH_MARKER="$PREVIEW_DIR/.digest-restore-epoch"
NEW_CODE_EPOCH=0
if [[ -f "$PREVIEW_DIR/packages/shared/dist/ingest-compute-epoch.js" ]]; then
    NEW_CODE_EPOCH="$(cd "$PREVIEW_DIR" && node -e \
        "console.log(require('./packages/shared/dist/ingest-compute-epoch.js').CURRENT_INGEST_COMPUTE_EPOCH)" \
        2>/dev/null || echo 0)"
elif [[ -f "$PREVIEW_DIR/packages/shared/src/ingest-compute-epoch.ts" ]]; then
    NEW_CODE_EPOCH="$(cd "$PREVIEW_DIR" && npx tsx -e \
        "process.stdout.write(String(require('./packages/shared/src/ingest-compute-epoch.ts').CURRENT_INGEST_COMPUTE_EPOCH))" \
        2>/dev/null || echo 0)"
fi
RESTORE_EPOCH=""
if [[ -f "$RESTORE_EPOCH_MARKER" ]]; then
    RESTORE_EPOCH="$(cat "$RESTORE_EPOCH_MARKER" 2>/dev/null | tr -d '[:space:]' || echo "")"
fi
log_info "Code epoch=$NEW_CODE_EPOCH restore-epoch=${RESTORE_EPOCH:-none}"
SHOULD_REBUILD_DIGESTS=0
if [[ "$SKIP_DIGEST_REBUILD" == "1" ]]; then
    log_info "SKIP_DIGEST_REBUILD=1 — skipping digest rebuild"
elif [[ -z "$RESTORE_EPOCH" ]]; then
    log_info "No restore-epoch marker — skipping digest rebuild (no prior restore or marker removed)"
elif [[ "$RESTORE_EPOCH" != "$NEW_CODE_EPOCH" ]]; then
    SHOULD_REBUILD_DIGESTS=1
    log_warn "Epoch changed since restore ($RESTORE_EPOCH → $NEW_CODE_EPOCH) — rebuilding digests"
else
    log_info "Epoch unchanged — digests are current"
fi
if [[ "$SHOULD_REBUILD_DIGESTS" -eq 1 ]]; then
    DIGEST_CURSOR=""
    DIGEST_TOTAL=0
    DIGEST_ITERATION=1
    while true; do
        DIGEST_CALL_ARGS="$(CURSOR="$DIGEST_CURSOR" DIGEST_REBUILD_BATCH_SIZE="$DIGEST_REBUILD_BATCH_SIZE" python3 <<'PYEOF'
import json, os
args = {"limit": int(os.environ["DIGEST_REBUILD_BATCH_SIZE"])}
cursor = os.environ.get("CURSOR")
if cursor:
    args["cursor"] = cursor
print(json.dumps(args))
PYEOF
)"
        log_info "Backfilling resume_digests batch $DIGEST_ITERATION..."
        if ! DIGEST_OUTPUT="$(docker exec trends-preview-convex bash -c \
            "cd /app/packages/convex && npx convex run resumes_search:backfillResumeDigests '$DIGEST_CALL_ARGS'" 2>&1)"; then
            printf '%s\n' "$DIGEST_OUTPUT"
            log_warn "resume_digests backfill failed — search totals may be inconsistent until manual rebuild"
            break
        fi
        DIGEST_PARSED="$(OUTPUT="$DIGEST_OUTPUT" python3 <<'PYEOF'
import json, os
source = os.environ["OUTPUT"]
start = source.find("{")
end = source.rfind("}")
if start == -1 or end == -1 or end < start:
    raise SystemExit(f"Could not parse Convex response: {source}")
value = json.loads(source[start : end + 1])
processed = int(value.get("processed") or 0)
is_done = 1 if value.get("isDone") else 0
cursor = value.get("cursor") or ""
print(f"{processed}\t{is_done}\t{cursor}")
PYEOF
)"
        DIGEST_PROCESSED="${DIGEST_PARSED%%$'\t'*}"
        DIGEST_REST="${DIGEST_PARSED#*$'\t'}"
        DIGEST_IS_DONE="${DIGEST_REST%%$'\t'*}"
        DIGEST_CURSOR="${DIGEST_REST#*$'\t'}"
        DIGEST_TOTAL=$((DIGEST_TOTAL + DIGEST_PROCESSED))
        if [[ "$DIGEST_IS_DONE" == "1" ]]; then
            break
        fi
        if [[ -z "$DIGEST_CURSOR" ]]; then
            log_warn "resume_digests backfill did not finish but returned no cursor"
            break
        fi
        DIGEST_ITERATION=$((DIGEST_ITERATION + 1))
    done
    log_info "Backfilled resume_digests for $DIGEST_TOTAL resumes"
    # Remove the marker so a subsequent upgrade without a new restore doesn't re-trigger
    rm -f "$RESTORE_EPOCH_MARKER"
fi
# Restart API to pick up rebuilt digests
if [[ "$SHOULD_REBUILD_DIGESTS" -eq 1 ]]; then
    systemctl restart "$PREVIEW_API_SERVICE"
    wait_for_http "$PREVIEW_API_URL/health" 120
fi

log_step "Search-data freshness gate (code deploy ≠ computed role years)"
# GATE_STRICT=0 for lag after schedule: upgrade succeeds but golden floor hard-fails.
# Operators re-run gate after reingest. Set PREVIEW_FRESHNESS_STRICT=1 to fail upgrade on floor miss.
FRESHNESS_SCRIPT="$SCRIPT_DIR/search-freshness-gate.sh"
[[ -x "$FRESHNESS_SCRIPT" ]] || FRESHNESS_SCRIPT="$PREVIEW_DIR/deploy/search-freshness-gate.sh"
if [[ -x "$FRESHNESS_SCRIPT" ]]; then
    set +e
    PREVIEW_DIR="$PREVIEW_DIR" PREVIEW_ENV_FILE="$PREVIEW_ENV_FILE" \
      PREVIEW_API_URL="$PREVIEW_API_URL" PREVIEW_PUBLIC_HOST="$PREVIEW_PUBLIC_HOST" \
      GATE_STRICT="${PREVIEW_FRESHNESS_STRICT:-1}" SCHEDULE_REINGEST="${PREVIEW_SCHEDULE_REINGEST:-1}" \
      bash "$FRESHNESS_SCRIPT" --role preview --api-url "$PREVIEW_API_URL" --workspace dev
    FRESH_RC=$?
    set -e
    if [[ "$FRESH_RC" -eq 0 ]]; then
        log_info "Search freshness gate OK"
    elif [[ "$FRESH_RC" -eq 3 ]]; then
        log_error "Search freshness availability / semantic checks failed (MY/CN minRoleYears). Code is up but search parity is bad."
        log_error "Ensure Convex BFF_API_URL=${PREVIEW_BFF_DEFAULT}, then:"
        log_error "  bash $FRESHNESS_SCRIPT --role preview --api-url $PREVIEW_API_URL"
        log_error "  or: trends resume debug trigger-reingest --mode compute --limit 200 --api-url $PREVIEW_API_URL"
        if [[ "${PREVIEW_FRESHNESS_STRICT:-1}" == "1" ]]; then
            exit 1
        fi
    elif [[ "$FRESH_RC" -eq 4 ]]; then
        log_error "BFF_API_URL misconfigured for preview Convex — reingest cannot reach host BFF"
        exit 1
    else
        log_warn "Search freshness gate exit=$FRESH_RC (see log); code deploy completed"
    fi
else
    log_warn "search-freshness-gate.sh missing — skip freshness check"
fi

cat <<EOF

=== Preview upgrade complete ===
before_version=$BEFORE_VERSION
after_version=$TARGET_VERSION
after_sha=$TARGET_SHA
after_branch=$TARGET_BRANCH
env_backup=$ENV_BACKUP
tree_backup=${BAK_DIR:-skipped}
log=$LOG_FILE

Production was not modified.
Data restore (if needed): sudo bash $SCRIPT_DIR/restore-preview-full-state-from-prod.sh
Seed auth: bash $SCRIPT_DIR/preview-seed-auth.sh
Gate: bash $SCRIPT_DIR/preview-migration-gate.sh
Doctor: bash $PREVIEW_DIR/deploy/preview-doctor.sh --full
Search freshness: bash $PREVIEW_DIR/deploy/search-freshness-gate.sh --role preview --api-url $PREVIEW_API_URL
Note: app upgrade is code-only; golden MY/CN floors need compute reingest when role years are zero/stale.
EOF
