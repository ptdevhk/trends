#!/usr/bin/env bash
# CLI: arm + health-check + first-time/empty daily-report one-shot.
#
# Usage:
#   bash deploy/daily-report-setup.sh [--role production|preview] [--strict]
#   bash deploy/daily-report-setup.sh --ensure-env-only --env-file /etc/trends/env
#
# Exit: 0 ok / soft content warn; 1 setup/health fail; 2 content fail under --strict / GATE_STRICT=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/deploy/lib-research-ingest-defaults.sh"
# shellcheck disable=SC1091
source "$ROOT/deploy/lib-daily-report-setup.sh"

ROLE="production"
ENV_FILE=""
BFF_BASE=""
WORKER_BASE=""
ENSURE_ENV_ONLY=0
STRICT="${GATE_STRICT:-0}"

usage() {
  cat <<'EOF'
Usage: deploy/daily-report-setup.sh [options]

  --role production|preview   Deployment role (default: production)
  --env-file PATH             Live env to arm (prod default /etc/trends/env;
                              preview default <repo>/.env.preview when role=preview)
  --bff-url URL               BFF base (default role loopback)
  --worker-url URL            Worker API base (default role loopback)
  --ensure-env-only           Only write missing RESEARCH_INGEST / DAILY_REPORT flags
  --strict                    Fail (exit 2) when content one-shot does not land today
  -h, --help                  Show help

Env: GATE_STRICT=1 same as --strict.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --bff-url) BFF_BASE="${2:-}"; shift 2 ;;
    --worker-url) WORKER_BASE="${2:-}"; shift 2 ;;
    --ensure-env-only) ENSURE_ENV_ONLY=1; shift ;;
    --strict) STRICT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 1 ;;
  esac
done

case "$ROLE" in
  production|preview) ;;
  *) echo "Invalid --role $ROLE" >&2; exit 1 ;;
esac

if [[ -z "$ENV_FILE" ]]; then
  if [[ "$ROLE" == "preview" ]]; then
    ENV_FILE="${PREVIEW_ENV_FILE:-$ROOT/.env.preview}"
  else
    ENV_FILE="${CONFIG_DIR:-/etc/trends}/env"
  fi
fi

echo "== daily-report-setup role=$ROLE env=$ENV_FILE =="

if [[ -f "$ENV_FILE" ]]; then
  ensure_rc=0
  ensure_research_ingest_env_lines "$ENV_FILE" "$ROLE" || ensure_rc=$?
  case "$ensure_rc" in
    0) echo "env ensure: already present" ;;
    1) echo "env ensure: added/repaired research + daily flags" ;;
    *) echo "env ensure: skipped rc=$ensure_rc" ;;
  esac
  # Belt: daily flag even if research ensure path skipped daily lib somehow
  daily_rc=0
  ensure_daily_report_build_env_lines "$ENV_FILE" || daily_rc=$?
  case "$daily_rc" in
    0) ;;
    1) echo "env ensure: added DAILY_REPORT_BUILD_ENABLED=1" ;;
  esac
else
  echo "WARN: env file missing: $ENV_FILE (skip arm)" >&2
fi

if [[ "$ENSURE_ENV_ONLY" -eq 1 ]]; then
  exit 0
fi

export GATE_STRICT="$STRICT"
rc=0
run_daily_report_setup "$ROLE" "$BFF_BASE" "$WORKER_BASE" "$ENV_FILE" || rc=$?
case "$rc" in
  0) echo "daily-report-setup: OK"; exit 0 ;;
  1) echo "daily-report-setup: HEALTH/SETUP FAILED" >&2; exit 1 ;;
  2) echo "daily-report-setup: CONTENT FAILED (strict)" >&2; exit 2 ;;
  *) echo "daily-report-setup: unexpected rc=$rc" >&2; exit "$rc" ;;
esac
