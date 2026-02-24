---
name: trends-cli
description: Use the Trends Go CLI for backend operations including resume/jd listing, worker triggers, exports, migrations, and MCP server mode.
validation:
  descriptionTerms: [CLI, resume, worker, migration]
---

# Trends CLI

Use this skill when the user asks to operate backend services from terminal commands, automate resume/JD workflows, or expose Trends operations as MCP tools.

## Workflow

1. Build the CLI when binaries are missing or stale: `make cli-build`.
2. Prefer CLI commands over ad-hoc curl scripts for supported operations.
3. Use `--output json` when command output needs to be consumed by other tools.
4. Use `trends mcp serve` when integration requires MCP tool exposure.

## Commands

- `./bin/trends resume list --limit 50`
- `./bin/trends resume search "CNC 东莞" --limit 50`
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
- Keep `--api-url` and `--worker-url` aligned with running services.
- For migration commands, report the exact `convex run` output back to the user.
