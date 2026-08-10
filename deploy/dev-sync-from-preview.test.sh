#!/usr/bin/env bash
# Structural + dry-run tests for dev-sync-from-preview.sh. Run: bash deploy/dev-sync-from-preview.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

[ -x "$ROOT/deploy/dev-sync-from-preview.sh" ] && pass "orchestrator executable" || fail "orchestrator missing/not executable"
grep -q 'lib-preview-common.sh' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "sources lib-preview-common" || fail "missing lib-preview-common"
grep -q 'lib-dev-common.sh' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "sources lib-dev-common" || fail "missing lib-dev-common"
grep -q 'lib-convex-export-fix.sh' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "sources lib-convex-export-fix" || fail "missing lib-convex-export-fix"
grep -q 'dev-parity-check.sh' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "invokes parity gate" || fail "missing parity gate call"
grep -q -- '--prod-base' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "--prod-base flag" || fail "missing --prod-base"
grep -q -- '--with-file-storage' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "--with-file-storage flag" || fail "missing --with-file-storage"
grep -q -- '--digest-backfill' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "--digest-backfill flag" || fail "missing --digest-backfill"
grep -q -- '--dry-run' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "--dry-run flag" || fail "missing --dry-run"
grep -q 'dev_backup_local' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "calls dev_backup_local" || fail "missing backup gate"
grep -q 'dev_stop_api' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "calls dev_stop_api" || fail "missing api stop"
grep -q 'fix_convex_export' "$ROOT/deploy/dev-sync-from-preview.sh" && pass "calls fix_convex_export" || fail "missing fix step"

# Dry-run must stop before the destructive swap
OUT="$(cd "$ROOT" && ASSUME_YES=1 bash deploy/dev-sync-from-preview.sh --dry-run 2>&1 || true)"
echo "$OUT" | grep -qi "dry-run" && pass "dry-run prints marker" || fail "dry-run marker missing"

# Wiring: npm role, Makefile target, docs
grep -q '"auth:bootstrap-hr-demo".*--role admin' "$ROOT/package.json" && pass "npm hr-demo seeds admin" || fail "npm hr-demo not admin"
grep -q 'on-host-dev-sync-from-preview' "$ROOT/Makefile" && pass "Makefile target present" || fail "Makefile target missing"
grep -q 'dev-sync-from-preview' "$ROOT/docs/agent-runbook.md" && pass "runbook documents dev sync" || fail "runbook missing dev sync"
grep -q 'dev-sync-from-preview' "$ROOT/docs/backup-restore-architecture.md" && pass "arch doc mentions dev sync" || fail "arch doc missing dev sync"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
