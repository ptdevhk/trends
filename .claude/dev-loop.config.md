# Dev Loop — trends

> Multi-source data aggregation platform with pluggable domain workflows.
> Primary direction: resume screening (ingest, scoring, filtering, notification).

## Identity

```yaml
slug: trends
vault: ~/wiki
release_branch: main
project_filter: trends
cron_schedule: "*/15 * * * *"
```

## PRD layer

```yaml
prd_layer: superpowers
prd_pipeline: full
```

### Cross-cutting disciplines

```yaml
prd_disciplines:
  - skill: superpowers:test-driven-development
    when: execute
    mode: advisory
  - skill: superpowers:systematic-debugging
    when: failure
    mode: reactive
```

## Knowledge layer

```yaml
knowledge_layer: skillwiki
```

### Knowledge backends registry

```yaml
knowledge_backends:
  skillwiki:
    vault: ~/wiki
    cli_entry: skillwiki
```

## Code layout

```yaml
cli_src: packages/cli/cmd/
cli_test: packages/cli/cmd/
skills_glob: dev-docs/skills/*/SKILL.md
cli_entry_override: bin/trends
```

## E2E

```yaml
e2e_scripts:
  - scripts/e2e-smoke.ts
```

## Release

```yaml
bump_script:
publish_via: none
deploy_script: bash scripts/install.sh upgrade
manifests_count: 5
remote_hosts: [ptcloud]
```

## Notes

```yaml
notes:
  stack: Monorepo — React+Vite (web), Hono+OpenAPI (api), FastAPI (worker), Convex (data)
  deploy: production deploys via `make on-prod-deploy` on ptcloud after `make on-prod-deploy-check`
  config_docs: CLAUDE.md is canonical; AGENTS.md is symlink
  planning: EnterPlanMode gated — use superpowers:brainstorming -> superpowers:writing-plans instead
  gotcha: api-types.ts regenerates on make check after API schema edits — always stage it
  gotcha: better-sqlite3 needs npm rebuild after Node version bumps
  vault_drift: concept pages drift when code changes without vault sync — check scoring/search concepts after relevant commits
  cron: durable every-15m, trends-only, auto-expires 7d — renew with CronCreate before expiry
```
  oauth_blocker: WeChat OAuth requires business license, WeCom requires admin - external deps not available
