# Convex Restore Operations

## Overview

Two restore scripts handle data sync between preview and prod:

| Script | Direction | When to use |
|--------|-----------|-------------|
| `restore-preview-from-prod.sh` | prod → preview | Refresh preview with latest prod data |
| `restore-prod-from-preview.sh` | preview → prod | Promote preview changes to prod |

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
