# Dev Sync from Preview — Design

**Status:** approved design (2026-08-10)
**Branch:** preview-v0.4.23
**Goal:** one command that makes local dev behave like the preview environment
(prod data + industry evidence + v0.4.23 semantics), with an automated hard
parity gate — equivalent guarantees to the canonical `prod → preview` flow.

## Problem statement

A manual `prod → dev` sync (2026-08-10) reproduced preview's *corpus* but not its
*behavior*. On the baseline UAT query
(`hr/resumes?location=Malaysia&q=CNC+Sales&minRoleYears=1&roleType=sales`):

| Environment | Code | Results | Notice (verified employers) |
|---|---|---|---|
| prod | v0.4.16 | 142 | n/a |
| preview | v0.4.23 | 48 | "目录中 35 家认证雇主" |
| dev (prod-synced) | v0.4.23 | 35 | hidden |

Root causes (all data/config, none code):

1. **Industry-evidence data missing on dev.** Prod v0.4.16 predates the feature;
   the 16 `company_industry_*` Convex tables exported empty. Preview's catalog
   holds 35 verified employers (built by the industry-verification workflow),
   which the search uses for employer-scoped matching and the notice count.
2. **Auth roles differ.** Preview seeds `hr-demo` as **admin** in workspace `hr`;
   the local seed uses `--role user`. The notice endpoint
   (`/api/company-industry-verified-employer-count`) is admin-only → 403 → the
   UI silently hides the notice (and logs a console 403).
3. **No orchestration.** The prod→dev sync was performed by hand: no backup
   gate, no parity check, no documented policy for digests/migrations. The
   35-vs-48 gap would have been caught by a query-total gate.

## Requirements (agreed)

1. **Dev behaves like preview** — same search totals, notice, status facets,
   admin surfaces for the same data + code.
2. **Default data source is preview** (both v0.4.23 → no schema drift; digest
   state copied verbatim instead of recomputed). `--prod-base` keeps the
   prod→dev path for when preview is stale.
3. **Adaptive migration** — auto-detect and handle: incompatible fields,
   `system_settings` exclusion, missing schema tables (materialize empty),
   digest epoch mismatch (backfill only when dev code epoch differs from the
   imported digests), SQLite auto-migration on API start.
4. **Auth roles match preview** — `hr-demo` = admin in `hr`, plus `admin@dev`
   ops account; local `auth:bootstrap-hr-demo` npm script updated to admin.
5. **Hard parity gate** — corpus total, baseline query totals, candidate_actions
   count, verified-employer count, auth smoke; source-aware (see contract).
6. **File storage opt-in** — `--with-file-storage` flag; default off.
7. **Safety** — local backup hard gate before any write; ptcloud touched only by
   read-only exports (never quiesce prod/preview); rollback instructions
   printed on failure.

## Architecture

**New files**

| File | Role |
|---|---|
| `deploy/dev-sync-from-preview.sh` | Orchestrator — one command, source-parametrized (`preview` default, `--prod-base`) |
| `deploy/lib-dev-common.sh` | Dev-host helpers: local paths, dev API stop/start (detached, `.env` sourced), local Convex import wrapper, auth re-seed |
| `deploy/dev-parity-check.sh` | Source-aware parity gate (curl + python3, same style as `preview-parity-check.sh`) |

**Reused as-is**

- `deploy/lib-preview-common.sh` — context reports, `confirm_or_exit`, logging
- Export-fix python step from `restore-preview-from-prod.sh` (extracted to a
  shared snippet so both flows stay in sync)
- `.backup` SQLite swap pattern from `restore-preview-full-state-from-prod.sh`
- `scripts/auth/manage-user.ts` for auth seeding

**Modified**

- `package.json`: `auth:bootstrap-hr-demo` → `--role admin`
- `Makefile`: `on-host-dev-sync-from-preview` target
- `docs/agent-runbook.md` + `docs/backup-restore-architecture.md`: new dev
  target node + runbook section

**Key architectural choice:** the orchestrator runs **on the dev host**, reaching
ptcloud over SSH for the export only. All imports, swaps, seeds, and checks run
locally. Shared systems are never written or quiesced.

## Data flow (phases)

**Phase 0 — Preflight & local backup (hard gate).**
Check: local Convex backend up, SSH reachable, required CLIs
(`sqlite3`, `unzip`, `zip`, `python3`), dev API state. Backup before any write:
export local Convex → `/tmp/trends-sync/local-backup-<ts>.zip`; copy local
SQLite (`db` + `-wal` + `-shm`) → `output/backups/pre-sync-<ts>/`. Abort on
failure.

**Phase 1 — Source export (read-only, on ptcloud).**
- Default `preview`: `docker exec trends-preview-convex ... npx convex export --path /tmp/preview-convex-export.zip` (plus `--include-file-storage` only with `--with-file-storage`), then `scp` to the dev host.
- `--prod-base`: `sudo -u trends` host export (as the 2026-08-10 manual run).
- SQLite snapshot: `sqlite3 <source-output>/resume_screening.db ".backup /tmp/..."` on ptcloud → `scp` down.

