# Dev Loop — trends

> Multi-source data aggregation platform with pluggable domain workflows.
> Primary direction: resume screening (ingest → search → scoring → notification).
> Optimised for: **TDD-first pipeline** (plan → red-green-refactor → review → merge),
> **autonomous long-running cycles**, **CI-gated auto-merge** (4 required checks),
> **Playwright-CLI against `make dev`** for browser-facing changes,
> **resume search · collection · AI scoring** as critical paths.
> Merge-bound work defaults to **`/dev-loop` as the cycle driver**; manual branch/PR/merge flow is exception-only.

## Identity

```yaml
slug: trends
vault: ~/wiki
release_branch: main
project_filter: trends
cron_schedule: "7,22,37,52 * * * *"
```

## PRD layer

```yaml
prd_layer: tdd
prd_pipeline: tdd-first         # plan → execute (TDD) → review → merge; no brainstorm/spec step
```

### PRD backends registry

```yaml
prd_backends:
  tdd:
    capabilities: [plan, execute, review]
    skills:
      plan: superpowers:writing-plans
      execute: superpowers:test-driven-development
      review: superpowers:requesting-code-review
```

### Cross-cutting disciplines

> TDD is the primary execution mode (prd_layer: tdd). The discipline entries
> below add path-scoped enforcement: mandatory on critical paths ensures
> red-green-refactor discipline even for quick fixes; advisory catch-all
> reminds for non-critical files. systematic-debugging fires reactively on
> failure (see `reactive_debugging` block for retry budget).
> verification-before-completion gates REVIEW for every cycle.

```yaml
prd_disciplines:
  - skill: superpowers:test-driven-development
    when: execute
    mode: mandatory
    include_paths:
      - packages/convex/convex/resumes.ts
      - packages/convex/convex/search_profiles.ts
      - apps/api/src/routes/resumes.ts
      - apps/api/src/routes/scoring-evaluation.ts
      - apps/api/src/services/scoring-metrics.ts
      - apps/api/src/services/scoring-auto-tuner.ts
      - apps/api/src/services/rule-scoring.ts
      - apps/api/src/services/bff-filter-utils.ts
      - apps/web/src/hooks/useConvexResumes.ts
  - skill: superpowers:test-driven-development
    when: execute
    mode: advisory                       # catch-all for non-critical files
  - skill: superpowers:systematic-debugging
    when: failure
    mode: reactive
  - skill: superpowers:verification-before-completion
    when: review
    mode: mandatory
```

## Critical paths

> Used by REFRESH (CRITICAL_PATHS), QUERY bias, IDLE research ranking,
> and WORK auto-priority escalation when changed files match `*.code`.

```yaml
critical_paths:
  resume_search:
    code:
      - packages/convex/convex/resumes.ts
      - packages/convex/convex/search_profiles.ts
      - apps/api/src/routes/resumes.ts
      - apps/api/src/services/bff-filter-utils.ts
      - apps/web/src/hooks/useConvexResumes.ts
    vault:
      - concepts/resume-search-architecture
      - concepts/search-filter-semantic-mapping
      - concepts/bff-convex-filter-path-alignment
      - concepts/search-filter-component-test-patterns
    history_pins:
      - "16 MiB byte-limit incident (PR #168 / 2026-03-11)"
      - "scanResumePageSlim batch=200 fix (2026-05-05)"
      - "BFF↔Convex filter parity (2026-05-21)"
  collection_ingest:
    code:
      - apps/worker/
      - packages/cli/cmd/resume/
      - packages/convex/convex/resumes.ts
      - packages/shared/src/parseSalaryRange.ts
    vault:
      - concepts/multi-source-resume-collection
      - concepts/resume-source-locale
      - concepts/seek-talent-search-url-parameters
      - concepts/regional-industry-db-graceful-degradation
    history_pins:
      - "seek.com en/zh chinese-rules mismatch (2026-05-22)"
      - "my.market ingestData backfill (2026-05-21)"
      - "seek malaysia zero-results fix (2026-05-21)"
  ai_scoring:
    code:
      - apps/api/src/routes/scoring-evaluation.ts
      - apps/api/src/services/scoring-metrics.ts
      - apps/api/src/services/scoring-auto-tuner.ts
      - apps/api/src/services/rule-scoring.ts
      - apps/web/src/lib/resume-scoring.ts
    vault:
      - concepts/resume-scoring-pipeline
      - concepts/self-tuning-scoring
      - concepts/llm-cost-gating
      - concepts/scoring-verification-flow
      - queries/ai-resume-screening-quality-measurement-2026
    history_pins:
      - "LLM-primary scoring switch (PR #674)"
      - "scoring threshold mismatch fix (2026-05-21)"
      - "industry_db score normalization review (2026-03-12)"
      - "parseIngestData drops market field (PR #1116, 2026-05-27)"
```

