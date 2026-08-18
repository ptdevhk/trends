#!/usr/bin/env bash
# Full preview migration green gate after prod→preview clone + upgrade + auth.
# Exit 0 = PASS. Never touches production.
#
# Usage (ptcloud):
#   bash deploy/preview-migration-gate.sh
#   SKIP_SEED=1 bash deploy/preview-migration-gate.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-preview-auth-session.sh
source "$SCRIPT_DIR/lib-preview-auth-session.sh"

PREVIEW_DIR="${PREVIEW_DIR:-/home/ubuntu/trends-preview}"
PREVIEW_ENV_FILE="${PREVIEW_ENV_FILE:-$PREVIEW_DIR/.env.preview}"
LOG_DIR="${LOG_DIR:-/var/log/trends}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$LOG_DIR" 2>/dev/null || true
GATE_JSON="${GATE_JSON:-$LOG_DIR/preview-gate-${TS}.json}"

assert_not_prod_install_dir "$PREVIEW_DIR" || exit 1
if is_prod_path "$(pwd -P 2>/dev/null || true)"; then
    log_error "Refuse gate from production cwd"
    exit 1
fi

if [[ ! -f "$PREVIEW_ENV_FILE" ]]; then
    log_error "Missing $PREVIEW_ENV_FILE"
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$PREVIEW_ENV_FILE"
set +a

RESULT=PASS
ADMIN_LOGIN=FAIL
HR_LOGIN=FAIL
NOTES=()

fail_note() {
    RESULT=FAIL
    NOTES+=("$1")
    log_error "$1"
}

log_step "Preview migration gate"
log_info "PREVIEW_DIR=$PREVIEW_DIR"

# 1) check-auth-env
log_step "check-auth-env"
if (cd "$PREVIEW_DIR" && npx tsx scripts/check-auth-env.ts --mode preview --env-file "$PREVIEW_ENV_FILE") \
    || (cd "$PREVIEW_DIR" && bunx tsx scripts/check-auth-env.ts --mode preview --env-file "$PREVIEW_ENV_FILE" 2>/dev/null); then
    log_info "auth env OK"
else
    fail_note "check-auth-env failed"
fi

# 2) seed
if [[ ! "${SKIP_SEED:-}" =~ ^(1|true|yes)$ ]]; then
    log_step "seed auth"
    if bash "$SCRIPT_DIR/preview-seed-auth.sh"; then
        log_info "seed OK"
    else
        fail_note "preview-seed-auth failed"
    fi
fi

# 3) Convex write secret sync
log_step "sync preview Convex env (incl. CONVEX_WRITE_SECRET)"
if [[ -x "$SCRIPT_DIR/sync-preview-convex-env.sh" ]]; then
    PREVIEW_DIR="$PREVIEW_DIR" bash "$SCRIPT_DIR/sync-preview-convex-env.sh" --sync-only \
        || fail_note "sync-preview-convex-env failed"
elif [[ -x "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" ]]; then
    PREVIEW_DIR="$PREVIEW_DIR" bash "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh" --sync-only \
        || fail_note "sync-preview-convex-env failed"
else
    log_warn "sync-preview-convex-env.sh not found"
fi

# 4) doctor
log_step "doctor"
DOCTOR_SCRIPT="$SCRIPT_DIR/preview-doctor.sh"
[[ -x "$DOCTOR_SCRIPT" ]] || DOCTOR_SCRIPT="$PREVIEW_DIR/deploy/preview-doctor.sh"
if bash "$DOCTOR_SCRIPT" --full; then
    log_info "doctor OK"
else
    fail_note "doctor failed"
fi

# 5) parity
log_step "parity"
if bash "$SCRIPT_DIR/preview-parity-check.sh"; then
    log_info "parity OK"
else
    fail_note "parity failed"
fi

PREVIEW_VER="$(cat "$PREVIEW_DIR/version" 2>/dev/null || echo unknown)"
PREVIEW_SHA="$(grep '^SOURCE_SHA=' "$PREVIEW_DIR/.trends-source-meta" 2>/dev/null | cut -d= -f2 || echo unknown)"
PROD_SHA="$(sudo -u "${PROD_SERVICE_USER:-trends}" git -C "${PROD_DIR:-/opt/trends}" rev-parse HEAD 2>/dev/null || echo unknown)"

