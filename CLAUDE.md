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
- Validate governance skill package and installed copy with `make check-agent-skill`.
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

## Dev Cycle Rules (Major)
- No direct commit to `main` or `master`.
- No direct push to `main` or `master`.
- No PR merge without explicit user approval.
- Never force-push protected branches.
- Never use `gh pr merge --delete-branch`; the web app relies on preserved branches for merged-task git diffs.
- Preferred merge command: `gh pr merge <number> --squash --auto`.
- Do not use `--admin` unless explicitly requested.

Required flow:
1. Create branch: `git checkout -b <type>/<scope>`
2. Implement focused change set.
3. Run scoped validation.
4. Commit with clear message.
5. Push branch and open PR.
6. Wait for explicit merge approval.

## Runbook Commands (Authoritative)

### Local Tooling Policy
- Local dev: prefer `bun` / `bunx`; fallback to `npm` / `npx` only if bun is unavailable.
- CI: use `npm` / `npx` only.
- Python dependency/runtime tooling: `uv`.

### Start Development
```bash
make install-deps
make dev                # Full local stack
make dev-fast           # UI-focused fast profile
make dev-critical       # Critical path profile
make dev-backend        # Backend-focused profile
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

### Verification
```bash
make check
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
make check-agent-skill
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
