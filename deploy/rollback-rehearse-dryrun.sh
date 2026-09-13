#!/usr/bin/env bash
# Safe DRY-RUN / temporary-directory rollback rehearsal scaffold.
#
# Validates a selected complete-backup bundle (deploy/backup-prod-complete.sh
# artifact) and a TARGET that is GUARANTEED isolated from production (separate
# rehearsal-only service unit, loopback port band, SQLite path, and Convex
# selector — all under REHEARSAL_ROOT), then emits a phase-state ledger and a
# command plan for an attended rollback runbook.
#
# HARD SAFETY CONTRACT:
#   - Refuses any target that is not clearly rehearsal-only (non-`rehearsal-*`
#     unit, BFF port outside :3300-3399, Convex port outside :4300-4399,
#     or any path outside REHEARSAL_ROOT).
#   - FAILS CLOSED when destructive execution is requested (REHEARSAL_APPLY=1):
#     this scaffold contains no execution engine, and it must never pretend to.
#   - Never issues systemctl / docker / ssh / npx / convex / import or any host
#     mutation. The output is a PLAN to be executed by the attended runbook
#     (separate, owner-authorized), never an execution engine itself.
#   - Writes ONLY under REHEARSAL_ROOT. No production path is read or written.
#
# Usage:
#   bash deploy/rollback-rehearse-dryrun.sh --backup-dir /path/to/prod-complete-<ts>
#
# Env (rehearsal-only; any non-rehearsal value is refused):
#   REHEARSAL_ROOT       sandbox root (default $HOME/.trends-rollback-rehearsals)
#   BACKUP_ROOT          backup root; must contain the selected bundle
#   PREVIEW_DIR          rehearsal target app dir (must be under REHEARSAL_ROOT)
#   PREVIEW_API_SERVICE  systemd unit named rehearsal-*
#   PREVIEW_API_URL      loopback BFF URL in :3300-3399
#   PREVIEW_CONVEX_URL   Convex URL in :4300-4399
#   PREVIEW_DB           rehearsal SQLite path (must be under REHEARSAL_ROOT)
#   REHEARSAL_APPLY=1    FAILS CLOSED: destructive execution is not implemented
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Snapshot the caller's env BEFORE libs assign their prod/preview defaults, so
# the rehearsal defaults below only win when the caller left the variable unset.
PREVIEW_DIR_USER="${PREVIEW_DIR:-}"
PREVIEW_API_SERVICE_USER="${PREVIEW_API_SERVICE:-}"
PREVIEW_API_URL_USER="${PREVIEW_API_URL:-}"
PREVIEW_CONVEX_URL_USER="${PREVIEW_CONVEX_URL:-}"
PREVIEW_DB_USER="${PREVIEW_DB:-}"
BACKUP_ROOT_USER="${BACKUP_ROOT:-}"

# shellcheck source=lib-complete-backup.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-complete-backup.sh"
# shellcheck source=lib-preview-common.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-preview-common.sh"

# --- Rehearsal-only defaults (override the libs' prod/preview defaults) ---
REHEARSAL_ROOT="$(complete_backup_realpath "${REHEARSAL_ROOT:-$HOME/.trends-rollback-rehearsals}")"
PREVIEW_DIR="$(complete_backup_realpath "${PREVIEW_DIR_USER:-$REHEARSAL_ROOT/round-trip/preview}")"
PREVIEW_API_SERVICE="${PREVIEW_API_SERVICE_USER:-rehearsal-api}"
PREVIEW_API_URL="${PREVIEW_API_URL_USER:-http://127.0.0.1:3301}"
PREVIEW_CONVEX_URL="${PREVIEW_CONVEX_URL_USER:-http://127.0.0.1:4301}"
PREVIEW_DB="$(complete_backup_realpath "${PREVIEW_DB_USER:-$REHEARSAL_ROOT/round-trip/preview/output/rehearsal.db}")"
BACKUP_ROOT="${BACKUP_ROOT_USER:-/var/backups/trends}"

ALLOWLIST="$SCRIPT_DIR/preview-output-restore.allowlist"
BACKUP_DIR=""
REHEARSAL_APPLY="${REHEARSAL_APPLY:-}"

