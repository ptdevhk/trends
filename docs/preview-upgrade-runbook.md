# Preview Site Upgrade CLI Runbook (`ptcloud`)

Complete, operator-facing runbook for refreshing the **preview** site on `ptcloud` from production data, then upgrading preview application code to the latest Trends version.

**Audience:** any engineer with SSH access to `ptcloud` and sudo.

**Safety contract (non-negotiable):**

- Production may only be used for **inspection**, **backup**, and **export**.
- Never run production upgrade commands from the preview tree without the guards in this document.
- Never import data into the production database.
- Never run `make deploy` / `./scripts/install.sh upgrade` from `/opt/trends` while performing a *preview* upgrade.
- Stop immediately if backup, import, migration, service restart, or health check fails.
- A selected historical backup is not the same operation as the current
  live-production clone. Use the historical rehearsal workflow below.

**Code upgrade ≠ search freshness (non-negotiable):**

- App version bumps and `preview-upgrade.sh` refresh **code only**. They do
  **not** recompute verified role years / resume digests for every resume.

## Historical backup replay: exact v0.4.6 baseline to exact v0.4.22

This attended workflow restores a selected verified `prod-complete-*` snapshot,
proves the application/data at the manifest-recorded source version, and only
then upgrades to an exact target and runs the canonical migrations.
Run it from the fixed non-preview controller checkout (normally
`/home/ubuntu/trends`), never from inside `/home/ubuntu/trends-preview`; exact
historical code replacement must not replace the active controller.

The first intended invocation is:

```bash
sudo make on-host-preview-rehearse-backup \
  BACKUP_DIR=/var/backups/trends/prod-complete-20260722T191315Z \
  TARGET_REF=v0.4.22
```

These are examples, not defaults. Preflight freezes the manifest source
(`0.4.6`, `ec0695935f08554b582d788e6db543bb6edd3f61`) and exact target
(`v0.4.22`, `d771f5a913dd3905c7e50759cd11c64d04340224`), verifies checksums and
archive safety, then captures a rollback snapshot of the current preview.
Production is read-only and no current-production export is performed.

The new run stops after `verify-baseline` with `awaiting-approval`. Review the
run directory under `/var/backups/trends/preview-rehearsals/<run-id>/`, then:

```bash
sudo make on-host-preview-rehearse-resume RUN_ID=<run-id>
```

After upgrade/migrations/upgraded verification, produce fresh browser evidence:

```bash
PREVIEW_REHEARSAL_ADMIN_PASSWORD='<secure-env-value>' \
PREVIEW_REHEARSAL_HR_PASSWORD='<secure-env-value>' \
bunx tsx scripts/preview-rehearsal-browser-smoke.ts \
  --base-url https://preview.pt-mes.com \
  --run-id <run-id> \
  --target-sha d771f5a913dd3905c7e50759cd11c64d04340224 \
  --output /secure/path/browser-evidence.json

sudo make on-host-preview-rehearse-resume \
  RUN_ID=<run-id> \
  BROWSER_EVIDENCE=/secure/path/browser-evidence.json
```

The browser script creates a new context per identity, so stale cookies cannot
make login appear healthy. Evidence is redacted and contains no passwords,
cookies, CSRF tokens, or authorization headers.

Failure stops immediately and preserves the run directory. Rollback is never
automatic:

```bash
sudo make on-host-preview-rehearse-rollback RUN_ID=<run-id>
```

Explicit rollback restores the protected app/data state, reinstalls the
protected version's dependencies, and reapplies preview integration isolation.
Lifting isolation remains a separate manual action.

The output archive allowlist contains only
`output/resumes/location-info/job5156-location-info.json`. Tracked resume
samples come from the frozen commit; worker status, auto-tune state, telemetry,
news databases, generated HTML, and nested backups are recorded as skipped.
Current-production parity is informational only for historical verification.
- Preview Convex runs in **Docker**. It must call the host BFF via `BFF_API_URL=https://preview.pt-mes.com` (synced into Convex env). Container-local `http://localhost:3000` is wrong and breaks reingest.
- After every preview (and production) upgrade, run the search-freshness gate:
  - `bash deploy/search-freshness-gate.sh --role preview --api-url http://127.0.0.1:3002`
  - or `make doctor-search-freshness` (local) / doctor `--full` on preview
- Exit **3** = verified-only golden MY/CN `minRoleYears` availability or
  semantic checks failed. Treat this as a data/parity problem, not as a reason
  to do another version bump:
  - `trends resume debug trigger-reingest --mode any --limit 200 --api-url http://127.0.0.1:3002`
- Production equivalent: `bash deploy/search-freshness-gate.sh --role production --api-url http://127.0.0.1:3000` (hooked into `scripts/install.sh` full upgrade).

Canonical script directory after code lands on the host:

| Location | Purpose |
|----------|---------|
| `/opt/trends/deploy/` | Production checkout scripts (may lag) |
| `/home/ubuntu/trends/deploy/` | Mirror of `origin/main` |
| `/home/ubuntu/trends-preview/deploy/` | Preview application tree |

Prefer scripts from the **newest** available tree that contains the helpers listed below. After the first successful mirror update, use `/home/ubuntu/trends/deploy/` or the preview tree’s `deploy/`.

---

## 0. Reference map

