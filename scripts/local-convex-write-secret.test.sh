#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT_DIR/scripts/local-convex-write-secret.sh"

if [[ ! -f "$HELPER" ]]; then
    echo "FAIL: local Convex write-secret helper is missing"
    exit 1
fi

# shellcheck disable=SC1090
source "$HELPER"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
    echo "FAIL: $1"
    exit 1
}

file_mode() {
    if stat -f '%Lp' "$1" >/dev/null 2>&1; then
        stat -f '%Lp' "$1"
    else
        stat -c '%a' "$1"
    fi
}

write_local_env() {
    local project_root="$1"
    local env_path="${2:-$project_root/.env.local}"
    mkdir -p "$(dirname "$env_path")"
    printf '%s\n' \
        'CONVEX_DEPLOYMENT=anonymous:anonymous-agent' \
        'CONVEX_URL=http://127.0.0.1:3210' > "$env_path"
}

# Local anonymous Convex generates, exports, persists, and protects one secret.
LOCAL_PROJECT="$TMP_DIR/local"
write_local_env "$LOCAL_PROJECT" "$LOCAL_PROJECT/packages/convex/.env.local"
LOCAL_CONVEX_PROJECT_ROOT="$LOCAL_PROJECT"
unset CONVEX_WRITE_SECRET CONVEX_DEPLOYMENT CONVEX_URL CONVEX_AGENT_MODE
OUTPUT_FILE="$TMP_DIR/local-output"
ensure_local_convex_write_secret > "$OUTPUT_FILE" 2>&1

[[ ! -s "$OUTPUT_FILE" ]] || fail "helper printed output while generating a secret"
[[ "${#CONVEX_WRITE_SECRET}" -ge 64 ]] || fail "generated secret is not high entropy"
ROOT_ENV="$LOCAL_PROJECT/.env.local"
[[ -f "$ROOT_ENV" ]] || fail "root .env.local was not created"
[[ "$(file_mode "$ROOT_ENV")" == "600" ]] || fail "root .env.local mode is not 600"
PERSISTED_SECRET="$(sed -n 's/^CONVEX_WRITE_SECRET=//p' "$ROOT_ENV" | tail -n 1)"
[[ "$PERSISTED_SECRET" == "$CONVEX_WRITE_SECRET" ]] || fail "exported and persisted secrets differ"
echo "PASS: local anonymous secret is generated, exported, and mode-protected"

# A second invocation reuses the persisted value without duplicate keys.
FIRST_SECRET="$CONVEX_WRITE_SECRET"
unset CONVEX_WRITE_SECRET
ensure_local_convex_write_secret > "$OUTPUT_FILE" 2>&1
[[ "$CONVEX_WRITE_SECRET" == "$FIRST_SECRET" ]] || fail "persisted secret was not reused"
[[ "$(grep -c '^CONVEX_WRITE_SECRET=' "$ROOT_ENV")" -eq 1 ]] || fail "secret key was duplicated"
echo "PASS: persisted local secret is stable across restarts"

# An explicitly provided local secret is persisted instead of replaced.
PROVIDED_PROJECT="$TMP_DIR/provided"
write_local_env "$PROVIDED_PROJECT"
LOCAL_CONVEX_PROJECT_ROOT="$PROVIDED_PROJECT"
CONVEX_WRITE_SECRET="provided-local-secret-value-with-sufficient-length"
ensure_local_convex_write_secret > "$OUTPUT_FILE" 2>&1
PERSISTED_SECRET="$(sed -n 's/^CONVEX_WRITE_SECRET=//p' "$PROVIDED_PROJECT/.env.local" | tail -n 1)"
[[ "$PERSISTED_SECRET" == "$CONVEX_WRITE_SECRET" ]] || fail "provided secret was replaced"
echo "PASS: an explicit local secret is preserved"

# A cloud/non-loopback deployment is a strict no-op.
CLOUD_PROJECT="$TMP_DIR/cloud"
mkdir -p "$CLOUD_PROJECT"
printf '%s\n' \
    'CONVEX_DEPLOYMENT=dev:cloud-project' \
    'CONVEX_URL=https://example.convex.cloud' > "$CLOUD_PROJECT/.env.local"