# ---------------------------------------------------------------------------
# Logging / helpers
# ---------------------------------------------------------------------------
log()  { printf '[rollback-rehearsal] %s\n' "$*"; }
die()  { printf '[rollback-rehearsal] FATAL: %s\n' "$*" >&2; exit 1; }
warn() { printf '[rollback-rehearsal] WARN: %s\n' "$*" >&2; }

usage() {
    cat <<'EOF'
Usage: bash deploy/rollback-rehearse-dryrun.sh --backup-dir DIR

Validates a selected complete-backup bundle and a rehearsal-only target, then
emits a phase-state ledger + command plan under REHEARSAL_ROOT. Dry-run only —
no deployment is contacted, nothing destructive is executed.

Env (rehearsal-only; any non-rehearsal value is refused):
  REHEARSAL_ROOT       sandbox root (default $HOME/.trends-rollback-rehearsals)
  BACKUP_ROOT          must contain the selected bundle
  PREVIEW_DIR          rehearsal target app dir (under REHEARSAL_ROOT)
  PREVIEW_API_SERVICE  systemd unit named rehearsal-*
  PREVIEW_API_URL      loopback BFF URL in :3300-3399
  PREVIEW_CONVEX_URL   Convex URL in :4300-4399
  PREVIEW_DB           rehearsal SQLite path (under REHEARSAL_ROOT)
  REHEARSAL_APPLY=1    FAILS CLOSED (destructive execution is not implemented)
EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) usage >&2; die "unknown argument: $1" ;;
        esac
    done
}

port_from_url() {
    python3 - "$1" <<'PY'
import sys, urllib.parse
try:
    port = urllib.parse.urlparse(sys.argv[1]).port
    print(port if port is not None else "")
except Exception:
    pass
PY
}

