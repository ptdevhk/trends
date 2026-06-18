#!/usr/bin/env bash
# Tests for the seed_bootstrap_admins() function in scripts/install.sh.
#
# install.sh has a top-level dispatch on "$1" that runs on source, so we
# extract ONLY the seed_bootstrap_admins() function body and eval it in a
# sandbox with stubbed callees. This proves the comma-parsing, no-op guard,
# default-assignment, and trim logic without invoking the real deploy.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_SH="$ROOT_DIR/scripts/install.sh"

if [[ ! -f "$INSTALL_SH" ]]; then
    echo "FAIL: $INSTALL_SH not found"
    exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
CALLS_FILE="$TMP_DIR/calls.txt"
: > "$CALLS_FILE"

# --- Stubs for everything seed_bootstrap_admins calls ---
log_info() { :; }
log_warn() { :; }
log_error() { :; }

# Capture the command run_as_service_user would have executed.
run_as_service_user() {
    printf '%s\n' "$*" >> "$CALLS_FILE"
    return 0
}

# Extract just the seed_bootstrap_admins() function from install.sh and eval
# it in this shell. The function is delimited by `seed_bootstrap_admins() {`
# ... `}` at column 1.
FUNC_BODY="$(awk '
    /^seed_bootstrap_admins\(\) \{/ { in_func=1 }
    in_func { print }
    in_func && /^\}/ { in_func=0 }
' "$INSTALL_SH")"

if [[ -z "$FUNC_BODY" ]]; then
    echo "FAIL: could not extract seed_bootstrap_admins() from install.sh"
    exit 1
fi

# shellcheck disable=SC1090
eval "$FUNC_BODY"

# Provide the globals the function reads.
INSTALL_DIR="$ROOT_DIR"
CONFIG_DIR="$TMP_DIR/config"
mkdir -p "$CONFIG_DIR"
: > "$CONFIG_DIR/env"   # empty env file exercises the env_source branch

fail() {
    echo "FAIL: $1"
    echo "--- captured calls ---"
    cat "$CALLS_FILE" 2>/dev/null || echo "(none)"
    exit 1
}

# --- Test 1: no-op when BOOTSTRAP_ADMIN_USERS unset/empty ---
: > "$CALLS_FILE"
BOOTSTRAP_ADMIN_USERS="" seed_bootstrap_admins || true
if [[ -s "$CALLS_FILE" ]]; then
    fail "invoked manage-user when BOOTSTRAP_ADMIN_USERS was empty"
fi
echo "PASS: no-op when BOOTSTRAP_ADMIN_USERS unset"

# --- Test 2: one call per user, trimmed ---
: > "$CALLS_FILE"
BOOTSTRAP_ADMIN_USERS="alice, bob ,carol" seed_bootstrap_admins || true
COUNT=$(wc -l < "$CALLS_FILE" | tr -d ' ')
[[ "$COUNT" -eq 3 ]] || fail "expected 3 invocations, got $COUNT"
echo "PASS: one invocation per comma-separated user"

# --- Test 3: defaults applied ---
: > "$CALLS_FILE"
BOOTSTRAP_ADMIN_USERS="alice" seed_bootstrap_admins || true
CALL=$(cat "$CALLS_FILE")
echo "$CALL" | grep -q -- "--workspace 'dev'" || fail "default workspace not applied: $CALL"
echo "$CALL" | grep -q -- "--role admin" || fail "role admin not applied: $CALL"
echo "$CALL" | grep -q -- "--password-env 'AUTH_BOOTSTRAP_PASSWORD'" || fail "default password-env not applied: $CALL"
echo "$CALL" | grep -q -- "--username 'alice'" || fail "username not applied: $CALL"
echo "$CALL" | grep -q -- "scripts/auth/manage-user.ts" || fail "manage-user.ts path missing: $CALL"
echo "PASS: defaults applied (workspace=dev, password-env=AUTH_BOOTSTRAP_PASSWORD)"

# --- Test 4: custom workspace + password-env ---
: > "$CALLS_FILE"
BOOTSTRAP_ADMIN_USERS="bob" BOOTSTRAP_ADMIN_WORKSPACE="hr" BOOTSTRAP_ADMIN_PASSWORD_ENV="BOB_PASS" seed_bootstrap_admins || true
CALL=$(cat "$CALLS_FILE")
echo "$CALL" | grep -q -- "--workspace 'hr'" || fail "custom workspace not honored: $CALL"
echo "$CALL" | grep -q -- "--password-env 'BOB_PASS'" || fail "custom password-env not honored: $CALL"
echo "PASS: custom workspace + password-env honored"

# --- Test 5: empty/whitespace entries skipped ---
: > "$CALLS_FILE"
BOOTSTRAP_ADMIN_USERS="alice,,  ,bob" seed_bootstrap_admins || true
COUNT=$(grep -c "manage-user.ts" "$CALLS_FILE" || true)
[[ "$COUNT" -eq 2 ]] || fail "expected 2 real invocations (alice,bob), got $COUNT"
echo "PASS: empty entries skipped"

# --- Test 6: failure in one user does not abort the rest ---
: > "$CALLS_FILE"
run_as_service_user() {
    # Fail for the second user only.
    if printf '%s' "$*" | grep -q -- "--username 'bob'"; then
        return 1
    fi
    printf '%s\n' "$*" >> "$CALLS_FILE"
    return 0
}
BOOTSTRAP_ADMIN_USERS="alice,bob,carol" seed_bootstrap_admins || true
COUNT=$(wc -l < "$CALLS_FILE" | tr -d ' ')
[[ "$COUNT" -eq 2 ]] || fail "expected 2 successful invocations (alice,carol), got $COUNT"
echo "PASS: one failure does not abort remaining users"

echo ""
echo "All seed_bootstrap_admins tests passed."
