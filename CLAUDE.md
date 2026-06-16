# Trends Agent Operating Guide (Canonical)

`CLAUDE.md` is the canonical instruction file for this repository.
`AGENTS.md` is a symlink to this file.
Keep this document execution-focused and stable.
English-first guidance; Chinese notes are short clarifications.

## Project Intent
- Trends is a multi-source data aggregation platform with pluggable domain workflows.
- Primary direction: resume screening (ingest, scoring, filtering, notification).
- News aggregation remains production-supported as an extension.
- Goal: minimal human-in-the-loop with strong verification discipline. (目标: 少人工、高可靠)

<!-- AGENT_POLICY:BEGIN -->
## Agent Governance Policy (Canonical)

- Canonical policy file: `AGENTS.md`
- Generated mirror file: `dev-docs/AGENTS.md`
- Do not edit `dev-docs/AGENTS.md` directly.
- After policy edits, run `make sync-agent-policy` or `bunx tsx scripts/agent-governance/sync-policy.ts`.

### Source Matrix (strict order)
1. Local repository sources, including `dev-docs/` cached docs and implementation files.
2. Context7 references for library/framework/API behavior and usage details.
3. DevTools MCP — browser snapshots, console, network for live verification (browser-facing changes only).
4. Official web sources only when freshness-sensitive or time-sensitive facts are required.

### Evidence Contract
- For non-trivial technical design/recommendation responses, include a `Sources Used` section.
- Include only categories actually consulted. Omit categories not used — no need to list `none`.

### Enforcement
- Sync generated policy mirror with `make sync-agent-policy`.
- Validate policy drift with `make check-agent-policy`.
- Validate governance skill package and installed copy with `make check-agent-skill` (or `make check-agent-skill TARGET=all` when both skill roots matter).
- `make check` must fail if policy or governance skill checks fail.
<!-- AGENT_POLICY:END -->

## Core Repo Facts
- Monorepo workspaces: `apps/*`, `packages/*`.
- UI: React + Vite (`apps/web`).
- BFF/API: Hono + OpenAPI (`apps/api`).
- Worker: FastAPI scheduler/REST (`apps/worker`).
- Data/compute path: Convex (`packages/convex`).
- Candidate state is split: `candidate_actions` (star/archive/shortlist/reject/note/contact) in SQLite `output/resume_screening.db`; `candidate_status` (pipeline enum) in Convex.
- Runtime sources include crawler output (`output/*.db`) and resume samples.

## Execution Priority
1. Ship safe, working changes.
2. Verify with the smallest sufficient test/check scope.
3. Document decisions and evidence for non-trivial recommendations.
4. Apply optional polish only after correctness.
- 先正确再优化; avoid speculative refactors.

# Git Policy (IMPORTANT)

**All agents (Claude, Codex, Gemini, etc.) MUST follow these rules:**

1. **NO direct commits to main/master** - Always create a feature branch first
2. **NO direct push to main/master** - Push to feature branches only
3. **Default merge behavior is auto-merge** - Unless the user explicitly requests not to merge, enable auto-merge with `gh pr merge <number> --squash --auto`
4. **NO force push to main/master** - This destroys history
5. **NO manual PR creation from cmux task sandboxes** - If `CMUX_TASK_RUN_JWT` is set AND `CMUX_IS_ORCHESTRATION_HEAD` is NOT set, do not run `gh pr create`; cmux creates or updates the task PR automatically. Cloud workspaces (head agents with `CMUX_IS_ORCHESTRATION_HEAD=1`) CAN create PRs manually.

**Workflow:**
1. Create feature branch: `git checkout -b <type>/<description>`
2. Make changes and commit to feature branch
3. Push feature branch: `git push -u origin <branch>`
4. If `CMUX_TASK_RUN_JWT` is unset OR `CMUX_IS_ORCHESTRATION_HEAD=1`, create PR manually: `gh pr create --base main`
5. If `CMUX_TASK_RUN_JWT` is set AND `CMUX_IS_ORCHESTRATION_HEAD` is NOT set, stop after pushing and let cmux create or update the PR
6. Unless the user explicitly requests not to merge, enable auto-merge: `gh pr merge <number> --squash --auto`

# Dev Cycle (IMPORTANT)

**After code changes:**

