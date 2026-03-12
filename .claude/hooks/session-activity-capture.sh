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
  if [ "$start_commit" != "unknown" ] && [ "$end_commit" != "unknown" ] && [ "$start_commit" != "$end_commit" ]; then
    # Get commits between start and end
    commits_json=$(git log --format='{"sha":"%H","message":"%s","timestamp":"%aI"}' "${start_commit}..${end_commit}" 2>/dev/null | \
      jq -s 'map(. + {filesChanged: 0, additions: 0, deletions: 0})' 2>/dev/null || echo "[]")

    # Add file stats to each commit
    local enriched_commits="[]"
    while IFS= read -r sha; do
      if [ -n "$sha" ]; then
        local stats
        stats=$(git show --stat --format="" "$sha" 2>/dev/null | tail -1 | \
          sed -n 's/.* \([0-9]*\) file.* \([0-9]*\) insertion.* \([0-9]*\) deletion.*/{"f":\1,"a":\2,"d":\3}/p' 2>/dev/null || echo '{"f":0,"a":0,"d":0}')
        if [ -z "$stats" ]; then
          stats='{"f":0,"a":0,"d":0}'
        fi
        enriched_commits=$(echo "$commits_json" | jq --arg sha "$sha" --argjson stats "$stats" \
          'map(if .sha == $sha then . + {filesChanged: $stats.f, additions: $stats.a, deletions: $stats.d} else . end)' 2>/dev/null || echo "$commits_json")
        commits_json="$enriched_commits"
      fi
    done < <(git log --format="%H" "${start_commit}..${end_commit}" 2>/dev/null)
  fi

  # Collect file changes
  local files_json="[]"
  if [ "$start_commit" != "unknown" ] && [ "$end_commit" != "unknown" ] && [ "$start_commit" != "$end_commit" ]; then
    files_json=$(git diff --numstat --diff-filter=AMDRT "${start_commit}..${end_commit}" 2>/dev/null | \
      while IFS=$'\t' read -r add del path; do
        [ -z "$path" ] && continue
        # Determine status from first commit that touched this file
        local status="modified"
        if git diff --name-status "${start_commit}..${end_commit}" 2>/dev/null | grep -q "^A.*${path}$"; then
          status="added"
        elif git diff --name-status "${start_commit}..${end_commit}" 2>/dev/null | grep -q "^D.*${path}$"; then
          status="deleted"
        elif git diff --name-status "${start_commit}..${end_commit}" 2>/dev/null | grep -q "^R.*${path}$"; then
          status="renamed"
        fi
        # Handle binary files (- for add/del)
        [ "$add" = "-" ] && add=0
        [ "$del" = "-" ] && del=0
        printf '{"path":"%s","additions":%d,"deletions":%d,"status":"%s"}\n' "$path" "$add" "$del" "$status"
      done | jq -s '.' 2>/dev/null || echo "[]")
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
