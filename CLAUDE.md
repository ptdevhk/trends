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
3. For full dev-loop pipeline (PRD → spec → plan → implement → verify), use `/dev-loop` skill

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

### On prod host (after `ssh ptcloud && cd /opt/trends`)
```bash
make on-prod-deploy-check        # dry run (alias: prod-deploy-check / deploy-check)
make on-prod-deploy              # full upgrade (alias: prod-deploy / deploy)
make on-prod-install             # first-time systemd install (alias: prod-install / install)
make on-prod-refresh-env         # refresh env + rebuild web bundle (alias: refresh-env)
```

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
- After editing `apps/api/src/schemas/*.ts`, stage `apps/web/src/lib/api-types.ts` too — `make check` regenerates it and fails `git diff --exit-code` otherwise.
- `make clear-resumes` may raise `OptimisticConcurrencyControlFailure` when scheduled Convex jobs overlap; just re-run until `partial:false`.
- Local Convex dev backend rate-limits at ~4 MiB writes/sec; large restores (2k+ resumes) can hit `TooManyWrites 429` — wait ~30-60s between retry attempts.
- After Node.js version bumps, run `npm rebuild better-sqlite3` — native module must match the running Node ABI or `make check` fails.
- When removing a skill from `config/skills/install.yaml`, also delete installed copies from `.agents/skills/`, `.claude/skills/`, and `~/.codex/skills/` — `make check` fails on stale/unexpected entries.
- Pre-push hook runs `make i18n-check` when locale files changed — blocks push on missing/mismatched keys. Activate with `make install-hooks` (also runs as part of `make install-deps`).

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
- **`/dev-loop-research`** — standalone repo + vault health scan with prioritized recommendations
- **PRD bridge**: All spec/plan output must land in the vault, not `docs/superpowers/`. Use `proj-work` to get redirect paths.

Update vault notes when architecture, governance, or major API changes land.

## What Not To Put In This File
- No phase-by-phase completion ledgers.
- No temporary pending migration queues.
- No large UI mockups or long architecture diagrams.
- No duplicated deep config examples better maintained in `config/*` or implementation docs.

Keep this file short, stable, and execution-oriented.