### Host

| Item | Value |
|------|--------|
| SSH alias | `ptcloud` |
| Hostname (example) | `vmi2853904` |
| OS | Ubuntu (systemd + Docker + Caddy) |

### Production

| Item | Value |
|------|--------|
| Public host | `trends.pt-mes.com` |
| Application directory | `/opt/trends` |
| Service user | `trends` |
| Env file | `/etc/trends/env` (also `/opt/trends/.env.production`) |
| SQLite DB | `/opt/trends/output/resume_screening.db` |
| Convex URL (local) | `http://127.0.0.1:3210` |
| API URL (local) | `http://127.0.0.1:3000` |
| API systemd unit | `trends-api.service` |
| Other units | `trends-worker`, `trends-worker-api`, `trends-mcp`, `trends-convex` |
| Deploy backups | `/var/backups/trends/deploy/` |
| Complete backups | `/var/backups/trends/prod-complete-<UTC>/` |

### Preview

| Item | Value |
|------|--------|
| Public host | `preview.pt-mes.com` |
| Application directory | `/home/ubuntu/trends-preview` |
| Service user | `ubuntu` |
| Env file | `/home/ubuntu/trends-preview/.env.preview` |
| SQLite DB | `/home/ubuntu/trends-preview/output/resume_screening.db` |
| Convex URL (local) | `http://127.0.0.1:4210` (Docker → container `:3210`) |
| API URL (local) | `http://127.0.0.1:3002` |
| API systemd unit | `trends-preview-api.service` |
| Docker services | `trends-preview-convex`, `trends-preview-mcp` |
| Compose file | `/home/ubuntu/trends-preview/docker-compose.preview.yml` |
| Repo mirror | `/home/ubuntu/trends` (`origin/main`) |

### Placeholders

Replace only when your host differs:

```bash
export SSH_HOST=ptcloud
export PROD_DIR=/opt/trends
export PREVIEW_DIR=/home/ubuntu/trends-preview
export REPO_MIRROR=/home/ubuntu/trends
export PROD_ENV_FILE=/etc/trends/env
export PREVIEW_ENV_FILE=${PREVIEW_DIR}/.env.preview
export PROD_DB=${PROD_DIR}/output/resume_screening.db
export PREVIEW_DB=${PREVIEW_DIR}/output/resume_screening.db
export PROD_PUBLIC_HOST=trends.pt-mes.com
export PREVIEW_PUBLIC_HOST=preview.pt-mes.com
export BACKUP_ROOT=/var/backups/trends
export LOG_DIR=/var/log/trends
# Set only for non-interactive automation after you understand the prompts:
# export ASSUME_YES=1
```

---

## 1. Prerequisites

### Access

- SSH key access: `ssh ptcloud` (or `ssh ${SSH_HOST}`)
- Passwordless or interactive `sudo` on the host
- Membership allowing Docker, systemd, and reading `/etc/trends/env`

### Tools on `ptcloud`

```bash
ssh "${SSH_HOST:-ptcloud}" 'set -Eeuo pipefail
for c in git rsync sqlite3 curl docker systemctl tar python3 npm npx tee sha256sum; do
  command -v "$c" >/dev/null || { echo "MISSING: $c"; exit 1; }
done
echo "OK: required tools present"
docker compose version >/dev/null
systemctl --version | head -1
'
```

**Success:** prints `OK: required tools present` and compose/systemd versions.

### Laptop tools (optional remote wrappers)

- `ssh`, `make`, `curl`

### Required knowledge

- Production and preview must **not** share Convex ports (`3210` vs `4210`) or API ports (`3000` vs `3002`).
- Preview API is **host systemd**; preview Convex is **Docker**.
- `scripts/install.sh` / production `make deploy` always target `/opt/trends`.  
  From the preview directory, `make deploy` routes to `deploy/preview-upgrade.sh` only.

---

## 2. Session bootstrap

```bash
ssh "${SSH_HOST:-ptcloud}"
# On the host:
set -Eeuo pipefail
export PROD_DIR=/opt/trends
export PREVIEW_DIR=/home/ubuntu/trends-preview
export REPO_MIRROR=/home/ubuntu/trends
export TS="$(date -u +%Y%m%dT%H%M%SZ)"
export LOG_DIR=/var/log/trends
sudo mkdir -p "$LOG_DIR" /var/backups/trends
hostname; whoami; date -u +%Y-%m-%dT%H:%M:%SZ
```

Identify which script tree to use:

```bash
set -Eeuo pipefail
for d in \
  "$PREVIEW_DIR/deploy" \
  "$REPO_MIRROR/deploy" \
  "$PROD_DIR/deploy"
do
  if [[ -f "$d/backup-prod-complete.sh" && -f "$d/preview-upgrade.sh" ]]; then
    export DEPLOY_SCRIPTS="$d"
    echo "Using DEPLOY_SCRIPTS=$DEPLOY_SCRIPTS"
    break
  fi
done
[[ -n "${DEPLOY_SCRIPTS:-}" ]] || { echo "Deploy helpers not found. Update mirror first."; exit 1; }
```

If helpers are missing on the host, update the mirror **read-only for prod**, without touching `/opt/trends`:

