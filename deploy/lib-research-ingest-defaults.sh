#!/usr/bin/env bash
# Shared research-ingest env defaults for deploy helper scripts.
# Source this file (after lib-preview-common.sh / lib-bff-defaults.sh or alone).
# Do not execute.
#
# Post-upgrade/install, a fresh (or previously-off) Trends tree should have
# research fetch scheduled without a desk click: Research Desk ingest is
# registered by apps/worker/scheduler.py only when RESEARCH_INGEST_ENABLED is
# truthy, and worker code defaults to the NewsNow URL in research_ports.py.
# This helper backfills the live env file for install/upgrade so the scheduler
# job is armed and the worker-api / status URL matches the deployment role.
#
# Kill-switch semantics: RESEARCH_INGEST_ENABLED=0 (or any other value) is
# never overwritten — only an ABSENT key becomes 1.
# shellcheck disable=SC2034

RESEARCH_INGEST_DEFAULT_NEWSNOW_URL="https://newsnow.busiyi.world/api/s"
RESEARCH_WORKER_PORT_PRODUCTION="${RESEARCH_WORKER_PORT_PRODUCTION:-8000}"
RESEARCH_WORKER_PORT_PREVIEW="${RESEARCH_WORKER_PORT_PREVIEW:-8003}"
RESEARCH_WORKER_LOOPBACK_HOST="${RESEARCH_WORKER_LOOPBACK_HOST:-127.0.0.1}"

# Normalize an env value (strip quotes/spaces)
_research_normalize_value() {
  local v="${1:-}"
  v="${v//\"/}"
  v="${v//\'/}"
  v="${v// /}"
  printf '%s' "$v"
}

# Port extracted from a worker URL, or empty if not a URL with a port
_research_worker_port() {
  local url="$1"
  case "$url" in
    http://*|https://*)
      local hostport
      hostport="${url#*://}"
      hostport="${hostport%%/*}"
      case "$hostport" in
        *:*) printf '%s' "${hostport##*:}" ;;
        *)   printf '' ;;
      esac
      ;;
    *) printf '' ;;
  esac
}

# True if a URL points at a loopback/host-local target (localhost or 127.0.0.x)
_is_loopback_worker_url() {
  local url="$1"
  case "$url" in
    http://localhost*|http://127.*|https://localhost*|https://127.*) return 0 ;;
    *) return 1 ;;
  esac
}

_research_worker_default_url() {
  local role="${1:-production}"
  case "$role" in
    preview) printf 'http://%s:%s' "$RESEARCH_WORKER_LOOPBACK_HOST" "$RESEARCH_WORKER_PORT_PREVIEW" ;;
    *)       printf 'http://%s:%s' "$RESEARCH_WORKER_LOOPBACK_HOST" "$RESEARCH_WORKER_PORT_PRODUCTION" ;;
  esac
}

# Ensure RESEARCH_INGEST_ENABLED / WORKER_URL / RESEARCH_HOTLIST_API_URL exist
# in an env file and match the deployment role. Idempotent; never overwrites an
# explicit RESEARCH_INGEST_ENABLED value; repairs only a wrong loopback-port
# WORKER_URL (leaves non-loopback URLs alone); only appends the NewsNow URL
# when RESEARCH_HOTLIST_API_URL is absent.
# Return codes (for operator logging): 0=unchanged, 1=changed, 2=missing file.
ensure_research_ingest_env_lines() {
  local env_file="$1"
  local role="${2:-production}"
  local changed=0
  [[ -f "$env_file" ]] || return 2

  local worker_default
  worker_default="$(_research_worker_default_url "$role")"

  # 1) RESEARCH_INGEST_ENABLED — only add when absent (respect explicit 0/kill-switch).
  if ! grep -q '^RESEARCH_INGEST_ENABLED=' "$env_file" 2>/dev/null; then
    {
      echo ""
      echo "# Research Desk native ingest: schedule apps.worker research_ingest job"
      echo "# (added by deploy/lib-research-ingest-defaults.sh). Set =0 to disable."
      echo "RESEARCH_INGEST_ENABLED=1"
    } >> "$env_file"
    changed=1
  fi

  # 2) WORKER_URL — add when absent; repair wrong loopback port; leave others.
  if ! grep -q '^WORKER_URL=' "$env_file" 2>/dev/null; then
    {
      echo ""
      echo "# Worker API base used by the BFF research service (loopback by role)"
      echo "WORKER_URL=${worker_default}"
    } >> "$env_file"
    changed=1
  else
    local existing
    existing="$(_research_normalize_value "$(grep -E '^WORKER_URL=' "$env_file" | head -1 | cut -d= -f2- || true)")"
    local existing_port
    existing_port="$(_research_worker_port "$existing")"
    local want_port
    case "$role" in
      preview) want_port="$RESEARCH_WORKER_PORT_PREVIEW" ;;
      *)       want_port="$RESEARCH_WORKER_PORT_PRODUCTION" ;;
    esac
    if _is_loopback_worker_url "$existing" && [[ -n "$existing_port" && "$existing_port" != "$want_port" ]]; then
      if sed -i.bak "s|^WORKER_URL=.*|WORKER_URL=${worker_default}|" "$env_file" 2>/dev/null; then
        rm -f "${env_file}.bak" 2>/dev/null || true
      else
        sed -i '' "s|^WORKER_URL=.*|WORKER_URL=${worker_default}|" "$env_file"
      fi
      changed=1
    fi
  fi

  # 3) RESEARCH_HOTLIST_API_URL — only add when absent (never overwrite a set URL).
  if ! grep -q '^RESEARCH_HOTLIST_API_URL=' "$env_file" 2>/dev/null; then
    {
      echo ""
      echo "# Research Desk NewsNow-compatible hotlist API (default upstream)"
      echo "RESEARCH_HOTLIST_API_URL=${RESEARCH_INGEST_DEFAULT_NEWSNOW_URL}"
    } >> "$env_file"
    changed=1
  fi

  chmod 600 "$env_file" 2>/dev/null || true
  return "$changed"
}
