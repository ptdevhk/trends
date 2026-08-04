#!/usr/bin/env bash
# Post-upgrade / post-migration search-data freshness gate.
#
# Code deploy does not recompute role years. This gate:
#   1) Sanity-checks BFF_API_URL for the deployment role (preview Docker vs prod host)
#   2) Runs search-freshness doctor (compute lag + golden availability / semantic checks)
#   3) Optionally schedules bounded compute reingest when lag is detected
#
# Exit codes (aligned with scripts/search-data-freshness-doctor.ts):
#   0 — ok
#   2 — compute-stale rows above threshold (repair scheduled or needed)
#   3 — golden query availability or semantic check failed
#   1 — auth/request/config error
#   4 — BFF URL misconfiguration for this role
#
# Usage:
#   bash deploy/search-freshness-gate.sh --role preview
#   bash deploy/search-freshness-gate.sh --role production --api-url "$PROD_API_URL"
#
# Env:
#   TRENDS_AUTH_USERNAME / TRENDS_AUTH_PASSWORD  (or AUTH_BOOTSTRAP_PASSWORD + admin user)
#   TRENDS_WORKSPACE (default: dev)
#   PREVIEW_API_URL / PROD_API_URL / PREVIEW_PUBLIC_HOST (see deploy/lib-bff-defaults.sh)
#   SCHEDULE_REINGEST=1   schedule bounded compute reingest when lag (default 1 on fail path when admin)
#   REINGEST_LIMIT=200    total rows to schedule across all paced batches
#   REINGEST_BATCH=25     rows per paced trigger-reingest call (capacity-safe for 8 GiB Convex)
#   REINGEST_SLEEP_SECS=8 seconds between paced calls (prevents Convex OOM on large cloned datasets)
#   SKIP_GOLDEN=0
#   GATE_STRICT=1         fail the calling upgrade when exit != 0 (default 1)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh" 2>/dev/null || true
# shellcheck source=lib-bff-defaults.sh
source "$SCRIPT_DIR/lib-bff-defaults.sh"

ROLE=""
API_URL=""
WORKSPACE="${TRENDS_WORKSPACE:-dev}"
SCAN_LIMIT="${SCAN_LIMIT:-200}"
REINGEST_LIMIT="${REINGEST_LIMIT:-200}"
REINGEST_BATCH="${REINGEST_BATCH:-25}"
REINGEST_SLEEP_SECS="${REINGEST_SLEEP_SECS:-8}"
SCHEDULE_REINGEST="${SCHEDULE_REINGEST:-1}"
SKIP_GOLDEN="${SKIP_GOLDEN:-0}"
GATE_STRICT="${GATE_STRICT:-1}"
JSON_OUT="${JSON_OUT:-}"

usage() {
  sed -n '2,29p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="${2:-}"; shift 2 ;;
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    --scan-limit) SCAN_LIMIT="${2:-}"; shift 2 ;;
    --reingest-limit) REINGEST_LIMIT="${2:-}"; shift 2 ;;
    --reingest-batch) REINGEST_BATCH="${2:-}"; shift 2 ;;
    --reingest-sleep) REINGEST_SLEEP_SECS="${2:-}"; shift 2 ;;
    --no-schedule) SCHEDULE_REINGEST=0; shift ;;
    --skip-golden) SKIP_GOLDEN=1; shift ;;
    --json) JSON_OUT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$ROLE" ]]; then
  echo "error: --role preview|production required" >&2
  exit 1
fi
if [[ -z "$API_URL" ]]; then
  if [[ "$ROLE" == "preview" ]]; then
    API_URL="${PREVIEW_API_URL}"
  else
    API_URL="${PROD_API_URL}"
  fi
fi

# Preview auth cookies are Secure, so protected scheduling calls must use the
# public HTTPS origin even when the read-only doctor uses host loopback.
SCHEDULE_API_URL="$API_URL"
if [[ "$ROLE" == "preview" ]]; then
  SCHEDULE_API_URL="$(preview_public_bff_url)"
fi