```bash
set -Eeuo pipefail
sudo -u ubuntu git -C /home/ubuntu/trends fetch origin main
sudo -u ubuntu git -C /home/ubuntu/trends reset --hard origin/main
export DEPLOY_SCRIPTS=/home/ubuntu/trends/deploy
```

---

## 3. Discover production and preview identity (read-only)

```bash
set -Eeuo pipefail

echo "=== Production ==="
sudo -u trends git -C "$PROD_DIR" rev-parse --short HEAD
sudo -u trends git -C "$PROD_DIR" branch --show-current
sudo -u trends git -C "$PROD_DIR" log -1 --oneline
cat "$PROD_DIR/version"
ls -la "$PROD_ENV_FILE" "$PROD_DB"
systemctl is-active trends-api trends-worker trends-worker-api trends-mcp || true
curl -sS -o /dev/null -w "prod_api_blocks=%{http_code}\n" --max-time 5 http://127.0.0.1:3000/api/blocks || true
curl -sS -o /dev/null -w "prod_convex=%{http_code}\n" --max-time 5 http://127.0.0.1:3210/version || true

echo "=== Preview ==="
ls -la "$PREVIEW_DIR" | head
[[ -f "$PREVIEW_DIR/.trends-source-meta" ]] && cat "$PREVIEW_DIR/.trends-source-meta" || echo "no .trends-source-meta"
cat "$PREVIEW_DIR/version" 2>/dev/null || true
grep -E '^(CONVEX_URL|CONVEX_PUBLIC_URL|AUTH_ALLOWED_ORIGINS)=' "$PREVIEW_ENV_FILE" || true
systemctl is-active trends-preview-api || true
docker ps --filter name=trends-preview --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -sS -o /dev/null -w "preview_api=%{http_code}\n" --max-time 5 http://127.0.0.1:3002/api/blocks || true
curl -sS -o /dev/null -w "preview_convex=%{http_code}\n" --max-time 5 http://127.0.0.1:4210/version || true
```

**Record (fill in during the change window):**

| Field | Production | Preview (before) |
|-------|------------|------------------|
| Git SHA | | |
| Branch | | |
| `version` file | | |
| candidate_actions count | | |

```bash
sqlite3 "$PROD_DB" "SELECT count(*) FROM candidate_actions;"
sqlite3 "$PREVIEW_DB" "SELECT count(*) FROM candidate_actions;" 2>/dev/null || echo "preview db missing"
```

**Stop if:** production API or Convex is down and you expected a live clone of current prod data.

---

## 4. Production complete backup (**mandatory first write-side step**)

> **Modifies:** creates files under `/var/backups/trends/prod-complete-<UTC>/` and may briefly quiesce Convex writers for export.  
> **Does not:** change application code, import into any DB, or restart production API permanently.

```bash
set -Eeuo pipefail
# Interactive confirmation unless ASSUME_YES=1
sudo bash "$DEPLOY_SCRIPTS/backup-prod-complete.sh" 2>&1 | tee "$LOG_DIR/backup-prod-${TS}.log"
```

Non-interactive (after you accept risk):

```bash
sudo ASSUME_YES=1 bash "$DEPLOY_SCRIPTS/backup-prod-complete.sh" 2>&1 | tee "$LOG_DIR/backup-prod-${TS}.log"
```

### Verify backup before continuing

```bash
set -Eeuo pipefail
BACKUP_DIR="$(ls -1dt /var/backups/trends/prod-complete-* | head -1)"
echo "BACKUP_DIR=$BACKUP_DIR"
test -s "$BACKUP_DIR/MANIFEST.txt"
grep -E '^status=OK$' "$BACKUP_DIR/MANIFEST.txt"
test -s "$BACKUP_DIR/git/HEAD"
test -s "$BACKUP_DIR/config/etc-trends-env"
test -s "$BACKUP_DIR/sqlite/resume_screening.db"
test -s "$BACKUP_DIR/convex/convex-export.zip"
sqlite3 "$BACKUP_DIR/sqlite/resume_screening.db" "PRAGMA integrity_check;" | grep -qx ok
unzip -t "$BACKUP_DIR/convex/convex-export.zip" >/dev/null
cat "$BACKUP_DIR/MANIFEST.txt"
export BACKUP_DIR
echo "Backup verified: $BACKUP_DIR"
```

**Success criteria:**

- `status=OK` in `MANIFEST.txt`
- SQLite `integrity_check` → `ok`
- Convex zip passes `unzip -t`
- `prod_sha` / `prod_branch` / `candidate_actions_count` recorded

**Stop if:** any check fails. Do not touch preview until backup is good.

### Optional: include Convex file storage

```bash
sudo ASSUME_YES=1 INCLUDE_FILE_STORAGE=1 bash "$DEPLOY_SCRIPTS/backup-prod-complete.sh"
```

---

## 5. Preview preflight (read-only)

```bash
set -Eeuo pipefail
sudo bash "$DEPLOY_SCRIPTS/preview-preflight.sh" 2>&1 | tee "$LOG_DIR/preview-preflight-${TS}.log"
```

**Success:** ends with `Preflight OK`.

**Stop if:** preview env points at production (`:3210`, `trends.pt-mes.com`), or preview SQLite path resolves to the production DB file.

---

## 6. Preferred: single-command data parity sync

