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
- After policy edits, run `npx tsx scripts/agent-governance/sync-policy.ts`.

### Source Matrix (strict order)
1. Local repository sources, including `dev-docs/*.txt` and implementation files.
2. Context7 references for library/framework/API behavior and usage details.
3. Official web sources only when freshness-sensitive or time-sensitive facts are required.

### Evidence Contract
- For non-trivial technical design/recommendation responses, include a `Sources Used` section.
- `Sources Used` must include:
  - Repo-relative file paths consulted.
  - Context7 library IDs queried.
  - Web URLs only when freshness-sensitive facts are used.
- Use `none` for any category with no source usage.

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

**All agents MUST follow this workflow after code changes:**

1. If you make code changes, run `make check` after completing the task and fix failures before handoff
2. After `make check`, if code changes remain or review is in progress, run a simplify workflow explicitly
3. Use `/simplify` if the runtime supports it
4. Otherwise use the portable `$simplify` skill or the agent's equivalent simplify workflow

**Available tools (for manual use when needed):**

| Command | Purpose |
|---------|---------|
| `make check` | Run required repo validation checks |
| `/simplify` | Full 3-pass code review (reuse, quality, efficiency) |
| `/simplify --quick` | Fast single-pass review |
| `/simplify --staged-only` | Review only staged files |

## Runbook Commands (Authoritative)

### Local Tooling Policy
- Local dev: prefer `bun` / `bunx`; fallback to `npm` / `npx` only if bun is unavailable.
- CI: use `npm` / `npx` only.
- Python dependency/runtime tooling: `uv`.

### Start Development
```bash
make install-deps                           # Sync repo project skills into .agents/.claude and install configured global skills via the skills CLI
CONVEX_MIRROR_MODE=mirror-first make install-deps  # Optional: mirror-first Convex prefetch during bootstrap
make sync-project-skills                    # Refresh committed project skill artifacts after editing dev-docs/skills/*
make install-global-skills                  # Reinstall configured external global skills from config/skills/install.yaml (direct npx skills add -g tree URLs)
make prefetch-convex                        # Prefetch local Convex backend + dashboard cache
CONVEX_MIRROR_MODE=mirror-first make prefetch-convex  # Optional: try configured mirrors before GitHub
make dev                # Full local stack
make dev-fast           # UI-focused fast profile
make dev-critical       # Critical path profile
make dev-backend        # Backend-focused profile
./scripts/dev.sh --help # Full dev service-profile plus CI=true/1 for Convex startup/prefetch and related env contract
```

### Start Single Services
```bash
make dev-web
make dev-api
make dev-worker
make dev-api-worker
make dev-mcp
make dev-crawl
```

### Deployment
```bash
make prod-install                                # Install the production stack from the current checkout (JDs only)
ENV_FILE=.env.production make prod-deploy-check  # Dry run the deploy precheck against the target env
CONVEX_MIRROR_MODE=mirror-first make prod-deploy # Optional: mirror-first Convex prefetch during upgrade
make restore-sample-snapshots                    # Optional: pull + restore fresh sample resume snapshots for dev
./scripts/install.sh --help                 # Full install/upgrade modes plus CI=true/1 for production prefetch and related env knobs
```

### Verification
```bash
make check                  # Default: validate committed project skill sync plus ~/.codex/skills governance install
make check TARGET=all       # Optional: validate governance installs in both skill roots
make check-build TARGET=all # Optional: include build validation after dual-root governance checks
make check-node
make check-python
npm test
npm run verify:critical-path
npm run test:api:search-profiles
npm run test:worker:resume-tasks
```

### API Contract / Client Sync
Use when API route/schema changed:
```bash
npm --workspace @trends/web run gen:api
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
- Use closest-scope instruction files when they exist; root rules still apply unless overridden.
- Avoid duplicating subsystem-specific long procedures in this root file.

## External Knowledge Sharing (Obsidian + GitHub)
This repository requires structured external knowledge sharing for major technical direction updates.

### Default Target
- Local-first vault path: `~/Documents/obsidian_vault`.
- Trends project notes path: `5️⃣-Projects/GitHub/trends/`.
- If local vault is unavailable, use `obsidian-gh-knowledge` configured default repository (config-driven fallback).

### When To Update Shared Knowledge
Update notes when any of the following changes land:
- Architecture or pipeline direction changes.
- Agent/governance/dev-cycle rule changes.
- Major API surface or workflow behavior changes.
- Significant migration strategy or workspace isolation changes.

### Note Hygiene Rules
- Include date, concise decision summary, and affected repo-relative paths.
- Link related PR/commit IDs when available.
- Never include secrets, tokens, credentials, or private environment values.
- Keep operational facts in shared notes; keep volatile TODOs in local task trackers.

## What Not To Put In This File
- No phase-by-phase completion ledgers.
- No temporary pending migration queues.
- No large UI mockups or long architecture diagrams.
- No duplicated deep config examples better maintained in `config/*` or implementation docs.

Keep this file short, stable, and execution-oriented.
