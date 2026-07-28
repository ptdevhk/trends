#!/usr/bin/env bash
# Snapshot-aware baseline/upgraded verifier for historical preview rehearsals.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-complete-backup.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-complete-backup.sh"
# shellcheck source=lib-preview-auth-session.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-preview-auth-session.sh"

MODE=""
RUN_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode) MODE="${2:-}"; shift 2 ;;
        --run-dir) RUN_DIR="${2:-}"; shift 2 ;;
        *) log_error "Unknown argument: $1"; exit 2 ;;
    esac
done
[[ "$MODE" == "baseline" || "$MODE" == "upgraded" ]] || { log_error "--mode baseline|upgraded is required"; exit 2; }
STATE_FILE="$RUN_DIR/state.env"
EVIDENCE_DIR="$RUN_DIR/evidence/$MODE"
PREVIEW_CONVEX_CONTAINER="${PREVIEW_CONVEX_CONTAINER:-trends-preview-convex}"

state_get() {
    python3 - "$STATE_FILE" "$1" <<'PY'
import pathlib, sys
for raw in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if "=" in raw:
        key, value = raw.split("=", 1)
        if key == sys.argv[2]:
            print(value)
            break
PY
}

meta_get() {
    python3 - "$PREVIEW_DIR/.trends-source-meta" "$1" <<'PY'
import pathlib, sys
for raw in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if "=" in raw:
        key, value = raw.split("=", 1)
        if key == sys.argv[2]:
            print(value)
            break
PY
}

capture_export() {
    local output="$1"
    local container_path="/tmp/trends-preview-verify-$MODE.zip"
    docker exec "$PREVIEW_CONVEX_CONTAINER" rm -f "$container_path"
    docker exec "$PREVIEW_CONVEX_CONTAINER" bash -lc \
        "cd /app/packages/convex && npx convex export --path '$container_path' --include-file-storage --env-file .env.local"
    docker cp "$PREVIEW_CONVEX_CONTAINER:$container_path" "$output"
    docker exec "$PREVIEW_CONVEX_CONTAINER" rm -f "$container_path"
    unzip -t "$output" >/dev/null
}

inventory_zip() {
    python3 - "$1" "$2" <<'PY'
import json, pathlib, sys, zipfile
source, output = map(pathlib.Path, sys.argv[1:])
tables, storage = {}, []
with zipfile.ZipFile(source) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit(f"corrupt ZIP member: {bad}")
    for info in archive.infolist():
        parts = pathlib.PurePosixPath(info.filename).parts
        if info.filename.endswith("/documents.jsonl") and len(parts) >= 2:
            if parts[-2] == "system_settings":
                continue
            with archive.open(info) as stream:
                tables[parts[-2]] = sum(1 for line in stream if line.strip())
        if parts and (parts[0] in {"_storage", "storage"} or "storage" in parts[0].lower()):
            if not info.is_dir():
                storage.append({"path": info.filename, "bytes": info.file_size})
output.write_text(json.dumps({
    "schema": "trends-convex-inventory/v1",
    "tables": dict(sorted(tables.items())),
    "storage": sorted(storage, key=lambda item: item["path"]),
}, indent=2) + "\n")
PY
}

compare_inventory() {
    local current="$1"
    local reference="$2"
    local comparison="$3"
    local mode="$4"
    python3 - "$current" "$reference" "$comparison" "$mode" <<'PY'
import json, pathlib, sys
current_path, reference_path, output_path = map(pathlib.Path, sys.argv[1:4])
mode = sys.argv[4]
current = json.loads(current_path.read_text())
reference = json.loads(reference_path.read_text())
current_tables = current.get("tables", {})
reference_tables = reference.get("tables", {})
derived = {"resume_digests", "resume_digest_status", "resume_digest_statuses", "resume_analyses"}
losses, deltas = [], {}
for table in sorted(set(current_tables) | set(reference_tables)):
    before, after = int(reference_tables.get(table, 0)), int(current_tables.get(table, 0))
    deltas[table] = {"before": before, "after": after, "delta": after - before}
    if after < before:
        losses.append({"table": table, "before": before, "after": after})
if mode == "baseline" and any(item["delta"] != 0 for item in deltas.values()):
    raise SystemExit(f"baseline table counts differ: {deltas}")
if mode == "upgraded" and losses:
    raise SystemExit(f"unexplained table-count decreases: {losses}")
before_storage = {(item["path"], item["bytes"]) for item in reference.get("storage", [])}
after_storage = {(item["path"], item["bytes"]) for item in current.get("storage", [])}
missing_storage = sorted(before_storage - after_storage)
if missing_storage:
    raise SystemExit(f"file-storage loss: {missing_storage[:10]}")
output_path.write_text(json.dumps({
    "schema": "trends-snapshot-comparison/v1",
    "mode": mode,
    "tableDeltas": deltas,
    "derivedGrowthAllowed": sorted(derived),
    "missingStorage": missing_storage,
    "result": "passed",
}, indent=2) + "\n")
PY
}

