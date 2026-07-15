#!/usr/bin/env bash
# Check if recent commits touched files with corresponding vault concept pages.
# Usage: bash scripts/check-concept-drift.sh [--since <ref>] [--range <ref1..ref2>]
# Associative arrays need Bash 4+. Re-exec with Homebrew bash on macOS if needed.
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

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

RANGE=""
SINCE="main"
STRICT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --range) RANGE="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    *) shift ;;
  esac
done

# Map of code paths → vault concept pages to review
declare -A DRIFT_MAP=(
  # -- resume-search-architecture --
  ["apps/web/src/hooks/useResumeSearchState.ts"]="concepts/resume-search-architecture.md"
  ["apps/web/src/hooks/useResumeListState.ts"]="concepts/resume-search-architecture.md"
  ["apps/web/src/hooks/useConvexResumes.ts"]="concepts/resume-search-architecture.md"
  ["apps/web/src/hooks/resume-filter-helpers.ts"]="concepts/resume-search-architecture.md"
  ["apps/web/src/components/SearchBar.tsx"]="concepts/resume-search-architecture.md"
  ["apps/web/src/components/ResumeCard.tsx"]="concepts/resume-search-architecture.md"
  ["apps/web/src/components/ResumeList.tsx"]="concepts/resume-search-architecture.md"
  ["apps/web/src/components/QuickStartPanel.tsx"]="concepts/resume-search-architecture.md"
  ["apps/web/src/components/FilterPanel.tsx"]="concepts/resume-search-architecture.md"
  ["apps/web/src/components/ActiveTagFilters.tsx"]="concepts/resume-search-architecture.md"
  ["packages/convex/convex/search_profiles.ts"]="concepts/resume-search-architecture.md"
  ["packages/convex/convex/search_text.ts"]="concepts/resume-search-architecture.md"

  # -- resume-scoring-pipeline --
  ["packages/convex/convex/resumes.ts"]="concepts/resume-scoring-pipeline.md concepts/resume-search-architecture.md concepts/self-tuning-scoring.md"
  ["packages/convex/convex/analyze.ts"]="concepts/resume-scoring-pipeline.md concepts/self-tuning-scoring.md"
  ["packages/convex/convex/ai_summary_cache.ts"]="concepts/resume-scoring-pipeline.md"
  ["apps/api/src/services/ai-matching.ts"]="concepts/resume-scoring-pipeline.md"

  # -- self-tuning-scoring --
  ["packages/convex/convex/analysis_tasks.ts"]="concepts/self-tuning-scoring.md"
  ["apps/api/src/services/ai-config.ts"]="concepts/self-tuning-scoring.md"

  # -- multi-source-resume-collection --
  ["packages/convex/convex/ingest_agent.ts"]="concepts/multi-source-resume-collection.md"
  ["apps/web/src/components/CollectResumesButton.tsx"]="concepts/multi-source-resume-collection.md"

  # -- workspace-isolation --
  ["packages/shared/src/workspace.ts"]="concepts/workspace-isolation.md"
  ["apps/api/src/middleware/workspace.ts"]="concepts/workspace-isolation.md"
  ["apps/web/src/contexts/WorkspaceContext.tsx"]="concepts/workspace-isolation.md"

  # -- star-rating-identity-model --
  ["apps/web/src/services/action-storage.ts"]="concepts/star-rating-identity-model.md"
  ["packages/convex/convex/candidate_blocks.ts"]="concepts/star-rating-identity-model.md"
  ["packages/convex/convex/candidate_status.ts"]="concepts/star-rating-identity-model.md"

  # -- convex-operations --
  ["packages/convex/convex/migrations.ts"]="concepts/convex-operations.md"
  ["packages/convex/convex/schema.ts"]="concepts/convex-operations.md"

  # -- scoring-metrics --
  ["scripts/compute-scoring-metrics.ts"]="concepts/resume-scoring-pipeline.md concepts/self-tuning-scoring.md"
  ["scripts/monitor-hr-rating-drift.ts"]="concepts/self-tuning-scoring.md"

  # -- e2e-testing-strategy --
  ["scripts/e2e-smoke.ts"]="concepts/e2e-testing-strategy.md"
  ["scripts/e2e-utils.ts"]="concepts/e2e-testing-strategy.md"

  # -- vitest-mock-patterns --
  ["apps/web/src/test/mocks/i18n.ts"]="concepts/vitest-mock-patterns.md"
  ["apps/web/src/test/setup.ts"]="concepts/vitest-mock-patterns.md"
)

if [ -n "$RANGE" ]; then
  changed=$(git diff --name-only "$RANGE" 2>/dev/null || true)
else
  changed=$(git diff --name-only "$SINCE"..HEAD 2>/dev/null || true)
fi

if [ -z "$changed" ]; then
  echo "concept-drift: no changes to check — skipping"
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
elif [ "$STRICT" -eq 1 ]; then
  echo ""
  echo "concept-drift: DRIFT DETECTED — review the vault pages listed above before pushing."
  echo "If the changes are intentional and the vault pages are already up to date, push with:"
  echo "  git push --no-verify"
  exit 1
fi
