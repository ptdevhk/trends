#!/usr/bin/env bash
# Attended, phased historical backup rehearsal controller.
# Production is read-only. All mutation workers independently enforce preview identity.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-complete-backup.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-complete-backup.sh"
# shellcheck source=lib-preview-common.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-preview-common.sh"

REHEARSAL_ROOT="${PREVIEW_REHEARSAL_ROOT:-/var/backups/trends/preview-rehearsals}"
LOCK_FILE="${PREVIEW_REHEARSAL_LOCK_FILE:-/var/lock/trends-preview-rehearsal.lock}"
REPO_MIRROR="${REPO_MIRROR:-/home/ubuntu/trends}"
BACKUP_DIR=""
TARGET_REF=""
RUN_ID=""
REQUESTED_PHASE=""
BROWSER_EVIDENCE=""
ASSUME_YES="${ASSUME_YES:-}"
RUN_DIR=""
STATE_FILE=""
ACTIVE_PHASE=""

usage() {
    cat <<'EOF'
Usage:
  sudo deploy/preview-rehearse-backup.sh --backup-dir DIR --target-ref REF [--assume-yes]
  sudo deploy/preview-rehearse-backup.sh --run-id ID [--browser-evidence FILE] [--assume-yes]
  sudo deploy/preview-rehearse-backup.sh --run-id ID --phase PHASE [--browser-evidence FILE]

Phases:
  preflight, protect-preview, restore-baseline, verify-baseline,
  upgrade, migrate, verify-upgrade, finish, rollback

New runs stop after verify-baseline with state awaiting-approval.
Rollback is never automatic and is only available through --phase rollback.
EOF
}

log() { printf '[preview-rehearsal] %s\n' "$*"; }
die() { printf '[preview-rehearsal] ERROR: %s\n' "$*" >&2; exit 1; }

is_truthy() { [[ "${1:-}" =~ ^(1|true|yes)$ ]]; }

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
            --target-ref) TARGET_REF="${2:-}"; shift 2 ;;
            --run-id) RUN_ID="${2:-}"; shift 2 ;;
            --phase) REQUESTED_PHASE="${2:-}"; shift 2 ;;
            --browser-evidence) BROWSER_EVIDENCE="${2:-}"; shift 2 ;;
            --assume-yes) ASSUME_YES=1; shift ;;
            -h|--help) usage; exit 0 ;;
            *) usage >&2; die "unknown argument: $1" ;;
        esac
    done
}

validate_run_id() {
    [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6,16}$ ]] || die "invalid run ID: $1"
}

new_run_id() {
    python3 - <<'PY'
import datetime, secrets, string
alphabet = string.ascii_lowercase + string.digits
suffix = "".join(secrets.choice(alphabet) for _ in range(8))
print(f"{datetime.datetime.now(datetime.timezone.utc):%Y%m%dT%H%M%SZ}-{suffix}")
PY
}

state_get() {
    local key="$1"
    python3 - "$STATE_FILE" "$key" <<'PY'
import pathlib, sys
path, target = pathlib.Path(sys.argv[1]), sys.argv[2]
if not path.is_file():
    raise SystemExit(0)
for raw in path.read_text().splitlines():
    if "=" not in raw:
        continue
    key, value = raw.split("=", 1)
    if key == target:
        print(value)
        break
PY
}