**Phase 2 — Adaptive fix.**
Same python step as the preview flow: strip fields the target schema rejects
(e.g. `screening_sessions.config.filters.showBlocked`), drop `system_settings`
(maintenance flag is environment-local), materialize target-schema tables
missing from the export as empty.

**Phase 3 — Local Convex import.**
`npx convex import --replace-all <fixed.zip> --yes` against
`http://127.0.0.1:3210` (admin key from `.convex/local/default/config.json`).

**Phase 4 — Adaptive digest step.**
Compare imported `resume_digests` `ingestComputeEpoch` vs local
`CURRENT_INGEST_COMPUTE_EPOCH`:
- match → skip (default for preview→dev: digest state copied verbatim — this
  is the point of preview→dev);
- mismatch (dev code newer than source) → run `backfillResumeDigests` loop
  (batches of 100, cursor-paginated);
- `--digest-backfill=always|skip` overrides detection.

**Phase 5 — SQLite swap + auth + API restart.**
Stop the dev API process tree (tsx-watch child on :3000) → swap
`output/resume_screening.db` from the `.backup` (remove stale `-wal`/`-shm`) →
seed auth → start API detached (`setsid nohup`, `.env` sourced, logs →
`logs/api.log`) → wait for `/api/blocks` 200/401.

**Auth seeding (role policy = preview):**
- `hr-demo` — role **admin** in workspace `hr`, password from
  `AUTH_HR_DEMO_PASSWORD` (required; local `.env` value `admin123`).
- `admin` — role admin in workspace `dev`, password from
  `AUTH_BOOTSTRAP_PASSWORD` (**required — fail with a clear message when
  unset**; dev `.env` currently lacks it and must add it).
- Reuses `scripts/auth/manage-user.ts` with `--replace-memberships`.

## Parity gate contract

`deploy/dev-parity-check.sh` compares dev API (local :3000) vs source API
(preview :3002 or prod :3000 on ptcloud, reached over SSH):

| Check | Preview source (default) | `--prod-base` |
|---|---|---|
| Corpus total (unfiltered) | hard fail on mismatch | hard fail on mismatch |
| `candidate_actions` count | hard fail | hard fail |
| Baseline query totals (UAT query + one generic query) | hard fail, tolerance `TOTAL_TOLERANCE` (default 0) | informational (v0.4.16 semantics differ by design) |
| Verified-employer count (admin) | hard fail (expect 35) | informational |
| Auth smoke (`hr-demo` login → 200) | hard fail | hard fail |

A parity report table is always printed. On hard-fail: print the diff and
rollback instructions (restore `output/backups/pre-sync-<ts>/` + re-import the
local Convex backup zip), exit non-zero.

## Safety & error handling

- `set -Eeuo pipefail` + `ERR` trap: on error, restart the dev API if the script
  stopped it, print the log path (`logs/dev-sync-<ts>.log`), never touch
  ptcloud beyond the read-only export.
- Destructive swap requires `confirm_or_exit` (preview-flow style);
  `ASSUME_YES=1` skips.
- Detached API restart is idempotent with `dev.sh`: a later `bun run dev` boot
  adopts or orphan-cleans it (existing dev.sh behavior).
- Never quiesce or write to prod/preview.

## Testing

- Shell tests in repo style (`deploy/*.test.sh`): fix-step drift cases,
  parity-checker unit test against fixture JSON, `--dry-run` mode that stops
  before the swap.
- Acceptance rehearsal: run the full flow once against current preview;
  expected numbers: 48 results / 35 verified employers / 266 candidate_actions
  / corpus 8,958.
- Docs: runbook + architecture doc updated.

## Non-goals

- Promoting dev → preview/prod.
- Automating preview refresh (prod → preview stays the existing
  `preview-sync-from-prod.sh`; operators refresh preview first when stale).
- Replacing the existing preview sync machinery.
- Changing prod/preview auth or data.

## Sources Used

- Local repository: `deploy/restore-preview-from-prod.sh`,
  `deploy/restore-preview-full-state-from-prod.sh`,
  `deploy/preview-sync-from-prod.sh`, `deploy/lib-preview-common.sh`,
  `apps/api/src/services/verified-employer-catalog-service.ts`,
  `apps/api/src/routes/companies.ts` (requireAdmin + count endpoint),
  `apps/api/src/services/resume-service.ts` (catalog warm-up),
  `apps/web/src/hooks/useVerifiedEmployerCount.ts`,
  `packages/convex/convex/resumes_search.ts` (backfillResumeDigests),
  `packages/shared/src/ingest-compute-epoch.ts`
- Live evidence from the 2026-08-10 manual prod→dev sync (this session):
  preview version 0.4.23, preview hr-demo role=admin, prod v0.4.16, query
  totals 142/48/35, candidate_actions 266, verified employers 35.
