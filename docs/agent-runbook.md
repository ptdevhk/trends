# Trends Agent Runbook

Operational reference for repository agents. Keep the root `CLAUDE.md` short and stable; place detailed commands and gotchas here.

## Path Aliases
- `{REPO_ROOT}` = repository root (`/root/workspace`)
- `{WIKI_VAULT}` = skillwiki vault root (default `~/wiki`; resolve with `skillwiki path`)

## Local Tooling Policy
- Local dev: prefer `bun` / `bunx`; fallback to `npm` / `npx` only if bun is unavailable.
- CI: use `npm` / `npx` only.
- Python dependency/runtime tooling: `uv`.

## Local Dev Stack
```bash
make install-deps                                    # Bootstrap (skills + deps + bin/trends + Convex prefetch)
make dev                                             # Full local stack (alias preserved)
make dev-fast                                        # UI-focused
make dev-critical / dev-backend
make dev-web / dev-api / dev-worker / dev-api-worker / dev-mcp / dev-crawl
./scripts/dev.sh --help
```

## Local Checks & Tooling
```bash
make check
make check TARGET=all
make check-node / check-python
npm test
npm --workspace @trends/web run gen:api
make e2e
make migration-test BACKUP_FILE=/tmp/trends-resume-backups/resumes-prod-<...>.tar.gz
make migration-test-fresh-sandbox YES=1 BACKUP_FILE=/tmp/trends-resume-backups/resumes-prod-<...>.tar.gz
make benchmark-critical-path
make benchmark-dev-resume-latency
```

## Backup / Restore / Deploy

### Remote backup
```bash
make remote-backup-prod
make remote-backup-prod SSH_HOST=myhost WORKSPACE=hr
```

### Restore to local dev
```bash
make local-restore-from-prod FILE=output/resume-backups/resumes-prod-<...>.tar.gz
# MODE=replace YES=1 preset; skip auto-backup with SKIP_AUTO_BACKUP=1
```

### Production host
```bash
make on-prod-deploy-check
make on-prod-deploy
make on-prod-install
make on-prod-refresh-env
```

### Preview deployment
Preview uses separate ports and paths. **Complete CLI runbook:**
- `docs/preview-upgrade-runbook.md`

Full postmortem/reference:
- `{WIKI_VAULT}/projects/trends/compound/2026-05-29-preview-deployment-lessons.md`

Canonical paths on `ptcloud`:
- Production: `/opt/trends` (API `:3000`, Convex `:3210`, `trends.pt-mes.com`)
- Preview: `/home/ubuntu/trends-preview` (API `:3002`, Convex `:4210`, `preview.pt-mes.com`)

```bash
# On ptcloud — preferred single entrypoint for DATA parity (prod → preview)
# Architecture: docs/backup-restore-architecture.md
sudo ASSUME_YES=1 DIGEST_BACKFILL_MODE=skip bash deploy/preview-sync-from-prod.sh --data-only
bash deploy/preview-parity-check.sh

# Optional: also pin preview app code to prod SHA
sudo ASSUME_YES=1 bash deploy/preview-sync-from-prod.sh --with-code-pin

# Upgrade preview app to latest main (code only — does not replace data)
cd /home/ubuntu/trends-preview && sudo ASSUME_YES=1 make deploy
bash deploy/preview-doctor.sh --full
# Code deploy does not recompute role years. Fail closed on golden floor miss:
bash deploy/search-freshness-gate.sh --role preview --api-url http://127.0.0.1:3002
# Convex (Docker) must use BFF_API_URL=https://preview.pt-mes.com — never localhost:3000
```

**Never** treat `preview-clone-from-prod` alone as a full clone — it pins **code**, not resumes/status/AI scores.