load_preview_auth_env() {
    local key value
    for key in AUTH_BOOTSTRAP_PASSWORD AUTH_HR_DEMO_PASSWORD BOOTSTRAP_ADMIN_USERS \
        BOOTSTRAP_HR_DEMO_USER BOOTSTRAP_ADMIN_WORKSPACE BOOTSTRAP_HR_DEMO_WORKSPACE; do
        value="$(read_env_value "$PREVIEW_ENV_FILE" "$key")"
        [[ -n "$value" ]] && declare -gx "$key=$value"
    done
}

verify_auth_routes() {
    local admin_user="${BOOTSTRAP_ADMIN_USERS%%,*}"
    local hr_user="${BOOTSTRAP_HR_DEMO_USER:-hr-demo}"
    local admin_ws="${BOOTSTRAP_ADMIN_WORKSPACE:-dev}"
    local hr_ws="${BOOTSTRAP_HR_DEMO_WORKSPACE:-hr}"
    local admin_jar="$EVIDENCE_DIR/admin.jar"
    local hr_jar="$EVIDENCE_DIR/hr.jar"
    [[ -n "${AUTH_BOOTSTRAP_PASSWORD:-}" && -n "${AUTH_HR_DEMO_PASSWORD:-}" ]] \
        || { log_error "preview auth passwords are required for strict verification"; exit 1; }
    preview_auth_login "${admin_user:-admin}" "$AUTH_BOOTSTRAP_PASSWORD" "$admin_jar"
    preview_auth_login "$hr_user" "$AUTH_HR_DEMO_PASSWORD" "$hr_jar"
    local code
    code="$(preview_auth_curl "$admin_jar" "$admin_ws" -o "$EVIDENCE_DIR/admin-resumes.json" -w '%{http_code}' \
        "$PREVIEW_API_URL/api/resumes?source=convex&paged=true&limit=1")"
    [[ "$code" == "200" ]] || { log_error "admin protected resumes route failed: $code"; exit 1; }
    code="$(preview_auth_curl "$admin_jar" "$admin_ws" -o "$EVIDENCE_DIR/admin-blocks.json" -w '%{http_code}' \
        "$PREVIEW_API_URL/api/blocks")"
    [[ "$code" == "200" ]] || { log_error "admin protected blocks route failed: $code"; exit 1; }
    code="$(preview_auth_curl "$hr_jar" "$hr_ws" -o "$EVIDENCE_DIR/hr-resumes.json" -w '%{http_code}' \
        "$PREVIEW_API_URL/api/resumes?source=convex&paged=true&limit=1")"
    [[ "$code" == "200" ]] || { log_error "hr protected resumes route failed: $code"; exit 1; }
    code="$(preview_auth_curl "$hr_jar" "$hr_ws" -o "$EVIDENCE_DIR/hr-blocks.json" -w '%{http_code}' \
        "$PREVIEW_API_URL/api/blocks")"
    [[ "$code" == "200" ]] || { log_error "hr protected blocks route failed: $code"; exit 1; }
    rm -f "$admin_jar" "$hr_jar"
}

write_summary() {
    local expected_sha="$1"
    local expected_version="$2"
    local candidate_actions="$3"
    local prod_sha=""
    if [[ -d "$PROD_DIR/.git" ]]; then
        prod_sha="$(git -C "$PROD_DIR" rev-parse HEAD 2>/dev/null || true)"
    fi
    node - "$EVIDENCE_DIR/summary.json" "$MODE" "$(state_get run_id)" "$expected_sha" \
        "$expected_version" "$candidate_actions" "$prod_sha" <<'NODE'
const fs = require("node:fs");
const [path, mode, runId, applicationSha, applicationVersion, candidateActions, currentProductionSha] = process.argv.slice(2);
fs.writeFileSync(path, `${JSON.stringify({
  schema: "trends-preview-snapshot-verification/v1",
  mode,
  runId,
  application: { sha: applicationSha, version: applicationVersion },
  sqlite: { candidateActions: Number(candidateActions), integrity: "ok" },
  currentProduction: { sha: currentProductionSha || null, comparison: "informational-only" },
  result: "passed",
  completedAt: new Date().toISOString(),
}, null, 2)}\n`, { mode: 0o600 });
NODE
}

