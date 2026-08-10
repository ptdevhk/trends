#!/usr/bin/env bash
# Tests for lib-dev-common.sh. Run: bash deploy/lib-dev-common.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# shellcheck source=lib-preview-common.sh
source "$ROOT/deploy/lib-preview-common.sh"
# shellcheck source=lib-dev-common.sh
source "$ROOT/deploy/lib-dev-common.sh"

[[ -n "${DEV_ROOT:-}" ]] && pass "DEV_ROOT set" || fail "DEV_ROOT unset"

# digest_epoch_from_export: fixture zip with mixed epochs + missing field
mkdir -p "$TMP/e/resume_digests"
printf '"uniform"\n' > "$TMP/e/resume_digests/generated_schema.jsonl"
printf '{"_id":"a","ingestComputeEpoch":1}\n{"_id":"b","ingestComputeEpoch":3}\n{"_id":"c"}\n' > "$TMP/e/resume_digests/documents.jsonl"
( cd "$TMP/e" && zip -rq "$TMP/digests.zip" . )
EPOCH="$(digest_epoch_from_export "$TMP/digests.zip")"
[ "$EPOCH" = "3" ] && pass "digest_epoch_from_export max=3" || fail "digest_epoch_from_export got $EPOCH"

# missing epoch field -> 0
printf '{"_id":"a"}\n' > "$TMP/e/resume_digests/documents.jsonl"
( cd "$TMP/e" && zip -rq "$TMP/digests0.zip" . )
EPOCH0="$(digest_epoch_from_export "$TMP/digests0.zip")"
[ "$EPOCH0" = "0" ] && pass "digest_epoch_from_export missing->0" || fail "got $EPOCH0"

# local_digest_epoch parses the shared registry
LOCAL="$(cd "$ROOT" && local_digest_epoch)"
[[ "$LOCAL" =~ ^[0-9]+$ ]] && pass "local_digest_epoch=$LOCAL" || fail "local_digest_epoch unparsable"

# seed command construction uses --role admin for both accounts
SEED_CMD="$(cd "$ROOT" && sed -n 's|^ *"auth:bootstrap-hr-demo": "\(.*\)",$|\1|p' package.json | head -1)"
echo "$SEED_CMD" | grep -q -- "--role admin" && pass "npm script seeds hr-demo admin" || fail "npm script not admin yet"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
