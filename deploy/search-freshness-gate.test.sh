#!/usr/bin/env bash
# Structural + helper tests for search-freshness gate and BFF deploy wiring.
# Run: bash deploy/search-freshness-gate.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

echo "=== search-freshness-gate structural ==="

# shellcheck source=lib-bff-defaults.sh
source "$ROOT/deploy/lib-bff-defaults.sh"

# Gate script exists and is executable
[[ -x "$ROOT/deploy/search-freshness-gate.sh" ]] && pass "search-freshness-gate.sh executable" || fail "gate missing/not executable"
[[ -f "$ROOT/deploy/lib-bff-defaults.sh" ]] && pass "lib-bff-defaults.sh present" || fail "lib-bff-defaults missing"

# Shared resolver module ships
[[ -f "$ROOT/packages/shared/src/bff-api-url.ts" ]] && pass "bff-api-url.ts present" || fail "bff-api-url.ts missing"
grep -q 'export function resolveBffApiUrl' "$ROOT/packages/shared/src/bff-api-url.ts" && pass "resolveBffApiUrl exported" || fail "resolveBffApiUrl missing"
grep -q 'export function previewPublicBffOrigin' "$ROOT/packages/shared/src/bff-api-url.ts" && pass "previewPublicBffOrigin exported" || fail "previewPublicBffOrigin missing"

# ingest_agent uses shared resolver
grep -q 'resolveBffApiUrl' "$ROOT/packages/convex/convex/ingest_agent.ts" && pass "ingest_agent uses resolveBffApiUrl" || fail "ingest_agent missing resolver"
! grep -qE 'return process\.env\.BFF_API_URL \|\| "http://localhost' "$ROOT/packages/convex/convex/ingest_agent.ts" && pass "old localhost-only getter removed" || fail "old getter still present"

# Preview compose sets BFF + role via env (not only literals)
grep -q 'TRENDS_DEPLOYMENT_ROLE' "$ROOT/deploy/docker/docker-compose.preview.yml" && pass "compose TRENDS_DEPLOYMENT_ROLE" || fail "compose role missing"
grep -q 'BFF_API_URL' "$ROOT/deploy/docker/docker-compose.preview.yml" && pass "compose BFF_API_URL" || fail "compose BFF missing"
grep -q 'PREVIEW_PUBLIC_HOST' "$ROOT/deploy/docker/docker-compose.preview.yml" && pass "compose PREVIEW_PUBLIC_HOST" || fail "compose public host var missing"

# Env templates declare BFF keys
grep -q '^BFF_API_URL=' "$ROOT/deploy/env.preview" && pass "env.preview BFF key" || fail "env.preview BFF wrong"
grep -q '^BFF_API_URL=' "$ROOT/deploy/env.production" && pass "env.production BFF key" || fail "env.production BFF wrong"
grep -q '^TRENDS_DEPLOYMENT_ROLE=preview' "$ROOT/deploy/env.preview" && pass "env.preview role" || fail "env.preview role missing"
grep -q '^TRENDS_DEPLOYMENT_ROLE=production' "$ROOT/deploy/env.production" && pass "env.production role" || fail "env.production role missing"

# Upgrade hooks
grep -q 'search-freshness-gate' "$ROOT/deploy/preview-upgrade.sh" && pass "preview-upgrade invokes freshness gate" || fail "preview-upgrade missing gate"
grep -q 'run_search_freshness_gate_production' "$ROOT/scripts/install.sh" && pass "install.sh prod freshness gate" || fail "install.sh missing gate"
grep -q 'BFF_API_URL' "$ROOT/deploy/sync-preview-convex-env.sh" && pass "sync-preview-convex-env syncs BFF" || fail "sync missing BFF"
grep -q 'BFF_API_URL' "$ROOT/deploy/preview-doctor.sh" && pass "preview-doctor checks BFF" || fail "doctor missing BFF check"
grep -q 'BFF_API_URL' "$ROOT/deploy/systemd/trends-convex.service" && pass "prod systemd BFF default" || fail "systemd BFF missing"
grep -q 'lib-bff-defaults' "$ROOT/deploy/search-freshness-gate.sh" && pass "gate sources lib-bff-defaults" || fail "gate missing lib-bff-defaults"
grep -q 'default_bff_api_url_for_role\|preview_public_bff_url\|ensure_bff_env_lines' "$ROOT/deploy/preview-upgrade.sh" && pass "preview-upgrade uses bff helpers" || fail "preview-upgrade hardcodes BFF"
grep -q 'lib-bff-defaults\|default_bff_api_url_for_role\|ensure_bff_env_lines' "$ROOT/scripts/install.sh" && pass "install uses bff helpers" || fail "install hardcodes BFF"

