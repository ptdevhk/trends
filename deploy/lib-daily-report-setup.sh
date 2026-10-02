#!/usr/bin/env bash
# Shared sales-daily-report setup for deploy / CLI / doctor.
# Source this file (after lib-research-ingest-defaults.sh preferred). Do not execute.
#
# Contract (approved design):
#   - Persistent worker: RESEARCH_INGEST_ENABLED (and optional DAILY_REPORT_BUILD_ENABLED)
#     must be armed so apps.worker registers daily_report_build.
#   - First-time / empty Convex: one-shot POST backfill_days=7.
#   - Later deploys: ensure Shanghai-today exists; skip heavy backfill when dates present.
#   - Gates: setup/health fail closed; content one-shot warns unless GATE_STRICT=1.
#
# Return codes for run_daily_report_setup:
#   0 = ok (or content soft-fail when GATE_STRICT off)
#   1 = setup/health hard failure
#   2 = content one-shot failed under GATE_STRICT=1
#
# CALLER CONTRACT: capture non-zero with `|| rc=$?` (never set +e sandwich under set -E).
# shellcheck disable=SC2034

DAILY_REPORT_BFF_PORT_PRODUCTION="${DAILY_REPORT_BFF_PORT_PRODUCTION:-3000}"
DAILY_REPORT_BFF_PORT_PREVIEW="${DAILY_REPORT_BFF_PORT_PREVIEW:-3002}"
DAILY_REPORT_WORKER_PORT_PRODUCTION="${DAILY_REPORT_WORKER_PORT_PRODUCTION:-${RESEARCH_WORKER_PORT_PRODUCTION:-8000}}"
DAILY_REPORT_WORKER_PORT_PREVIEW="${DAILY_REPORT_WORKER_PORT_PREVIEW:-${RESEARCH_WORKER_PORT_PREVIEW:-8003}}"
DAILY_REPORT_LOOPBACK="${DAILY_REPORT_LOOPBACK:-${RESEARCH_WORKER_LOOPBACK_HOST:-127.0.0.1}}"

_daily_normalize() {
  local v="${1:-}"
  v="${v//\"/}"
  v="${v//\'/}"
  v="${v// /}"
  printf '%s' "$v"
}

_daily_truthy() {
  case "$(_daily_normalize "${1:-}")" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

_daily_role_ports() {
  local role="${1:-production}"
  case "$role" in
    preview)
      DAILY_BFF_PORT="$DAILY_REPORT_BFF_PORT_PREVIEW"
      DAILY_WORKER_PORT="$DAILY_REPORT_WORKER_PORT_PREVIEW"
      ;;
    *)
      DAILY_BFF_PORT="$DAILY_REPORT_BFF_PORT_PRODUCTION"
      DAILY_WORKER_PORT="$DAILY_REPORT_WORKER_PORT_PRODUCTION"
      ;;
  esac
}

# Shanghai calendar today (fixed +08:00; no DST).
daily_report_shanghai_today() {
  # Prefer GNU date; fall back to UTC+8 via TZ.
  TZ=Asia/Shanghai date +%F 2>/dev/null || date -u -d '+8 hours' +%F 2>/dev/null || date -u +%F
}

# Append DAILY_REPORT_BUILD_ENABLED=1 when absent. Never overwrite an explicit value.
# Returns 0=unchanged, 1=changed, 2=missing file (same convention as research-ingest ensure).
ensure_daily_report_build_env_lines() {
  local env_file="$1"
  local changed=0
  [[ -f "$env_file" ]] || return 2

  if ! grep -q '^DAILY_REPORT_BUILD_ENABLED=' "$env_file" 2>/dev/null; then
    {
      echo ""
      echo "# Sales daily report: schedule apps.worker daily_report_build job"
      echo "# (added by deploy/lib-daily-report-setup.sh). Set =0 to disable."
      echo "# When unset, worker also follows RESEARCH_INGEST_ENABLED."
      echo "DAILY_REPORT_BUILD_ENABLED=1"
    } >> "$env_file"
    changed=1
  fi

  chmod 600 "$env_file" 2>/dev/null || true
  return "$changed"
}