For a selected historical `prod-complete-*` backup, do not use the live-clone
scripts. Use the attended `on-host-preview-rehearse-*` targets documented in
`docs/preview-upgrade-runbook.md`. They freeze the manifest source SHA and exact
target SHA, stop after the same-version baseline, run the same canonical Convex
migration declarations as production, require clean-browser evidence, and keep
rollback explicit. Repository tests for this workflow must use generated
fixtures and fake commands only; they must not SSH or contact preview/production.

**Search freshness after upgrade/migration:** app version green ≠ MY/CN `minRoleYears` search healthy. Preview Convex must reach host BFF (`BFF_API_URL`); then schedule `trigger-reingest --mode any|compute` when doctor exit 2/3.

`make deploy` / `./scripts/install.sh upgrade` from `/opt/trends` = **production**.  
From `/home/ubuntu/trends-preview`, `make deploy` routes to `deploy/preview-upgrade.sh`.  
`install.sh` refuses preview paths.

Do **not** raw-copy `convex_local_backend.sqlite3` between deployments.

## Policy and Project Skill Sync
Only needed when the policy block or project skill sources change.

```bash
make sync-agent-policy
make check-agent-policy
make sync-project-skills
make check-project-skills
```

## Code Style & Safety

### TypeScript / Node
- Always use `node:` prefix for Node.js built-ins.
- Do not use `any`; prefer `unknown` + narrowing or concrete types.
- Avoid type casts unless necessary.
- Avoid dynamic imports unless following an existing codebase pattern.
- In `try/catch`, do not silently suppress errors; log with `console.error`.

### General
- Prefer editing existing files over creating new files.
- Do not modify `README.md` unless explicitly requested.
- Do not add docs/comments unless explicitly requested.
- Keep changes minimal, testable, and scoped to the task.

## Known Gotchas
- `EMBEDDING_ENABLED` gates embedding/vector operations; default is OFF.
- Protected `/dev/*` routes are authenticated. Seed a local account with `npm run auth:bootstrap-demo` (or `npm run auth:bootstrap-hr-demo`) and sign in at `/dev/login`.
- Refresh dev data to mirror preview (prod data + industry evidence + same code):
  `bash deploy/dev-sync-from-preview.sh` (preview source, parity-gated).
  `--prod-base` syncs from prod instead; `--with-file-storage` adds raw
  attachments; `--digest-backfill=always|skip` overrides the adaptive digest
  policy. Requires `AUTH_HR_DEMO_PASSWORD` and `AUTH_BOOTSTRAP_PASSWORD` in
  `.env` (seeds hr-demo as admin, matching preview roles). Local state is
  backed up first; a failed parity gate prints rollback instructions.
