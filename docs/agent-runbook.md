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
- Never `bun run scripts/auth/manage-user.ts` directly — it opens SQLite via `better-sqlite3`, which the Bun runtime cannot load (`Fatal error: 'better-sqlite3' is not yet supported in Bun`). `bun run <npm-script>` is fine (the script shells out to `tsx` on Node); otherwise use `npx tsx scripts/auth/manage-user.ts ...` or `bunx tsx ...`.
- `AUTH_BOOTSTRAP_PASSWORD` / `AUTH_HR_DEMO_PASSWORD` are **seed-time only**: read by `scripts/auth/manage-user.ts` and `deploy/preview-seed-auth.sh`, never by the login endpoint (`apps/api/src/routes/auth.ts` verifies against the stored scrypt hash in SQLite). Editing the env file does NOT change the stored password — re-run the seed to apply (idempotent upsert).
- Local dev credentials are independent of preview: `hr-demo`'s local password is whatever the local seed used, not the preview bootstrap password. If in doubt, re-run the seed and restart the API.
- Login lockout: 5 failed attempts per username+IP within 15 min → 15-min in-memory lock (`429 Account temporarily locked`, see `apps/api/src/middleware/login-rate-limit.ts`). Cleared by API restart or `POST /api/admin/auth/unlock`.
- After editing `apps/api/src/schemas/*.ts`, stage `apps/web/src/lib/api-types.ts` too.
- After changing shared generated search-profile templates or YAML profiles, rebuild `@trends/shared`.
- `make clear-resumes` may hit `OptimisticConcurrencyControlFailure`; rerun until `partial:false`.
- Large local Convex restores may hit `TooManyWrites 429`; wait 30–60s and retry.
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

## Current Engineering Direction
- Resume screening is the primary product path.
- Convex-first ingest/query flow powers pre-computed matching.
- Search Profiles + JD auto-match are main operational entry points.
- Tagging/scoring pipelines and role-aware filtering are active focus areas.
- Workspace-aware isolation is part of current architecture direction.
- Notifications are integrated extension points.
- Dev flow is TDD-first.
- Embedding/RAG search remains disabled; use BM25 + tag expansion.

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
