#!/usr/bin/env bash
# Install the exact production application version into the preview site.
# Preserves preview-specific .env.preview and does NOT touch production.
#
# Steps:
#   1. Read production git SHA / version
#   2. Backup existing preview env + optional full tree
#   3. Sync code from /opt/trends (or REPO_MIRROR at prod SHA)
#   4. Restore preview env + isolation
#   5. Install deps, build shared+web, restart preview services only
#
# Usage (on ptcloud as root):
#   sudo bash deploy/preview-clone-from-prod.sh
#   sudo ASSUME_YES=1 bash deploy/preview-clone-from-prod.sh
#
# Env:
#   PROD_DIR, PREVIEW_DIR, SKIP_BUILD=1, SKIP_DOCKER_RESTART=1
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="${LOG_DIR:-/var/log/trends}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/preview-clone-from-prod-${TS}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

on_err() {
    log_error "preview-clone-from-prod failed at line $1 (log: $LOG_FILE)"
    exit 1
}
trap 'on_err $LINENO' ERR

require_root
require_command rsync
require_command git
require_command curl

assert_not_prod_install_dir "$PREVIEW_DIR" || exit 1
if is_prod_path "$(pwd -P)"; then
    log_error "Refuse to run while cwd is production install. cd elsewhere first."
    exit 1
fi

log_step "Clone production version → preview"
print_context_report "production(read-only)" "$PROD_DIR" "$PROD_ENV_FILE"

if [[ ! -d "$PROD_DIR/.git" ]]; then
    log_error "Production is not a git checkout: $PROD_DIR"
    exit 1
fi

PROD_SHA="$(sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" rev-parse HEAD)"
PROD_SHA_SHORT="$(sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" rev-parse --short HEAD)"
PROD_BRANCH="$(sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
PROD_VERSION="$(tr -d '[:space:]' < "$PROD_DIR/version" 2>/dev/null || echo unknown)"
log_info "Production target: $PROD_BRANCH @ $PROD_SHA_SHORT (v$PROD_VERSION)"

confirm_or_exit "Replace preview application files at $PREVIEW_DIR with production SHA $PROD_SHA_SHORT?"

# --- Preserve preview env ---
ENV_BACKUP=""
if [[ -f "$PREVIEW_ENV_FILE" ]]; then
    ENV_BACKUP="/tmp/preview-env-${TS}.env"
    cp -a "$PREVIEW_ENV_FILE" "$ENV_BACKUP"
    chmod 600 "$ENV_BACKUP"
    log_info "Saved preview env → $ENV_BACKUP"
fi

# --- Backup existing preview tree ---
if [[ -d "$PREVIEW_DIR" ]]; then
    BAK="${PREVIEW_DIR}.bak.${TS}"
    log_info "Moving existing preview → $BAK"
    mv "$PREVIEW_DIR" "$BAK"
    # Keep a symlink marker for operators
    echo "$BAK" > "/tmp/preview-last-bak-${TS}.path"
fi

mkdir -p "$PREVIEW_DIR"
chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_DIR"