- Never `bun run scripts/auth/manage-user.ts` directly — it opens SQLite via `better-sqlite3`, which the Bun runtime cannot load (`Fatal error: 'better-sqlite3' is not yet supported in Bun`). `bun run <npm-script>` is fine (the script shells out to `tsx` on Node); otherwise use `npx tsx scripts/auth/manage-user.ts ...` or `bunx tsx ...`.
- Industry review roles: workspace role `reviewer` grants the industry-verification review workflow (proposals, evidence sources, verdict revisions, identity resolution) without admin powers; ops surfaces (recompute, link-backfill, maintenance, coverage) stay admin-only. Assign with `npx tsx scripts/auth/manage-user.ts --username <u> --workspace hr --role reviewer --no-password` (no `auth:manage` npm script exists — use the `npx tsx` runner above; `--no-password` keeps the existing account password on a role change). No demo seat exists; UAT by role-changing an existing dev account.
- `AUTH_BOOTSTRAP_PASSWORD` / `AUTH_HR_DEMO_PASSWORD` are **seed-time only**: read by `scripts/auth/manage-user.ts` and `deploy/preview-seed-auth.sh`, never by the login endpoint (`apps/api/src/routes/auth.ts` verifies against the stored scrypt hash in SQLite). Editing the env file does NOT change the stored password — re-run the seed to apply (idempotent upsert).
- Local dev credentials are independent of preview: `hr-demo`'s local password is whatever the local seed used, not the preview bootstrap password. If in doubt, re-run the seed and restart the API.
- Login lockout: 5 failed attempts per username+IP within 15 min → 15-min in-memory lock (`429 Account temporarily locked`, see `apps/api/src/middleware/login-rate-limit.ts`). Cleared by API restart or `POST /api/admin/auth/unlock`.
- **BFF manual restart must source `.env` first.** `bun run <pkg-script>` does not propagate `.env` to `tsx` children (F32 root cause). Restart the BFF with `set -a; source .env; set +a; nohup <command> &` — otherwise `/api/resumes/:id/analysis-tasks` returns 500s with Convex "Unauthorized Convex read" because the child process has no `CONVEX_WRITE_SECRET`.
- After editing `apps/api/src/schemas/*.ts`, stage `apps/web/src/lib/api-types.ts` too.
- After changing shared generated search-profile templates or YAML profiles, rebuild `@trends/shared`.
- `make clear-resumes` may hit `OptimisticConcurrencyControlFailure`; rerun until `partial:false`.
- Large local Convex restores may hit `TooManyWrites 429`; wait 30–60s and retry.
- **Backup restore: `maintenanceMode` flag.** Convex exports from `backup-prod-complete.sh` capture `maintenanceMode=true` (writer-quiesce during backup). Restoring without clearing blocks all writes — logins return 503 "Maintenance mode active". `dev_import_convex` now auto-clears unless `RESTORE_KEEP_MAINTENANCE=1`. For manual restores: `npx convex run system_settings:set '{"key":"maintenanceMode","value":false,"updatedBy":"manual"}'`.
- **Parity comparison: version check.** Browser parity smoke scripts now compare `/health` version before reporting IDENTICAL. When versions differ, verdict is `VERSION-DIFFERS` — cross-version search-total comparison is informational, not a parity gate. Use `PARITY_STRICT_SEARCH=1` for same-code comparisons only. Public prod/preview domains serve HTML at `/health` (Caddy static); version resolves to `'unknown'`, which correctly forces `VERSION-DIFFERS`.
- **Match lookups key on `candidate.resumeId`, not `resolveResumeId(item)`.** `loadResumeMatchContextMap` keys by the Convex document `_id` (the `candidate.resumeId` used at save time). `resolveResumeId(item)` resolves profileUrl/externalId and can differ from the `_id` when content carries a platform resumeId — using it for matchMap lookups silently drops rows or sorts as −1 (fixed 2026-08-13, `aad30efc`). Always pass `candidate.resumeId` (or `item.resumeId ?? item.id` on enriched working sets).
- After Node version changes, run `npm rebuild better-sqlite3`.
- Removing a skill from `config/skills/install.yaml` also requires removing installed copies from `.agents/skills/`, `.claude/skills/`, and `~/.codex/skills/`.
- Pre-push hook runs `make i18n-check` when locale files change.
- Always verify browser-facing changes with a running app/browser flow; compilation is not sufficient.
- For URL/mode-gated changes, verify against the reported deployed host, not only localhost.
- Search filter changes must update all 3 runtime paths simultaneously:
  1. Convex `matchesResumeListFilters`
  2. BFF AND-mode `bffMatchesResumeFilters`
  3. BFF OR-mode `ResumeService.filterResumes`
- Convex test mock query builders must support `.take()`, `.order()`, `.paginate()`.
- Module-level `vi.stubGlobal()` must be paired with `afterAll(() => vi.unstubAllGlobals())`.
- When using `useResumeListState`, prefer `displayedResumes.find(e => e.key === id)?.identityKey`.
- Restored legacy search profiles auto-adopt stamp fields only after hitting `/api/search-profiles/stats`.
- New SearchProfile filter fields require updates in all six known template/schema/generation locations.
- Template changes may require `SEARCH_PROFILES_RESEED_ON_DRIFT=true` to restamp local/prod profiles.
- New Convex write mutations must be added to `packages/convex/convex/_mutations_registry.ts`.
- Convex `import --replace-all` preserves `_id`; restore flows depend on that preservation.
- Portable BFF resume restore (`trends resume restore` / `make restore-resumes`) does **not** preserve Convex document `_id` (backup JSON has no `_id`). After restore, HR export CSV `Resume ID` values often miss. Import HR feedback with Profile URL / externalId matching (supported by feedback-batch + importNotesBatch). Import in the **same workspace** the resumes were restored into (`dev` vs `hr`).
- New fields on existing Convex tables should start as `v.optional(...)`.

