#!/bin/bash
# Session activity capture script
# Called by session-start hook (on start) and autopilot-keep-running hook (on end)
# Captures git commits, PRs, and file changes for the session activity dashboard

set -euo pipefail

ACTION="${1:-}"
SESSION_ID="${2:-}"

# Check required environment
if [ -z "${CMUX_TASK_RUN_JWT:-}" ]; then
  # Not running in a cmux sandbox - skip silently
  exit 0
fi

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "default" ]; then
  # No valid session ID - skip
  exit 0
fi

# Resolve API base URL (from CONVEX_SITE_URL or fallback)
API_BASE="${CONVEX_SITE_URL:-https://api.cmux.sh}"

get_current_commit() {
  git rev-parse HEAD 2>/dev/null || echo "unknown"
}

build_commit_stats_json() {
  local start_commit="$1"
  local end_commit="$2"

  git log --format='{"sha":"%H","message":"%s","timestamp":"%aI"}' "${start_commit}..${end_commit}" 2>/dev/null | \
    jq -s 'map(. + {filesChanged: 0, additions: 0, deletions: 0})' 2>/dev/null || echo "[]"
}

build_file_status_json() {
  local start_commit="$1"
  local end_commit="$2"

  python3 - "$start_commit" "$end_commit" <<'PY'
import json
import subprocess
import sys

start_commit, end_commit = sys.argv[1], sys.argv[2]
name_status = subprocess.run(
    ["git", "diff", "--name-status", "--diff-filter=AMDRT", "-z", f"{start_commit}..{end_commit}"],
    capture_output=True,
    text=False,
    check=False,
)
numstat = subprocess.run(
    ["git", "diff", "--numstat", "--diff-filter=AMDRT", "-z", f"{start_commit}..{end_commit}"],
    capture_output=True,
    text=False,
    check=False,
)

status_by_path: dict[str, str] = {}
parts = [part.decode("utf-8", errors="replace") for part in name_status.stdout.split(b"\0") if part]
index = 0
while index < len(parts):
    status_token = parts[index]
    index += 1
    if not status_token:
        continue
    code = status_token[0]
    if code == "R":
        if index + 1 >= len(parts):
            break
        old_path = parts[index]
        new_path = parts[index + 1]
        index += 2
        status_by_path[old_path] = "renamed"
        status_by_path[new_path] = "renamed"
    else:
        if index >= len(parts):
            break
        path = parts[index]
        index += 1
        status_by_path[path] = {
            "A": "added",
            "D": "deleted",
            "M": "modified",
            "T": "modified",
        }.get(code, "modified")

entries: list[dict[str, object]] = []
parts = [part.decode("utf-8", errors="replace") for part in numstat.stdout.split(b"\0") if part]
index = 0
while index + 2 < len(parts):
    additions, deletions, path = parts[index:index + 3]
    index += 3
    if not path:
        continue
    entries.append({
        "path": path,
        "additions": 0 if additions == "-" else int(additions),
        "deletions": 0 if deletions == "-" else int(deletions),
        "status": status_by_path.get(path, "modified"),
    })

print(json.dumps(entries, ensure_ascii=False))
PY
}

# Record session start
record_start() {
  local start_commit
  start_commit=$(get_current_commit)

  # Store start commit for later diff
  echo "$start_commit" > "/tmp/claude-session-start-commit-${SESSION_ID}"

  curl -s -X POST "${API_BASE}/api/session-activity/start" \
    -H "Content-Type: application/json" \
    -H "X-Task-Run-JWT: ${CMUX_TASK_RUN_JWT}" \
    -d "{\"sessionId\": \"${SESSION_ID}\", \"startCommit\": \"${start_commit}\"}" \
    > /dev/null 2>&1 || true
}

# Record session end with activity data
record_end() {
  local start_commit end_commit

  # Get start commit from saved file
  start_commit=""
  if [ -f "/tmp/claude-session-start-commit-${SESSION_ID}" ]; then
    start_commit=$(cat "/tmp/claude-session-start-commit-${SESSION_ID}" 2>/dev/null || echo "")
    rm -f "/tmp/claude-session-start-commit-${SESSION_ID}"
  fi

  if [ -z "$start_commit" ]; then
    # No start commit recorded - skip
    exit 0
  fi

  end_commit=$(get_current_commit)

  # Collect commits since start
  local commits_json="[]"
  local files_json="[]"
  if [ "$start_commit" != "unknown" ] && [ "$end_commit" != "unknown" ] && [ "$start_commit" != "$end_commit" ]; then
    commits_json=$(build_commit_stats_json "$start_commit" "$end_commit")
    files_json=$(build_file_status_json "$start_commit" "$end_commit" 2>/dev/null || echo "[]")
  fi

  # For now, skip PRs merged detection (would need gh CLI and repo context)
  local prs_json="[]"

  # Build and send the payload
  local payload
  payload=$(jq -n \
    --arg sessionId "$SESSION_ID" \
    --arg endCommit "$end_commit" \
    --argjson commits "$commits_json" \
    --argjson prsMerged "$prs_json" \
    --argjson filesChanged "$files_json" \
    '{sessionId: $sessionId, endCommit: $endCommit, commits: $commits, prsMerged: $prsMerged, filesChanged: $filesChanged}')

  curl -s -X POST "${API_BASE}/api/session-activity/end" \
    -H "Content-Type: application/json" \
    -H "X-Task-Run-JWT: ${CMUX_TASK_RUN_JWT}" \
    -d "$payload" \
    > /dev/null 2>&1 || true
}

case "$ACTION" in
  start)
    record_start
    ;;
  end)
    record_end
    ;;
  *)
    echo "Usage: $0 <start|end> <session_id>" >&2
    exit 1
    ;;
esac
