#!/usr/bin/env bash
# Regression test for the shared restore quiesce helper. This only sources the
# helper and replaces its Convex boundary with an in-process recorder; it never
# contacts a deployment or reads an environment file.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT_DIR/deploy/quiesce.sh"

if [[ ! -f "$HELPER" ]]; then
    echo "FAIL: $HELPER not found"
    exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
CALLS_FILE="$TMP_DIR/convex-calls.txt"
: > "$CALLS_FILE"

# shellcheck disable=SC1090
source "$HELPER"

convex_run() {
    local _convex_dir="$1"
    local _convex_url="$2"
    local function_name="$3"
    local _args="$4"
    printf '%s\n' "$function_name" >> "$CALLS_FILE"
}

unset CONVEX_WRITE_SECRET

if quiesce_writers "$TMP_DIR/convex" "http://example.invalid" "test"; then
    echo "FAIL: quiesce_writers succeeded without CONVEX_WRITE_SECRET"
    exit 1
fi

if grep -Fxq 'system_settings:set' "$CALLS_FILE"; then
    echo "FAIL: maintenance mode was changed before CONVEX_WRITE_SECRET validation"
    exit 1
fi

if [[ -s "$CALLS_FILE" ]]; then
    echo "FAIL: Convex was called before CONVEX_WRITE_SECRET validation"
    cat "$CALLS_FILE"
    exit 1
fi

echo "PASS: missing CONVEX_WRITE_SECRET fails before any Convex call"