log_step "Rsync production application into preview (exclude runtime/secrets)"
# Copy application code from production working tree at current SHA.
# Exclude: git, node_modules, venv, logs, local DBs, production env files
rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.venv' \
    --exclude '.cache' \
    --exclude 'logs' \
    --exclude 'coverage' \
    --exclude 'output/*.db' \
    --exclude 'output/*.db-shm' \
    --exclude 'output/*.db-wal' \
    --exclude 'convex_local_storage' \
    --exclude '.env.production' \
    --exclude '.env.preview' \
    --exclude 'packages/convex/.env.local' \
    --exclude 'packages/convex/.convex' \
    --exclude 'apps/web/dist' \
    "$PROD_DIR/" "$PREVIEW_DIR/"

chown -R "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_DIR"

# Record source metadata (preview has no .git after rsync)
cat > "$PREVIEW_DIR/.trends-source-meta" <<EOF
SOURCE=production
SOURCE_DIR=$PROD_DIR
SOURCE_SHA=$PROD_SHA
SOURCE_SHA_SHORT=$PROD_SHA_SHORT
SOURCE_BRANCH=$PROD_BRANCH
SOURCE_VERSION=$PROD_VERSION
CLONED_AT=$TS
EOF
chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_DIR/.trends-source-meta"

# Compose + start script at project root
if [[ -f "$PREVIEW_DIR/deploy/docker/docker-compose.preview.yml" ]]; then
    cp "$PREVIEW_DIR/deploy/docker/docker-compose.preview.yml" "$PREVIEW_DIR/docker-compose.preview.yml"
fi
if [[ -f "$PREVIEW_DIR/deploy/docker/start-convex.sh" ]]; then
    cp "$PREVIEW_DIR/deploy/docker/start-convex.sh" "$PREVIEW_DIR/start-convex.sh"
    chmod +x "$PREVIEW_DIR/start-convex.sh"
fi
chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" \
    "$PREVIEW_DIR/docker-compose.preview.yml" \
    "$PREVIEW_DIR/start-convex.sh" 2>/dev/null || true

# Restore preview env
log_step "Restore preview-specific environment"
if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
    cp -a "$ENV_BACKUP" "$PREVIEW_ENV_FILE"
elif [[ -f "$BAK/.env.preview" ]]; then
    cp -a "$BAK/.env.preview" "$PREVIEW_ENV_FILE"
elif [[ -f "$PREVIEW_DIR/deploy/env.preview" ]]; then
    log_warn "No previous preview env; copying template — EDIT SECRETS before serving traffic"
    cp "$PREVIEW_DIR/deploy/env.preview" "$PREVIEW_ENV_FILE"
else
    log_error "Unable to restore preview env"
    exit 1
fi
chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_ENV_FILE"
chmod 600 "$PREVIEW_ENV_FILE"

# Force isolation keys
ASSUME_YES=1 bash "$SCRIPT_DIR/preview-isolate-integrations.sh" --apply

assert_preview_env_file "$PREVIEW_ENV_FILE" || exit 1
print_context_report "preview-after-clone" "$PREVIEW_DIR" "$PREVIEW_ENV_FILE"

if [[ "${SKIP_BUILD:-}" =~ ^(1|true|yes)$ ]]; then
    log_warn "SKIP_BUILD set; skipping npm install/build"
else
    log_step "Install dependencies + build preview artifacts"
    sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && npm install --no-audit --no-fund"
    sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && npm rebuild better-sqlite3" || true
    if [[ -x "$PREVIEW_DIR/scripts/build-extension-zip.sh" ]]; then
        sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && bash scripts/build-extension-zip.sh" || true
    fi
    # Vite build-time env for preview public Convex URL
    sudo -u "$PREVIEW_SERVICE_USER" tee "$PREVIEW_DIR/apps/web/.env.local" >/dev/null <<EOF
VITE_CONVEX_URL=https://${PREVIEW_PUBLIC_HOST}/convex
EOF
    sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && npm --workspace @trends/shared run build"
    sudo -u "$PREVIEW_SERVICE_USER" bash -c "cd '$PREVIEW_DIR' && npm --workspace @trends/web run build"
fi

if [[ ! "${SKIP_DOCKER_RESTART:-}" =~ ^(1|true|yes)$ ]]; then
    log_step "Recreate preview Docker services (Convex + MCP only)"
    # IMPORTANT: clone does `mv` of the preview tree. Existing containers keep
    # the old directory inode on their bind mount, so plain `up -d` leaves
    # Convex unhealthy and the SPA appears broken (API 500 / blank UI).
    # Always force-recreate after a tree replace.
    if [[ -f "$PREVIEW_DIR/docker-compose.preview.yml" ]]; then
        cd "$PREVIEW_DIR"
        docker compose -f docker-compose.preview.yml up -d --force-recreate convex mcp
        # Wait for convex health if container exists
        for i in $(seq 1 48); do
            status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' trends-preview-convex 2>/dev/null || echo missing)"
            code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$PREVIEW_CONVEX_URL/version" || echo 000)"
            if [[ "$code" == "200" ]]; then
                log_info "Preview Convex ready (status=$status http=$code)"
                break
            fi
            sleep 5
        done
        if [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$PREVIEW_CONVEX_URL/version" || echo 000)" != "200" ]]; then
            log_error "Preview Convex did not become healthy after recreate"
            docker logs trends-preview-convex --tail 40 2>&1 || true
            exit 1
        fi
    fi
    if [[ -x "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" ]]; then
        PREVIEW_DIR="$PREVIEW_DIR" bash "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" || true
    fi
    log_step "Restart preview API only (never production units)"
    systemctl restart "$PREVIEW_API_SERVICE"
    wait_for_http "$PREVIEW_API_URL/api/blocks" 120 || wait_for_http "$PREVIEW_API_URL/" 60 || true
fi

# Smoke
log_step "Smoke checks"
for path in /api/blocks; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$PREVIEW_API_URL$path" || echo 000)"
    log_info "preview $path → $code"
done
PUB="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PREVIEW_PUBLIC_HOST/" || echo 000)"
log_info "https://$PREVIEW_PUBLIC_HOST/ → $PUB"

cat <<EOF

=== Preview clone from production complete ===
preview_dir=$PREVIEW_DIR
source_sha=$PROD_SHA
source_branch=$PROD_BRANCH
source_version=$PROD_VERSION
env_backup=${ENV_BACKUP:-none}
tree_backup=${BAK:-none}
log=$LOG_FILE

Next:
  # Full data sync (Convex + SQLite) — modifies PREVIEW only
  sudo bash $SCRIPT_DIR/restore-preview-full-state-from-prod.sh

  # Then upgrade preview to latest (from preview dir):
  cd $PREVIEW_DIR && sudo bash deploy/preview-upgrade.sh
  # or: cd $PREVIEW_DIR && make deploy
EOF