LOCAL_CONVEX_PROJECT_ROOT="$CLOUD_PROJECT"
unset CONVEX_WRITE_SECRET CONVEX_DEPLOYMENT CONVEX_URL CONVEX_AGENT_MODE
ensure_local_convex_write_secret > "$OUTPUT_FILE" 2>&1
[[ -z "${CONVEX_WRITE_SECRET:-}" ]] || fail "cloud deployment exported a local secret"
[[ "$(grep -c '^CONVEX_WRITE_SECRET=' "$CLOUD_PROJECT/.env.local" || true)" -eq 0 ]] || fail "cloud env file was modified"
echo "PASS: cloud deployment remains untouched"

# An explicitly named cloud deployment remains a strict no-op even when a
# local-looking URL is present.
LOOPBACK_CLOUD_PROJECT="$TMP_DIR/cloud-loopback"
mkdir -p "$LOOPBACK_CLOUD_PROJECT"
printf '%s\n' \
    'CONVEX_DEPLOYMENT=dev:cloud-project' \
    'CONVEX_URL=http://127.0.0.1:3210' > "$LOOPBACK_CLOUD_PROJECT/.env.local"
LOCAL_CONVEX_PROJECT_ROOT="$LOOPBACK_CLOUD_PROJECT"
unset CONVEX_WRITE_SECRET CONVEX_DEPLOYMENT CONVEX_URL CONVEX_AGENT_MODE
ensure_local_convex_write_secret > "$OUTPUT_FILE" 2>&1
[[ -z "${CONVEX_WRITE_SECRET:-}" ]] || fail "loopback cloud deployment exported a local secret"
[[ "$(grep -c '^CONVEX_WRITE_SECRET=' "$LOOPBACK_CLOUD_PROJECT/.env.local" || true)" -eq 0 ]] || fail "loopback cloud env file was modified"
echo "PASS: loopback cloud deployment remains untouched"

# Agent mode cannot override an explicit named cloud deployment.
LOOPBACK_CLOUD_ANONYMOUS_PROJECT="$TMP_DIR/cloud-loopback-anonymous"
mkdir -p "$LOOPBACK_CLOUD_ANONYMOUS_PROJECT"
printf '%s\n' \
    'CONVEX_DEPLOYMENT=dev:cloud-project' \
    'CONVEX_URL=http://127.0.0.1:3210' > "$LOOPBACK_CLOUD_ANONYMOUS_PROJECT/.env.local"
LOCAL_CONVEX_PROJECT_ROOT="$LOOPBACK_CLOUD_ANONYMOUS_PROJECT"
unset CONVEX_WRITE_SECRET CONVEX_DEPLOYMENT CONVEX_URL
CONVEX_AGENT_MODE=anonymous
ensure_local_convex_write_secret > "$OUTPUT_FILE" 2>&1
[[ -z "${CONVEX_WRITE_SECRET:-}" ]] || fail "anonymous-mode cloud deployment exported a local secret"
[[ "$(grep -c '^CONVEX_WRITE_SECRET=' "$LOOPBACK_CLOUD_ANONYMOUS_PROJECT/.env.local" || true)" -eq 0 ]] || fail "anonymous-mode cloud env file was modified"
unset CONVEX_AGENT_MODE
echo "PASS: anonymous mode cannot override a cloud deployment"

# Startup and runtime-env sync must both consume the shared helper. Anonymous
# local CLI calls need agent mode, while the secret key must remain part of the
# bounded runtime allowlist.
DEV_SCRIPT="$ROOT_DIR/scripts/dev.sh"
SYNC_SCRIPT="$ROOT_DIR/scripts/sync-convex-env.sh"
grep -q 'local-convex-write-secret.sh' "$DEV_SCRIPT" || fail "dev.sh does not source the shared helper"
[[ "$(grep -c 'ensure_local_convex_write_secret' "$DEV_SCRIPT")" -ge 2 ]] || fail "dev.sh does not ensure the secret for startup and API launch"
grep -q 'local-convex-write-secret.sh' "$SYNC_SCRIPT" || fail "sync-convex-env.sh does not source the shared helper"
grep -q 'CONVEX_WRITE_SECRET' "$SYNC_SCRIPT" || fail "Convex runtime sync omits CONVEX_WRITE_SECRET"
grep -q 'CONVEX_AGENT_MODE=anonymous' "$SYNC_SCRIPT" || fail "anonymous local env sync does not set agent mode"
echo "PASS: dev startup and Convex runtime sync are wired to the helper"

echo "All local Convex write-secret tests passed."
