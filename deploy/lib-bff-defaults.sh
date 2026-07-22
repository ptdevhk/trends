#!/usr/bin/env bash
# Shared BFF host/port defaults for deploy helper scripts.
# Source after lib-preview-common.sh (or alone). Do not execute.
#
# All preview/prod BFF URLs for helpers should come from here so scripts do not
# hard-code hosts/ports. Override via env (PREVIEW_PUBLIC_HOST, PROD_API_URL, …).
# shellcheck disable=SC2034

# Align with packages/shared/src/bff-api-url.ts BFF_API_URL_DEFAULTS
: "${PROD_PUBLIC_HOST:=trends.pt-mes.com}"
: "${PREVIEW_PUBLIC_HOST:=preview.pt-mes.com}"
: "${PROD_API_PORT:=3000}"
: "${PREVIEW_API_PORT:=3002}"
: "${LOOPBACK_HOST:=127.0.0.1}"

# Prefer existing common-lib URLs when already set
: "${PROD_API_URL:=http://${LOOPBACK_HOST}:${PROD_API_PORT}}"
: "${PREVIEW_API_URL:=http://${LOOPBACK_HOST}:${PREVIEW_API_PORT}}"

# Public HTTPS origin for Docker Convex → host BFF (Caddy)
preview_public_bff_url() {
  printf 'https://%s' "${PREVIEW_PUBLIC_HOST}"
}

# Host loopback BFF for production Convex (systemd on same host)
production_loopback_bff_url() {
  printf '%s' "${PROD_API_URL}"
}

# Default BFF_API_URL for a deployment role
default_bff_api_url_for_role() {
  local role="${1:-}"
  case "$role" in
    preview) preview_public_bff_url ;;
    production|prod) production_loopback_bff_url ;;
    *) production_loopback_bff_url ;;
  esac
}

# Strip quotes/spaces from an env value
_normalize_env_value() {
  local v="${1:-}"
  v="${v//\"/}"
  v="${v//\'/}"
  v="${v// /}"
  printf '%s' "$v"
}

# Read BFF_API_URL from an env file (empty if missing)
read_bff_api_url_from_file() {
  local env_file="${1:-}"
  [[ -f "$env_file" ]] || { printf ''; return 0; }
  local raw
  raw="$(grep -E '^BFF_API_URL=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  _normalize_env_value "$raw"
}

# True if URL is container-local loopback on production API port (or bare loopback).
# That pattern is wrong for preview Docker Convex (must use public HTTPS origin).
is_container_local_bff_url() {
  local url
  url="$(_normalize_env_value "${1:-}")"
  [[ -z "$url" ]] && return 1
  case "$url" in
    http://localhost|"http://localhost/"|http://127.0.0.1|"http://127.0.0.1/")
      return 0
      ;;
    "http://localhost:${PROD_API_PORT}"|"http://localhost:${PROD_API_PORT}/"|\
    "http://127.0.0.1:${PROD_API_PORT}"|"http://127.0.0.1:${PROD_API_PORT}/"|\
    "https://localhost:${PROD_API_PORT}"|"https://127.0.0.1:${PROD_API_PORT}")
      return 0
      ;;
  esac
  return 1
}

# Rewrite BFF_API_URL= line in place (GNU sed + BSD sed).
_rewrite_bff_api_url_line() {
  local env_file="$1"
  local bff_url="$2"
  if sed -i.bak "s|^BFF_API_URL=.*|BFF_API_URL=${bff_url}|" "$env_file" 2>/dev/null; then
    rm -f "${env_file}.bak" 2>/dev/null || true
    return 0
  fi
  sed -i '' "s|^BFF_API_URL=.*|BFF_API_URL=${bff_url}|" "$env_file"
}

# Ensure BFF_API_URL / TRENDS_DEPLOYMENT_ROLE exist; rewrite container-local misconfig.
# Return codes (for operator logging): 0=unchanged, 1=added, 2=repaired.
ensure_bff_env_lines() {
  local env_file="$1"
  local role="$2"
  local bff_url="${3:-}"
  local existing=""
  [[ -f "$env_file" ]] || return 1
  if [[ -z "$bff_url" ]]; then
    bff_url="$(default_bff_api_url_for_role "$role")"
  fi
  if ! grep -q '^BFF_API_URL=' "$env_file" 2>/dev/null; then
    {
      echo ""
      echo "# Convex→host BFF (from deploy/lib-bff-defaults.sh; do not use container localhost)"
      echo "BFF_API_URL=${bff_url}"
      echo "TRENDS_DEPLOYMENT_ROLE=${role}"
    } >> "$env_file"
    return 1
  fi
  existing="$(read_bff_api_url_from_file "$env_file")"
  # Preview misconfig only: container-local loopback on prod port.
  # Skip no-op rewrite when already the desired URL (incl. production loopback).
  if is_container_local_bff_url "$existing" && [[ "$existing" != "$bff_url" ]]; then
    _rewrite_bff_api_url_line "$env_file" "$bff_url"
    if ! grep -q '^TRENDS_DEPLOYMENT_ROLE=' "$env_file" 2>/dev/null; then
      echo "TRENDS_DEPLOYMENT_ROLE=${role}" >> "$env_file"
    fi
    return 2
  fi
  if ! grep -q '^TRENDS_DEPLOYMENT_ROLE=' "$env_file" 2>/dev/null; then
    echo "TRENDS_DEPLOYMENT_ROLE=${role}" >> "$env_file"
  fi
  return 0
}