## Fact-check tier

> Default first stop for any non-trivial claim during SPEC/PLAN/EXECUTE/REVIEW.
> Local sources first, web only when freshness or external authority is required.

```yaml
fact_check:
  enabled: true
  source_order:
    - local_repo
    - context7
    - vault_query
    - web_search
  web_tools:
    primary: mcp__grok-search__web_search
    deep_fetch: mcp__grok-search__web_fetch
    site_map: mcp__grok-search__web_map
    plan_first: mcp__grok-search__plan_intent
  triggers:
    - "version "
    - "deprecat"
    - "CVE-"
    - "release dates"
    - "third-party tool not already in repo"
  evidence_contract:
    require_sources_used_section: true
    cite_session_id: true
```

## Idle deep-research

> When mechanical scan returns no P2+ findings, rotate research topics
> through /deep-research. Long-running cron loops compound research backlog
> from otherwise-dead idle cycles.

```yaml
idle_deep_research:
  enabled: true
  skill: deep-research
  trigger:
    when: idle_after_mechanical_scan
    if: no_p2_or_higher_findings
    cooldown: every_3rd_idle_cycle
    max_per_day: 4
  topic_seeds:
    - "Convex search index byte-budget patterns 2026 — beyond maximumBytesRead"
    - "Resume screening LLM scoring — explainability + drift detection 2026"
    - "Chinese resume text segmentation — Convex/Tantivy CJK gaps in 2026"
    - "Hono OpenAPI streaming + Server-Timing best practices"
    - "FastAPI worker scheduling + idempotent crawl resume patterns"
    - "Browser-extension MV3 + CDP automation patterns 2026"
    - "AI scoring evaluation — NDCG/recall metrics for hiring at scale"
    - "Multi-source resume dedup heuristics across boards (seek/51job/zhipin/my)"
  topic_selection:
    bias_toward: critical_paths
    skip_if_recent_query_page_exists: 14d
  output_mode: vault
  budget:
    web_searches: 3
    deep_fetches: 3
    context7_calls: 3
  followups:
    on_finding: capture_to_vault_then_create_work_item
    p_score_default: P3
```

## Preflight prep

> Human-attended readiness mode for `/dev-loop prep`. It batches questions
> and writes readiness metadata only after approval, then unattended `/goal`
> cycles skip work that is not explicitly ready.

```yaml
preflight:
  enabled: true
  default_limit: 5
  default_lanes: [work, captures, hygiene]
  require_approved_spec_and_plan: true
  unattended_not_ready_behavior: skip
  defaults:
    compatibility_policy: "Trends changes are additive/backward-compatible unless explicitly scoped otherwise."
    verification_policy: "Run make check; browser-facing changes require make dev plus playwright-cli/e2e per CLAUDE.md."
```

## Browser verification

> Per CLAUDE.md feedback memory: every browser-facing change MUST be
> verified against the running `make dev` stack via `/playwright-cli`.
> Localhost URL is `http://localhost:5173` — never the external hostname.

```yaml
browser_verification:
  enabled: true
  trigger:
    - "apps/web/**"
    - "apps/browser-extension/**"
    - "packages/convex/convex/resumes.ts"
  prerequisites:
    - "curl -fsS http://localhost:5173 >/dev/null"
    - "make chrome-debug"
    - "make dev"
  driver: playwright-cli
  base_url: http://localhost:5173
  smoke_routes:
    - /
    - /resumes
    - /search-profiles
    - /scoring
    - /dev/resumes?location=Malaysia&q=CNC+Sales  # MY industry_db floor verification
  reviser_workflow:
    - take_snapshot
    - list_console_messages
    - evaluate_script
  e2e_fallback: make e2e
```

## Reactive debugging

> Caps systematic-debugging retries, captures evidence, fact-checks
> external-lib errors via grok-search, escalates to a P1 finding after
> N idle cycles with the same error signature.

```yaml
reactive_debugging:
  enabled: true
  auto_retry_attempts: 2
  evidence_dir: .claude/dev-loop-debug/
  evidence_capture:
    - "make check 2>&1 | tee {evidence_dir}/{cycle}-check.log"
    - "git diff --stat > {evidence_dir}/{cycle}-diff.txt"
    - "git log --oneline -5 > {evidence_dir}/{cycle}-log.txt"
  fact_check_tool: mcp__grok-search__web_search
  escalate_after:
    consecutive_idle_cycles: 3
    same_error_signature: true
  escalation_action: surface_p1_finding
```

## Code review

> REVIEW always runs `simplify:simplify` as the base code-review skill for
> code changes. Codex second-opinion is opt-in per intensity. Currently OFF —
> toggle `enabled_in_high: true` if you want a parallel reviewer on
> /dev-loop high cycles.