# Helper scripts must not hardcode full public BFF URL outside lib-bff-defaults / env templates
for f in search-freshness-gate.sh sync-preview-convex-env.sh preview-upgrade.sh preview-doctor.sh; do
  if grep -nE 'https://preview\.pt-mes\.com|BFF_API_URL=https://' "$ROOT/deploy/$f" 2>/dev/null | grep -vE '^\s*#' | grep -q .; then
    # Allow only variable-based construction / comments
    if grep -nE 'BFF_API_URL=https://preview\.pt-mes\.com|defaulting to https://preview\.pt-mes\.com' "$ROOT/deploy/$f" | grep -vE '^\s*#' | grep -q .; then
      fail "$f still hardcodes preview public BFF URL"
    else
      pass "$f has no hard-coded BFF_API_URL=https://preview… assignment"
    fi
  else
    pass "$f has no hard-coded preview public BFF URL"
  fi
done

# Live bash helpers
PREV_BFF="$(preview_public_bff_url)"
PROD_BFF="$(production_loopback_bff_url)"
[[ "$PREV_BFF" == "https://${PREVIEW_PUBLIC_HOST}" ]] && pass "bash preview_public_bff_url ($PREV_BFF)" || fail "bash preview bff got $PREV_BFF"
[[ -n "$PROD_BFF" ]] && pass "bash production_loopback_bff_url ($PROD_BFF)" || fail "bash prod bff empty"
is_container_local_bff_url "$PROD_BFF" && pass "bash is_container_local_bff_url detects prod loopback" || fail "bash container-local detect failed"
! is_container_local_bff_url "$PREV_BFF" && pass "bash public preview is not container-local" || fail "bash public flagged as local"

# Live TS resolver via node (shipped function) — compare bash vs TS, no hard-coded expected host string
cd "$ROOT"
RESOLVED=$(node --import tsx -e 'import { resolveBffApiUrl, previewPublicBffOrigin, productionLoopbackBffUrl } from "./packages/shared/src/bff-api-url.ts"; console.log(JSON.stringify({ preview: resolveBffApiUrl({ TRENDS_DEPLOYMENT_ROLE: "preview" }), prod: resolveBffApiUrl({ TRENDS_DEPLOYMENT_ROLE: "production" }), previewOrigin: previewPublicBffOrigin(), prodLoop: productionLoopbackBffUrl() }))')
node --import tsx -e '
import { resolveBffApiUrl, previewPublicBffOrigin, productionLoopbackBffUrl, diagnoseBffApiUrl, isContainerLocalBffUrl, BFF_API_URL_DEFAULTS } from "./packages/shared/src/bff-api-url.ts";
const preview = resolveBffApiUrl({ TRENDS_DEPLOYMENT_ROLE: "preview" });
const prod = resolveBffApiUrl({ TRENDS_DEPLOYMENT_ROLE: "production" });
if (preview !== previewPublicBffOrigin()) throw new Error(`preview mismatch ${preview}`);
if (prod !== productionLoopbackBffUrl()) throw new Error(`prod mismatch ${prod}`);
if (!preview.startsWith("https://")) throw new Error("preview must be https");
if (isContainerLocalBffUrl(preview)) throw new Error("preview flagged container-local");
if (!isContainerLocalBffUrl(prod)) throw new Error("prod loopback not detected");
const bad = diagnoseBffApiUrl({ BFF_API_URL: productionLoopbackBffUrl(), TRENDS_DEPLOYMENT_ROLE: "preview" }, { role: "preview" });
if (bad.length === 0) throw new Error("diagnose should flag preview+prod-loopback");
const override = resolveBffApiUrl({ TRENDS_DEPLOYMENT_ROLE: "preview", PREVIEW_PUBLIC_HOST: "preview.example.test" });
if (override !== "https://preview.example.test") throw new Error(`override failed ${override}`);
console.log("ts_resolver_ok", { preview, prod, port: BFF_API_URL_DEFAULTS.productionApiPort });
' && pass "TS resolver + diagnose + PREVIEW_PUBLIC_HOST override" || fail "TS resolver checks failed"