> **This is the primary path.** Code pin alone does **not** reproduce HR search totals or status facets.

Architecture: `docs/backup-restore-architecture.md`

```bash
set -Eeuo pipefail
# Loads CONVEX_WRITE_SECRET for quiesce from /etc/trends/env when run as root
sudo ASSUME_YES=1 DIGEST_BACKFILL_MODE=skip \
  bash "$DEPLOY_SCRIPTS/preview-sync-from-prod.sh" --data-only \
  2>&1 | tee "$LOG_DIR/preview-sync-${TS}.log"
```

With code pin to production SHA as well:

```bash
sudo ASSUME_YES=1 DIGEST_BACKFILL_MODE=skip \
  bash "$DEPLOY_SCRIPTS/preview-sync-from-prod.sh" --with-code-pin
```

**Digest policy:** default `DIGEST_BACKFILL_MODE=skip` keeps production digests (search parity).  
`always` recomputes digests and **will** drift search totals.

## 6b. Legacy: clone production **application version** only

> **Modifies:** `/home/ubuntu/trends-preview` only (moves previous tree to `trends-preview.bak.<ts>`).  
> **Does not:** copy Convex/SQLite data. **Not sufficient for UI parity.**

```bash
set -Eeuo pipefail
# Must not run from /opt/trends
cd /tmp
sudo bash "$DEPLOY_SCRIPTS/preview-clone-from-prod.sh" 2>&1 | tee "$LOG_DIR/preview-clone-${TS}.log"
```

Non-interactive:

```bash
cd /tmp
sudo ASSUME_YES=1 bash "$DEPLOY_SCRIPTS/preview-clone-from-prod.sh" 2>&1 | tee "$LOG_DIR/preview-clone-${TS}.log"
```

### Verify clone

```bash
set -Eeuo pipefail
cd "$PREVIEW_DIR"
pwd
hostname
cat .trends-source-meta
cat version
# Source SHA must match production HEAD from backup
diff -u <(cat "$BACKUP_DIR/git/HEAD") <(grep '^SOURCE_SHA=' .trends-source-meta | cut -d= -f2)
grep -E '^(CONVEX_URL|CONVEX_PUBLIC_URL|AUTH_ALLOWED_ORIGINS)=' .env.preview
# Isolation: must not include production host
! grep -q 'trends.pt-mes.com' .env.preview || { echo "FAIL: prod host in preview env"; exit 1; }
grep -q '4210' .env.preview
curl -sS -o /dev/null -w "preview_api=%{http_code}\n" --max-time 10 http://127.0.0.1:3002/api/blocks
```

**Success:** `.trends-source-meta` shows `SOURCE=production` and SHA matches backup; env still preview-scoped.

---

## 7. Synchronize production **data** into preview

> **Modifies:** preview Convex (replace-all import) and preview SQLite.  
> **Does not:** write to production SQLite or production Convex import.

### Preferred: full state (Convex + SQLite candidate actions)

```bash
set -Eeuo pipefail
# Prefer production tree script if present (same logic)
RESTORE_SCRIPT="$PROD_DIR/deploy/restore-preview-full-state-from-prod.sh"
[[ -x "$RESTORE_SCRIPT" ]] || RESTORE_SCRIPT="$DEPLOY_SCRIPTS/restore-preview-full-state-from-prod.sh"
sudo SKIP_PREVIEW_AI_SMOKE="${SKIP_PREVIEW_AI_SMOKE:-1}" bash "$RESTORE_SCRIPT" 2>&1 | tee "$LOG_DIR/preview-restore-full-${TS}.log"
```

Convex-only:

```bash
sudo bash "$PROD_DIR/deploy/restore-preview-from-prod.sh" 2>&1 | tee "$LOG_DIR/preview-restore-convex-${TS}.log"
```

SQLite-only (after Convex already restored):

```bash
sudo bash "$PROD_DIR/deploy/restore-preview-full-state-from-prod.sh" --sqlite-only
```

### Verify data sync

```bash
set -Eeuo pipefail
PROD_CA="$(sqlite3 "$PROD_DB" "SELECT count(*) FROM candidate_actions;")"
PREV_CA="$(sqlite3 "$PREVIEW_DB" "SELECT count(*) FROM candidate_actions;")"
echo "prod_candidate_actions=$PROD_CA preview_candidate_actions=$PREV_CA"
[[ "$PROD_CA" == "$PREV_CA" ]] || { echo "FAIL: SQLite count mismatch"; exit 1; }

for endpoint in \
  http://127.0.0.1:3002/api/blocks \
  "http://127.0.0.1:3002/api/resumes?source=convex&paged=true&limit=1"; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$endpoint")"
  printf '%s=%s\n' "$endpoint" "$status"
  # 200 is the legacy/open-API response; 401 means the protected route is
  # reachable and auth is enforced. Neither response proves data parity.
  [[ "$status" == 200 || "$status" == 401 ]] || {
    echo "FAIL: preview endpoint returned $status" >&2
    exit 1
  }
done

# The authenticated parity gate is the data check: it requires production and
# preview HR-demo login, authenticated 200 responses, and matching SQLite
# candidate_actions counts. Search totals/status counts are compared too; a
# data-only sync intentionally keeps preview's newer code, so a total mismatch
# is a warning when API versions differ. Use PARITY_STRICT_SEARCH=1 (or pin
# preview code to production) when exact search-semantic parity is required.
bash deploy/preview-parity-check.sh
```