state_set() {
    local key="$1"
    local value="$2"
    [[ "$key" =~ ^[a-z][a-z0-9_]*$ ]] || die "invalid state key: $key"
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "invalid state value for $key"
    python3 - "$STATE_FILE" "$key" "$value" <<'PY'
import os, pathlib, re, sys, tempfile
path, key, value = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
if not re.fullmatch(r"[a-z][a-z0-9_]*", key):
    raise SystemExit("invalid state key")
rows, found = [], False
if path.exists():
    for raw in path.read_text().splitlines():
        if "=" not in raw:
            raise SystemExit("invalid state file")
        current, old = raw.split("=", 1)
        if not re.fullmatch(r"[a-z][a-z0-9_]*", current):
            raise SystemExit("invalid state file key")
        if current == key:
            rows.append(f"{key}={value}")
            found = True
        else:
            rows.append(f"{current}={old}")
if not found:
    rows.append(f"{key}={value}")
path.parent.mkdir(parents=True, exist_ok=True)
fd, temp = tempfile.mkstemp(prefix=".state.", dir=path.parent)
try:
    with os.fdopen(fd, "w") as stream:
        stream.write("\n".join(rows) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temp, 0o600)
    os.replace(temp, path)
finally:
    if os.path.exists(temp):
        os.unlink(temp)
PY
}

phase_key() { printf '%s_status\n' "${1//-/_}"; }

phase_status() { state_get "$(phase_key "$1")"; }

controller_hash() {
    local file
    for file in \
        "$SCRIPT_DIR/preview-rehearse-backup.sh" \
        "$SCRIPT_DIR/lib-complete-backup.sh" \
        "$SCRIPT_DIR/lib-convex-migrations.sh" \
        "$SCRIPT_DIR/restore-preview-from-backup.sh" \
        "$SCRIPT_DIR/preview-run-migrations.sh" \
        "$SCRIPT_DIR/preview-verify-snapshot.sh" \
        "$SCRIPT_DIR/preview-output-restore.allowlist" \
        "$SCRIPT_DIR/lib-preview-common.sh" \
        "$SCRIPT_DIR/lib-preview-auth-session.sh" \
        "$SCRIPT_DIR/lib-bff-defaults.sh" \
        "$SCRIPT_DIR/preview-isolate-integrations.sh" \
        "$SCRIPT_DIR/preview-seed-auth.sh" \
        "$SCRIPT_DIR/search-freshness-gate.sh" \
        "$SCRIPT_DIR/sync-preview-convex-env.sh"; do
        [[ -f "$file" ]] || die "controller file missing: $file"
        printf '%s  %s\n' "$(complete_backup_sha256 "$file")" "$(basename "$file")"
    done | {
        if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'; else shasum -a 256 | awk '{print $1}'; fi
    }
}

assert_controller_unchanged() {
    local expected current
    expected="$(state_get controller_hash)"
    [[ -n "$expected" ]] || return 0
    current="$(controller_hash)"
    [[ "$current" == "$expected" ]] || die "controller drift detected; use the original controller checkout for this run"
}

acquire_lock() {
    mkdir -p "$(dirname "$LOCK_FILE")"
    exec 9>"$LOCK_FILE"
    command -v flock >/dev/null 2>&1 || die "flock is required"
    flock -n 9 || die "another preview rehearsal holds $LOCK_FILE"
}

confirm() {
    local prompt="$1"
    if is_truthy "$ASSUME_YES"; then
        log "$prompt [approved by --assume-yes]"
        return 0
    fi
    [[ -t 0 ]] || die "attended approval required: $prompt"
    local answer
    read -r -p "$prompt Type 'yes': " answer
    [[ "$answer" == "yes" ]] || die "approval declined"
}

on_error() {
    local rc=$?
    trap - ERR
    if [[ -n "$STATE_FILE" && -f "$STATE_FILE" && -n "$ACTIVE_PHASE" ]]; then
        state_set "$(phase_key "$ACTIVE_PHASE")" failed || true
        state_set run_status failed || true
        state_set failed_phase "$ACTIVE_PHASE" || true
        state_set failed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" || true
    fi
    log "failure preserved in ${RUN_DIR:-<no-run-dir>} (phase=${ACTIVE_PHASE:-none}, rc=$rc)"
    exit "$rc"
}
trap on_error ERR