# bash vs env alignment: default_bff_api_url_for_role matches env file value for preview
ENV_PREVIEW_BFF=$(grep -E '^BFF_API_URL=' "$ROOT/deploy/env.preview" | head -1 | cut -d= -f2-)
[[ "$ENV_PREVIEW_BFF" == "$(default_bff_api_url_for_role preview)" ]] && pass "env.preview BFF matches default_bff_api_url_for_role" || fail "env.preview BFF=$ENV_PREVIEW_BFF vs helper $(default_bff_api_url_for_role preview)"
ENV_PROD_BFF=$(grep -E '^BFF_API_URL=' "$ROOT/deploy/env.production" | head -1 | cut -d= -f2-)
[[ "$ENV_PROD_BFF" == "$(default_bff_api_url_for_role production)" ]] && pass "env.production BFF matches default_bff_api_url_for_role" || fail "env.production BFF=$ENV_PROD_BFF vs helper $(default_bff_api_url_for_role production)"

echo "=== search-freshness-gate behavioral (shipped gate entrypoint) ==="
# Behavioral: drive real gate script — bad container-local BFF must hard-fail exit 4.
# Do not pipe the gate (pipes mask exit codes). Capture rc only.
set +e
GATE_STRICT=1 SCHEDULE_REINGEST=0 \
  BFF_API_URL="http://localhost:${PROD_API_PORT}" \
  TRENDS_DEPLOYMENT_ROLE=preview \
  PREVIEW_DIR="/nonexistent-preview" \
  PREVIEW_ENV_FILE="/nonexistent.env" \
  bash "$ROOT/deploy/search-freshness-gate.sh" --role preview --api-url "$PREVIEW_API_URL" --workspace dev \
  >/dev/null 2>&1
BAD_RC=$?
set -e
[[ "$BAD_RC" -eq 4 ]] && pass "gate exit 4 on container-local BFF (got $BAD_RC)" || fail "gate should exit 4 on container-local BFF, got $BAD_RC"

set +e
GATE_STRICT=1 SCHEDULE_REINGEST=0 \
  BFF_API_URL="$(preview_public_bff_url)" \
  TRENDS_DEPLOYMENT_ROLE=preview \
  PREVIEW_DIR="/nonexistent-preview" \
  PREVIEW_ENV_FILE="/nonexistent.env" \
  bash "$ROOT/deploy/search-freshness-gate.sh" --role preview --api-url "$PREVIEW_API_URL" --workspace dev \
  >/dev/null 2>&1
GOOD_RC=$?
set -e
# Without password gate exits 0 after BFF check (skip doctor). Must not be 4.
[[ "$GOOD_RC" -ne 4 ]] && pass "gate does not exit 4 on public preview BFF (got $GOOD_RC)" || fail "public BFF should not exit 4, got $GOOD_RC"

# ensure_bff_env_lines repairs wrong container-local URL (upgrade repair path)
# Return codes: 0 unchanged, 1 added, 2 repaired
TMP_ENV="$(mktemp "${TMPDIR:-/tmp}/bff-env-XXXXXX")"
printf 'BFF_API_URL=http://localhost:%s\nOTHER=1\n' "$PROD_API_PORT" > "$TMP_ENV"
set +e
ensure_bff_env_lines "$TMP_ENV" preview
ENSURE_RC=$?
set -e
REPAIRED="$(read_bff_api_url_from_file "$TMP_ENV")"
[[ "$ENSURE_RC" -eq 2 && "$REPAIRED" == "$(preview_public_bff_url)" ]] \
  && pass "ensure_bff_env_lines rewrites container-local BFF (rc=$ENSURE_RC)" \
  || fail "ensure did not rewrite: rc=$ENSURE_RC value=$REPAIRED"
# Idempotent: second call on good value → rc 0
set +e
ensure_bff_env_lines "$TMP_ENV" preview
ENSURE_RC2=$?
set -e
[[ "$ENSURE_RC2" -eq 0 ]] && pass "ensure_bff_env_lines no-op when already correct (rc=0)" \
  || fail "ensure should be no-op rc=0, got $ENSURE_RC2"
rm -f "$TMP_ENV"

echo "=== upgrade/sync call sites always repair present-but-wrong BFF ==="
# preview-upgrade must always call ensure_bff_env_lines (not only when key missing)
if grep -nE 'if ! grep -q .?\^BFF_API_URL=' "$ROOT/deploy/preview-upgrade.sh" | grep -q ensure; then
  fail "preview-upgrade still gates ensure on missing-only"
