#!/usr/bin/env bash
# Preview-only mutation worker for historical backup rehearsals.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-complete-backup.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-complete-backup.sh"

ACTION="${1:-}"
shift || true
RUN_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --run-dir) RUN_DIR="${2:-}"; shift 2 ;;
        *) log_error "Unknown argument: $1"; exit 2 ;;
    esac
done

STATE_FILE="$RUN_DIR/state.env"
ROLLBACK_DIR="$RUN_DIR/rollback"
ALLOWLIST="$SCRIPT_DIR/preview-output-restore.allowlist"
PREVIEW_CONVEX_CONTAINER="${PREVIEW_CONVEX_CONTAINER:-trends-preview-convex}"
PREVIEW_MCP_CONTAINER="${PREVIEW_MCP_CONTAINER:-trends-preview-mcp}"

state_get() {
    python3 - "$STATE_FILE" "$1" <<'PY'
import pathlib, sys
path, target = pathlib.Path(sys.argv[1]), sys.argv[2]
for raw in path.read_text().splitlines():
    if "=" in raw:
        key, value = raw.split("=", 1)
        if key == target:
            print(value)
            break
PY
}

assert_worker_safety() {
    [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || { log_error "run state missing"; exit 1; }
    [[ -d "$PREVIEW_DIR" ]] || { log_error "preview directory missing: $PREVIEW_DIR"; exit 1; }
    ! is_preview_path "$SCRIPT_DIR" \
        || { log_error "controller scripts must run from a fixed checkout outside PREVIEW_DIR"; exit 1; }
    assert_not_prod_install_dir "$PREVIEW_DIR" || exit 1
    [[ "$(complete_backup_realpath "$PREVIEW_DIR")" != "$(complete_backup_realpath "$PROD_DIR")" ]] \
        || { log_error "preview and production directories are identical"; exit 1; }
    [[ "$(complete_backup_realpath "$(dirname "$PREVIEW_DB")")" == "$(complete_backup_realpath "$PREVIEW_DIR/output")" ]] \
        || { log_error "preview SQLite is outside preview output"; exit 1; }
    [[ "$PREVIEW_DB" != "$PROD_DB" ]] || { log_error "preview and production SQLite paths are identical"; exit 1; }
    [[ "$PREVIEW_CONVEX_URL" != "$PROD_CONVEX_URL" && "$PREVIEW_CONVEX_URL" != *":3210"* ]] \
        || { log_error "preview Convex URL points at production"; exit 1; }
    [[ "$PREVIEW_API_SERVICE" == trends-preview-* ]] || { log_error "refusing non-preview systemd unit: $PREVIEW_API_SERVICE"; exit 1; }
    [[ "$PREVIEW_CONVEX_CONTAINER" == trends-preview-* && "$PREVIEW_MCP_CONTAINER" == trends-preview-* ]] \
        || { log_error "refusing non-preview container name"; exit 1; }
    assert_preview_env_file "$PREVIEW_ENV_FILE" || exit 1
}

hash_manifest() {
    local root="$1"
    local output="$2"
    local temporary
    temporary="$(mktemp "${TMPDIR:-/tmp}/trends-rollback-manifest.XXXXXX")"
    (
        cd "$root"
        find . -type f ! -name "$(basename "$output")" -print0 \
            | sort -z \
            | while IFS= read -r -d '' file; do
                printf '%s  %s\n' "$(complete_backup_sha256 "$file")" "${file#./}"
            done
    ) > "$temporary"
    mv "$temporary" "$output"
}

capture_preview_convex() {
    local output="$1"
    local container_path="/tmp/trends-preview-rehearsal-export.zip"
    docker exec "$PREVIEW_CONVEX_CONTAINER" rm -f "$container_path"
    docker exec "$PREVIEW_CONVEX_CONTAINER" bash -lc \
        "cd /app/packages/convex && npx convex export --path '$container_path' --include-file-storage --env-file .env.local"
    docker cp "$PREVIEW_CONVEX_CONTAINER:$container_path" "$output"
    docker exec "$PREVIEW_CONVEX_CONTAINER" rm -f "$container_path"
    unzip -t "$output" >/dev/null
}

protect_preview() {
    mkdir -p "$ROLLBACK_DIR"/{app,sqlite,convex,meta,output}
    systemctl is-active "$PREVIEW_API_SERVICE" > "$ROLLBACK_DIR/meta/api-service-state.txt" 2>/dev/null || true
    docker inspect -f '{{.State.Status}}' "$PREVIEW_CONVEX_CONTAINER" > "$ROLLBACK_DIR/meta/convex-container-state.txt" 2>/dev/null || true
    docker inspect -f '{{.State.Status}}' "$PREVIEW_MCP_CONTAINER" > "$ROLLBACK_DIR/meta/mcp-container-state.txt" 2>/dev/null || true
    docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' > "$ROLLBACK_DIR/meta/docker-state.txt"
    stat -f '%Lp %Su %Sg' "$PREVIEW_DIR" > "$ROLLBACK_DIR/meta/preview-dir-mode.txt" 2>/dev/null \
        || stat -c '%a %U %G' "$PREVIEW_DIR" > "$ROLLBACK_DIR/meta/preview-dir-mode.txt"

    [[ -f "$PREVIEW_DB" && ! -L "$PREVIEW_DB" ]] || { log_error "preview SQLite missing or symlinked"; exit 1; }
    sqlite3 "$PREVIEW_DB" ".timeout 10000" ".backup '$ROLLBACK_DIR/sqlite/resume_screening.db'"
    sqlite3 "$ROLLBACK_DIR/sqlite/resume_screening.db" "PRAGMA integrity_check;" | grep -qx ok
    for suffix in "" "-wal" "-shm"; do
        [[ -f "$PREVIEW_DB$suffix" ]] && cp -a "$PREVIEW_DB$suffix" "$ROLLBACK_DIR/sqlite/original$(basename "$PREVIEW_DB")$suffix"
    done
    capture_preview_convex "$ROLLBACK_DIR/convex/preview-convex.zip"
    tar -C "$PREVIEW_DIR" \
        --exclude='.git' --exclude='node_modules' --exclude='.cache' \
        --exclude='coverage' --exclude='logs' --exclude='output' \
        -czf "$ROLLBACK_DIR/app/preview-app.tgz" .
    cp -a "$PREVIEW_ENV_FILE" "$ROLLBACK_DIR/app/.env.preview"
    [[ -f "$PREVIEW_DIR/.trends-source-meta" ]] && cp -a "$PREVIEW_DIR/.trends-source-meta" "$ROLLBACK_DIR/app/.trends-source-meta"
    while IFS= read -r relative; do
        [[ -z "$relative" || "$relative" == \#* ]] && continue
        if [[ -f "$PREVIEW_DIR/$relative" && ! -L "$PREVIEW_DIR/$relative" ]]; then
            mkdir -p "$ROLLBACK_DIR/output/$(dirname "$relative")"
            cp -a "$PREVIEW_DIR/$relative" "$ROLLBACK_DIR/output/$relative"
        fi
    done < "$ALLOWLIST"
    hash_manifest "$ROLLBACK_DIR" "$ROLLBACK_DIR/MANIFEST.sha256"
    [[ -s "$ROLLBACK_DIR/MANIFEST.sha256" ]] || { log_error "rollback manifest is empty"; exit 1; }
    (cd "$ROLLBACK_DIR" && while read -r hash file; do [[ "$(complete_backup_sha256 "$file")" == "$hash" ]] || exit 1; done < MANIFEST.sha256)
}

materialize_commit() {
    local sha="$1"
    local destination="$2"
    rm -rf "$destination"
    mkdir -p "$destination"
    git -C "$REPO_MIRROR" cat-file -e "$sha^{commit}"
    git -C "$REPO_MIRROR" archive "$sha" | tar -x -C "$destination"
    [[ "$(tr -d '[:space:]' < "$destination/version")" == "$(git -C "$REPO_MIRROR" show "$sha:version" | tr -d '[:space:]')" ]]
}

apply_preview_isolation() {
    local isolate_script="$SCRIPT_DIR/preview-isolate-integrations.sh"
    [[ -x "$isolate_script" ]] || { log_error "controller isolation helper missing: $isolate_script"; exit 1; }
    ASSUME_YES=1 PREVIEW_DIR="$PREVIEW_DIR" bash "$isolate_script" --apply
    assert_preview_env_file "$PREVIEW_ENV_FILE"
}

install_dependencies_and_build() {
    chown -R "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_DIR"
    sudo -u "$PREVIEW_SERVICE_USER" bash -lc "cd '$PREVIEW_DIR' && npm install --no-audit --no-fund"
    sudo -u "$PREVIEW_SERVICE_USER" bash -lc "cd '$PREVIEW_DIR' && npm rebuild better-sqlite3" || true
    sudo -u "$PREVIEW_SERVICE_USER" bash -lc "cd '$PREVIEW_DIR' && npm --workspace @trends/shared run build"
    sudo -u "$PREVIEW_SERVICE_USER" bash -lc "cd '$PREVIEW_DIR' && npm --workspace @trends/web run build"
}

install_tree() {
    local staging="$1"
    local sha="$2"
    local version="$3"
    local source_label="$4"
    local env_backup="$RUN_DIR/staging/.env.preview.$source_label"
    local runtime_backup="$RUN_DIR/staging/runtime.$source_label"
    rm -rf "$runtime_backup"
    mkdir -p "$runtime_backup"
    cp -a "$PREVIEW_ENV_FILE" "$env_backup"
    for runtime_file in docker-compose.preview.yml start-convex.sh; do
        [[ -f "$PREVIEW_DIR/$runtime_file" ]] \
            || { log_error "preview runtime file missing: $PREVIEW_DIR/$runtime_file"; exit 1; }
        cp -a "$PREVIEW_DIR/$runtime_file" "$runtime_backup/$runtime_file"
    done
    rsync -a --delete \
        --exclude='.git' --exclude='node_modules' --exclude='.venv' --exclude='.cache' \
        --exclude='logs' --exclude='coverage' --exclude='output' \
        --exclude='.env.preview' --exclude='.env.production' \
        --exclude='packages/convex/.env.local' --exclude='packages/convex/.convex' \
        --exclude='docker-compose.preview.yml' --exclude='start-convex.sh' \
        "$staging/" "$PREVIEW_DIR/"
    cp -a "$env_backup" "$PREVIEW_ENV_FILE"
    cp -a "$runtime_backup/docker-compose.preview.yml" "$PREVIEW_DIR/docker-compose.preview.yml"
    cp -a "$runtime_backup/start-convex.sh" "$PREVIEW_DIR/start-convex.sh"
    chmod +x "$PREVIEW_DIR/start-convex.sh"
    cat > "$PREVIEW_DIR/.trends-source-meta" <<EOF
SOURCE=historical-preview-rehearsal
SOURCE_SHA=$sha
SOURCE_SHA_SHORT=${sha:0:8}
SOURCE_VERSION=$version
SOURCE_REF=$source_label
REHEARSAL_RUN_ID=$(state_get run_id)
INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
    apply_preview_isolation
    install_dependencies_and_build
}

restore_sqlite_artifact() {
    local source="$1"
    local temp="$PREVIEW_DB.rehearsal-tmp"
    mkdir -p "$(dirname "$PREVIEW_DB")"
    cp "$source" "$temp"
    sqlite3 "$temp" "PRAGMA integrity_check;" | grep -qx ok
    systemctl stop "$PREVIEW_API_SERVICE"
    rm -f "$PREVIEW_DB-wal" "$PREVIEW_DB-shm"
    mv -f "$temp" "$PREVIEW_DB"
    chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_DB"
}

sanitize_convex_zip() {
    local source="$1"
    local output="$2"
    python3 - "$source" "$output" <<'PY'
import pathlib, shutil, sys, tempfile, zipfile
source, output = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(source) as src, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as dst:
    for info in src.infolist():
        parts = pathlib.PurePosixPath(info.filename).parts
        if parts and parts[0] == "system_settings":
            continue
        dst.writestr(info, src.read(info.filename))
PY
    unzip -t "$output" >/dev/null
}

import_preview_convex() {
    local zip="$1"
    local container_path="/tmp/trends-preview-rehearsal-import.zip"
    docker cp "$zip" "$PREVIEW_CONVEX_CONTAINER:$container_path"
    docker exec "$PREVIEW_CONVEX_CONTAINER" bash -lc \
        "cd /app/packages/convex && npx convex import --replace-all --yes '$container_path' --env-file .env.local"
    docker exec "$PREVIEW_CONVEX_CONTAINER" rm -f "$container_path"
    # `convex import --replace-all` materializes schema tables missing from the
    # snapshot as EMPTY. If the replayed backup predates the no-hire seed (or
    # lacks the table), the workspace blacklist settings for 宝力机械 /
    # Pro-Technic Machinery and 宝惠 / Polywell would silently vanish on
    # preview while prod keeps them. Re-run the idempotent seed so a repeat
    # restore cycle leaves the blacklist SET. Best-effort here: a rehearsal
    # baseline may predate the seed mutation (function not found), which must
    # not abort the replay.
    seed_preview_canonical_no_hire "hr" \
        || log_warn "canonical no-hire re-seed failed (rehearsal baseline may predate the seed mutation) — re-run manually after install-target"
}

recreate_preview_containers() {
    (
        cd "$PREVIEW_DIR"
        docker compose -f docker-compose.preview.yml up -d --force-recreate convex mcp
    )
    wait_for_http "$PREVIEW_CONVEX_URL/version" 240
    docker exec "$PREVIEW_CONVEX_CONTAINER" bash -lc \
        'cd /app/packages/convex && npx convex dev --once --url http://127.0.0.1:3210'
}

restart_preview_api() {
    systemctl restart "$PREVIEW_API_SERVICE"
    wait_for_http "$PREVIEW_API_URL/health" 120
}

restart_preview_runtime() {
    recreate_preview_containers
    restart_preview_api
}

restore_baseline() {
    local backup source_sha source_version sqlite_path convex_zip sanitized output_tgz=""
    backup="$(state_get backup_dir)"
    source_sha="$(state_get source_sha)"
    source_version="$(state_get source_version)"
    complete_backup_validate "$backup" "$RUN_DIR/evidence/backup" "$ALLOWLIST"
    sqlite_path="$(complete_backup_artifact_path sqlite_path)"
    convex_zip="$(complete_backup_artifact_path convex_zip)"
    [[ -n "${COMPLETE_BACKUP_MANIFEST[output_tgz]:-}" ]] && output_tgz="$(complete_backup_artifact_path output_tgz)"
    materialize_commit "$source_sha" "$RUN_DIR/staging/source-tree"
    [[ "$(tr -d '[:space:]' < "$RUN_DIR/staging/source-tree/version")" == "$source_version" ]]
    install_tree "$RUN_DIR/staging/source-tree" "$source_sha" "$source_version" "manifest-source"
    restore_sqlite_artifact "$sqlite_path"
    sanitized="$RUN_DIR/staging/historical-convex-sanitized.zip"
    sanitize_convex_zip "$convex_zip" "$sanitized"
    recreate_preview_containers
    import_preview_convex "$sanitized"
    if [[ -n "$output_tgz" ]]; then
        rm -rf "$RUN_DIR/staging/allowed-output"
        complete_backup_extract_allowlisted_output "$output_tgz" "$ALLOWLIST" "$RUN_DIR/staging/allowed-output"
        rsync -a "$RUN_DIR/staging/allowed-output/output/" "$PREVIEW_DIR/output/"
    fi
    restart_preview_api
    local seed_script="$SCRIPT_DIR/preview-seed-auth.sh"
    [[ -x "$seed_script" ]] || { log_error "controller auth seeder missing: $seed_script"; exit 1; }
    PREVIEW_DIR="$PREVIEW_DIR" bash "$seed_script"
}

install_target() {
    local target_sha target_version
    target_sha="$(state_get target_sha)"
    target_version="$(state_get target_version)"
    materialize_commit "$target_sha" "$RUN_DIR/staging/target-tree"
    [[ "$(tr -d '[:space:]' < "$RUN_DIR/staging/target-tree/version")" == "$target_version" ]]
    install_tree "$RUN_DIR/staging/target-tree" "$target_sha" "$target_version" "target"
    restart_preview_runtime
}

rollback_preview() {
    [[ -f "$ROLLBACK_DIR/MANIFEST.sha256" ]] || { log_error "rollback manifest missing"; exit 1; }
    (cd "$ROLLBACK_DIR" && while read -r hash file; do [[ "$(complete_backup_sha256 "$file")" == "$hash" ]] || exit 1; done < MANIFEST.sha256)
    systemctl stop "$PREVIEW_API_SERVICE"
    rm -rf "$RUN_DIR/staging/rollback-tree"
    mkdir -p "$RUN_DIR/staging/rollback-tree"
    tar -xzf "$ROLLBACK_DIR/app/preview-app.tgz" -C "$RUN_DIR/staging/rollback-tree"
    rsync -a --delete \
        --exclude='.git' --exclude='node_modules' --exclude='output' --exclude='.env.preview' \
        "$RUN_DIR/staging/rollback-tree/" "$PREVIEW_DIR/"
    cp -a "$ROLLBACK_DIR/app/.env.preview" "$PREVIEW_ENV_FILE"
    [[ -f "$ROLLBACK_DIR/app/.trends-source-meta" ]] && cp -a "$ROLLBACK_DIR/app/.trends-source-meta" "$PREVIEW_DIR/.trends-source-meta"
    apply_preview_isolation
    install_dependencies_and_build
    rm -f "$PREVIEW_DB-wal" "$PREVIEW_DB-shm"
    cp "$ROLLBACK_DIR/sqlite/resume_screening.db" "$PREVIEW_DB.rehearsal-tmp"
    mv -f "$PREVIEW_DB.rehearsal-tmp" "$PREVIEW_DB"
    chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_DB"
    recreate_preview_containers
    import_preview_convex "$ROLLBACK_DIR/convex/preview-convex.zip"
    while IFS= read -r relative; do
        [[ -z "$relative" || "$relative" == \#* ]] && continue
        rm -f "$PREVIEW_DIR/$relative"
    done < "$ALLOWLIST"
    if [[ -d "$ROLLBACK_DIR/output/output" ]]; then
        rsync -a "$ROLLBACK_DIR/output/output/" "$PREVIEW_DIR/output/"
    fi
    restart_preview_api
    local seed_script="$SCRIPT_DIR/preview-seed-auth.sh"
    [[ -x "$seed_script" ]] || { log_error "controller auth seeder missing: $seed_script"; exit 1; }
    PREVIEW_DIR="$PREVIEW_DIR" bash "$seed_script"
}

main() {
    [[ -n "$RUN_DIR" ]] || { log_error "--run-dir is required"; exit 2; }
    assert_worker_safety
    require_command git
    require_command rsync
    require_command sqlite3
    require_command docker
    require_command tar
    require_command unzip
    case "$ACTION" in
        protect) protect_preview ;;
        restore-baseline) restore_baseline ;;
        install-target) install_target ;;
        rollback) rollback_preview ;;
        *) log_error "Action must be protect, restore-baseline, install-target, or rollback"; exit 2 ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