**Stop if:** import errors, count mismatch, an endpoint returns neither 200 nor
401, or the authenticated parity check fails. A version-drift search warning
is expected to be reviewed, not silently treated as identical behavior.

---

## 8. Restore / enforce preview-specific configuration

Isolation (clears Telegram tokens, forces preview URLs):

```bash
set -Eeuo pipefail
# Dry-run first
sudo bash "$DEPLOY_SCRIPTS/preview-isolate-integrations.sh"
# Apply
sudo ASSUME_YES=1 bash "$DEPLOY_SCRIPTS/preview-isolate-integrations.sh" --apply
```

Hydrate AI keys into preview without copying prod URLs (existing helper):

```bash
sudo PREVIEW_DIR="$PREVIEW_DIR" bash "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh"
```

### Manual review checklist for `.env.preview`

```bash
set -Eeuo pipefail
cd "$PREVIEW_DIR"
set +o nounset
set -a
# shellcheck disable=SC1091
source .env.preview
set +a
set -o nounset

echo "CONVEX_URL=$CONVEX_URL"                 # must be http://127.0.0.1:4210
echo "CONVEX_PUBLIC_URL=$CONVEX_PUBLIC_URL"   # must be https://preview.pt-mes.com/convex
echo "AUTH_ALLOWED_ORIGINS=$AUTH_ALLOWED_ORIGINS"  # preview host only
echo "TELEGRAM_BOT_TOKEN length=${#TELEGRAM_BOT_TOKEN}"  # prefer 0 after isolate
echo "AI_ANALYSIS_ENABLED=${AI_ANALYSIS_ENABLED:-}"
```

Disable production-only behaviors operators often forget:

| Concern | Preview expectation |
|---------|---------------------|
| Domain / URLs | `preview.pt-mes.com` only |
| Convex | port `4210`, never `3210` |
| Email / Telegram | tokens empty or non-prod chat |
| Payments / webhooks | keys empty |
| Worker crawl against prod APIs | `WORKER_INTERVAL_MINUTES` high or worker not scheduled on preview |
| OIDC | preview redirect URI only |

Restart preview API after env edits:

```bash
sudo systemctl restart trends-preview-api
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 http://127.0.0.1:3002/api/blocks
```

---

## 9. Context print before upgrade (mandatory)

```bash
set -Eeuo pipefail
cd "$PREVIEW_DIR"
echo "hostname=$(hostname)"
echo "pwd=$(pwd -P)"
echo "app_path=$PREVIEW_DIR"
echo "env_file=$PREVIEW_ENV_FILE"
echo "env_name=$(basename "$PREVIEW_ENV_FILE")"
echo "db=$PREVIEW_DB"
echo "convex=$(grep '^CONVEX_URL=' .env.preview)"
echo "public=$(grep '^CONVEX_PUBLIC_URL=' .env.preview)"
[[ -f .trends-source-meta ]] && cat .trends-source-meta
echo "version=$(cat version 2>/dev/null || true)"
# Refuse if production cwd
case "$(pwd -P)" in
  /opt/trends|/opt/trends/*) echo "FATAL: in production dir"; exit 1 ;;
esac
# Refuse if install.sh would be the wrong tool without routing
if [[ "$(pwd -P)" == *"/trends-preview"* ]]; then
  echo "OK: preview directory confirmed"
fi
```

**Alternative (scripted):**

```bash
sudo bash "$PREVIEW_DIR/deploy/preview-preflight.sh"
```

---

## 10. Upgrade preview to latest application version

> **Working directory must be** `/home/ubuntu/trends-preview`.  
> **Command routes:** `make deploy` → `deploy/preview-upgrade.sh` (preview only).  
> **`./scripts/install.sh upgrade` is production-only** and will **refuse** when cwd is preview.

### Option A (recommended): `make deploy` from preview

```bash
set -Eeuo pipefail
cd /home/ubuntu/trends-preview
pwd -P | grep -q trends-preview
sudo ASSUME_YES=1 make deploy 2>&1 | tee "$LOG_DIR/preview-upgrade-${TS}.log"
```

### Option B: explicit upgrade script

```bash
set -Eeuo pipefail
cd /home/ubuntu/trends-preview
sudo ASSUME_YES=1 bash ./deploy/preview-upgrade.sh 2>&1 | tee "$LOG_DIR/preview-upgrade-${TS}.log"
```

### Option C: pin to a branch/ref

```bash
cd /home/ubuntu/trends-preview
sudo ASSUME_YES=1 SOURCE_REF=origin/main bash ./deploy/preview-upgrade.sh
# or a tag/sha available in /home/ubuntu/trends:
# sudo ASSUME_YES=1 SOURCE_REF=v0.4.7 bash ./deploy/preview-upgrade.sh
```

### Forbidden

```bash
# FORBIDDEN during preview work — upgrades production
cd /opt/trends && make deploy
cd /opt/trends && sudo ./scripts/install.sh upgrade

# FORBIDDEN — install.sh always targets /opt/trends; from preview it must refuse
cd /home/ubuntu/trends-preview && sudo ./scripts/install.sh upgrade
# Expected: ERROR refusing production install/upgrade from a preview path
```