# Hard health: worker-api /health + BFF /daily/index.json must be 200.
# Prints STATUS lines on stdout; returns 0 ok / 1 fail.
daily_report_check_services() {
  local role="${1:-production}"
  local bff_base="${2:-}"
  local worker_base="${3:-}"
  _daily_role_ports "$role"
  if [[ -z "$bff_base" ]]; then
    bff_base="http://${DAILY_REPORT_LOOPBACK}:${DAILY_BFF_PORT}"
  fi
  if [[ -z "$worker_base" ]]; then
    worker_base="http://${DAILY_REPORT_LOOPBACK}:${DAILY_WORKER_PORT}"
  fi
  bff_base="${bff_base%/}"
  worker_base="${worker_base%/}"

  local worker_code bff_code
  worker_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${worker_base}/health" 2>/dev/null || echo 000)"
  bff_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "${bff_base}/daily/index.json" 2>/dev/null || echo 000)"

  echo "DAILY_HEALTH worker=${worker_base}/health code=${worker_code}"
  echo "DAILY_HEALTH bff=${bff_base}/daily/index.json code=${bff_code}"

  if [[ "$worker_code" != "200" ]]; then
    echo "DAILY_HEALTH_FAIL worker_api"
    return 1
  fi
  if [[ "$bff_code" != "200" ]]; then
    echo "DAILY_HEALTH_FAIL bff_daily_index"
    return 1
  fi
  return 0
}

# Read dates array length from /daily/index.json (0 on parse/network failure).
daily_report_index_date_count() {
  local bff_base="${1%/}"
  local body
  body="$(curl -sS --max-time 8 "${bff_base}/daily/index.json" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    echo 0
    return 0
  fi
  # Prefer python for reliable JSON; fall back to grep count of YYYY-MM-DD.
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  print(len(d.get("dates") or []))
except Exception:
  print(0)
' <<<"$body" 2>/dev/null || echo 0
  else
    echo "$body" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | wc -l | tr -d ' '
  fi
}

daily_report_index_has_date() {
  local bff_base="${1%/}"
  local want="$2"
  local body
  body="$(curl -sS --max-time 8 "${bff_base}/daily/index.json" 2>/dev/null || true)"
  [[ "$body" == *"$want"* ]]
}

# Wait for worker /health up to N attempts (5s each).
daily_report_wait_worker() {
  local worker_base="${1%/}"
  local attempts="${2:-24}"
  local i code=000
  for i in $(seq 1 "$attempts"); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${worker_base}/health" 2>/dev/null || echo 000)"
    [[ "$code" == "200" ]] && return 0
    sleep 5
  done
  return 1
}

# One-shot build: empty index → backfill 7; missing today → force today; else skip.
# Returns 0 on HTTP 200 / skip, 1 on failure.
daily_report_trigger_one_shot() {
  local worker_base="${1%/}"
  local bff_base="${2%/}"
  local today
  today="$(daily_report_shanghai_today)"
  local count
  count="$(daily_report_index_date_count "$bff_base")"
  local payload http_code

  if [[ "${count:-0}" -eq 0 ]]; then
    echo "DAILY_ONE_SHOT mode=backfill_days:7 reason=empty_index today=$today"
    payload="{\"force\":true,\"backfill_days\":7}"
  elif ! daily_report_index_has_date "$bff_base" "$today"; then
    echo "DAILY_ONE_SHOT mode=force_today date=$today reason=today_missing"
    payload="{\"date\":\"${today}\",\"force\":true}"
  else
    echo "DAILY_ONE_SHOT mode=skip reason=today_present date=$today count=$count"
    return 0
  fi

  http_code="$(curl -sS -o /tmp/daily-report-oneshot.json -w '%{http_code}' --max-time 900 \
    -X POST "${worker_base}/worker/research/daily-report" \
    -H 'Content-Type: application/json' \
    -d "$payload" 2>/dev/null || echo 000)"

  echo "DAILY_ONE_SHOT http=$http_code"
  if [[ "$http_code" == "200" ]]; then
    return 0
  fi
  return 1
}

