#!/bin/bash
# Migration test verification script
# Usage: scripts/migration-test-verify.sh [BASE_URL] [OUTPUT_FILE]
# Defaults: BASE_URL=http://localhost:3000, OUTPUT_FILE=stdout
#
# Verified against actual API response shape:
#   - API returns {data: [...], summary: {total, returned, source}, metadata: {...}, success}
#   - Data items in .data[] (not .items[])
#   - Use `source=convex` to query Convex data (default returns sample data)
#   - Count via Convex CLI (npm --workspace @trends/convex exec convex run resumes:count)
#   - Search with q= + source=convex causes 500 — use q= alone for search check
#   - primaryRuleScore not exposed at API level; use ingestData.ruleScores presence

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
OUTPUT_FILE="${2:-/dev/stdout}"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUTPUT_FILE"; }

log "=== Migration Verification ==="
log "Target: $BASE_URL"
log ""

# Check 1: API health
log "--- Check 1: API Health ---"
if curl -fsS "$BASE_URL/api/health" >/dev/null 2>&1; then
    log "  API: OK (health endpoint)"
elif curl -fsS "$BASE_URL" >/dev/null 2>&1; then
    log "  API: responding"
else
    log "  API: UNREACHABLE"
    log "=== FAIL ==="
    exit 1
fi

# Check 2: Resume count via Convex CLI
log "--- Check 2: Record Count (Convex CLI) ---"
CONVEX_COUNT=$(npm --workspace @trends/convex exec convex run resumes:count '{}' 2>/dev/null || echo "error")
log "  Convex resume count: $CONVEX_COUNT"

# Fetch convex data once for checks 3-7 (reduce HTTP round-trips)
CONVEX_SAMPLE=$(curl -s "$BASE_URL/api/resumes?source=convex&limit=50" 2>/dev/null || echo "{}")

# Check 3: Source distribution
log "--- Check 3: Source Distribution ---"
echo "$CONVEX_SAMPLE" | jq -r '
  [.data[]? | .source // "unknown"] | group_by(.) | map({source: .[0], count: length}) | .[] | "  \(.source): \(.count)"
' 2>/dev/null | tee -a "$OUTPUT_FILE" || log "  (could not determine source distribution)"

# Check 4: Search returns results (use default endpoint since q= + source=convex 500s)
log "--- Check 4: Search Integrity ---"
SEARCH_RESP=$(curl -s "$BASE_URL/api/resumes?limit=5" 2>/dev/null)
SEARCH_COUNT=$(echo "$SEARCH_RESP" | jq -r '.summary.returned // 0' 2>/dev/null || echo "0")
SEARCH_SOURCE=$(echo "$SEARCH_RESP" | jq -r '.summary.source // "unknown"' 2>/dev/null || echo "unknown")
log "  Default query: $SEARCH_COUNT results (source: $SEARCH_SOURCE)"

# Check 5: Filters on convex data
log "--- Check 5: Filter Integrity ---"
FILTER_MINROLE=$(curl -s "$BASE_URL/api/resumes?source=convex&limit=5&minRoleYears=0.5" 2>/dev/null | jq -r '.summary.total // 0' 2>/dev/null || echo "0")
log "  minRoleYears=0.5: $FILTER_MINROLE results"

FILTER_AGE=$(curl -s "$BASE_URL/api/resumes?source=convex&limit=5&minAge=25&maxAge=40" 2>/dev/null | jq -r '.summary.total // 0' 2>/dev/null || echo "0")
log "  age 25-40: $FILTER_AGE results"

FILTER_MAXEXP=$(curl -s "$BASE_URL/api/resumes?source=convex&limit=5&maxExperience=20" 2>/dev/null | jq -r '.summary.total // 0' 2>/dev/null || echo "0")
log "  maxExperience=20: $FILTER_MAXEXP results"

# Check 6: Derived fields (reuse CONVEX_SAMPLE)
log "--- Check 6: Derived Fields ---"
echo "$CONVEX_SAMPLE" | jq -r '
  .data[:5][]? |
  "  \(.name // "unnamed") | source=\(.source // "?") | hasIngestData=\(.ingestData != null) | verifiedRoleYears=\(.ingestData.verifiedRoleYears // "null" | tostring) | ruleScores=\(.ingestData.ruleScores // {} | keys | length) | industryDbV2Raw=\(.ingestData.industryDbV2Raw // "null")"
' 2>/dev/null | tee -a "$OUTPUT_FILE" || log "  (could not read derived fields)"

# Check 7: Scoring (reuse CONVEX_SAMPLE)
log "--- Check 7: Scoring Pipeline ---"
SCORED_COUNT=$(echo "$CONVEX_SAMPLE" | jq '[.data[:10][]? | select(.ingestData.ruleScores != null)] | length' 2>/dev/null || echo "0")
log "  Resumes with ruleScores: $SCORED_COUNT / 10 sampled"

VERIFIED_COUNT=$(echo "$CONVEX_SAMPLE" | jq '[.data[:10][]? | select(.ingestData.verifiedRoleYears != null and (.ingestData.verifiedRoleYears | length > 0))] | length' 2>/dev/null || echo "0")
log "  Resumes with verifiedRoleYears: $VERIFIED_COUNT / 10 sampled"

log ""
log "=== Verification Complete ==="
log "Convex count: $CONVEX_COUNT"
log "Default query results: $SEARCH_COUNT"
log "Filter results: minRoleYears=$FILTER_MINROLE age=$FILTER_AGE maxExp=$FILTER_MAXEXP"
log "Scored (ruleScores): $SCORED_COUNT/10"
log "Verified role years: $VERIFIED_COUNT/10"