### Verify upgrade identity

```bash
set -Eeuo pipefail
cd "$PREVIEW_DIR"
cat .trends-source-meta
cat version
cat apps/web/dist/.trends-build-meta 2>/dev/null || true
# Production must be unchanged vs backup
echo "prod_now=$(sudo -u trends git -C "$PROD_DIR" rev-parse HEAD)"
echo "prod_bak=$(cat "$BACKUP_DIR/git/HEAD")"
[[ "$(sudo -u trends git -C "$PROD_DIR" rev-parse HEAD)" == "$(cat "$BACKUP_DIR/git/HEAD")" ]] \
  || echo "WARN: production HEAD moved during window (investigate)"
```

---

## 11. Post-upgrade verification

### 11.1 Services and ports

```bash
set -Eeuo pipefail
systemctl is-active trends-preview-api
systemctl is-active trends-api   # production must remain active
docker ps --filter name=trends-preview --format 'table {{.Names}}\t{{.Status}}'
ss -tlnp | grep -E ':(3000|3002|3210|4210)\s' || true
```

### 11.2 Doctor + search freshness

```bash
bash "$PREVIEW_DIR/deploy/preview-doctor.sh" --full
# Optional recovery (preview only):
# bash "$PREVIEW_DIR/deploy/preview-doctor.sh" --recover --full

# Code upgrade ≠ computed verified role years. Gate golden MY/CN checks + compute lag:
bash "$PREVIEW_DIR/deploy/search-freshness-gate.sh" --role preview --api-url http://127.0.0.1:3002

# Convex (Docker) must reach host BFF — never container localhost:3000:
#   BFF_API_URL=https://preview.pt-mes.com in .env.preview
#   PREVIEW_DIR=... bash deploy/sync-preview-convex-env.sh --sync-only
# Repair lag / stale verified-role projections:
#   trends resume debug trigger-reingest --mode any --limit 200 --api-url http://127.0.0.1:3002
```

### 11.3 HTTP health

```bash
set -Eeuo pipefail
for url in \
  "http://127.0.0.1:3002/api/blocks" \
  "http://127.0.0.1:3002/api/resumes?source=convex&paged=true&limit=1" \
  "http://127.0.0.1:4210/version" \
  "https://preview.pt-mes.com/" \
  "https://preview.pt-mes.com/api/blocks" \
  "https://preview.pt-mes.com/convex/version"
do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo 000)"
  printf '%s → %s\n' "$url" "$code"
  [[ "$code" =~ ^[23] ]] || { echo "FAIL $url"; exit 1; }
done
```

### 11.4 Authentication

```bash
set -Eeuo pipefail
cd "$PREVIEW_DIR"
set -a
# shellcheck disable=SC1091
source .env.preview
set +a
USER0="${BOOTSTRAP_ADMIN_USERS%%,*}"
USER0="${USER0:-admin}"
if [[ -n "${AUTH_BOOTSTRAP_PASSWORD:-}" ]]; then
  curl -sS -X POST "http://127.0.0.1:3002/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER0\",\"password\":\"$AUTH_BOOTSTRAP_PASSWORD\"}" \
    | tee /tmp/preview-login-${TS}.json
  grep -q '"success":true' /tmp/preview-login-${TS}.json
  echo "admin login OK ($USER0)"
else
  echo "AUTH_BOOTSTRAP_PASSWORD unset; skip login check (manual browser login required)"
fi
```

### 11.5 Database / migrations

Preview Convex schema is applied via container start (`start-convex.sh` / `convex dev --once`). Confirm:

```bash
set -Eeuo pipefail
docker logs trends-preview-convex --tail 80 2>&1 | tee "$LOG_DIR/preview-convex-tail-${TS}.log"
# Optional function smoke (inside container):
docker exec trends-preview-convex bash -c \
  "cd /app/packages/convex && npx convex run resumes_search:scanResumePageSlim '{\"numItems\":1}'" \
  | tee "$LOG_DIR/preview-resume-page-${TS}.log"
```

SQLite still preview-local:

```bash
readlink -f "$PREVIEW_DB"
readlink -f "$PROD_DB"
# Must differ
[[ "$(readlink -f "$PREVIEW_DB")" != "$(readlink -f "$PROD_DB")" ]]
sqlite3 "$PREVIEW_DB" "PRAGMA integrity_check;" | grep -qx ok
```

### 11.6 Static files and uploads

```bash
set -Eeuo pipefail
test -f "$PREVIEW_DIR/apps/web/dist/index.html"
curl -sS -o /dev/null -w "index=%{http_code}\n" "https://preview.pt-mes.com/"
# Sample asset if present
ls "$PREVIEW_DIR/apps/web/dist/assets" 2>/dev/null | head
```

### 11.7 Background jobs / scheduler

Preview does **not** run production `trends-worker.service` against preview by default. Confirm production worker still points at prod:

```bash
systemctl is-active trends-worker trends-worker-api
# Preview MCP container (optional)
docker ps --filter name=trends-preview-mcp --format '{{.Names}} {{.Status}}'
```

If you run AI analysis smoke on preview (uses preview Convex only):

