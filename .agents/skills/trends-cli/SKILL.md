---
name: trends-cli
description: Use the Trends Go CLI for backend operations including resume/jd listing, resume debug and AI dev-cycle workflows, worker triggers, exports, migrations, and MCP server mode.
validation:
  descriptionTerms: [CLI, resume, debug, worker, migration]
---

# Trends CLI

Use this skill when the user asks to operate backend services from terminal commands, automate resume/JD workflows, or expose Trends operations as MCP tools.

## Workflow

1. Bootstrap local dependencies and project skill setup when the environment may be stale:
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
- `./bin/trends resume snapshot --source job5156 --count 50`
- `./bin/trends resume import-51job ~/Downloads/51job.rar --keyword "CNC 销售"`
- `./bin/trends resume restore output/resume-backups/<run-stamp> --mode replace --yes`
- `./bin/trends resume show <resume-id> --source convex` (one resume with detailed work experience)
- `./bin/trends resume archive <id> [<id>...]` (soft-delete resumes)
- `./bin/trends resume unarchive <id> [<id>...]` (restore archived resumes)
- `./bin/trends resume backup --out <file> --limit 200` (portable backup from $API_URL)
- `./bin/trends resume deploy-backup write <run-dir> --limit 200` (write into the deploy backup layout, .tar.gz by default)
- `./bin/trends resume deploy-backup restore <run-dir> --mode replace --yes` (restore from a deploy backup run directory)
- `./bin/trends resume full-restore <backup-file>` (replace ALL local data from a backup file; auto-backs up current state first)
- `./bin/trends resume note --from-file feedback.csv --dry-run` (import HR feedback comments as resume notes)
- `./bin/trends resume match --query "CNC 销售" --source convex --mode rules_only`
- `./bin/trends resume debug ai-score --query "CNC 销售" --limit 5 --top-n 3`
- `./bin/trends resume debug matches --job-description lathe-sales`
- `./bin/trends resume debug match-runs --job-description lathe-sales --limit 20`
- `./bin/trends resume debug clear-matches --job-description lathe-sales`
- `./bin/trends resume debug skills-version`
- `./bin/trends resume debug search-freshness` (ingestComputeEpoch lag + golden MY/CN totals; or `make doctor-search-freshness`)
- `./bin/trends resume debug clear-analyses --job-description lathe-sales --resume-id resume-1`
- `./bin/trends resume debug clear-analyses --dry-run`
- `./bin/trends resume debug hard-reset-reingest --dry-run`
- `./bin/trends resume debug hard-reset-reingest --yes`
- `./bin/trends resume debug reset-database --dry-run`
- `./bin/trends resume debug reset-database --yes`
- `./bin/trends resume debug trigger-reingest --limit 200`
- `./bin/trends resume debug trigger-reingest --mode any --dry-run` (count skills-stale vs compute-stale)
- `./bin/trends resume debug trigger-reingest --mode compute --limit 200` (algorithm epoch lag only)
- `./bin/trends resume debug diagnostics --source-key job5156 --limit 100` (ingest/archive diagnostics rows)
- `./bin/trends resume debug diagnostics --archived`
- `./bin/trends resume debug clear-demo-resumes` (delete workspace-demo tagged resumes)
- `./bin/trends resume debug reingest --resume-id <id> --dry-run` (resolve an exact resume cohort; `--yes --wait` schedules and waits for evidence)
- `./bin/trends resume debug workflow-dataset --query "CNC 销售" --source-key seek --top 10`
- `./bin/trends resume analyze --query "CNC 销售" --limit 50`
- `./bin/trends resume analyze --job-description lathe-sales --dry-run`
- `./bin/trends resume analyze --query "CNC Sales" --min-experience 3 --locations "Dongguan,Shenzhen"`
- `./bin/trends resume debug analysis-tasks`
- `./bin/trends resume debug rescore --source sample --query "CNC 销售"`
- `./bin/trends resume export --format xlsx --limit 200`
- `./bin/trends jd list`
- `./bin/trends jd create ./config/job-descriptions/lathe-sales.md --name lathe-sales-copy`
- `./bin/trends worker status`
- `./bin/trends worker run --once`
- `./bin/trends worker summary run --period daily --dry-run` (render without sending)
- `./bin/trends worker summary history --limit 20`
- `./bin/trends worker summary show <run-id>`
- `./bin/trends industry review --status ready_for_review --limit 20`
- `./bin/trends industry inspect <proposal-id>`
- `./bin/trends industry recommend <proposal-id> --output json`
- `./bin/trends industry review-packet <proposal-id> --output json`
- `./bin/trends industry open <proposal-id>` (prints the admin URL; approval stays in the UI)
- `./bin/trends crawl`
- `./bin/trends migrate reindex-search`
- `./bin/trends migrate backfill-ingest --limit 100`
- `./bin/trends migrate backfill-manual-51job --limit 100`
- `./bin/trends migrate backfill-score`
- `./bin/trends migrate backfill-verified-role-years --batch-size 100`
- `./bin/trends migrate validate-consistency --force` (full data consistency validation and repair)
- `./bin/trends research company "CNC 东莞" --persona hr` (persona re-ranked company signals)
- `./bin/trends research ingest` (trigger Research Eng native ingest; operator command)
- `./bin/trends research parity` (latest research parity run / kill-switch ledger)
- `./bin/trends system metadata`
- `./bin/trends system sources`
- `./bin/trends system source <key>`
- `./bin/trends mcp serve`

