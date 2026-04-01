#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/debug-51job-detail.sh <resume-id> [raw-json-path]

Description:
  Uses the Trends CLI to back up one synced 51job resume and print the core
  parsed fields plus workHistory. If a raw 51job detail payload JSON path is
  provided, the script also prints the most relevant raw fields side by side.

Examples:
  scripts/debug-51job-detail.sh 975386637
  scripts/debug-51job-detail.sh 975386637 /tmp/51job-975386637-raw.json

Notes:
  - The parsed half comes from:
      ./bin/trends resume backup --resume-id <id> --source-host ehire.51job.com
  - The raw half is optional because the current Trends CLI does not expose the
    browser extension's captured job51DetailPayload directly.
  - To create the raw JSON file from the browser detail page console:
      copy(JSON.stringify(window.__TR_RESUME_DATA__.getApiSnapshot().job51DetailPayload, null, 2))
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

RESUME_ID="${1:-}"
RAW_PATH="${2:-}"

if [[ -z "$RESUME_ID" ]]; then
  usage
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required for this helper." >&2
  exit 1
fi

OUT="/tmp/51job-${RESUME_ID}.json"

./bin/trends resume backup \
  --resume-id "$RESUME_ID" \
  --source-host ehire.51job.com \
  --out "$OUT"

if [[ ! -s "$OUT" ]]; then
  echo "ERROR: backup file missing or empty: $OUT" >&2
  exit 1
fi

if ! jq -e '.. | .resumeId? // empty' "$OUT" >/dev/null 2>&1; then
  echo "ERROR: no parsed synced resume found for resumeId=$RESUME_ID" >&2
  echo "Hint: sync or collect the resume into Trends first, then rerun this helper." >&2
  exit 1
fi

echo "=== Parsed core fields ==="
jq '.. | {resumeId, name, experience, jobIntention, education, location, activityStatus}? | select(. != {})' "$OUT"

echo
echo "=== Parsed workHistory ==="
jq '.. | .workHistory? // empty' "$OUT"

if [[ -n "$RAW_PATH" ]]; then
  if [[ ! -s "$RAW_PATH" ]]; then
    echo >&2
    echo "ERROR: raw payload path was provided but is missing or empty: $RAW_PATH" >&2
    exit 1
  fi

  echo
  echo "=== Raw detail payload fields ==="
  jq '{
    displayage: .data.displayage,
    workyear: .data.workyear,
    jobintention: .data.jobintention,
    highestdegree: .data.highestdegree,
    activetimelabel: .data.activetimelabel,
    work: .data.work
  }' "$RAW_PATH"
else
  echo
  echo "=== Raw payload compare skipped ==="
  echo "Provide a raw payload JSON path as the second argument to compare parsed vs raw."
fi