log() { printf '[search-freshness-gate] %s\n' "$*"; }
warn() { printf '[search-freshness-gate] WARN: %s\n' "$*" >&2; }
err() { printf '[search-freshness-gate] ERROR: %s\n' "$*" >&2; }

# --- BFF URL sanity (node one-liner using shipped shared module when available) ---
diagnose_bff() {
  local env_file="${1:-}"
  if [[ -n "$env_file" && -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file" 2>/dev/null || true
    set +a
  fi
  # Role/host from CLI/common-lib win over env file (file may lack role).
  export TRENDS_DEPLOYMENT_ROLE="$ROLE"
  export PREVIEW_PUBLIC_HOST="${PREVIEW_PUBLIC_HOST}"
  export PROD_PUBLIC_HOST="${PROD_PUBLIC_HOST}"

  if [[ -f "$REPO_ROOT/packages/shared/dist/bff-api-url.js" ]] || [[ -f "$REPO_ROOT/packages/shared/src/bff-api-url.ts" ]]; then
    local node_rc=0
    set +e
    node --import tsx -e '
import { resolveBffApiUrl, diagnoseBffApiUrl } from "@trends/shared";
const role = process.env.TRENDS_DEPLOYMENT_ROLE || "";
const resolved = resolveBffApiUrl(process.env);
const issues = diagnoseBffApiUrl(process.env, { role });
console.log(JSON.stringify({ resolved, issues, role }, null, 2));
process.exit(issues.length ? 4 : 0);
' 2>/dev/null
    node_rc=$?
    set -e
    # 0 = ok, 4 = BFF misconfig — return immediately. Other codes fall through to shell.
    if [[ "$node_rc" -eq 0 || "$node_rc" -eq 4 ]]; then
      return "$node_rc"
    fi
  fi

  # Fallback without package resolution: shell helpers only (lib-bff-defaults)
  local bff="${BFF_API_URL:-${TRENDS_BFF_API_URL:-}}"
  local recommended
  recommended="$(default_bff_api_url_for_role "$ROLE")"
  if [[ "$ROLE" == "preview" ]]; then
    if [[ -z "$bff" ]]; then
      warn "BFF_API_URL unset for preview — Convex Docker will mis-target container loopback unless TRENDS_DEPLOYMENT_ROLE=preview is set in Convex env (recommended: ${recommended})"
      return 0
    fi
    if is_container_local_bff_url "$bff"; then
      err "Preview BFF_API_URL=$bff is container-local; set ${recommended}"
      return 4
    fi
  fi
  if [[ -z "$bff" && "$ROLE" == "production" ]]; then
    warn "BFF_API_URL unset for production — defaulting to ${recommended} (set explicitly in env file)"
  fi
  return 0
}

ENV_FILE=""
if [[ "$ROLE" == "preview" ]]; then
  ENV_FILE="${PREVIEW_ENV_FILE:-${PREVIEW_DIR}/.env.preview}"
elif [[ -f /etc/trends/env ]]; then
  ENV_FILE=/etc/trends/env
fi

log "role=$ROLE api=$API_URL workspace=$WORKSPACE"
# Do not use `if ! diagnose_bff` — bash `!` clears $? so exit 4 is lost.
diag_rc=0
set +e
diagnose_bff "$ENV_FILE"
diag_rc=$?
set -e
if [[ "$diag_rc" -eq 4 ]]; then
  err "BFF URL misconfiguration — fix BFF_API_URL before reingest will work"
  exit 4
fi

# Resolve credentials
if [[ -z "${TRENDS_AUTH_USERNAME:-}" || -z "${TRENDS_AUTH_PASSWORD:-}" ]]; then
  if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE" 2>/dev/null || true
    set +a
  fi
  if [[ -z "${TRENDS_AUTH_USERNAME:-}" ]]; then
    # ${var%%,*} with unset var fails under set -u — expand with default first.
    TRENDS_AUTH_USERNAME="${BOOTSTRAP_ADMIN_USERS:-}"
    TRENDS_AUTH_USERNAME="${TRENDS_AUTH_USERNAME%%,*}"
    TRENDS_AUTH_USERNAME="${TRENDS_AUTH_USERNAME:-admin}"
  fi
  if [[ -z "${TRENDS_AUTH_PASSWORD:-}" ]]; then
    TRENDS_AUTH_PASSWORD="${AUTH_BOOTSTRAP_PASSWORD:-}"
  fi
fi

if [[ -z "${TRENDS_AUTH_PASSWORD:-}" ]]; then
  # BFF already checked above; missing auth only skips live doctor.
  warn "No admin password available — skipping live doctor (BFF config still checked)"
  exit 0
fi

DOCTOR="$REPO_ROOT/scripts/search-data-freshness-doctor.ts"
if [[ ! -f "$DOCTOR" ]]; then
  # Host preview tree path
  if [[ -f "${PREVIEW_DIR:-}/scripts/search-data-freshness-doctor.ts" ]]; then
    DOCTOR="${PREVIEW_DIR}/scripts/search-data-freshness-doctor.ts"
  elif [[ -f /opt/trends/scripts/search-data-freshness-doctor.ts ]]; then
    DOCTOR=/opt/trends/scripts/search-data-freshness-doctor.ts
  fi
fi

DOCTOR_ARGS=(--api-url "$API_URL" --workspace "$WORKSPACE" --username "$TRENDS_AUTH_USERNAME" --password "$TRENDS_AUTH_PASSWORD" --scan-limit "$SCAN_LIMIT")
if [[ "$SKIP_GOLDEN" == "1" ]]; then
  DOCTOR_ARGS+=(--skip-golden)
fi
DOCTOR_ARGS+=(--json)

set +e
DOCTOR_OUT="$(cd "$(dirname "$DOCTOR")/.." && TRENDS_AUTH_USERNAME="$TRENDS_AUTH_USERNAME" TRENDS_AUTH_PASSWORD="$TRENDS_AUTH_PASSWORD" \
  npx tsx "$DOCTOR" "${DOCTOR_ARGS[@]}" 2>&1)"
DOCTOR_RC=$?
set -e

if [[ -n "$JSON_OUT" ]]; then
  printf '%s\n' "$DOCTOR_OUT"
else
  log "doctor exit=$DOCTOR_RC"
  printf '%s\n' "$DOCTOR_OUT" | head -c 4000
  echo
fi

# Schedule reingest on lag (exit 2) or when JSON says computeStale / lagScanFailed
should_schedule=0
if [[ "$SCHEDULE_REINGEST" == "1" ]]; then
  if [[ "$DOCTOR_RC" -eq 2 ]]; then
    should_schedule=1
  elif echo "$DOCTOR_OUT" | grep -q '"lagScanFailed": true'; then
    should_schedule=1
  elif echo "$DOCTOR_OUT" | grep -q '"computeStale": [1-9]'; then
    should_schedule=1
  elif echo "$DOCTOR_OUT" | grep -q '"missingEpoch": [1-9]'; then
    should_schedule=1
  fi
fi

# Cursor-continuation batches + inter-batch sleep avoid Convex overload while
# ensuring each paced call advances past the rows scheduled by the prior call.
# Defaults are set at the top of the script (REINGEST_BATCH=25, REINGEST_SLEEP_SECS=8)
# and can be overridden via env or --reingest-batch / --reingest-sleep CLI flags.

if [[ "$should_schedule" -eq 1 ]]; then
  log "Scheduling cursor-paced compute reingest limit=$REINGEST_LIMIT batch=$REINGEST_BATCH (mode=compute)"
  # Use API trigger-reingest as admin — paced to keep Convex healthy
  python3 - "$SCHEDULE_API_URL" "$WORKSPACE" "$TRENDS_AUTH_USERNAME" "$TRENDS_AUTH_PASSWORD" \
    "$REINGEST_LIMIT" "$REINGEST_BATCH" "$REINGEST_SLEEP_SECS" <<'PY' || warn "reingest schedule failed"
import json, sys, time, urllib.request, http.cookiejar
api, ws, user, pw, limit_s, batch_s, sleep_s = sys.argv[1:8]
limit = int(limit_s)
batch = max(1, min(int(batch_s), limit))
sleep_secs = max(0, float(sleep_s))
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req = urllib.request.Request(
    api.rstrip("/") + "/api/auth/login",
    data=json.dumps({"username": user, "password": pw}).encode(),
    headers={"Content-Type": "application/json", "X-Workspace-Slug": ws},
    method="POST",
)
with opener.open(req, timeout=30) as r:
    body = json.loads(r.read().decode())
if not body.get("success"):
    print("login failed", body, file=sys.stderr)
    sys.exit(1)
csrf = body.get("csrfToken") or ""
scheduled_total = 0
remaining = limit
cursor = None
call_count = 0
while remaining > 0:
    call_count += 1
    n = min(batch, remaining)
    payload_obj = {"limit": n, "mode": "compute", "dryRun": False}
    if cursor is not None:
        payload_obj["cursor"] = cursor
    payload = json.dumps(payload_obj).encode()
    req = urllib.request.Request(
        api.rstrip("/") + "/api/resumes/trigger-reingest",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Workspace-Slug": ws,
            "X-CSRF-Token": csrf,
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with opener.open(req, timeout=180) as r:
            out = json.loads(r.read().decode())
        sched = int(out.get("scheduled") or 0)
        scheduled_total += sched
        remaining -= sched
        print(f"call {call_count}: scheduled={sched} matched={out.get('matchedCount')} hasMore={out.get('hasMore')}")
        if not out.get("hasMore"):
            break
        next_cursor = out.get("cursor")
        if not isinstance(next_cursor, str) or not next_cursor or next_cursor == cursor:
            print("trigger-reingest returned hasMore without a new cursor", file=sys.stderr)
            break
        cursor = next_cursor
    except Exception as e:
        print("trigger-reingest error:", e, file=sys.stderr)
        # Do not hard-fail the whole gate on one overloaded batch — caller still sees doctor rc
        break
    if sleep_secs and remaining > 0:
        time.sleep(sleep_secs)
print(f"total_scheduled={scheduled_total}")
if scheduled_total == 0 and remaining == limit:
    sys.exit(1)
PY
  log "Reingest scheduled (background, paced). Re-run this gate after compute settles."
  log "Manual: trends resume debug trigger-reingest --mode compute --limit $REINGEST_LIMIT --api-url $SCHEDULE_API_URL --workspace $WORKSPACE"
fi

if [[ "$DOCTOR_RC" -eq 3 ]]; then
  err "Golden availability / semantic checks failed — sampled results are missing verified direct role evidence or fell below the expected floor."
  err "Repair: ensure BFF_API_URL reachable from Convex, then paced reingest:"
  err "  trends resume debug trigger-reingest --mode compute --limit $REINGEST_LIMIT --api-url $API_URL"
  err "  (or re-run this gate; it schedules cursor-paced REINGEST_BATCH calls with sleep)"
  if [[ "$GATE_STRICT" == "1" ]]; then
    exit 3
  fi
fi

if [[ "$DOCTOR_RC" -eq 2 ]]; then
  warn "Compute-stale rows or lag-scan failure — reingest scheduled or required"
  # Scheduling alone is not parity. When GATE_STRICT=1, fail so upgrade cannot
  # claim green while MY minRoleYears still under-repairs (historical false green).
  if [[ "$GATE_STRICT" == "1" ]]; then
    err "GATE_STRICT=1 — exit 2 until doctor returns 0 after reingest drains"
    exit 2
  fi
  if [[ "$SCHEDULE_REINGEST" == "1" ]]; then
    log "GATE_STRICT=0 — upgrade may complete; re-check golden floors after reingest drains"
    exit 0
  fi
  log "GATE_STRICT=0 — treating compute lag as non-fatal"
  exit 0
fi

if [[ "$DOCTOR_RC" -ne 0 ]]; then
  err "Doctor failed with exit $DOCTOR_RC"
  if [[ "$GATE_STRICT" == "1" ]]; then
    exit "$DOCTOR_RC"
  fi
  log "GATE_STRICT=0 — treating doctor exit $DOCTOR_RC as non-fatal"
fi

log "Search freshness gate OK"
exit 0