# Full setup gate used by install/preview-upgrade/CLI.
# Args: role [bff_base] [worker_base] [env_file]
# Env: GATE_STRICT=0|1 (default 0 for content; callers may set 1)
run_daily_report_setup() {
  local role="${1:-production}"
  local bff_base="${2:-}"
  local worker_base="${3:-}"
  local env_file="${4:-}"
  local strict="${GATE_STRICT:-0}"

  _daily_role_ports "$role"
  if [[ -z "$bff_base" ]]; then
    bff_base="http://${DAILY_REPORT_LOOPBACK}:${DAILY_BFF_PORT}"
  fi
  if [[ -z "$worker_base" ]]; then
    worker_base="http://${DAILY_REPORT_LOOPBACK}:${DAILY_WORKER_PORT}"
  fi
  bff_base="${bff_base%/}"
  worker_base="${worker_base%/}"

  # Env kill-switch: if both ingest and daily are explicitly off, skip soft.
  if [[ -n "$env_file" && -f "$env_file" ]]; then
    local ingest_flag daily_flag
    ingest_flag="$(_daily_normalize "$(grep -E '^RESEARCH_INGEST_ENABLED=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- || true)")"
    daily_flag="$(_daily_normalize "$(grep -E '^DAILY_REPORT_BUILD_ENABLED=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- || true)")"
    if [[ "$daily_flag" == "0" || "$daily_flag" == "false" || "$daily_flag" == "off" || "$daily_flag" == "no" ]]; then
      if [[ "$ingest_flag" == "0" || "$ingest_flag" == "false" || "$ingest_flag" == "off" || "$ingest_flag" == "no" ]]; then
        echo "DAILY_SETUP skipped (DAILY_REPORT_BUILD_ENABLED + RESEARCH_INGEST_ENABLED kill-switch)"
        return 0
      fi
    fi
  fi

  if ! daily_report_wait_worker "$worker_base" 24; then
    echo "DAILY_SETUP_FAIL worker_not_ready"
    return 1
  fi

  if ! daily_report_check_services "$role" "$bff_base" "$worker_base"; then
    echo "DAILY_SETUP_FAIL health"
    return 1
  fi

  if daily_report_trigger_one_shot "$worker_base" "$bff_base"; then
    # Re-check today when we attempted a build
    local today
    today="$(daily_report_shanghai_today)"
    if daily_report_index_has_date "$bff_base" "$today"; then
      echo "DAILY_SETUP_OK today=$today"
      return 0
    fi
    # Skip path already returned 0 from trigger; index may already have today
    local count
    count="$(daily_report_index_date_count "$bff_base")"
    if [[ "${count:-0}" -gt 0 ]] && daily_report_index_has_date "$bff_base" "$today"; then
      echo "DAILY_SETUP_OK today=$today"
      return 0
    fi
    if [[ "${count:-0}" -gt 0 ]]; then
      # Built something but today still missing (thin day / clock) — soft unless strict
      echo "DAILY_SETUP_WARN today_missing_after_oneshot today=$today count=$count"
      if _daily_truthy "$strict"; then
        return 2
      fi
      return 0
    fi
    echo "DAILY_SETUP_WARN empty_after_oneshot"
    if _daily_truthy "$strict"; then
      return 2
    fi
    return 0
  fi

  echo "DAILY_SETUP_WARN oneshot_failed"
  if _daily_truthy "$strict"; then
    return 2
  fi
  return 0
}
