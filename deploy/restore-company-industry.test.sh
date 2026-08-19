#!/usr/bin/env bash
# Smoke test: the preview restore paths re-seed the reviewed company-industry
# catalog after every `convex import --replace-all`, preview-only.
#
# Regression guard for: after a preview data restore/upgrade-migrate cycle,
# the company_industry_* tables could be materialized EMPTY (the prod export
# carries no rows — the catalog was written by a July attended bootstrap that
# predates the export path), silently emptying the preview catalog while prod
# keeps it. The re-seed leg replays the deterministic reviewed bootstrap plan
# through the same mutation chain (companies:upsert ->
# companies:upsertIndustryProposal -> companies:upsertIndustryEvidenceSource
# -> companies:approveIndustryProposal) and is idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
common="$ROOT/lib-preview-common.sh"
prod_restore="$ROOT/restore-preview-from-prod.sh"
backup_restore="$ROOT/restore-preview-from-backup.sh"
seed_dir="$ROOT/seed-data"
plan_json="$seed_dir/company-industry-seed-plan.json"
driver="$seed_dir/seed-company-industry.mjs"

# 1) Seed plan is valid JSON with the reviewed catalog shape (27 companies /
# 71 sources, every company carries the approval chain ids).
if [ ! -r "$plan_json" ]; then
    echo "FAIL: $plan_json missing"
    exit 1
fi
python3 - "$plan_json" <<'PY' || { echo "FAIL: seed plan JSON shape"; exit 1; }
import json, sys
plan = json.load(open(sys.argv[1]))
companies = plan.get("companies")
assert isinstance(companies, list) and len(companies) == 27, f"companies={len(companies) if isinstance(companies, list) else companies}"
required = {"companyKey", "employerName", "industryClass", "proposalId", "revisionId",
            "verificationLevel", "evidenceSummary", "sources"}
for c in companies:
    missing = required - set(c)
    assert not missing, f"{c.get('companyKey')} missing {sorted(missing)}"
    assert c["industryClass"] in ("cnc", "industrial"), c["industryClass"]
    assert c["verificationLevel"] == "verified", c["verificationLevel"]
    for s in c["sources"]:
        assert s["sourceId"] and s["url"].startswith(("http://", "https://")), s
sources = sum(len(c["sources"]) for c in companies)
assert sources == 71, f"sources={sources}"
PY

# 2) Driver exists, parses, and drives the full mutation chain.
[ -r "$driver" ] || { echo "FAIL: $driver missing"; exit 1; }
node --check "$driver" || { echo "FAIL: node --check $driver"; exit 1; }
for needle in \
    '"companies:upsert"' \
    '"companies:upsertIndustryProposal"' \
    '"companies:upsertIndustryEvidenceSource"' \
    '"companies:approveIndustryProposal"' \
    '"companies:listIndustryProfiles"' \
    'fetchStatus: "fetched"' \
    'reviewAttestation' \
    'SEED_OK' \
    'SEED_FATAL'; do
    grep -qF "$needle" "$driver" || { echo "FAIL: driver must contain $needle"; exit 1; }
done

# 3) Shared helper exists, is preview-container-guarded, and copies the plan
#    + driver into the container before running them with the deployment's
#    own write secret.
grep -q "seed_preview_company_industry()" "$common" || { echo "FAIL: lib-preview-common.sh must define seed_preview_company_industry"; exit 1; }
grep -q 'trends-preview-\*' "$common" || { echo "FAIL: re-seed helper must refuse non-preview containers"; exit 1; }
grep -q 'company-industry-seed-plan.json' "$common" || { echo "FAIL: helper must reference the seed plan"; exit 1; }
grep -q 'docker cp "$plan_path"' "$common" || { echo "FAIL: helper must copy the seed plan into the container"; exit 1; }
grep -q 'docker cp "$driver_path"' "$common" || { echo "FAIL: helper must copy the seed driver into the container"; exit 1; }
grep -q 'npx convex env get CONVEX_WRITE_SECRET' "$common" || { echo "FAIL: helper must fetch the write secret from the deployment env"; exit 1; }
grep -q 'node /app/seed-company-industry.mjs' "$common" || { echo "FAIL: helper must run the driver with node inside the container"; exit 1; }

# 4) restore-preview-from-prod.sh: re-seed after the --replace-all import,
#    FATAL on failure with a manual-fix hint.
grep -q 'convex import --replace-all' "$prod_restore" || { echo "FAIL: restore-preview-from-prod.sh must import with --replace-all"; exit 1; }
grep -q 'seed_preview_company_industry' "$prod_restore" || { echo "FAIL: restore-preview-from-prod.sh must re-seed the company-industry catalog after import"; exit 1; }
grep -q 'FATAL: company-industry re-seed failed' "$prod_restore" || { echo "FAIL: restore-preview-from-prod.sh must FATAL when the re-seed fails"; exit 1; }
grep -q 'the seed leg is idempotent' "$prod_restore" || { echo "FAIL: restore-preview-from-prod.sh must hint at the idempotent re-run"; exit 1; }

# 5) restore-preview-from-backup.sh: re-seed inside import_preview_convex
#    (covers restore-baseline and rollback), best-effort.
grep -q 'seed_preview_company_industry' "$backup_restore" || { echo "FAIL: restore-preview-from-backup.sh must re-seed the company-industry catalog after import"; exit 1; }
grep -q 'log_warn "company-industry re-seed failed' "$backup_restore" || { echo "FAIL: restore-preview-from-backup.sh must treat the re-seed as best-effort"; exit 1; }

# 6) Never wired into any production script.
if grep -rl 'seed_preview_company_industry' "$ROOT"/../scripts/install.sh "$ROOT"/../deploy/restore-prod-from-preview.sh 2>/dev/null; then
    echo "FAIL: re-seed helper must never run from production scripts"
    exit 1
fi

# 7) Syntax check the modified scripts.
for script in "$common" "$prod_restore" "$backup_restore"; do
    bash -n "$script" || { echo "FAIL: bash -n $script"; exit 1; }
done

echo "OK"
