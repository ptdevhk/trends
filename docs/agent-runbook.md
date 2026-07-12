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
Preview uses separate ports and paths. Full postmortem/reference:
- `{WIKI_VAULT}/projects/trends/compound/2026-05-29-preview-deployment-lessons.md`

```bash
bash /opt/trends/deploy/setup-preview.sh
cd /home/ubuntu/trends-preview && docker compose -f docker-compose.preview.yml up -d
systemctl enable --now trends-preview-api
bash /opt/trends/deploy/restore-preview-from-prod.sh
```

Do **not** raw-copy `convex_local_backend.sqlite3` between deployments.

## Governance Sync
Only needed when the policy block changes.

```bash
make sync-agent-policy
make check-agent-policy
make sync-project-skills
make check-project-skills
make check-agent-skill
make check-agent-skill TARGET=all
TARGET=all make sync-agent-governance
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
- Protected `/dev/*` routes are authenticated. Use `bun run auth:bootstrap-demo` and sign in at `/dev/login` when needed.
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
- New fields on existing Convex tables should start as `v.optional(...)`.

## Browser Testing & Debugging
- Start headed Chrome with CDP:
  ```bash
  make chrome-debug
  ```
- Use `/playwright-cli` for browser automation.
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