is_rehearsal_path() {
    local target="$1"
    local target_real root_real
    target_real="$(complete_backup_realpath "$target")"
    root_real="$REHEARSAL_ROOT"
    [[ -n "$target_real" && ( "$target_real" == "$root_real" || "$target_real" == "$root_real"/* ) ]]
}

# ---------------------------------------------------------------------------
# Fail-closed target guards. Every refusal is terminal.
# ---------------------------------------------------------------------------
assert_safe_target() {
    if is_prod_path "$REHEARSAL_ROOT"; then
        printf '%s\n' "FAIL: REHEARSAL_ROOT resolves inside a production path: $REHEARSAL_ROOT"
        exit 1
    fi
    if ! is_rehearsal_path "$PREVIEW_DIR"; then
        printf '%s\n' "FAIL: Refusing to target a non-rehearsal directory: $PREVIEW_DIR"
        exit 1
    fi
    local api_port convex_port
    api_port="$(port_from_url "$PREVIEW_API_URL")"
    convex_port="$(port_from_url "$PREVIEW_CONVEX_URL")"
    [[ "$api_port" =~ ^33[0-9]{2}$ ]] || {
        printf '%s\n' "FAIL: Refusing to target a non-rehearsal port (BFF): $PREVIEW_API_URL"
        exit 1
    }
    [[ "$convex_port" =~ ^43[0-9]{2}$ ]] || {
        printf '%s\n' "FAIL: Refusing to target a non-rehearsal port (Convex): $PREVIEW_CONVEX_URL"
        exit 1
    }
    [[ "$PREVIEW_API_SERVICE" == rehearsal-* ]] || {
        printf '%s\n' "FAIL: Refusing to target a non-rehearsal unit: $PREVIEW_API_SERVICE"
        exit 1
    }
    if ! is_rehearsal_path "$PREVIEW_DB"; then
        printf '%s\n' "FAIL: Refusing to target a non-rehearsal path (SQLite): $PREVIEW_DB"
        exit 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Run identity
# ---------------------------------------------------------------------------
new_run_id() {
    python3 - <<'PY'
import datetime, secrets, string
alphabet = string.ascii_lowercase + string.digits
print(f"dryrun-{datetime.datetime.now(datetime.timezone.utc):%Y%m%dT%H%M%SZ}-"
      + "".join(secrets.choice(alphabet) for _ in range(6)))
PY
}

# ---------------------------------------------------------------------------
# Phase tracking / command plan
# ---------------------------------------------------------------------------
RUN_DIR=""
PLAN_TSV=""
declare -A PHASE_STATUS=()
declare -a PHASE_ORDER=(
    validate-bundle
    validate-target-isolation
    snapshot-target
    quiesce-plan
    restore-env-plan
    restore-sqlite-plan
    restore-code-plan
    restore-convex-plan
    parity-plan
    restart-acceptance-plan
    release-plan
)
RUN_FAILED=0

phase_begin() {
    local name="$1"
    local description="$2"
    printf 'phase %s\n' "$name"
    PHASE_STATUS["$name"]="planned"
    printf 'P\t%s\t%s\n' "$name" "$description" >> "$PLAN_TSV"
}

plan_cmd() {
    local phase="$1"
    local label="$2"
    local command="$3"
    printf 'C\t%s\t%s\t%s\n' "$phase" "$label" "$command" >> "$PLAN_TSV"
}

phase_pass() { PHASE_STATUS["$1"]="passed"; }
phase_fail() { PHASE_STATUS["$1"]="failed"; RUN_FAILED=1; }

# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------
phase_validate_bundle() {
    phase_begin validate-bundle "Validate the selected complete-backup bundle end-to-end"
    local evidence="$RUN_DIR/evidence/backup"
    mkdir -p "$evidence"
    if complete_backup_validate "$BACKUP_DIR" "$evidence" "$ALLOWLIST"; then
        printf 'rehearsal-backup-source: OK\n'
        printf 'rehearsal-source-sha=%s\n' "${COMPLETE_BACKUP_MANIFEST[prod_sha]}"
        printf 'rehearsal-source-branch=%s\n' "${COMPLETE_BACKUP_MANIFEST[prod_branch]}"
        printf 'rehearsal-source-version=%s\n' "${COMPLETE_BACKUP_MANIFEST[prod_version]}"
        printf 'rehearsal-candidate-actions=%s\n' "${COMPLETE_BACKUP_MANIFEST[candidate_actions_count]}"
        printf 'rehearsal-file-storage=%s\n' "${COMPLETE_BACKUP_MANIFEST[include_file_storage]}"
        plan_cmd validate-bundle "provenance" \
            "attested git/HEAD == prod_sha; SQLite+Convex hashes match manifest; ZIP/TAR safe; integrity ok"
        phase_pass validate-bundle
    else
        printf '%s\n' "FAIL: bundle validation failed (see complete-backup messages above)"
        phase_fail validate-bundle
    fi
    printf '\n'
}

phase_validate_target() {
    phase_begin validate-target-isolation "Prove the target is rehearsal-only (unit/port/SQLite/Convex)"
    # Guards already ran in assert_safe_target() before phases; re-assert here so
    # a phase-only future entry point cannot bypass them.
    if ! is_rehearsal_path "$PREVIEW_DIR" \
        || ! is_rehearsal_path "$PREVIEW_DB" \
        || [[ "$PREVIEW_API_SERVICE" != rehearsal-* ]] \
        || ! [[ "$(port_from_url "$PREVIEW_API_URL")" =~ ^33[0-9]{2}$ ]] \
        || ! [[ "$(port_from_url "$PREVIEW_CONVEX_URL")" =~ ^43[0-9]{2}$ ]]; then
        printf '%s\n' "FAIL: target is not rehearsal-isolated — refusing to plan against it"
        phase_fail validate-target-isolation
        printf '\n'
        return
    fi
    printf 'rehearsal-target: OK\n'
    printf 'rehearsal-target-dir=%s\n' "$PREVIEW_DIR"
    printf 'rehearsal-target-unit=%s\n' "$PREVIEW_API_SERVICE"
    printf 'rehearsal-target-bff=%s\n' "$PREVIEW_API_URL"
    printf 'rehearsal-target-convex=%s\n' "$PREVIEW_CONVEX_URL"
    printf 'rehearsal-target-sqlite=%s\n' "$PREVIEW_DB"
    printf 'rehearsal-target-isolated: separate unit / port band / SQLite / Convex selector\n'
    plan_cmd validate-target-isolation "isolation-matrix" \
        "unit=$PREVIEW_API_SERVICE bff=$PREVIEW_API_URL convex=$PREVIEW_CONVEX_URL sqlite=$PREVIEW_DB (all rehearsal-only)"
    phase_pass validate-target-isolation
    printf '\n'
}

phase_plan_only() {
    local name="$1"
    local description="$2"
    local label="$3"
    local command="$4"
    phase_begin "$name" "$description"
    plan_cmd "$name" "$label" "[PLAN-ONLY] $command"
    phase_pass "$name"
    printf '%s\n' "phase $name: planned (not executed — dry-run)"
    printf '\n'
}

run_phases() {
    phase_validate_bundle
    phase_validate_target
    phase_plan_only snapshot-target \
        "Snapshot the rehearsal target before any change" \
        "pre-rehearsal-snapshot" \
        "cp $PREVIEW_DB $PREVIEW_DB.pre-rehearsal ; verify integrity ; record rehearsal Convex export"
    phase_plan_only quiesce-plan \
        "Quiesce rehearsal target to zero (analysis/resume counts)" \
        "maintenance-on" \
        "set maintenanceMode on rehearsal Convex; require analysis_tasks=0 and resume_tasks=0 (no warn-and-continue)"
    phase_plan_only restore-env-plan \
        "Restore env copies into rehearsal target" \
        "env-restore" \
        "restore config/etc-trends-env -> rehearsal env; chown rehearsal owner; mode 0600; never print secret values"
    phase_plan_only restore-sqlite-plan \
        "Restore SQLite atomically into rehearsal target" \
        "sqlite-atomic-swap" \
        "keep writers stopped; PRAGMA integrity_check ok; rm live -wal/-shm; atomic rename into $PREVIEW_DB; re-check count"
    phase_plan_only restore-code-plan \
        "Checkout exact manifest SHA into rehearsal target and rebuild" \
        "code-restore" \
        "git -C $PREVIEW_DIR checkout <prod_sha>; npm ci; npm --workspace @trends/shared build; npm --workspace @trends/web build"
    phase_plan_only restore-convex-plan \
        "Import bundle Convex into rehearsal selector (replace-all)" \
        "convex-import" \
        "npx convex import --replace-all <bundle>/convex/convex-export.zip --env-file <rehearsal selector>; storage from ZIP"
    phase_plan_only parity-plan \
        "Data parity between restored SQLite and Convex" \
        "parity" \
        "candidate_actions count == manifest; every distinct resume_id resolves in rehearsal Convex; table/storage inventory matches"
    phase_plan_only restart-acceptance-plan \
        "Restart rehearsal services and run acceptance" \
        "restart-acceptance" \
        "systemctl start $PREVIEW_API_SERVICE; wait_for_http $PREVIEW_API_URL/health; SHA/version/membership/anon-401 checks"
    phase_plan_only release-plan \
        "Release maintenance only after owner accepts all gates" \
        "release-writers" \
        "set maintenanceMode=false on rehearsal Convex only after owner acceptance; observe logs; bounded re-acceptance"
}

# ---------------------------------------------------------------------------
# Plan + state emission (sanitized: no secret values ever printed or written)
# ---------------------------------------------------------------------------
write_plan_and_state() {
    local plan_path="$RUN_DIR/plan.json"
    local state_path="$RUN_DIR/state.env"
    local statuses=""
    local name
    for name in "${PHASE_ORDER[@]}"; do
        statuses+="$name=${PHASE_STATUS[$name]:-planned};"
    done
    local result="passed"
    [[ "$RUN_FAILED" -eq 0 ]] || result="failed"
    local manifest_sha="" manifest_version="" manifest_ca="" manifest_fs=""
    if [[ -n "${COMPLETE_BACKUP_MANIFEST[prod_sha]:-}" ]]; then
        manifest_sha="${COMPLETE_BACKUP_MANIFEST[prod_sha]}"
    fi
    if [[ -n "${COMPLETE_BACKUP_MANIFEST[prod_version]:-}" ]]; then
        manifest_version="${COMPLETE_BACKUP_MANIFEST[prod_version]}"
    fi
    if [[ -n "${COMPLETE_BACKUP_MANIFEST[candidate_actions_count]:-}" ]]; then
        manifest_ca="${COMPLETE_BACKUP_MANIFEST[candidate_actions_count]}"
    fi
    if [[ -n "${COMPLETE_BACKUP_MANIFEST[include_file_storage]:-}" ]]; then
        manifest_fs="${COMPLETE_BACKUP_MANIFEST[include_file_storage]}"
    fi
    python3 - "$plan_path" "$state_path" "$RUN_ID" "$result" "$BACKUP_DIR" \
        "$manifest_sha" "$manifest_version" \
        "$manifest_ca" \
        "$manifest_fs" \
        "$PREVIEW_DIR" "$PREVIEW_API_SERVICE" "$PREVIEW_API_URL" "$PREVIEW_CONVEX_URL" "$PREVIEW_DB" \
        "$REHEARSAL_ROOT" "$PLAN_TSV" "$statuses" <<'PY'
import json, pathlib, sys
plan_path = pathlib.Path(sys.argv[1])
state_path = pathlib.Path(sys.argv[2])
run_id, result = sys.argv[3], sys.argv[4]
backup_dir, sha, version, ca_count, file_storage = sys.argv[5:10]
target_dir, service, bff, convex, sqlite, root_dir = sys.argv[10:16]
tsv_path, statuses_str = pathlib.Path(sys.argv[16]), sys.argv[17]

phases_map = {}
for raw in tsv_path.read_text().splitlines():
    parts = raw.split("\t", 3)
    if parts and parts[0] == "P":
        phases_map[parts[1]] = {"name": parts[1], "description": parts[2], "commands": []}
    elif len(parts) == 4 and parts[0] == "C" and parts[1] in phases_map:
        phases_map[parts[1]]["commands"].append({"label": parts[2], "command": parts[3]})
statuses = {}
for segment in statuses_str.split(";"):
    if "=" in segment:
        key, value = segment.split("=", 1)
        statuses[key] = value
phases = []
for name in phases_map:
    entry = phases_map[name]
    entry["status"] = statuses.get(name, "planned")
    phases.append(entry)

plan = {
    "schema": "trends-rollback-rehearsal-plan/v1",
    "mode": "dry-run",
    "runId": run_id,
    "selectedBundle": backup_dir,
    "bundle": {
        "sha": sha,
        "version": version,
        "candidateActions": int(ca_count or 0),
        "includeFileStorage": file_storage == "true",
    },
    "target": {
        "rehearsalRoot": root_dir,
        "appDir": target_dir,
        "apiService": service,
        "bffUrl": bff,
        "convexUrl": convex,
        "sqlite": sqlite,
        "isolation": {
            "unitPrefix": "rehearsal-",
            "bffPortBand": "3300-3399",
            "convexPortBand": "4300-4399",
            "pathRoot": root_dir,
        },
    },
    "phases": phases,
    "result": result,
    "destructiveExecution": "refused",
    "note": "Dry-run rehearsal only. No deployment was contacted; nothing was executed.",
}
plan_path.write_text(json.dumps(plan, indent=2) + "\n")
plan_path.chmod(0o600)

state_rows = [
    "schema=trends-rollback-rehearsal-state/v1",
    f"run_id={run_id}",
    f"result={result}",
]
for name in phases_map:
    state_rows.append(f"phase_{name.replace('-', '_')}={statuses.get(name, 'planned')}")
state_path.write_text("\n".join(state_rows) + "\n")
state_path.chmod(0o600)
PY
    log "plan written: $plan_path"
    log "state written: $state_path"
    log "evidence written: $RUN_DIR/evidence"
}

main() {
    require_command python3
    require_command node
    require_command sqlite3

    parse_args "$@"
    [[ -n "$BACKUP_DIR" ]] || { usage >&2; die "--backup-dir is required"; }

    # FAIL CLOSED: destructive execution is never implemented here.
    if [[ "$REHEARSAL_APPLY" =~ ^(1|true|yes)$ ]]; then
        printf '%s\n' "FAIL: destructive execution is not implemented (dry-run scaffold; REHEARSAL_APPLY=$REHEARSAL_APPLY)"
        exit 1
    fi

    # FAIL CLOSED: target must be rehearsal-only before anything else happens.
    assert_safe_target

    RUN_ID="$(new_run_id)"
    RUN_DIR="$REHEARSAL_ROOT/$RUN_ID"
    PLAN_TSV="$RUN_DIR/plan.tsv"
    mkdir -p "$RUN_DIR/evidence"
    chmod 700 "$RUN_DIR"
    : > "$PLAN_TSV"
    chmod 600 "$PLAN_TSV"

    log "dry-run rehearsal: bundle=$BACKUP_DIR"
    log "rehearsal root: $REHEARSAL_ROOT"

    run_phases

    write_plan_and_state

    if [[ "$RUN_FAILED" -eq 0 ]]; then
        printf 'rehearsal-result: PLAN-ONLY PASS (nothing executed)\n'
    else
        printf '%s\n' "rehearsal-result: FAILED — no plan may be executed from this run"
        exit 1
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi