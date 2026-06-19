#!/usr/bin/env bash
# Smoke test: setup-preview.sh contains a seeding block that references the same
# env vars install.sh's seed_bootstrap_admins uses, and shells out to manage-user.ts.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/setup-preview.sh"

grep -q "BOOTSTRAP_ADMIN_USERS"           "$script" || { echo "FAIL: BOOTSTRAP_ADMIN_USERS not referenced"; exit 1; }
grep -q "BOOTSTRAP_ADMIN_WORKSPACE"       "$script" || { echo "FAIL: BOOTSTRAP_ADMIN_WORKSPACE not referenced"; exit 1; }
grep -q "BOOTSTRAP_ADMIN_PASSWORD_ENV"    "$script" || { echo "FAIL: BOOTSTRAP_ADMIN_PASSWORD_ENV not referenced"; exit 1; }
grep -q "scripts/auth/manage-user.ts"     "$script" || { echo "FAIL: manage-user.ts not invoked"; exit 1; }
bash -n "$script" || { echo "FAIL: setup-preview.sh has syntax errors"; exit 1; }
echo "OK"