ADMIN_USER="${BOOTSTRAP_ADMIN_USERS%%,*}"
ADMIN_USER="${ADMIN_USER:-admin}"
HR_USER="${BOOTSTRAP_HR_DEMO_USER:-hr-demo}"
HR_WS="${BOOTSTRAP_HR_DEMO_WORKSPACE:-hr}"
JAR_A="/tmp/preview-gate-admin-$$.jar"
JAR_H="/tmp/preview-gate-hr-$$.jar"
if preview_auth_login "$ADMIN_USER" "${AUTH_BOOTSTRAP_PASSWORD:-}" "$JAR_A"; then
    ADMIN_LOGIN=PASS
fi
if preview_auth_login "$HR_USER" "${AUTH_HR_DEMO_PASSWORD:-}" "$JAR_H"; then
    HR_LOGIN=PASS
fi

# 6) hr-ops snapshot artifact (P4): evidence for migration rehearsal workflows.
log_step "hr-ops snapshot artifact"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-$LOG_DIR}"
mkdir -p "$SNAPSHOT_DIR" 2>/dev/null || true
SNAPSHOT_FILE="${SNAPSHOT_FILE:-$SNAPSHOT_DIR/preview-hr-ops-snapshot-${TS}.json}"
SNAPSHOT_FILE_EMITTED=""
if [[ "$ADMIN_LOGIN" == "PASS" ]]; then
    if preview_auth_curl "$JAR_A" "$HR_WS" --max-time 60 \
        "${PREVIEW_API_URL:-http://127.0.0.1:3002}/api/workspace/export?profile=hr-ops" \
        > "$SNAPSHOT_FILE.tmp" \
        && python3 - "$SNAPSHOT_FILE.tmp" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    doc = json.load(f)
ok = (
    doc.get("success") is True
    and doc.get("schemaVersion") == 1
    and doc.get("profile") == "hr-ops"
    and isinstance(doc.get("tables"), dict)
)
sys.exit(0 if ok else 1)
PY
    then
        mv "$SNAPSHOT_FILE.tmp" "$SNAPSHOT_FILE"
        SNAPSHOT_FILE_EMITTED="$SNAPSHOT_FILE"
        log_info "hr-ops snapshot artifact: $SNAPSHOT_FILE"
    else
        rm -f "$SNAPSHOT_FILE.tmp"
        fail_note "hr-ops snapshot artifact export failed"
    fi
else
    fail_note "hr-ops snapshot artifact skipped (admin login failed)"
fi
rm -f "$JAR_A" "$JAR_H"

NOTES_JOINED="$(printf '%s|' "${NOTES[@]:-}" | sed 's/|$//')"
export RESULT PREVIEW_VER PREVIEW_SHA PROD_SHA ADMIN_LOGIN HR_LOGIN TS NOTES_JOINED GATE_JSON SNAPSHOT_FILE_EMITTED
python3 <<'PY'
import json, os
doc = {
  "result": os.environ.get("RESULT", "FAIL"),
  "preview_version": os.environ.get("PREVIEW_VER", ""),
  "preview_sha": os.environ.get("PREVIEW_SHA", ""),
  "prod_sha": os.environ.get("PROD_SHA", ""),
  "admin_login": os.environ.get("ADMIN_LOGIN", "FAIL"),
  "hr_demo_login": os.environ.get("HR_LOGIN", "FAIL"),
  "snapshot_artifact": os.environ.get("SNAPSHOT_FILE_EMITTED", ""),
  "notes": [n for n in os.environ.get("NOTES_JOINED", "").split("|") if n],
  "ts": os.environ.get("TS", ""),
}
path = os.environ.get("GATE_JSON", "/tmp/preview-gate.json")
with open(path, "w") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
print(json.dumps(doc, indent=2))
print("signoff=", path)
PY

if [[ "$RESULT" != "PASS" || "$ADMIN_LOGIN" != "PASS" || "$HR_LOGIN" != "PASS" ]]; then
    log_error "GATE FAIL"
    exit 1
fi
log_info "GATE PASS"
exit 0
