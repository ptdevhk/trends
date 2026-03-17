---
name: trends-cli
description: Use the Trends Go CLI for backend operations including resume/jd listing, resume debug and AI dev-cycle workflows, worker triggers, exports, migrations, and MCP server mode.
validation:
  descriptionTerms: [CLI, resume, debug, worker, migration]
---

# Trends CLI

Use this skill when the user asks to operate backend services from terminal commands, automate resume/JD workflows, or expose Trends operations as MCP tools.

## Workflow

1. Bootstrap local dependencies and default governance skill setup when the environment may be stale:
   - `make install-deps`
   - `SKILL_INSTALL_TARGET=all make install-deps`
   - `CONVEX_MIRROR_MODE=mirror-first make install-deps`
   - `make prefetch-convex`
2. Build the CLI when binaries are missing or stale: `make cli-build`.
3. Install or refresh the skill from this canonical repo copy when you want the packaged workflow available in Codex or other agent managers:
   - `make install-skill SKILL=trends-cli`
   - `make install-skill SKILL=trends-cli TARGET=agents`
   - `make install-skill SKILL=trends-cli TARGET=all`
4. Prefer CLI commands over ad-hoc curl scripts for supported operations.
5. Use `--output json` when command output needs to be consumed by other tools.
6. Use `trends mcp serve` when integration requires MCP tool exposure.
7. For live Convex AI debug work, prefer `trends resume debug ai-score` over forcing unsupported API match modes.

## Commands

- `./bin/trends resume list --limit 50`
- `./bin/trends resume search "CNC 东莞" --limit 50`
- `./bin/trends resume debug ai-score --query "CNC 销售" --limit 5 --top-n 3`
- `./bin/trends resume debug matches --job-description lathe-sales`
- `./bin/trends resume debug match-runs --job-description lathe-sales --limit 20`
- `./bin/trends resume debug clear-matches --job-description lathe-sales`
- `./bin/trends resume debug skills-version`
- `./bin/trends resume debug trigger-reingest --limit 200`
- `./bin/trends resume debug rescore --source sample --query "CNC 销售"`
- `./bin/trends resume export --format xlsx --limit 200`
- `./bin/trends jd list`
- `./bin/trends jd create ./config/job-descriptions/lathe-sales.md --name lathe-sales-copy`
- `./bin/trends worker status`
- `./bin/trends worker run --once`
- `./bin/trends crawl`
- `./bin/trends migrate reindex-search`
- `./bin/trends migrate backfill-ingest --limit 100`
- `./bin/trends migrate backfill-score`
- `./bin/trends mcp serve`

## Rules

- Run commands from repository root.
- `make install-deps` bootstraps the governance skill by default into `~/.codex/skills`; use `SKILL_INSTALL_TARGET=all make install-deps` when local setup should also refresh `~/.agents/skills`.
- `CONVEX_MIRROR_MODE=mirror-first make install-deps` is the repo-level bootstrap path when Convex asset prefetch should try configured mirrors before GitHub, and `make prefetch-convex` is the focused prefetch-only escape hatch. Use `./scripts/install-deps.sh --help` when skill-target, CI env/defaults, or broader prefetch env knobs matter, and `./scripts/prefetch-convex-backend.sh --help` for the focused low-level prefetch contract.
- Keep `dev-docs/skills/trends-cli` as the only editable source; install into `~/.codex/skills` and/or `~/.agents/skills` from that source instead of maintaining duplicate copies. `CODEX_HOME` and `AGENTS_HOME` can override those roots when needed.
- Keep `--api-url` and `--worker-url` aligned with running services.
- `trends resume match` remains the API-backed path; when `source=convex` and AI scoring is needed for debug, use `trends resume debug ai-score`.
- `trends resume debug rescore` currently mirrors the backend restriction and is sample-only.
- `trends resume debug trigger-reingest` is the stale-skills-version reingest path, not a generic arbitrary reingest.
- For migration commands, report the exact `convex run` output back to the user.
