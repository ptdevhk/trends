#!/usr/bin/env bash
set -euo pipefail

KEYWORD="${KEYWORD:-销售}"
SAMPLE="${SAMPLE:-sample-initial}"
CDP_PORT="${CDP_PORT:-9222}"
ALLOW_EMPTY="${ALLOW_EMPTY:-}"
LOCATION="${LOCATION:-}"

LOCATION_ARGS=()
if [[ -n "${LOCATION}" ]]; then
  LOCATION_ARGS=(--location "${LOCATION}")
fi

if ! curl -fsS "http://127.0.0.1:${CDP_PORT}/json" >/dev/null 2>&1; then
  echo "Error: Chrome not running with remote debugging on port ${CDP_PORT}."
  echo "Start Chrome with: --remote-debugging-port=${CDP_PORT}"
  echo "Or run: ./apps/browser-extension/scripts/cmux-setup-profile.sh"
  exit 1
fi

exec uv run python scripts/refresh-sample.py \
  --keyword "${KEYWORD}" \
  --sample "${SAMPLE}" \
  --port "${CDP_PORT}" \
  ${ALLOW_EMPTY:+--allow-empty} \
  "${LOCATION_ARGS[@]}"