else
  pass "preview-upgrade does not missing-only-gate ensure"
fi
grep -q 'ensure_bff_env_lines "\$PREVIEW_ENV_FILE" preview' "$ROOT/deploy/preview-upgrade.sh" \
  && pass "preview-upgrade always calls ensure_bff_env_lines" \
  || fail "preview-upgrade missing unconditional ensure_bff_env_lines"

# install.sh production path must always call ensure when env file exists (not only missing)
if grep -A6 'Ensure BFF_API_URL is present in live env\|Always ensure + repair BFF_API_URL' "$ROOT/scripts/install.sh" \
  | grep -qE 'if \[\[ -f "\$env_live" \]\] && ! grep -q'; then
  fail "install.sh still missing-only gates ensure_bff"
else
  pass "install.sh does not missing-only-gate ensure"
fi
grep -q 'ensure_bff_env_lines "\$env_live" production' "$ROOT/scripts/install.sh" \
  && pass "install.sh calls ensure_bff_env_lines for production env" \
  || fail "install.sh missing ensure_bff_env_lines"

# sync-preview must repair via ensure before convex env set
grep -q 'ensure_bff_env_lines "\$PREVIEW_ENV" preview' "$ROOT/deploy/sync-preview-convex-env.sh" \
  && pass "sync-preview-convex-env calls ensure_bff_env_lines" \
  || fail "sync missing ensure_bff_env_lines"
grep -q 'refusing to sync container-local BFF_API_URL' "$ROOT/deploy/sync-preview-convex-env.sh" \
  && pass "sync refuses container-local BFF push" \
  || fail "sync missing refuse container-local guard"

# Behavioral: upgrade-path simulation — present wrong key must become public origin
# (same helper preview-upgrade/install/sync now always invoke)
# ensure_bff returns 2 on repair — capture under set +e (set -e would abort)
UPG_ENV="$(mktemp "${TMPDIR:-/tmp}/bff-upg-XXXXXX")"
printf 'BFF_API_URL=http://127.0.0.1:%s\nTRENDS_DEPLOYMENT_ROLE=preview\n' "$PROD_API_PORT" > "$UPG_ENV"
set +e
ensure_bff_env_lines "$UPG_ENV" preview "$(default_bff_api_url_for_role preview)"
UPG_RC=$?
set -e
UPG_AFTER="$(read_bff_api_url_from_file "$UPG_ENV")"
[[ "$UPG_RC" -eq 2 && "$UPG_AFTER" == "$(preview_public_bff_url)" ]] \
  && pass "upgrade-path ensure rewrites present-but-wrong BFF ($UPG_AFTER rc=$UPG_RC)" \
  || fail "upgrade-path left wrong BFF: $UPG_AFTER rc=$UPG_RC"
rm -f "$UPG_ENV"

# Behavioral: sync refuse path — container-local value replaced with default before "push"
SYNC_VAL="http://localhost:${PROD_API_PORT}"
if is_container_local_bff_url "$SYNC_VAL"; then
  SYNC_PUSH="$(preview_public_bff_url)"
else
  SYNC_PUSH="$SYNC_VAL"
fi
[[ "$SYNC_PUSH" == "$(preview_public_bff_url)" ]] \
  && pass "sync refuse path maps container-local to public BFF" \
  || fail "sync refuse path failed: $SYNC_PUSH"

# set -u safe when BOOTSTRAP_ADMIN_USERS unset
set +e
unset BOOTSTRAP_ADMIN_USERS
GATE_STRICT=0 SCHEDULE_REINGEST=0 \
  BFF_API_URL="$(preview_public_bff_url)" \
  PREVIEW_ENV_FILE="/nonexistent.env" \
  bash "$ROOT/deploy/search-freshness-gate.sh" --role preview --workspace dev \
  >/dev/null 2>&1
UNSET_RC=$?
set -e
[[ "$UNSET_RC" -ne 1 ]] && pass "gate survives unset BOOTSTRAP_ADMIN_USERS (got $UNSET_RC)" || fail "gate crashed with unset BOOTSTRAP_ADMIN_USERS (exit $UNSET_RC)"

# Gate captures diagnose exit without the `if ! diagnose_bff` anti-pattern
# (comment may mention the anti-pattern — only flag active condition lines)
if grep -nE '^\s*if ! diagnose_bff' "$ROOT/deploy/search-freshness-gate.sh" | grep -q .; then
  fail "gate still uses if ! diagnose_bff (loses exit code)"