1. Run `make check` — fix failures before handoff
2. If code changes remain, run `/simplify` (or `--quick` / `--staged-only` variants)
3. For full dev-loop pipeline (plan → TDD execute → review → merge), use `/dev-loop` skill

**Core commands:**

| Command | Purpose |
|---------|---------|
| `make check` | Validate + governance + project skill sync |
| `/simplify` | Full 3-pass code review (reuse, quality, efficiency) |
| `/dev-loop` | Full dev-cycle pipeline with skillwiki integration |

## Runbook Commands (Authoritative)

### Local Tooling Policy
- Local dev: prefer `bun` / `bunx`; fallback to `npm` / `npx` only if bun is unavailable.
- CI: use `npm` / `npx` only.
- Python dependency/runtime tooling: `uv`.

### Local dev stack
```bash
make install-deps                                    # Bootstrap (skills + deps + bin/trends + Convex prefetch)
make dev                # Full local stack (alias preserved)
make dev-fast           # UI-focused
make dev-critical / dev-backend
make dev-web / dev-api / dev-worker / dev-api-worker / dev-mcp / dev-crawl
./scripts/dev.sh --help
```

### Local checks & tooling
```bash
make check                  # validate + governance + project skill sync
make check TARGET=all       # dual-root governance
make check-node / check-python
npm test
npm --workspace @trends/web run gen:api   # after API schema edits
make e2e                                  # E2E smoke (requires make chrome-debug + make dev)
make migration-test BACKUP_FILE=/tmp/trends-resume-backups/resumes-prod-<...>.tar.gz  # v0.2.1 -> main; refuses output/resume-backups
make migration-test-fresh-sandbox YES=1 BACKUP_FILE=/tmp/trends-resume-backups/resumes-prod-<...>.tar.gz  # destructive local app-state reset + migration test
make benchmark-critical-path              # Latency benchmark
make benchmark-dev-resume-latency         # Dev-resume latency check
```

### Remote backup (laptop -> prod via SSH)
```bash
make remote-backup-prod                          # SSH tunnel -> backup -> close (alias: backup-prod)
make remote-backup-prod SSH_HOST=myhost WORKSPACE=hr
```

### Restore to local dev (laptop-only)
```bash
make local-restore-from-prod FILE=output/resume-backups/resumes-prod-<...>.tar.gz
# MODE=replace YES=1 preset; auto-writes safety pre-backup; skip with SKIP_AUTO_BACKUP=1
# For merge mode: make restore-resumes FILE=... MODE=merge
# Go CLI: trends resume full-restore <path>
```

### On prod host (SSH via `${SSH_HOST:-ptcloud}`; `SSH_HOST` defaults to `ptcloud` if unset)
```bash
make on-prod-deploy-check        # dry run (alias: prod-deploy-check / deploy-check)
make on-prod-deploy              # full upgrade (alias: prod-deploy / deploy)
make on-prod-install             # first-time systemd install (alias: prod-install / install)
make on-prod-refresh-env         # refresh env + rebuild web bundle (alias: refresh-env)
```

### Preview deployment (preview.pt-mes.com; uses `${SSH_HOST:-ptcloud}`)
Preview runs in parallel with production on different ports — Convex `4210/4211`, API `3002`, MCP `3334`, web at `/home/ubuntu/trends-preview/apps/web/dist`. See `deploy/restore-preview-from-prod.sh` and the compound entry `projects/trends/compound/2026-05-29-preview-deployment-lessons.md` for the full postmortem.

```bash
# On the preview host as root (SSH_HOST)
bash /opt/trends/deploy/setup-preview.sh           # rsync code, build API+web (~6m)
cd /home/ubuntu/trends-preview && \
  docker compose -f docker-compose.preview.yml up -d   # Convex + MCP
systemctl enable --now trends-preview-api          # API runs as systemd, not Docker
bash /opt/trends/deploy/restore-preview-from-prod.sh  # Convex export → import (~1m)
```

Do NOT raw-copy `convex_local_backend.sqlite3` between deployments — schema push fails with 500. Use the `convex export`/`import` API (the restore script handles this).

### Governance Sync (only when policy block changes)
```bash
make sync-agent-policy
make check-agent-policy
make sync-project-skills
make check-project-skills
make check-agent-skill              # Default: validate ~/.codex/skills copy
make check-agent-skill TARGET=all   # Optional: validate ~/.codex/skills and ~/.agents/skills
TARGET=all make sync-agent-governance  # Optional: run policy sync + governance skill install in both roots
```