initialize_new_run() {
    [[ -n "$BACKUP_DIR" && -n "$TARGET_REF" ]] || die "new run requires --backup-dir and --target-ref"
    [[ -z "$RUN_ID" ]] || die "do not combine --run-id with a new run"
    [[ "$TARGET_REF" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] \
        && [[ "$TARGET_REF" != *".."* && "$TARGET_REF" != *"@{"* ]] \
        || die "target ref contains unsafe syntax"
    RUN_ID="$(new_run_id)"
    validate_run_id "$RUN_ID"
    RUN_DIR="$REHEARSAL_ROOT/$RUN_ID"
    STATE_FILE="$RUN_DIR/state.env"
    [[ ! -e "$RUN_DIR" ]] || die "run directory already exists: $RUN_DIR"
    mkdir -p "$RUN_DIR"/{evidence,logs,staging,rollback}
    chmod 700 "$RUN_DIR"
    : > "$STATE_FILE"
    chmod 600 "$STATE_FILE"
    state_set schema trends_preview_rehearsal_v1
    state_set run_id "$RUN_ID"
    state_set run_status pending
    state_set backup_dir "$(complete_backup_realpath "$BACKUP_DIR")"
    state_set target_ref "$TARGET_REF"
    state_set created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    state_set controller_hash "$(controller_hash)"
    log "created run $RUN_ID at $RUN_DIR"
}

load_existing_run() {
    [[ -n "$RUN_ID" ]] || die "--run-id is required"
    validate_run_id "$RUN_ID"
    RUN_DIR="$REHEARSAL_ROOT/$RUN_ID"
    STATE_FILE="$RUN_DIR/state.env"
    [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || die "run state missing: $STATE_FILE"
    [[ "$(state_get run_id)" == "$RUN_ID" ]] || die "run ID does not match persisted state"
    if [[ "$(state_get run_status)" == "running" ]]; then
        state_set run_status failed-needs-review
        die "interrupted running state requires attended review before resuming"
    fi
    assert_controller_unchanged
}

git_resolve_commit() {
    git -C "$REPO_MIRROR" rev-parse "$1^{commit}"
}

git_version_at() {
    git -C "$REPO_MIRROR" show "$1:version" | tr -d '[:space:]'
}

phase_preflight() {
    local backup source_sha source_version target_sha target_version
    local mirror_real prod_real preview_real
    backup="$(state_get backup_dir)"
    complete_backup_validate "$backup" "$RUN_DIR/evidence/backup"
    source_sha="${COMPLETE_BACKUP_MANIFEST[prod_sha]}"
    source_version="${COMPLETE_BACKUP_MANIFEST[prod_version]}"
    [[ -d "$REPO_MIRROR/.git" ]] || die "REPO_MIRROR is not a git checkout: $REPO_MIRROR"
    mirror_real="$(complete_backup_realpath "$REPO_MIRROR")"
    prod_real="$(complete_backup_realpath "$PROD_DIR")"
    preview_real="$(complete_backup_realpath "$PREVIEW_DIR")"
    [[ "$mirror_real" != "$prod_real" && "$mirror_real" != "$prod_real"/* ]] \
        || die "REPO_MIRROR must not be the production checkout"
    [[ "$mirror_real" != "$preview_real" && "$mirror_real" != "$preview_real"/* ]] \
        || die "REPO_MIRROR must not be the preview checkout"
    git -C "$REPO_MIRROR" fetch --prune origin
    git -C "$REPO_MIRROR" fetch --tags --prune origin
    if ! git -C "$REPO_MIRROR" cat-file -e "$source_sha^{commit}" 2>/dev/null; then
        git -C "$REPO_MIRROR" fetch origin \
            "${COMPLETE_BACKUP_MANIFEST[prod_branch]}:refs/remotes/origin/${COMPLETE_BACKUP_MANIFEST[prod_branch]}" \
            || git -C "$REPO_MIRROR" fetch origin "$source_sha"
    fi
    git -C "$REPO_MIRROR" cat-file -e "$source_sha^{commit}"
    [[ "$(git_version_at "$source_sha")" == "$source_version" ]] || die "manifest source version does not match source commit"
    target_sha="$(git_resolve_commit "$(state_get target_ref)")"
    target_version="$(git_version_at "$target_sha")"
    [[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || die "target did not resolve to a commit"
    state_set source_sha "$source_sha"
    state_set source_version "$source_version"
    state_set source_branch "${COMPLETE_BACKUP_MANIFEST[prod_branch]}"
    state_set target_sha "$target_sha"
    state_set target_version "$target_version"
    state_set candidate_actions_count "${COMPLETE_BACKUP_MANIFEST[candidate_actions_count]}"
    state_set backup_manifest_hash "$(complete_backup_sha256 "$backup/MANIFEST.txt")"
}

phase_worker() {
    "$SCRIPT_DIR/restore-preview-from-backup.sh" "$@" --run-dir "$RUN_DIR"
}

phase_verify() {
    "$SCRIPT_DIR/preview-verify-snapshot.sh" "$@" --run-dir "$RUN_DIR"
}

phase_migrate() {
    "$SCRIPT_DIR/preview-run-migrations.sh" --run-dir "$RUN_DIR"
}

validate_browser_evidence() {
    local evidence="$1"
    [[ -f "$evidence" && ! -L "$evidence" ]] || die "browser evidence missing: $evidence"
    node - "$evidence" "$RUN_ID" "$(state_get target_sha)" "${PREVIEW_PUBLIC_URL:-https://preview.pt-mes.com}" <<'NODE'
const fs = require("node:fs");
const [path, runId, targetSha, expectedBaseUrl] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(path, "utf8"));
if (value.schema !== "trends-preview-rehearsal-browser-evidence/v1") throw new Error("invalid evidence schema");
if (value.runId !== runId || value.targetSha !== targetSha) throw new Error("browser evidence identity mismatch");
if (value.baseUrl !== expectedBaseUrl.replace(/\/$/, "")) throw new Error("browser evidence base URL mismatch");
if (value.result !== "passed") throw new Error("browser evidence did not pass");
const ageMs = Date.now() - Date.parse(value.completedAt);
if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 6 * 60 * 60 * 1000) throw new Error("browser evidence is stale");
const serialized = JSON.stringify(value);
for (const forbidden of ["password", "cookie", "csrf", "authorization", "set-cookie"]) {
  if (serialized.toLowerCase().includes(forbidden)) throw new Error(`browser evidence contains forbidden field: ${forbidden}`);
}
NODE
    if [[ "$(complete_backup_realpath "$evidence")" != "$(complete_backup_realpath "$RUN_DIR/evidence/browser-evidence.json")" ]]; then
        cp "$evidence" "$RUN_DIR/evidence/browser-evidence.json"
    fi
    chmod 600 "$RUN_DIR/evidence/browser-evidence.json"
    state_set browser_evidence_hash "$(complete_backup_sha256 "$RUN_DIR/evidence/browser-evidence.json")"
}

run_phase() {
    local phase="$1"
    local key prior
    key="$(phase_key "$phase")"
    prior="$(phase_status "$phase")"
    if [[ "$prior" == "passed" && "$phase" != "finish" ]]; then
        die "phase already passed and will not be rerun silently: $phase"
    fi
    ACTIVE_PHASE="$phase"
    state_set run_status running
    state_set current_phase "$phase"
    state_set "$key" running
    state_set "${phase//-/_}_started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    case "$phase" in
        preflight) phase_preflight ;;
        protect-preview) phase_worker protect ;;
        restore-baseline) phase_worker restore-baseline ;;
        verify-baseline) phase_verify --mode baseline ;;
        upgrade)
            local resolved
            resolved="$(git_resolve_commit "$(state_get target_ref)")"
            [[ "$resolved" == "$(state_get target_sha)" ]] || die "target ref moved since preflight"
            phase_worker install-target
            ;;
        migrate) phase_migrate ;;
        verify-upgrade) phase_verify --mode upgraded ;;
        finish)
            [[ -n "$BROWSER_EVIDENCE" ]] || BROWSER_EVIDENCE="$RUN_DIR/evidence/browser-evidence.json"
            validate_browser_evidence "$BROWSER_EVIDENCE"
            state_set finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
            ;;
        rollback) phase_worker rollback ;;
        *) die "unknown phase: $phase" ;;
    esac
    state_set "$key" passed
    state_set "${phase//-/_}_completed_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    state_set run_status passed
    ACTIVE_PHASE=""
}

require_passed() {
    [[ "$(phase_status "$1")" == "passed" ]] || die "required prior phase has not passed: $1"
}

run_exact_phase() {
    local phase="$1"
    case "$phase" in
        preflight) ;;
        protect-preview) require_passed preflight ;;
        restore-baseline) require_passed protect-preview ;;
        verify-baseline) require_passed restore-baseline ;;
        upgrade) require_passed verify-baseline; [[ "$(state_get run_status)" == "awaiting-approval" || -n "$REQUESTED_PHASE" ]] || die "baseline approval state missing" ;;
        migrate) require_passed upgrade ;;
        verify-upgrade) require_passed migrate ;;
        finish) require_passed verify-upgrade ;;
        rollback) require_passed protect-preview ;;
        *) die "invalid phase: $phase" ;;
    esac
    run_phase "$phase"
    if [[ "$phase" == "verify-baseline" ]]; then
        state_set run_status awaiting-approval
        state_set approval_state awaiting-baseline-approval
    elif [[ "$phase" == "verify-upgrade" ]]; then
        state_set run_status awaiting-browser-evidence
    elif [[ "$phase" == "finish" ]]; then
        state_set run_status completed
        log "rehearsal complete; preview integrations remain isolated"
        log "manual isolation lift (not executed): sudo bash deploy/preview-isolate-integrations.sh --restore"
    elif [[ "$phase" == "rollback" ]]; then
        state_set run_status rolled_back
    fi
}

resume_default() {
    case "$(state_get run_status)" in
        awaiting-approval)
            confirm "Baseline evidence passed. Approve exact target upgrade to $(state_get target_sha)?"
            state_set approval_state approved
            state_set approved_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
            run_exact_phase upgrade
            run_exact_phase migrate
            run_exact_phase verify-upgrade
            log "upgrade verification passed; supply fresh browser evidence to finish"
            ;;
        awaiting-browser-evidence)
            [[ -n "$BROWSER_EVIDENCE" ]] || die "--browser-evidence is required to finish"
            run_exact_phase finish
            ;;
        failed|failed-needs-review)
            die "run is failed; inspect evidence and use an explicit legal --phase or --phase rollback"
            ;;
        completed|rolled_back) die "run is already terminal: $(state_get run_status)" ;;
        *) die "run is not at a resumable attended gate: $(state_get run_status)" ;;
    esac
}

main() {
    parse_args "$@"
    acquire_lock
    if [[ -n "$BACKUP_DIR" || -n "$TARGET_REF" ]]; then
        initialize_new_run
        if [[ -n "$REQUESTED_PHASE" ]]; then
            [[ "$REQUESTED_PHASE" == "preflight" ]] || die "a new run may only select --phase preflight"
            run_exact_phase preflight
            return
        fi
        run_exact_phase preflight
        run_exact_phase protect-preview
        run_exact_phase restore-baseline
        run_exact_phase verify-baseline
        log "baseline verified; run ID: $RUN_ID"
        log "review $RUN_DIR/evidence and resume with: $0 --run-id $RUN_ID"
        return
    fi
    load_existing_run
    if [[ -n "$REQUESTED_PHASE" ]]; then
        [[ "$REQUESTED_PHASE" == "rollback" ]] || confirm "Run exactly phase '$REQUESTED_PHASE' for $RUN_ID?"
        run_exact_phase "$REQUESTED_PHASE"
    else
        resume_default
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