else
  pass "gate does not use if ! diagnose_bff"
fi
grep -q 'diag_rc=\$?' "$ROOT/deploy/search-freshness-gate.sh" && pass "gate captures diagnose_bff via diag_rc=\$?" || fail "diag_rc capture missing"
grep -q 'node_rc' "$ROOT/deploy/search-freshness-gate.sh" && pass "node diagnose returns via node_rc" || fail "node_rc path missing"

# Cursor-paced reingest + strict lag: prevent duplicate scheduling and greenwash
grep -q 'REINGEST_BATCH' "$ROOT/deploy/search-freshness-gate.sh" \
  && pass "gate paces reingest via REINGEST_BATCH" \
  || fail "gate missing REINGEST_BATCH paced reingest"
if grep -q 'REINGEST_PASSES' "$ROOT/deploy/search-freshness-gate.sh"; then
  fail "gate still caps cursor progress with REINGEST_PASSES"
else
  pass "gate derives paced calls from REINGEST_LIMIT"
fi
grep -q 'payload_obj\["cursor"\] = cursor' "$ROOT/deploy/search-freshness-gate.sh" \
  && pass "gate sends the server continuation cursor" \
  || fail "gate does not send the server continuation cursor"
grep -q 'next_cursor = out.get("cursor")' "$ROOT/deploy/search-freshness-gate.sh" \
  && pass "gate advances to the returned continuation cursor" \
  || fail "gate does not advance the continuation cursor"
grep -q 'if not out.get("hasMore"):' "$ROOT/deploy/search-freshness-gate.sh" \
  && pass "gate stops immediately at terminal hasMore=false" \
  || fail "gate does not stop immediately at terminal hasMore=false"
grep -q 'SCHEDULE_API_URL="$(preview_public_bff_url)"' "$ROOT/deploy/search-freshness-gate.sh" \
  && pass "preview authenticated scheduling uses public HTTPS for secure cookies" \
  || fail "preview authenticated scheduling still uses loopback HTTP"
grep -q 'python3 - "$SCHEDULE_API_URL"' "$ROOT/deploy/search-freshness-gate.sh" \
  && pass "gate passes the authenticated scheduling origin to the paced loop" \
  || fail "gate does not pass the authenticated scheduling origin"
grep -q 'lagScanFailed' "$ROOT/deploy/search-freshness-gate.sh" \
  && pass "gate schedules on lagScanFailed" \
  || fail "gate missing lagScanFailed schedule trigger"
# GATE_STRICT=1 must exit 2 on doctor rc 2 (not soft-exit 0 after schedule)
if grep -A20 'DOCTOR_RC.*-eq 2' "$ROOT/deploy/search-freshness-gate.sh" | grep -q 'exit 2'; then
  pass "gate GATE_STRICT path can exit 2 on compute lag"
else
  fail "gate no longer exits 2 under GATE_STRICT for doctor rc 2"
fi
# Golden query config: MY availability floor is semantic-only, CN remains high-volume
if grep -A16 'id: "my-cnc-sales-minRoleYears"' "$ROOT/packages/shared/src/ingest-compute-epoch.ts" | grep -q 'minTotalFloor: 1'; then
  pass "MY golden minTotalFloor is 1 under verified-only semantics"
else
  fail "MY golden minTotalFloor should be 1"
fi
if grep -A12 'id: "cn-cnc-sales-minRoleYears"' "$ROOT/packages/shared/src/ingest-compute-epoch.ts" | grep -q 'minTotalFloor: 100'; then
  pass "CN golden minTotalFloor remains 100"
else
  fail "CN golden minTotalFloor should remain 100"
fi
if grep -q '"mode": "compute"' "$ROOT/deploy/search-freshness-gate.sh"; then
  pass "gate schedules compute-only reingest"
else
  fail "gate should schedule compute-only reingest"
fi
if grep -q -- '--mode compute' "$ROOT/deploy/search-freshness-gate.sh"; then
  pass "gate manual instructions use --mode compute"
else
  fail "gate manual instructions should use --mode compute"
fi
if grep -q -- '--mode any' "$ROOT/deploy/search-freshness-gate.sh"; then
  fail "gate still references --mode any"
else
  pass "gate no longer references --mode any"
fi

echo "Summary: $FAIL failure(s)"
[[ "$FAIL" -eq 0 ]]
