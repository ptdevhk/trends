#!/usr/bin/env bash
# Smoke test: the preview restore paths re-assert the canonical no-hire
# policies after every `convex import --replace-all`, preview-only.
#
# Regression guard for: after a preview data restore/upgrade-migrate cycle,
# company_policy_revisions could be materialized EMPTY (schema tables missing
# from the imported snapshot), silently unsetting the workspace blacklist for
# 宝力机械 / Pro-Technic Machinery and 宝惠 / Polywell while prod keeps it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
common="$ROOT/lib-preview-common.sh"
prod_restore="$ROOT/restore-preview-from-prod.sh"
backup_restore="$ROOT/restore-preview-from-backup.sh"

# 1) Shared helper exists and is preview-container-guarded.
grep -q "seed_preview_canonical_no_hire()" "$common" || { echo "FAIL: lib-preview-common.sh must define seed_preview_canonical_no_hire"; exit 1; }
grep -q 'trends-preview-\*' "$common" || { echo "FAIL: re-seed helper must refuse non-preview containers"; exit 1; }
grep -q 'seedCanonicalCompanies' "$common" || { echo "FAIL: helper must call companies:seedCanonicalCompanies"; exit 1; }
grep -q '"seedNoHireForWorkspace\\":true\|seedNoHireForWorkspace.*true' "$common" || { echo "FAIL: helper must pass seedNoHireForWorkspace=true"; exit 1; }
grep -q 'workspaceSlug' "$common" || { echo "FAIL: helper must pass a workspaceSlug (hr)"; exit 1; }

# 2) restore-preview-from-prod.sh: re-seed after the --replace-all import.
grep -q 'convex import --replace-all' "$prod_restore" || { echo "FAIL: restore-preview-from-prod.sh must import with --replace-all"; exit 1; }
grep -q 'lib-preview-common.sh' "$prod_restore" || { echo "FAIL: restore-preview-from-prod.sh must source lib-preview-common.sh"; exit 1; }
grep -q 'seed_preview_canonical_no_hire "hr"' "$prod_restore" || { echo "FAIL: restore-preview-from-prod.sh must re-seed canonical no-hire after import"; exit 1; }

# 3) restore-preview-from-backup.sh: re-seed inside import_preview_convex
# (covers restore-baseline and rollback).
grep -q 'seed_preview_canonical_no_hire "hr"' "$backup_restore" || { echo "FAIL: restore-preview-from-backup.sh must re-seed canonical no-hire after import"; exit 1; }

# 4) Never wired into any production script.
if grep -rl 'seed_preview_canonical_no_hire' "$ROOT"/../scripts/install.sh "$ROOT"/../deploy/restore-prod-from-preview.sh 2>/dev/null; then
    echo "FAIL: re-seed helper must never run from production scripts"
    exit 1
fi

# 5) Syntax check the modified scripts.
for script in "$common" "$prod_restore" "$backup_restore"; do
    bash -n "$script" || { echo "FAIL: bash -n $script"; exit 1; }
done

echo "OK"