```bash
cd "$PREVIEW_DIR"
# Optional; can call external AI providers — set SKIP if that is undesirable
# SKIP_PREVIEW_AI_SMOKE=1 by default in full-state restore wrapper
CONVEX_URL=http://127.0.0.1:4210 npx tsx scripts/verify-critical-path.ts \
  --mode=seeded --keyword=CNC --analysis-timeout-sec=300 --json \
  | tee "$LOG_DIR/preview-ai-smoke-${TS}.json"
```

If `.env.preview` has `AI_ANALYSIS_ENABLED=false`, the analysis leg is
intentionally unavailable on preview. In that case:

- still treat doctor, auth login, isolation, and search-freshness gates as the
  preview-host readiness decision surface
- do **not** treat skipped preview-host AI smoke as a blocker by itself
- run authoritative scoring verification on a local/auth-enabled stack instead
  of forcing preview to exercise AI analysis

### 11.8 Notifications / external APIs isolation

```bash
set -Eeuo pipefail
cd "$PREVIEW_DIR"
# After isolate, Telegram tokens should be empty
grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=' .env.preview
# Should not contain production domain
! grep -E 'trends\.pt-mes\.com' .env.preview
# Preview public host only for auth origins
grep '^AUTH_ALLOWED_ORIGINS=' .env.preview
```

### 11.9 Logs (no critical errors)

```bash
set -Eeuo pipefail
sudo journalctl -u trends-preview-api -n 100 --no-pager | tee "$LOG_DIR/preview-api-journal-${TS}.log"
# Fail on obvious critical patterns (tune as needed)
if sudo journalctl -u trends-preview-api -n 200 --no-pager | grep -Ei 'FATAL|Unhandled|ECONNREFUSED 127.0.0.1:3210'; then
  echo "Investigate critical log patterns above"
  exit 1
fi
docker logs trends-preview-convex --tail 50 2>&1 | grep -Ei 'error|fatal' || true
```

### 11.10 Production untouched

```bash
set -Eeuo pipefail
systemctl is-active trends-api
curl -sS -o /dev/null -w "prod=%{http_code}\n" --max-time 10 https://trends.pt-mes.com/api/blocks
sudo -u trends git -C "$PROD_DIR" rev-parse HEAD
cat "$BACKUP_DIR/git/HEAD"
```

---

## 12. Failure handling and stop conditions

| Failure | Action |
|---------|--------|
| Backup incomplete / verify fail | **STOP.** Do not clone or import. Fix backup first. |
| Preflight env isolation fail | **STOP.** Fix `.env.preview` before any restart. |
| Clone/rsync fail | Restore previous tree: `mv $PREVIEW_DIR $PREVIEW_DIR.failed; mv $PREVIEW_DIR.bak.<ts> $PREVIEW_DIR` |
| Convex import fail | Leave preview in maintenance; restore from preview bak + previous Convex volume if needed; re-run restore after fix |
| Preview Convex unhealthy | `bash deploy/preview-doctor.sh --recover --full` |
| Upgrade build fail | Tree backup at `$PREVIEW_DIR.upgrade-bak.<ts>`; rsync back; restart API |
| Health check fail | **STOP.** Do not continue to “done”. Open logs; roll back if needed |
| Accidental production change | **STOP.** Escalate. Use production deploy backup under `/var/backups/trends/deploy/` |

---

## 13. Rollback

### 13.1 Application tree (preview)

```bash
set -Eeuo pipefail
# List backups
ls -1d /home/ubuntu/trends-preview.bak.* /home/ubuntu/trends-preview.upgrade-bak.* 2>/dev/null
# Example rollback of full tree (pre-clone backup)
sudo systemctl stop trends-preview-api
sudo mv /home/ubuntu/trends-preview "/home/ubuntu/trends-preview.failed.${TS}"
sudo mv /home/ubuntu/trends-preview.bak.<TIMESTAMP> /home/ubuntu/trends-preview
cd /home/ubuntu/trends-preview
sudo docker compose -f docker-compose.preview.yml up -d
sudo systemctl start trends-preview-api
```

### 13.2 Preview env only

```bash
# Scripts write /tmp/preview-env-*.env backups
ls -1t /tmp/preview-env*.env | head
sudo cp -a /tmp/preview-env-<TIMESTAMP>.env /home/ubuntu/trends-preview/.env.preview
sudo chmod 600 /home/ubuntu/trends-preview/.env.preview
sudo chown ubuntu:ubuntu /home/ubuntu/trends-preview/.env.preview
sudo systemctl restart trends-preview-api
```

### 13.3 Preview SQLite (from full-state restore backup)

```bash
# Created by restore-preview-full-state-from-prod.sh
ls -1d /home/ubuntu/trends-preview/output/pre-full-state-restore-* 2>/dev/null
sudo systemctl stop trends-preview-api
sudo cp -a /home/ubuntu/trends-preview/output/pre-full-state-restore-<TS>/resume_screening.db* \
  /home/ubuntu/trends-preview/output/
sudo systemctl start trends-preview-api
```

### 13.4 Preview Convex data

Re-import from the production complete backup export (preview only):

```bash
set -Eeuo pipefail
# Copy zip into preview workspace and import via restore script, or:
sudo cp "$BACKUP_DIR/convex/convex-export.zip" "$PREVIEW_DIR/prod-convex-export.zip"
# Prefer the maintained restore script (handles strip/fix + digests):
sudo bash "$PROD_DIR/deploy/restore-preview-from-prod.sh"
```