## Code Style & Safety

### TypeScript / Node
- Always use `node:` prefix for Node.js built-ins.
- Do not use `any`; use `unknown` + narrowing or concrete types.
- Avoid type casts (`as`) unless absolutely necessary.
- Avoid dynamic imports unless following an existing codebase pattern.
- In `try/catch`, never suppress errors silently; always `console.error`.

### General
- Prefer editing existing files over creating new files.
- Do not modify `README.md` unless explicitly requested.
- Do not add docs/comments unless explicitly requested.
- Keep changes minimal, testable, and scoped to user request.

### Known Gotchas
- `EMBEDDING_ENABLED` env var gates all embedding/vector operations (default: OFF). Do not build features that depend on embeddings until a compatible API is configured. `hybridSearchResumes` falls back to BM25-only when disabled.
- After editing `apps/api/src/schemas/*.ts`, stage `apps/web/src/lib/api-types.ts` too — `make check` regenerates it and fails `git diff --exit-code` otherwise.
- After changing `packages/shared/src/generated/search-profile-templates.ts` or YAML profiles, run `npm --workspace @trends/shared run build` — the compiled `dist/` is what `@trends/shared` resolves to at runtime/test time, not the TypeScript source.
- `make clear-resumes` may raise `OptimisticConcurrencyControlFailure` when scheduled Convex jobs overlap; just re-run until `partial:false`.
- Local Convex dev backend rate-limits at ~4 MiB writes/sec; large restores (2k+ resumes) can hit `TooManyWrites 429` — wait ~30-60s between retry attempts.
- After Node.js version bumps, run `npm rebuild better-sqlite3` — native module must match the running Node ABI or `make check` fails.
- When removing a skill from `config/skills/install.yaml`, also delete installed copies from `.agents/skills/`, `.claude/skills/`, and `~/.codex/skills/` — `make check` fails on stale/unexpected entries.
- Pre-push hook runs `make i18n-check` when locale files changed — blocks push on missing/mismatched keys. Activate with `make install-hooks` (also runs as part of `make install-deps`).
- Always start `make dev` and verify with `/playwright-cli` before claiming browser-facing changes are done — TypeScript compilation doesn't verify runtime behavior.
- For URL-gated or mode-gated changes, verify against the deployed host the user reports from (not just localhost) — local seed fixtures only cover the back-compat path and hide defects.
- When changing any search filter, update all 3 paths simultaneously: (1) Convex `matchesResumeListFilters`, (2) BFF AND-mode `bffMatchesResumeFilters`, (3) BFF OR-mode `ResumeService.filterResumes`. The Convex filter is the source of truth.
- Convex test mock query builders must support `.take()`, `.order()`, `.paginate()` (with `maximumBytesRead`/`maximumRowsRead` params) — missing these causes false-positive test failures that `make check` won't catch (it only runs typecheck + lint, not `npm test`).
- Module-level `vi.stubGlobal()` in vitest must be paired with `afterAll(() => vi.unstubAllGlobals())` — without it, stubbed globals leak to subsequent test files.
- When adding status/filter logic to `useResumeListState`, use `displayedResumes.find(e => e.key === id)?.identityKey` — not `displayedResumeMap` which maps resumeKey→ConvexResumeItem. The entry's `identityKey` is pre-computed via `getResumeIdentityKey`; in non-AI fallback mode `entry.identityKey` may differ from `resume.identityKey`.
- After `make local-restore-from-prod` or `restore-preview-from-prod.sh`, legacy search profiles (seeded before stamping) lack `seedSource`/`templateHash`. As of PR #1150, these are auto-adopted unconditionally on the next `/api/search-profiles/stats` hit — no flag required. Half-stamped profiles (have `seedSource` but no `templateHash`) are also auto-repaired. If profiles still appear stale after restore, check that the API process has restarted and hit the stats endpoint.
- When adding new fields to SearchProfile filters, update all 6 locations: (1) `config/search-profiles/*.yaml`, (2) `search-profile-service.ts` `SearchProfile.filters` type + `parseFilters`, (3) `search-profiles.ts` Zod schema + output mapping, (4) `sync-search-profile-templates.ts` `ProfileFilters` type + `parseFilters`, (5) run `make sync-search-profile-templates` to regenerate the artifact, (6) run `npm --workspace @trends/web run gen:api` to regenerate `api-types.ts`.
- When `config/search-profiles/*.yaml` templates change (new fields, renamed fields, new defaults), the local DB profile won't update automatically unless `SEARCH_PROFILES_RESEED_ON_DRIFT=true` is set — the API logs a "template drift detected" warning but skips the update otherwise. `.env.example` sets this flag for local dev. For production, enable it temporarily in `.env.production` when deploying a profile-template upgrade, then remove it.
- When adding new fields to existing Convex tables, always use `v.optional(...)` for the first deploy. Existing rows don't have the field — Convex rejects them on schema push with "Object is missing the required field". After a backfill migration confirms all rows carry the field, you can tighten to required. Readers should default to the "active" equivalent when the field is `undefined` (e.g. `coldRow.status === "archived"` not `coldRow.status !== "active"`).

