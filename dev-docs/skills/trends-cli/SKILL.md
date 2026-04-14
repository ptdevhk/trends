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
   - `CONVEX_MIRROR_MODE=mirror-first make install-deps`
   - `make sync-project-skills`
   - `make install-global-skills`
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
- `./bin/trends resume snapshot --source job5156 --count 20`
- `./bin/trends resume import-51job ~/Downloads/51job.rar --keyword "CNC 销售"`
- `./bin/trends resume restore output/resume-backups/<run-stamp> --mode replace --yes`
- `./bin/trends resume match --query "CNC 销售" --source convex --mode rules_only`
- `./bin/trends resume debug ai-score --query "CNC 销售" --limit 5 --top-n 3`
- `./bin/trends resume debug matches --job-description lathe-sales`
- `./bin/trends resume debug match-runs --job-description lathe-sales --limit 20`
- `./bin/trends resume debug clear-matches --job-description lathe-sales`
- `./bin/trends resume debug skills-version`
- `./bin/trends resume debug clear-analyses --job-description lathe-sales --resume-id resume-1`
- `./bin/trends resume debug clear-analyses --dry-run`
- `./bin/trends resume debug hard-reset-reingest --dry-run`
- `./bin/trends resume debug hard-reset-reingest --yes`
- `./bin/trends resume debug reset-database --dry-run`
- `./bin/trends resume debug reset-database --yes`
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
- `./bin/trends migrate backfill-manual-51job --limit 100`
- `./bin/trends migrate backfill-score`
- `./bin/trends mcp serve`

## Rules

- Run commands from repository root.
- `make install-deps` syncs repo-managed skills from `dev-docs/skills` into committed `.agents/skills` and `.claude/skills`, then installs configured external global skills from `config/skills/install.yaml`.
- `CONVEX_MIRROR_MODE=mirror-first make install-deps` is the repo-level bootstrap path when Convex asset prefetch should try configured mirrors before GitHub, and `make prefetch-convex` is the focused prefetch-only escape hatch. Use `./scripts/install-deps.sh --help` when CI=true/1 or broader prefetch env knobs matter, and `./scripts/prefetch-convex-backend.sh --help` for the focused low-level prefetch contract.
- Keep `dev-docs/skills/trends-cli` as the only editable source. Refresh `.agents/skills/trends-cli` and `.claude/skills/trends-cli` with `make sync-project-skills`; use `make install-skill SKILL=trends-cli [TARGET=codex|agents|all]` only for manual user-global installs.
- Keep `--api-url` and `--worker-url` aligned with running services.
- Prefer `trends resume snapshot` over calling `scripts/resume/snapshot-source-backups.ts` directly when you want a repeatable operator/dev-cycle entrypoint.
- Use `trends resume import-51job` when you want to validate the live `/api/resumes/manual-import` lane for local `.rar`, `.zip`, `.docx`, or `.pdf` files and inspect file-level warnings/failures before or after snapshot restore.
- `trends resume restore` accepts either a single portable backup file or a snapshot run directory; directory restores import files in deterministic source order (`job5156`, `seek`, `51job-manual`) and only reset once in `--mode replace`.
- The preferred snapshot verification flow is: `resume snapshot` -> `resume restore` -> `resume search` / `resume match --mode rules_only` -> `resume debug ai-score`; use `resume debug matches` or `match-runs` only for persisted review-lane validation.
- `trends resume match` remains the API-backed path; when `source=convex` and AI scoring is needed for debug, use `trends resume debug ai-score`.
- `trends resume debug rescore` currently mirrors the backend restriction and is sample-only.
- `trends resume debug trigger-reingest` is the stale-skills-version reingest path, not a generic arbitrary reingest.
- For migration commands, report the exact `convex run` output back to the user.
- All destructive commands (`hard-reset-reingest`, `reset-database`, `clear-analyses`) require `--yes` to execute; use `--dry-run` to preview without mutating.
- `hard-reset-reingest` is a two-phase operation (clear data then schedule re-ingest); if scheduling fails after clearing, output shows `phase: "failed_scheduling"` with partial results.
- `reset-database` deletes ALL resume, JD, search profile, and screening data; use with extreme caution.
- `clear-analyses` now routes through the BFF API instead of calling Convex directly; `--dry-run` counts affected records without mutating.
- `--dry-run` on any destructive command shows what would happen without performing the operation.
