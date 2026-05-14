#!/usr/bin/env bash
# Check if recent commits touched files with corresponding vault concept pages.
# Usage: bash scripts/check-concept-drift.sh [--since <ref>]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

SINCE="${1:-main}"

# Map of code paths → vault concept pages to review
declare -A DRIFT_MAP=(
  ["packages/convex/convex/resumes.ts"]="concepts/resume-scoring-pipeline.md concepts/resume-search-architecture.md concepts/self-tuning-scoring.md"
  ["apps/web/src/hooks/useResumeSearchState.ts"]="concepts/resume-search-architecture.md"
  ["apps/web/src/components/SearchBar.tsx"]="concepts/resume-search-architecture.md"
  ["apps/web/src/components/ResumeCard.tsx"]="concepts/resume-search-architecture.md"
  ["apps/web/src/components/QuickStartPanel.tsx"]="concepts/resume-search-architecture.md"
  ["apps/web/src/hooks/useResumeListState.ts"]="concepts/resume-search-architecture.md"
)

changed=$(git diff --name-only "$SINCE"..HEAD 2>/dev/null || true)
if [ -z "$changed" ]; then
  echo "concept-drift: no commits since $SINCE — skipping"
  exit 0
fi

warned=0
for code_path in "${!DRIFT_MAP[@]}"; do
  if echo "$changed" | grep -qF "$code_path"; then
    echo "concept-drift: $code_path changed — review vault pages: ${DRIFT_MAP[$code_path]}"
    warned=1
  fi
done

if [ "$warned" -eq 0 ]; then
  echo "concept-drift: no scoring/search files changed — OK"
fi