main() {
    [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || { log_error "run state missing"; exit 1; }
    mkdir -p "$EVIDENCE_DIR"
    chmod 700 "$EVIDENCE_DIR"
    assert_not_prod_install_dir "$PREVIEW_DIR" || exit 1
    assert_preview_env_file "$PREVIEW_ENV_FILE" || exit 1
    [[ "$PREVIEW_CONVEX_CONTAINER" == trends-preview-* ]] || { log_error "refusing non-preview Convex container"; exit 1; }
    local expected_sha expected_version source_count actual_count reference
    if [[ "$MODE" == "baseline" ]]; then
        [[ "$(state_get restore_baseline_status)" == "passed" ]] || { log_error "restore-baseline has not passed"; exit 1; }
        expected_sha="$(state_get source_sha)"
        expected_version="$(state_get source_version)"
        reference="$RUN_DIR/evidence/backup/source-inventory.json"
    else
        [[ "$(state_get migrate_status)" == "passed" ]] || { log_error "migrate has not passed"; exit 1; }
        [[ -f "$RUN_DIR/evidence/migrations/summary.json" ]] || { log_error "migration summary missing"; exit 1; }
        expected_sha="$(state_get target_sha)"
        expected_version="$(state_get target_version)"
        reference="$RUN_DIR/evidence/baseline/convex-inventory.json"
    fi
    [[ "$(meta_get SOURCE_SHA)" == "$expected_sha" ]] || { log_error "application SHA mismatch"; exit 1; }
    [[ "$(meta_get SOURCE_VERSION)" == "$expected_version" ]] || { log_error "application version mismatch"; exit 1; }
    [[ "$(tr -d '[:space:]' < "$PREVIEW_DIR/version")" == "$expected_version" ]] || { log_error "version file mismatch"; exit 1; }
    sqlite3 "$PREVIEW_DB" "PRAGMA integrity_check;" | grep -qx ok
    actual_count="$(sqlite3 "$PREVIEW_DB" "SELECT count(*) FROM candidate_actions;")"
    source_count="$(state_get candidate_actions_count)"
    [[ "$actual_count" == "$source_count" ]] || { log_error "candidate_actions drift: expected=$source_count actual=$actual_count"; exit 1; }
    wait_for_http "$PREVIEW_CONVEX_URL/version" 60
    wait_for_http "$PREVIEW_API_URL/health" 60
    capture_export "$EVIDENCE_DIR/convex-export.zip"
    inventory_zip "$EVIDENCE_DIR/convex-export.zip" "$EVIDENCE_DIR/convex-inventory.json"
    compare_inventory "$EVIDENCE_DIR/convex-inventory.json" "$reference" "$EVIDENCE_DIR/comparison.json" "$MODE"
    load_preview_auth_env
    verify_auth_routes
    if [[ -x "$SCRIPT_DIR/search-freshness-gate.sh" ]]; then
        local freshness_script="$SCRIPT_DIR/search-freshness-gate.sh"
        local freshness_api_url="$PREVIEW_API_URL"
        PREVIEW_DIR="$PREVIEW_DIR" PREVIEW_API_URL="$PREVIEW_API_URL" GATE_STRICT=1 SCHEDULE_REINGEST=0 \
            bash "$freshness_script" --role preview --api-url "$freshness_api_url" --workspace dev \
            > "$EVIDENCE_DIR/search-freshness.log" 2>&1
    fi
    if [[ "$MODE" == "upgraded" && ! "${SKIP_PREVIEW_AI_SMOKE:-}" =~ ^(1|true|yes)$ ]]; then
        (
            cd "$PREVIEW_DIR"
            ANALYSIS_TIMEOUT_SEC="${PREVIEW_AI_SMOKE_TIMEOUT_SEC:-300}" \
                npx tsx scripts/verify-critical-path.ts --mode=seeded
        ) > "$EVIDENCE_DIR/ai-smoke.log" 2>&1
    fi
    write_summary "$expected_sha" "$expected_version" "$actual_count"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