### 13.5 Production

This runbook does **not** roll back production. If production was modified outside this runbook, use `/var/backups/trends/deploy/deploy-<ts>/` and `scripts/install.sh` production procedures — out of scope here.

---

## 14. Cleanup

```bash
set -Eeuo pipefail
# Temporary exports (safe to remove after verified upgrade)
sudo rm -f /tmp/prod-convex-export.zip /tmp/prod-convex-export-fixed.zip
sudo rm -f "$PREVIEW_DIR/prod-convex-export.zip"
# Keep complete backups; prune only after retention policy agreement
# Example: keep last 5 complete backups
# ls -1dt /var/backups/trends/prod-complete-* | tail -n +6 | xargs -r sudo rm -rf
# Optional: remove old preview tree backups after confirmation
# ls -1d /home/ubuntu/trends-preview.bak.* 
```

Do **not** delete the latest `BACKUP_DIR` until the change window is closed and sign-off is complete.

---

## 15. Final sign-off checklist

Copy and check off:

- [ ] Production complete backup created and `status=OK`
- [ ] Backup SQLite integrity OK; Convex zip OK
- [ ] Preview preflight passed
- [ ] Preview app cloned from production SHA (if clone step run)
- [ ] Preview data restored (Convex ± SQLite) and counts verified
- [ ] Preview env isolated (no `trends.pt-mes.com`, Convex `:4210`, Telegram cleared or reviewed)
- [ ] Upgrade run **only** from `/home/ubuntu/trends-preview` via `make deploy` or `preview-upgrade.sh`
- [ ] `./scripts/install.sh upgrade` was **not** used to change production during this window
- [ ] Production SHA matches pre-change backup HEAD
- [ ] `trends-preview-api` active; preview HTTP 200 on web/API/convex
- [ ] Admin login verified (or explicit waiver)
- [ ] Logs reviewed; no critical errors
- [ ] Doctor clean or residual issues documented
- [ ] Rollback path known (`BACKUP_DIR`, preview `.bak.*`, env backups under `/tmp`)
- [ ] Cleanup of temp dumps done or scheduled
- [ ] Operators notified that preview may still call external AI if `AI_*` keys are set

**Sign-off**

| Field | Value |
|-------|--------|
| Operator | |
| Date (UTC) | |
| Production SHA | |
| Preview SHA / version after | |
| Backup dir | |
| Result | PASS / FAIL |
| Notes | |

---

## 16. Quick command index

```bash
# SSH
ssh ptcloud

# Backup prod (first)
sudo ASSUME_YES=1 bash /home/ubuntu/trends/deploy/backup-prod-complete.sh

# Preflight
sudo bash /home/ubuntu/trends/deploy/preview-preflight.sh

# Clone prod version → preview
sudo ASSUME_YES=1 bash /home/ubuntu/trends/deploy/preview-clone-from-prod.sh

# Sync data prod → preview
sudo SKIP_PREVIEW_AI_SMOKE=1 bash /opt/trends/deploy/restore-preview-full-state-from-prod.sh

# Isolate integrations
sudo ASSUME_YES=1 bash /home/ubuntu/trends-preview/deploy/preview-isolate-integrations.sh --apply

# Upgrade preview (from preview dir only)
cd /home/ubuntu/trends-preview && sudo ASSUME_YES=1 make deploy
# equivalent:
cd /home/ubuntu/trends-preview && sudo ASSUME_YES=1 bash deploy/preview-upgrade.sh

# Doctor / smoke
bash /home/ubuntu/trends-preview/deploy/preview-doctor.sh --full
curl -sS -o /dev/null -w '%{http_code}\n' https://preview.pt-mes.com/api/blocks
```

### Laptop Make wrappers

```bash
make preview-backup-prod          # SSH → complete backup
make preview-deploy               # SSH → preview-upgrade
make preview-restore-data         # SSH → convex restore
make preview-doctor
make preview-smoke
```

---

## 17. Related docs and scripts

| Path | Role |
|------|------|
| `deploy/backup-prod-complete.sh` | Complete production backup |
| `deploy/preview-preflight.sh` | Read-only guards |
| `deploy/preview-clone-from-prod.sh` | Prod SHA → preview app tree |
| `deploy/preview-upgrade.sh` | Latest code → preview |
| `deploy/preview-isolate-integrations.sh` | Clear prod-facing integrations |
| `deploy/restore-preview-from-prod.sh` | Convex export/import |
| `deploy/restore-preview-full-state-from-prod.sh` | Convex + SQLite |
| `deploy/preview-doctor.sh` | Health + recovery |
| `deploy/search-freshness-gate.sh` | Post-upgrade BFF + golden MY/CN floors + optional reingest |
| `deploy/setup-preview.sh` | Legacy full preview bootstrap from `origin/main` |
| `scripts/install.sh` | **Production only** |
| `deploy/README-restore.md` | Restore quiesce notes |
| `docs/agent-runbook.md` | Agent-oriented short reference |

---

## Sources Used

- Local repository: `deploy/*`, `scripts/install.sh`, `Makefile`, live `ptcloud` inspection of paths/services/versions.
