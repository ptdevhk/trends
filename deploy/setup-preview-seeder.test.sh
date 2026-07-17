#!/usr/bin/env bash
# Smoke test: preview seed path references canonical accounts and manage-user.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
setup="$ROOT/setup-preview.sh"
seed="$ROOT/preview-seed-auth.sh"
envt="$ROOT/env.preview"

grep -q "preview-seed-auth" "$setup" || { echo "FAIL: setup-preview must call preview-seed-auth"; exit 1; }
grep -q "BOOTSTRAP_HR_DEMO_USER" "$envt" || { echo "FAIL: env.preview missing BOOTSTRAP_HR_DEMO_USER"; exit 1; }
grep -q "AUTH_HR_DEMO_PASSWORD" "$envt" || { echo "FAIL: env.preview missing AUTH_HR_DEMO_PASSWORD"; exit 1; }
grep -q "AUTH_HR_DEMO_TOKEN" "$envt" || { echo "FAIL: env.preview missing AUTH_HR_DEMO_TOKEN (silent login)"; exit 1; }
grep -q "hr-demo" "$seed" || { echo "FAIL: preview-seed-auth must seed hr-demo"; exit 1; }
grep -q "manage-user.ts" "$seed" || { echo "FAIL: manage-user.ts not invoked in seed"; exit 1; }
# Failed product path must not be reseeded
if grep -q "backup-hr-temp" "$seed" "$setup" "$envt" 2>/dev/null; then
    echo "FAIL: backup-hr-temp must not appear in seed/setup/env templates"
    exit 1
fi
bash -n "$setup" || { echo "FAIL: setup-preview.sh syntax"; exit 1; }
bash -n "$seed" || { echo "FAIL: preview-seed-auth.sh syntax"; exit 1; }
bash -n "$ROOT/preview-migration-gate.sh" || { echo "FAIL: preview-migration-gate.sh syntax"; exit 1; }
bash -n "$ROOT/preview-parity-check.sh" || { echo "FAIL: preview-parity-check.sh syntax"; exit 1; }
bash -n "$ROOT/preview-doctor.sh" || { echo "FAIL: preview-doctor.sh syntax"; exit 1; }
echo "OK"