## Browser Testing & Debugging
- Start headed Chrome with CDP using the **global default-user** profile clone (not a new empty repo profile):
  ```bash
  make chrome-debug
  # equivalent: bash scripts/chrome-debug.sh
  # restart same profile: bash scripts/chrome-debug.sh --restart
  ```
- Attach and automate with `/playwright-cli` (`playwright-cli attach`). Prefer attach over inventing `--repo-local-profile`.
- Profile defaults: `chrome-debug-contract: v2` — `PROFILE_MODE=default-user` under Application Support / XDG. Use `--repo-local-profile` only for explicit isolation.
- CLI: prefer `@playwright/cli` ≥ 0.1.17 (`npm install -g @playwright/cli@latest`).
- Browser extension-specific guidance:
  - `{REPO_ROOT}/apps/browser-extension/CLAUDE.md`

## Nightly UAT & Fix Loop (preview branch)

Unattended overnight UAT + fix cycle: a full pass runs every ~30–40 min (a 10-min
scheduler fires `/tmp/nightly-uat.lock`-guarded passes; fires skip while a pass runs),
on the **preview branch** against the **local dev stack** (`make dev`, localhost only),
stopping at 09:00 with a finalized report. Proven across 35 passes (2026-08-11/12:
14 commits — 4 product fixes, 10 harness hardenings).

Operational flow per pass:
1. **Branch guard:** `preview-v0.4.23`, clean worktree. Never commit/push off preview,
   never open PRs, never tag/deploy, never touch remote hosts (ptcloud /
   preview.pt-mes.com / prod).
2. **Self-enable (idempotent):** boot `make dev` if :5173 down; seed `hr-demo`
   (`npm run auth:bootstrap-hr-demo`) and `uat-reviewer`
   (`npx tsx scripts/auth/manage-user.ts --username uat-reviewer --workspace hr
   --role reviewer --password-env AUTH_BOOTSTRAP_PASSWORD`); ensure the chrome-debug
   profile + `Page.bringToFront` on the ACTIVE tab (backgrounded tabs throttle rAF →
   smooth scroll-to-detail silently no-ops, F16); restart cmux-devtools if the CDP
   websocket wedges (F14).
3. **Memory trim (pre-gate):** if `free -m` available < 4000 MB or swap > 90% →
   restart the convex local backend via `scripts/dev.sh --convex-only --no-seed`
   (F18: pkill+respawn does NOT work on the precompiled supervisor; kill by
   port-derived PID; healthy ~30s; worker heartbeat lags ~1–2 gate runs after restart,
   self-recovers). Then `sync && echo 3 > /proc/sys/vm/drop_caches` + `swappiness=10`.
4. **Gates (all exit 0):** `bun run verify:critical-path`, `npm run e2e` (e2e-smoke),
   `bun run setup:industry-review-uat` (if fixtures missing) +
   `bun run verify:industry-review-uat -- --base-url http://localhost:3000`,
   `make check` when code changed.
   The industry-review fixture's `companyKeyByCase` maps to CN companies present in
   local Convex (explicit-cnc → `polywell`; see the stewardship runbook for the table
   and rebinding rules). The browser UAT stage takes `--workspace` (default `hr`;
   `dev` for the dev workspace) and selects the manual-approval row by `data-testid`,
   so it never depends on localized button text.
