#!/usr/bin/env bash
# Associative arrays need Bash 4+. On macOS, /usr/bin/env bash is often 3.2 when
# Homebrew is missing from PATH (GUI apps, minimal make envs). Re-exec if needed.
if [ -z "${BASH_VERSION:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  for _bash_candidate in /opt/homebrew/bin/bash /usr/local/bin/bash; do
    if [ -x "$_bash_candidate" ]; then
      exec "$_bash_candidate" "$0" "$@"
    fi
  done
  echo "error: this script requires Bash 4+ (found ${BASH_VERSION:-non-bash})." >&2
  echo "Install with: brew install bash" >&2
  exit 1
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

hash_path() {
  local input="$1"
  if command -v md5sum >/dev/null 2>&1; then
    printf '%s' "$input" | md5sum | awk '{print $1}' | cut -c1-8
  elif command -v md5 >/dev/null 2>&1; then
    printf '%s' "$input" | md5 | awk '{print $NF}' | cut -c1-8
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$input" | shasum -a 256 | awk '{print $1}' | cut -c1-8
  else
    printf '%s' "nohash"
  fi
}

PROJECT_HASH="$(hash_path "$PROJECT_ROOT")"
LOCKFILE="/tmp/dev-server-${PROJECT_HASH}.lock"
LOCKDIR="/tmp/dev-server-${PROJECT_HASH}.lockdir"
PIDFILE="/tmp/dev-server-${PROJECT_HASH}.pid"
PATHFILE="/tmp/dev-server-${PROJECT_HASH}.path"

PORTS=(
  "${CONVEX_PORT:-3210}"
  "${MCP_PORT:-3333}"
  "${TRENDS_WORKER_PORT:-8000}"
  "${API_PORT:-3000}"
  "${WEB_PORT:-5173}"
)

declare -A TARGET_PIDS=()

cleanup_lock_artifacts() {
  rm -f "$LOCKFILE" "$PIDFILE" "$PATHFILE" 2>/dev/null || true
  rm -rf "$LOCKDIR" 2>/dev/null || true
}

add_pid() {
  local pid="$1"
  if [[ -z "${pid:-}" ]]; then
    return
  fi
  if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
    return
  fi
  if [ "$pid" -le 1 ] || [ "$pid" -eq "$$" ]; then
    return
  fi
  TARGET_PIDS["$pid"]=1
}

list_child_pids() {
  local parent_pid="$1"
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -P "$parent_pid" 2>/dev/null || true
  else
    ps -eo pid=,ppid= | awk -v p="$parent_pid" '$2 == p { print $1 }'
  fi
}

kill_process_tree() {
  local pid="$1"
  local signal="$2"
  local child

  while read -r child; do
    [ -n "$child" ] || continue
    kill_process_tree "$child" "$signal"
  done < <(list_child_pids "$pid")

  kill "$signal" "$pid" 2>/dev/null || true
}

collect_port_pids() {
  local port
  for port in "${PORTS[@]}"; do
    while read -r pid; do
      add_pid "$pid"
    done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  done
}

collect_known_dev_pids() {
  local pattern
  local patterns=(
    "$PROJECT_ROOT/scripts/dev.sh"
    "bash ./scripts/dev.sh"
    "$PROJECT_ROOT/.venv/bin/python3 -m mcp_server.server --transport http --port"
    "$PROJECT_ROOT/.venv/bin/python scripts/worker.py"
    "$PROJECT_ROOT/node_modules/.bin/tsx watch"
    "node.*tsx watch"
    "$PROJECT_ROOT/node_modules/.bin/vite"
    "vite --port 5173"
    "$PROJECT_ROOT/node_modules/.bin/convex dev"
    "convex dev"
    "uv run uvicorn api:app"
    "uv run --env-file .env uvicorn api:app"
  )

  for pattern in "${patterns[@]}"; do
    while read -r pid; do
      add_pid "$pid"
    done < <(pgrep -f "$pattern" 2>/dev/null || true)
  done
}

print_targets() {
  local pid
  echo "Cleaning dev services in $PROJECT_ROOT"
  for pid in "${!TARGET_PIDS[@]}"; do
    local cmd
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [ -n "$cmd" ]; then
      echo "  - PID $pid: $cmd"
    else
      echo "  - PID $pid"
    fi
  done
}

cleanup_targets() {
  local pid
  local signal="$1"
  for pid in "${!TARGET_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill_process_tree "$pid" "$signal"
    fi
  done
}

collect_port_pids
collect_known_dev_pids

if [ ${#TARGET_PIDS[@]} -eq 0 ]; then
  echo "No dev services detected."
  cleanup_lock_artifacts
  echo "Removed singleton lock artifacts for this project."
  exit 0
fi

print_targets

echo "Sending SIGTERM..."
cleanup_targets "-TERM"
sleep 2

declare -A REMAINING_PIDS=()
for pid in "${!TARGET_PIDS[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    REMAINING_PIDS["$pid"]=1
  fi
done

if [ ${#REMAINING_PIDS[@]} -gt 0 ]; then
  echo "Force killing remaining processes..."
  TARGET_PIDS=()
  for pid in "${!REMAINING_PIDS[@]}"; do
    TARGET_PIDS["$pid"]=1
  done
  cleanup_targets "-KILL"
  sleep 1
fi

echo "Done. Current listeners on dev ports:"
lsof -nP -iTCP:"${CONVEX_PORT:-3210}" -iTCP:"${MCP_PORT:-3333}" -iTCP:"${TRENDS_WORKER_PORT:-8000}" -iTCP:"${API_PORT:-3000}" -iTCP:"${WEB_PORT:-5173}" -sTCP:LISTEN 2>/dev/null || true

cleanup_lock_artifacts
echo "Removed singleton lock artifacts for this project."
