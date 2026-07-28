#!/usr/bin/env bash
# Run the canonical migration declaration stream against preview only.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-convex-migrations.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-convex-migrations.sh"

RUN_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --run-dir) RUN_DIR="${2:-}"; shift 2 ;;
        *) log_error "Unknown argument: $1"; exit 2 ;;
    esac
done
STATE_FILE="$RUN_DIR/state.env"
PREVIEW_CONVEX_CONTAINER="${PREVIEW_CONVEX_CONTAINER:-trends-preview-convex}"
CONVEX_MIGRATION_EVIDENCE_DIR="$RUN_DIR/evidence/migrations"
export CONVEX_MIGRATION_EVIDENCE_DIR

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

convex_migration_execute() {
    local _convex_dir="$1"
    local migration_name="$2"
    local call_args="$3"
    local -a command=(docker exec "$PREVIEW_CONVEX_CONTAINER" bash -lc)
    local shell_command="cd /app/packages/convex && npx convex run migrations:$migration_name"
    if [[ "$call_args" != "{}" ]]; then
        shell_command+=" '$(printf '%s' "$call_args" | sed "s/'/'\\\\''/g")'"
    fi
    "${command[@]}" "$shell_command"
}

main() {
    [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || { log_error "run state missing"; exit 1; }
    [[ "$(state_get upgrade_status)" == "passed" ]] || { log_error "upgrade phase has not passed"; exit 1; }
    assert_not_prod_install_dir "$PREVIEW_DIR" || exit 1
    [[ "$PREVIEW_CONVEX_URL" != "$PROD_CONVEX_URL" && "$PREVIEW_CONVEX_URL" != *":3210"* ]] \
        || { log_error "preview Convex URL targets production"; exit 1; }
    [[ "$PREVIEW_CONVEX_CONTAINER" == trends-preview-* ]] || { log_error "refusing non-preview container"; exit 1; }
    assert_preview_env_file "$PREVIEW_ENV_FILE" || exit 1
    [[ -f "$PREVIEW_DIR/.trends-source-meta" ]] || { log_error "preview source metadata missing"; exit 1; }
    [[ "$(meta_get SOURCE_SHA)" == "$(state_get target_sha)" ]] || { log_error "preview target SHA mismatch"; exit 1; }
    [[ "$(meta_get SOURCE_VERSION)" == "$(state_get target_version)" ]] || { log_error "preview target version mismatch"; exit 1; }
    mkdir -p "$CONVEX_MIGRATION_EVIDENCE_DIR"
    chmod 700 "$CONVEX_MIGRATION_EVIDENCE_DIR"
    convex_migration_declarations | cut -f1 > "$CONVEX_MIGRATION_EVIDENCE_DIR/declaration-order.txt"
    run_convex_migration_sequence "$PREVIEW_DIR/packages/convex"
    node - "$CONVEX_MIGRATION_EVIDENCE_DIR/summary.json" \
        "$(state_get run_id)" "$(state_get target_sha)" "$(convex_migration_declaration_hash)" \
        "$CONVEX_MIGRATION_EVIDENCE_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [output, runId, targetSha, declarationHash, dir] = process.argv.slice(2);
const order = fs.readFileSync(path.join(dir, "declaration-order.txt"), "utf8").trim().split("\n");
const migrations = order.map((name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")));
if (migrations.some((item) => item.result !== "passed")) throw new Error("migration evidence contains a failure");
if (migrations.length !== order.length) throw new Error("migration evidence is incomplete");
fs.writeFileSync(output, `${JSON.stringify({
  schema: "trends-preview-migration-summary/v1",
  runId,
  targetSha,
  declarationHash,
  result: "passed",
  completedAt: new Date().toISOString(),
  migrations,
}, null, 2)}\n`, { mode: 0o600 });
NODE
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