5. **Browser UAT (playwright-cli, localhost:5173 only):** hr-demo smoke routes +
   6-step checklist (`dev-docs/qa/critical-path-ui-smoke.md`); uat-reviewer
   industry-review workflow (sidebar 行业验证 entry, proposals list, 查看 no
   SystemAccessGate bounce, queue-ordered prev/next, scroll-to-detail, verdict
   revision, evidence sources, legacy notice). 0 app console errors.
6. **Fix loop:** confirmed issue → systematic-debugging → TDD tests first → minimal fix →
   re-run affected gate + unit tests → browser re-verify → commit
   `fix(...): ... [nightly-uat]` → push to origin/preview-v0.4.23 only when all gates
   + tests pass.
7. **Report:** `/tmp/uat-report-<date>.md` (one row per pass), evidence under
   `/tmp/uat-evidence/`, P1/P2 vault captures at
   `raw/transcripts/YYYY-MM-DD-nightly-uat-*.md`; the 09:00 pass writes the FINAL
   SUMMARY (pass count, fixed/open findings, per-critical-path verdicts) + one-line retro.

Gotchas (all observed; F-numbers reference the nightly report):
- `bun run <pkg-script>` does not propagate .env to tsx children — export
  `CONVEX_WRITE_SECRET`/auth vars before gates (F32).
- chrome-debug profile is shared across UAT roles — sessions flip between passes;
  e2e self-heals via `ensureDevAdminSession` (F12); re-login per role walk.
- 智通直聘 extension auto-scrape can hijack the driven tab to job5156 (F18b) — settle
  recovery tracks API responses + query-param re-navigation, not DOM state.
- Search failure panel (重试) vs true empty state: assert the correct one (F11/F14).
- `sales` empty state after e2e bulk actions = new-only filter, not a bug (F19).
- e2e first-run flakes after cmux/chrome restarts = extension re-scrape churn (F17);
  settle polls reload on stuck loading + wait for analysis quiescence (F17 follow-ups).
- Convex local backend heap grows with activity (searches/ingest churn; ~100–150 MB/pass
  steady-state, larger on first bursts; idle ≈ flat — no leak); trim floor 4 GB available (F18).
  Root cause (2026-08-12): glibc-malloc heap ratchet in the precompiled backend
  (Tantivy in-memory index + doc/version churn); no backend knob — restart is the
  correct mitigation. See `~/wiki/raw/transcripts/2026-08-12-nightly-uat-root-cause-fixes.md`.

## Current Engineering Direction
- Resume screening is the primary product path.
- Convex-first ingest/query flow powers pre-computed matching.
- Search Profiles + JD auto-match are main operational entry points.
- Tagging/scoring pipelines and role-aware filtering are active focus areas.
- Workspace-aware isolation is part of current architecture direction.
- Notifications are integrated extension points.
- Dev flow is TDD-first.
- Embedding/RAG search remains disabled; use BM25 + tag expansion.
- LLM scoring provider is Convex `callLLM` (not the BFF `aiConfig` snapshot). Default/basic model is Poe `openai/deepseek-v4-flash`. `openai/deepseek-v4-flash-e` is the fallback. The former Poe `response_format` rejection bug on `deepseek-v4-flash` was confirmed fixed 2026-08-25 (see `docs/runbooks/llm-api-provider-fallback.md`).

## Migrations & Environment Policy
- Do not keep temporary migration checklists in root `CLAUDE.md`.
- If schema/search/index behavior changes, review/update `packages/convex/convex/migrations.ts`.
- Run migrations per environment and keep them idempotent.
- Prefer deploy automation scripts/Make targets for production migration flow.
- Validate end-to-end behavior after migration runs.

## Wiki / Knowledge References
- Vault root: `{WIKI_VAULT}`
- Trends project index: `{WIKI_VAULT}/projects/trends/index.md`
- Trends project README: `{WIKI_VAULT}/projects/trends/README.md`
- Use `proj-work` so plans/specs land under the vault rather than repo docs.