## Rules

- Run commands from repository root.
- `make install-deps` syncs repo-managed skills from `dev-docs/skills` into committed `.agents/skills` and `.claude/skills`, then installs configured external global skills from `config/skills/install.yaml`.
- `CONVEX_MIRROR_MODE=mirror-first make install-deps` is the repo-level bootstrap path when Convex asset prefetch should try configured mirrors before GitHub, and `make prefetch-convex` is the focused prefetch-only escape hatch. Use `./scripts/install-deps.sh --help` when CI=true/1 or broader prefetch env knobs matter, and `./scripts/prefetch-convex-backend.sh --help` for the focused low-level prefetch contract.
- Keep `dev-docs/skills/trends-cli` as the only editable source. Refresh `.agents/skills/trends-cli` and `.claude/skills/trends-cli` with `make sync-project-skills`; use `make install-skill SKILL=trends-cli [TARGET=codex|agents|all]` only for manual user-global installs.
- Keep `--api-url` and `--worker-url` aligned with running services.
- Keep `--web-url` (or `TRENDS_WEB_URL`) aligned with the local admin UI when using `trends industry open`.
- `trends industry` commands are read-only review preparation. They share the API's `industry-review.v1` recommendation envelope and never approve, reject, or bulk-mutate industry truth.
- Prefer `trends resume snapshot` over calling `scripts/resume/snapshot-source-backups.ts` directly when you want a repeatable operator/dev-cycle entrypoint.
- Use `trends resume import-51job` when you want to validate the live `/api/resumes/manual-import` lane for local `.rar`, `.zip`, `.docx`, or `.pdf` files and inspect file-level warnings/failures before or after snapshot restore.
- `trends resume restore` accepts either a single portable backup file or a snapshot run directory; directory restores import files in deterministic source order (`job5156`, `seek`, `51job-manual`) and only reset once in `--mode replace`.
- The preferred snapshot verification flow is: `resume snapshot` -> `resume restore` -> `resume search` / `resume match --mode rules_only` -> `resume debug ai-score`; use `resume debug matches` or `match-runs` only for persisted review-lane validation.
- `trends resume match` remains the API-backed path; when `source=convex` and AI scoring is needed for debug, use `trends resume debug ai-score`.
- `trends resume debug rescore` currently mirrors the backend restriction and is sample-only.
- `trends resume debug trigger-reingest` selects by **skillsVersion lag and/or ingestComputeEpoch lag** (`--mode skills|compute|any`, default `any`). It is not a full hard-reset; use `--dry-run` to report skillsStale vs computeStale counts. After pure algorithm fixes (e.g. Seek EN year parse), bump `CURRENT_INGEST_COMPUTE_EPOCH` in `@trends/shared` and schedule `--mode compute` — do not rely on skillsVersion alone.
- Return-to-laptop / post-deploy: `make doctor-search-freshness` (or `resume debug search-freshness`) after git pull + API up; exit 2 means compute-stale rows need reingest, exit 3 means the verified-only MY/CN golden availability or semantic checks failed.
- For migration commands, report the exact `convex run` output back to the user.
- All destructive commands (`hard-reset-reingest`, `reset-database`, `clear-analyses`) require `--yes` to execute; use `--dry-run` to preview without mutating.
- `hard-reset-reingest` is a two-phase operation (clear data then schedule re-ingest); if scheduling fails after clearing, output shows `phase: "failed_scheduling"` with partial results.
- `reset-database` deletes ALL resume, JD, search profile, and screening data; use with extreme caution.
- `clear-analyses` now routes through the BFF API instead of calling Convex directly; `--dry-run` counts affected records without mutating.
- `--dry-run` on any destructive command shows what would happen without performing the operation.
- `resume archive` soft-deletes resumes; `resume unarchive` restores them. `resume full-restore` replaces ALL local data from a backup file and auto-backs up the current state first — treat as destructive.
- `resume deploy-backup` reads/writes backups in the standard deploy layout under `--base-dir` (default `/var/backups/trends/deploy`); `restore --mode replace` requires `--yes`, `--mode merge` does not.
- `resume note` imports HR feedback rows from CSV/TSV (`--delimiter auto|tab|comma`, `--from-file` or stdin); `--dry-run` previews rows without posting.
- `resume debug reingest` resolves an exact resume cohort from `--resume-id`/`--manifest`; live scheduling requires `--yes`, `--dry-run` previews targets, `--wait --wait-timeout` waits for the expected ingest evidence.
- `resume debug clear-demo-resumes` deletes `workspace-demo`-tagged resumes from the target Convex deployment (destructive).
- `resume debug diagnostics` is read-only; `--archived` lists archived rows instead of active ingest rows.
- `worker summary run` renders the daily/weekly workspace summary; `--dry-run` renders without sending, `--via-worker` routes through the worker endpoint instead of the API summary route.
- `research company` shows persona re-ranked company signals (`--persona hr|sales`); `research ingest` and `research parity` are operator commands for the Research Eng ingest lane and its kill-switch ledger.
- `resume analyze` dispatches the production Convex AI analysis pipeline; results are stored per-resume in the `analyses` map.
- Use `--dry-run` on `resume analyze` to preview candidate count without dispatching analysis.
- Check analysis task status with `resume debug analysis-tasks`.
- `resume analyze` is fire-and-forget; the Convex backend processes analysis asynchronously.
- Either `--query` or `--job-description` is required for `resume analyze`; both can be combined.
