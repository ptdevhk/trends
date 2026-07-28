# Convex Restore Operations

## Overview

Two restore scripts handle data sync between preview and prod:

| Script | Direction | When to use |
|--------|-----------|-------------|
| `restore-preview-from-prod.sh` | prod → preview | Refresh preview with latest prod data |
| `preview-rehearse-backup.sh` | selected `prod-complete-*` → preview | Phased historical baseline/upgrade rehearsal |
| `restore-prod-from-preview.sh` | preview → prod | Promote preview changes to prod |

For the **full preview clone + upgrade CLI runbook** (backup → clone prod version → data sync → upgrade), see:

- [`docs/preview-upgrade-runbook.md`](../docs/preview-upgrade-runbook.md)

Related helpers:

| Script | Role |
|--------|------|
| `backup-prod-complete.sh` | Complete production backup before preview work |
| `preview-preflight.sh` | Read-only isolation / path checks |
| `preview-clone-from-prod.sh` | Install production app version into preview |
| `preview-upgrade.sh` | Upgrade preview to latest (safe `make deploy` target) |
| `preview-isolate-integrations.sh` | Clear Telegram / force preview URLs |
| `restore-preview-full-state-from-prod.sh` | Convex + SQLite into preview |
| `restore-preview-from-backup.sh` | Historical backup/target worker with explicit rollback |
| `preview-run-migrations.sh` | Shared canonical migrations against preview only |
| `preview-verify-snapshot.sh` | Baseline/upgraded snapshot-aware verification |
| `preview-doctor.sh` | Health + recovery |

## Current clone versus historical replay

The existing `preview-clone-from-prod.sh` and
`restore-preview-full-state-from-prod.sh` workflow clones the **current live
production** application and data. It remains unchanged.

The historical replay requires an explicit verified backup directory and exact
target ref:

```bash
sudo make on-host-preview-rehearse-backup \
  BACKUP_DIR=/var/backups/trends/prod-complete-20260722T191315Z \
  TARGET_REF=v0.4.22
```

It stops after same-version baseline verification. After reviewing the run
evidence, resume with `RUN_ID=<id>`. Upgraded verification stops again until a
fresh clean-browser evidence file for both `admin/dev` and `hr-demo/hr` is
provided. Failure preserves evidence and never rolls back automatically:

```bash
sudo make on-host-preview-rehearse-rollback RUN_ID=<id>
```

Production remains read-only. Current-production parity is informational only
for historical runs. The only automatically replayed persistent-output member
is `output/resumes/location-info/job5156-location-info.json`; worker state,
telemetry, auto-tune data, news databases, generated HTML, tracked samples, and
nested backups are excluded. Explicit rollback reinstalls the protected
application version's dependencies, restores the protected data, and reapplies
preview integration isolation; isolation is never lifted automatically.

## Quiesce behavior

Both scripts use `deploy/quiesce.sh` to set a maintenance flag on both environments before export/import. During maintenance:

- **Crons** (6 handlers) skip execution
- **Scheduler dispatch** (`analysis_tasks:dispatch`, `resume_tasks:submit`) refuses new work
- **In-flight scheduled tasks** defer themselves by 60s
- **BFF API** returns 503 on write methods (POST/PUT/PATCH/DELETE)
- **Python worker** skips crawl cycle (controlled via `TRENDS_API_URL`)

The flag auto-clears on the target after `import --replace-all` (wipes the table). The trap-based `release_writers` on EXIT is a safety net.

## ID preservation

Before any `--replace-all`, the script audits resume `_id` sets:

1. Extract `_id`s from both source and target exports
2. Fail if target has IDs not in source (would be deleted by replace-all)
3. Override with `RESTORE_ALLOW_ID_LOSS=1` only if explicitly accepting data loss

After import, the script verifies all SQLite `candidate_actions.resume_id` values still resolve in Convex.

## Manual operations

### Empty prod SQLite (separate operation)

If you need to wipe prod's `candidate_actions` (e.g. to reset all recruiter decisions):

```bash
ssh ptcloud
# Safety backup first
cp /opt/trends/output/resume_screening.db /opt/trends/output/resume-backups/resume_screening-$(date -u +%Y%m%dT%H%M%SZ).bak
# Empty it
sudo -u trends sqlite3 /opt/trends/output/resume_screening.db "DELETE FROM candidate_actions;"
```

This is NOT part of the restore scripts — run separately and intentionally.

### Toggle maintenance mode manually

```bash
# On prod
ssh ptcloud
sudo -u trends bash -c "cd /opt/trends/packages/convex && CONVEX_URL=http://127.0.0.1:3210 \
    npx convex run system_settings:set '{\"key\":\"maintenanceMode\",\"value\":true,\"updatedBy\":\"manual\"}'"

# Check status (prod API listens on port 3000)
curl -s http://127.0.0.1:3000/api/system/maintenance

# Release
sudo -u trends bash -c "cd /opt/trends/packages/convex && CONVEX_URL=http://127.0.0.1:3210 \
    npx convex run system_settings:set '{\"key\":\"maintenanceMode\",\"value\":false,\"updatedBy\":\"manual\"}'"
```