```yaml
code_review:
  parallel: true
  codex:
    enabled_in_normal: false
    enabled_in_high: false
    agent: dev-loop:codex-review-worker
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

## Interview

> `auto` keeps the loop unattended; native 3-question backend gates only
> ambiguous specs. Long-running cycles will skip interviews on clearly
> scoped trivial fast-path items.

```yaml
interview:
  setup:
    skill: setup-dev-loop
    glossary: grill-with-docs  # installed at ~/.claude/skills/grill-with-docs/SKILL.md
  work_item:
    default: native
    upgrade: grill-me          # installed at ~/.claude/skills/grill-me/SKILL.md
    source: mattpocock/skills
    install: "npx skills@latest add mattpocock/skills --skill grill-me -a claude-code -g -y"
    trigger: auto
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
e2e_prerequisites:
  - "make chrome-debug"
  - "make dev"
e2e_optional_benchmarks:
  - make benchmark-critical-path
  - make benchmark-dev-resume-latency
```

## Release

```yaml
bump_script:
publish_via: none
deploy_script: bash scripts/install.sh upgrade
manifests_count: 5
remote_hosts: [${SSH_HOST:-ptcloud}]
```

## CI Configuration

```yaml
ci_configured: true
ci_discovery: runtime
# Branch protection on main requires: test, verify, i18n-check, secret-scan
# ci-health-worker queries protection API at MERGE time — now resolves (was 404 before 2026-05-27)
# Existing workflows: checks.yml (secret-scan, i18n-check, verify), tests.yml (test)
```

## Notes

```yaml
notes:
  stack: Monorepo — React+Vite (web), Hono+OpenAPI (api), FastAPI (worker), Convex (data)
  deploy: production deploys via `make on-prod-deploy` on prod host (`SSH_HOST`, defaults to `ptcloud`) after `make on-prod-deploy-check`
  prod_pin: "ptcloud prod is PINNED to tag v0.4.6-hotfix (commit 4ce93b90). DO NOT deploy main — auth (#1259-#1263), public sharing (#1254-#1257), and Phase 4 resume_analyses (#1264-#1290) are NOT production-ready. Run `git describe --tags` after any deploy to verify pin. See memory/prod-pinned-v046-hotfix.md for full details."
  config_docs: CLAUDE.md is canonical; AGENTS.md is symlink
  planning: EnterPlanMode gated — TDD-first pipeline uses superpowers:writing-plans for plan, then superpowers:test-driven-development for execute
  gotcha: api-types.ts regenerates on make check after API schema edits — always stage it
  gotcha: better-sqlite3 needs npm rebuild after Node version bumps
  gotcha: Convex 16 MiB per-query byte limit — keep paginate batches ≤200 docs (~5.4MB)
  gotcha: localhost:5173 only — never the external hostname when verifying
  gotcha: BFF and Convex search filters MUST stay in lockstep (3 paths) — see concepts/bff-convex-filter-path-alignment
  gotcha: Resume backups live at output/resume-backups/ — restore via `make local-restore-from-prod FILE=...`
  gotcha: cmux task sandboxes (CMUX_TASK_RUN_JWT set, CMUX_IS_ORCHESTRATION_HEAD unset) MUST NOT run gh pr create — cmux handles it
  merge_policy: Merge-bound work defaults to /dev-loop; manual branch/PR/merge sequencing is allowed only when the user explicitly asks for it or the task is local-only
  gotcha: preview deploys MUST verify admin login after setup-preview.sh or restore-preview-from-prod.sh — if AUTH_BOOTSTRAP_PASSWORD is set in .env.preview, run: curl -s -X POST https://preview.pt-mes.com/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<pw>"}' | grep -q '"success":true'; setup-preview.sh now fails hard on seeding errors; restore-preview-from-prod.sh auto-verifies in its verification block
  vault_drift: scoring + search concept pages drift fastest — re-check after PRs touching resumes.ts or aiScoring.ts
  cron: "7,22,37,52 * * * *" durable, runs `/loop /dev-loop high` — auto-expires 7d, renew with CronCreate
  oauth_blocker: WeChat OAuth requires business license, WeCom requires admin — external deps not available
  critical_path_test_seed: prod snapshot under output/resume-backups/ (~89k resumes); use it instead of local 51job collector for search/scoring tests
  tdd_test_locations:
    - packages/convex/test/
    - apps/api/test/
    - apps/web/src/**/*.test.ts(x)
    - apps/worker/tests/
  tdd_forbidden:
    - "Replicating production logic inline in tests (bff-filter-utils memory)"
    - "Mocking the database in integration tests (superpowers feedback)"
    - "Skipping a failing test to ship"
```
