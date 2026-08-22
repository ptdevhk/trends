#!/usr/bin/env bash
# Local migration test driver: run canonical + derived-field migrations against
# the LOCAL dev Convex (prod 0.4.16 data under preview-v0.4.23 code).
# Mirrors deploy/preview-run-migrations.sh but for the local backend.
set -Eeuo pipefail

cd /root/workspace
SCRIPT_DIR=/root/workspace/deploy
# shellcheck source=lib-convex-migrations.sh
source "$SCRIPT_DIR/lib-convex-migrations.sh"

CONVEX_DIR=/root/workspace/packages/convex
CONVEX_MIGRATION_EVIDENCE_DIR=/root/workspace/output/migration-test-results/evidence/migrations
export CONVEX_MIGRATION_EVIDENCE_DIR
mkdir -p "$CONVEX_MIGRATION_EVIDENCE_DIR"
chmod 700 "$CONVEX_MIGRATION_EVIDENCE_DIR"

convex_migration_execute() {
    local convex_dir="$1"
    local migration_name="$2"
    local call_args="$3"
    local shell_command="cd '$convex_dir' && npx convex run migrations:$migration_name"
    if [[ "$call_args" != "{}" ]]; then
        shell_command+=" '$(printf '%s' "$call_args" | sed "s/'/'\\\\''/g")'"
    fi
    bash -lc "$shell_command"
}

# Extended declaration table: canonical 13 (lib) + newer derived-field backfills,
# validateDataConsistency always LAST. Destructive/utility migrations excluded.
# Emitted with TAB separators (lib's read -r IFS=$'\t' splitter).
convex_migration_declarations() {
    local n a
    while IFS='|' read -r n a; do
        printf '%s\t%s\t1000\t3\tidempotent\n' "$n" "$a"
    done <<'EOF'
backfillSourceKey|{}
backfillTaggingEnvelope|{}
backfillWorkspaceSlugs|{}
backfillJob5156ProfileUrls|{}
backfillJob5156WorkHistoryEducation|{}
backfillJob5156LocationHierarchy|{}
backfillManual51jobStructuredContent|{"batchSize":100}
backfillIngestData|{"limit":100}
backfillAge|{}
backfillSearchText|{}
backfillEvidenceText|{}
backfillPrimaryRuleScore|{}
backfillVerifiedRoleYears|{}
backfillSearchProfileTemplateHash|{}
backfillMarketField|{}
backfillSeekNameSearchUrls|{}
backfillAnalysesValidator|{}
backfillAuditLogActorIdentity|{}
backfillResumeAnalysesStatus|{}
validateDataConsistency|{}
EOF
}

echo "=== Migration test start: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
convex_migration_declarations | cut -f1 > "$CONVEX_MIGRATION_EVIDENCE_DIR/declaration-order.txt"
run_convex_migration_sequence "$CONVEX_DIR"
echo "=== Migration sequence complete: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Evidence: $CONVEX_MIGRATION_EVIDENCE_DIR"
