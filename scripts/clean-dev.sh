#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

PORTS=(
  "${CONVEX_PORT:-3210}"
  "${MCP_PORT:-3333}"
  "${TRENDS_WORKER_PORT:-8000}"
  "${API_PORT:-3000}"
  "${WEB_PORT:-5173}"
)

declare -A TARGET_PIDS=()

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
    "$PROJECT_ROOT/node_modules/.bin/tsx watch src/index.ts"
    "$PROJECT_ROOT/node_modules/.bin/vite --port 5173"
    "$PROJECT_ROOT/node_modules/.bin/convex dev"
    "tsx watch src/index.ts"
    "vite --port 5173"
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
