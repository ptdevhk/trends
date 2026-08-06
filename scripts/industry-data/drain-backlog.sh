#!/usr/bin/env bash
# Drain industry proposal backlog: worker research -> auto-verify -> reingest.
#
# Usage: ./scripts/industry-data/drain-backlog.sh [rounds] [proposal_limit]
#
# Default: 10 rounds, 50 proposals per round.
# Each round takes ~3-5 minutes. 10 rounds = ~30-50 minutes.
#
# Requires: CONVEX_WRITE_SECRET, INDUSTRY_PROPOSAL_LIMIT env vars.
set -euo pipefail

ROUNDS="${1:-10}"
PROPOSAL_LIMIT="${2:-50}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

cd "$PROJECT_ROOT"
source .env 2>/dev/null || true
export INDUSTRY_PROPOSAL_LIMIT="$PROPOSAL_LIMIT"

echo "============================================"
echo "Industry Proposal Backlog Drain"
echo "  Rounds: $ROUNDS"
echo "  Proposal limit per round: $PROPOSAL_LIMIT"
echo "============================================"
echo ""

TOTAL_APPROVED=0

for round in $(seq 1 "$ROUNDS"); do
  echo "--- Round $round/$ROUNDS ---"

  # Step 1: Run worker to research proposals
  echo "  [1/3] Worker research..."
  WORKER_RESULT=$(curl -s -X POST "http://localhost:8000/worker/industry/maintenance" \
    -H "Content-Type: application/json" \
    -d '{"trigger":"manual"}' 2>&1)
  echo "    $(echo "$WORKER_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','?'))" 2>/dev/null || echo 'done')"

  # Step 2: Auto-verify ready_for_review proposals
  echo "  [2/3] Auto-verify..."
  VERIFY_OUTPUT=$(CONVEX_WRITE_SECRET="$CONVEX_WRITE_SECRET" \
    npx tsx scripts/industry-data/auto-verify-proposals.ts \
    --limit 50 --apply 2>&1)
  APPROVED_THIS_ROUND=$(echo "$VERIFY_OUTPUT" | grep "Results:" | sed -n 's/.*\([0-9][0-9]*\) approved.*/\1/p' || echo "0")
  echo "    Approved: $APPROVED_THIS_ROUND"
  TOTAL_APPROVED=$((TOTAL_APPROVED + APPROVED_THIS_ROUND))

  # Step 3: If we approved any, trigger reingest
  if [ "$APPROVED_THIS_ROUND" -gt 0 ]; then
    echo "  [3/3] Reingest..."
    cd packages/convex
    npx convex run migrations:reIngestAllResumes '{}' 2>&1 | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(f'    Scheduled {d.get(\"scheduled\",0)} resumes for reingest')" 2>/dev/null || echo "    (reingest triggered)"
    cd "$PROJECT_ROOT"
  else
    echo "  [3/3] Skip reingest (no new approvals)"
  fi

  echo ""
done

echo "============================================"
echo "Drain complete: $TOTAL_APPROVED companies approved across $ROUNDS rounds"
echo ""
echo "Next steps:"
echo "  1. Check search results: curl 'http://localhost:3000/api/resumes?q=CNC+Sales&location=Malaysia&minRoleYears=1&roleType=sales&source=convex&paged=true&limit=200&workspaceSlug=hr'"
echo "  2. If still low, run more rounds: ./scripts/industry-data/drain-backlog.sh 10 50"
echo "============================================"