## Browser Testing & Debugging

Prerequisite: `make chrome-debug` starts a headed Chrome with CDP on port 9222 and your real profile.

- **`/playwright-cli`** skill handles browser automation (attach, navigate, snap, evaluate)
- `make e2e` — E2E smoke test via `scripts/e2e-smoke.ts` (requires chrome-debug + local dev stack)
- `make benchmark-critical-path` — Benchmark critical path latency (requires seeded data)
- For browser extension CDP patterns, see `apps/browser-extension/CLAUDE.md`.

## Current Engineering Direction (Stable Snapshot)
- Resume screening is the primary product path.
- Convex-first ingest/query flow powers pre-computed matching.
- Search Profiles + JD auto-match are the main operational entry points.
- Tagging/scoring pipelines and role-aware filtering are active focus areas.
- Workspace-aware isolation is part of current architecture direction.
- Notifications (Feishu/WeChat Work/Email etc.) are integrated extension points.
- Dev flow: TDD-first pipeline (plan → red-green-refactor → review → merge); no PRD/brainstorm step for implementation.
- Embedding/RAG search is disabled (EMBEDDING_ENABLED=false) — Poe API lacks /embeddings support. Complete all features using BM25 text search + tag expansion only; do not design around semantic search availability.

## Migrations & Environment Policy
- Do not keep temporary migration checklists in this file.
- If schema/search/index behavior changes, review/update `packages/convex/convex/migrations.ts`.
- Run migrations per environment, and keep them idempotent.
- Prefer deploy workflow automation (`scripts/install.sh`, Make targets) for production migration flow.
- Validate end-to-end behavior after migration runs.

## Scoped Instructions
- For browser extension work, follow `apps/browser-extension/CLAUDE.md`.
- For browser automation, use `/playwright-cli` skill (replaces manual playwright-cli commands).
- For plan/spec/PRD work, use `/brainstorming` + `/writing-plans` (superpowers) with PRD bridge to vault.
- For debugging, use `/systematic-debugging` (superpowers) before ad-hoc investigation.
- Use closest-scope instruction files when they exist; root rules still apply unless overridden.

## Planning

Use `/brainstorming` -> `/writing-plans` (superpowers) for all planning. `EnterPlanMode` is disabled in favor of structured skill-based planning with persistent output. Use `/wiki-gate-plan-mode status` to check or toggle this.

## External Knowledge Sharing (skillwiki)
Default vault: `~/wiki` (resolved via `skillwiki path`). Project notes under `projects/trends/`.
If local vault is unavailable, fall back to config-driven remote repository.

- **`/wiki-ingest`** — capture URLs/files/pastes into typed pages
- **`/wiki-query`** — search and synthesize from vault
- **`/wiki-crystallize`** — save session insights
- **`/dev-loop:research`** — standalone repo + vault health scan with prioritized recommendations
- **PRD bridge**: All spec/plan output must land in the vault, not `docs/superpowers/`. Use `proj-work` to get redirect paths.

Update vault notes when architecture, governance, or major API changes land.

## What Not To Put In This File
- No phase-by-phase completion ledgers.
- No temporary pending migration queues.
- No large UI mockups or long architecture diagrams.
- No duplicated deep config examples better maintained in `config/*` or implementation docs.

Keep this file short, stable, and execution-oriented.
