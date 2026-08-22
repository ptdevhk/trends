# HANDOFF — Review Phase (for new session)

> This handoff is for a fresh session tasked with REVIEW work on the completed
> dev-loop "high" campaign in the Trends repo. Implementation is DONE: 12/12
> completed items work-validated (`valid:true`, 0 unchecked boxes), item #13
> valid with 9 human-gated unchecked boxes by design. This session REVIEWS —
> code review of the 14 local commits, plus vault review-pending items and the
> human-only backlog. Do not implement unless a review finding demands a fix,
> and only with explicit user approval.
> Campaign record: `/root/workspace/HANDOFF.md` (272 lines, §7 ALL PASSED).

## 1. Repo State

- Workspace `/root/workspace`: branch `preview-v0.4.23`, **ahead 14** of `origin/preview-v0.4.23`, working tree CLEAN
- Pile size: **115 files, 11152 insertions, 232 deletions** across 14 commits
- **NO-PUSH** for the workspace repo — local commits only, always
- Vault `/root/wiki` (branch `main`): pushed and clean (`b2885548c`, `3d7cd479a`, `09cfa11ea`, `5621fd8ab`, `d59d6830b`)

## 2. Commit Review Map (oldest → newest)

| # | Commit | Scope | Review value |
|---|--------|-------|--------------|
| 1 | `9ed80454` | "update" — only `.claude/settings.json` (-1 line) | low (meta) |
| 2 | `bd142b2e` | undo-500 fix (replacement recompute targets reversal revision; browser UAT v2) | **HIGH** |
| 3 | `f4ef1318` | item1: convex search byte-budget audit + 16-term caps + `docs/runbooks/convex-search-budget.md` | MED |
| 4 | `5e8c6cfa` | item2: Server-Timing named metrics + OpenAPI streaming check (+ `docs/runbooks/server-timing.md`) | MED |
| 5 | `763be521` | item3: extension CDP usage boundary + F18b hazard note (apps/browser-extension/CLAUDE.md) | MED |
| 6 | `918cf3a5` | item7: CJK spike `scripts/cjk-measurement-spike.ts` (502) + results (957) + runbook (300); no search-path change | MED |
| 7 | `cef3f5fd` | item8: worker idempotent crawl — `apps/worker/crawl_progress.py` (96), `resume_tasks.py` (151), tests (78+142) | **HIGH** |
| 8 | `1e57ec7f` | HANDOFF.md created (248 lines) | low (meta) |
| 9 | `25ac7676` | item9: resume dedup — `packages/convex/convex/lib/resume_identity.ts` (263), `resume_dedup.ts` (218), `resume_dedup_blocks` table, tests (376); web `ResumeDedupReviewPage.tsx` (169) + test (142); i18n 3 locales | **HIGH** |
| 10 | `3ec04044` | **MIXED PILE** — items #10/#11/#12 + #1 closeout tests + #9 wiring; ~70 files across convex/API/web/CLI/scripts/docs | **HIGHEST** — review by subsystem, see §3 |
| 11 | `cc9a1a48` | api-types regen (`apps/web/src/lib/api-types.ts` +293, generated) | low (generated; verify parity via check-node) |
| 12 | `82d4713d` | route-auth-policy.json +8 (policy-overrides workspace-write + workspace-snapshots admin) | **MED (auth)** |
| 13 | `63cf6105` | mutations registry +1 (`workspace_snapshots.ts:importWorkspaceSnapshot`, quiesceAware:false, reason recorded) | **MED (registry)** |
| 14 | `a339488d` | HANDOFF.md final state (40+/37-, §7 ALL PASSED) | low (meta) |

## 3. Reviewing the Mixed Pile `3ec04044`

`git show --stat 3ec04044` first, then split by subsystem:

- **Convex**: `packages/convex/convex/workspace_snapshots.ts` (380), `candidate_policy_overrides.ts` (178), `candidate_status.ts`, `lib/company_resume_links.ts`, schema, `_generated/api.d.ts`
- **API**: `apps/api/src/routes/workspace-snapshots.ts` (174 + test 293), `routes/policy-overrides.ts` (167), `services/candidate-policy-override-service.ts` (97), app.ts/server-timing middleware/openapi tests/companies route
- **Web**: `apps/web/src/pages/system-settings/SystemSettingsWorkspacePage.tsx` (475 + test 228), `hooks/useCandidatePolicyOverrides.ts` (133), App.tsx/ResumeCard/ResumeDetail/ResumeList/search components/useResumeSearchState/i18n/DebugConfig/ResumeSearchPage/SystemSettingsIndustryVerificationPage tests
- **CLI**: `packages/cli/cmd/workspace_backup.go` (193 + test 373), `internal/client/workspace_backup.go` (77 + test 114)
- **Scripts**: `scripts/t12-*.ts/.sh`, `t3-stamp-verify.ts`, `t6-*.ts`, `scripts/evaluate-hr-cohort-ranking.ts` (371 + test 168), `compute-scoring-metrics.ts`, `scripts/industry-review/browser-uat-clean.ts` (305) + fixture changes (browser-uat hardened to workspace route + `data-testid` row selection)
- **Docs**: `docs/runbooks/rerank-gap-analysis.md` (118), `docs/design-patterns/scoring-explanation-signals.md` (86)
- **Dumps**: `ws-*.yaml` (5) — review as fixtures, not source

Known constraint from the campaign: CJK company keys in the Convex resume-impact response caused a reviewer review-queue 500 (non-ASCII field names rejected by Convex JSON serializer). Fix used ASCII-safe entries + route-side ASCII key filtering — verify no regression in related routes.

## 4. Vault Review-Pending Items

All under `/root/wiki/projects/trends/`. **Review/discuss; do NOT auto-claim:**

1. `work/2026-07-17-industry-data-r1-r2-r4-web-steward` — discuss/review, do not auto-claim
2. `work/2026-07-31-industry-verification-coverage-panel` — 20 researched / 3 ready; **owner closeout remains**
3. `work/2026-08-01-industry-inbox-linkedin-filters-history-resilience` — UAT passed (41/5/36/23); **plan checkpoints + owner closeout remain**
4. PR #1360: `work/2026-08-07-preview-v0.4.23-pr-1360-human-gate` — **NEVER merge by agent**; human gate

## 5. Human-Only Backlog (do NOT auto-claim, review findings only)

- `work/2026-07-17-company-policy-followups-human-only`
- `work/2026-07-17-workspace-portability-p2-p4-human-only` (P3/P4 remain)
- MY scoring gap #3 — BLOCKED
- v0.4.17 prod deploy

## 6. Hard Rules

- **NEVER touch `2026-06-18-prod-unpin-auth-readiness`**: requires authorized prod cutover + HR disposition of 19 prod-only rows. Do not claim, edit, or commit anything for it. Verified untouched during the campaign (0 commits referencing it).
- **NO-PUSH** for `/root/workspace`. Vault push only via the presync flow in §7.
- Do not auto-claim human-gated items. Review-only unless the user approves a fix.

## 7. Conventions

- **All subagent spawns fail** (gateway HTTP 400 `reasoning_content must be passed back`) → do all work INLINE. Do not retry spawns.
- **No browser MCP** → verify via tests/curl/scripts. If browser verification is needed, use playwright-cli / chrome-debug profiles (`ensureDevAdminSession` self-heal pattern; the chrome-debug profile is SHARED across UAT roles — sessions flip between passes).
- **Env sourcing**: `set -a; source .env; set +a` before gate/seed runs — `bun run <pkg-script>` does NOT propagate `.env` to `tsx` children. Export `CONVEX_WRITE_SECRET`, `AUTH_BOOTSTRAP_PASSWORD`, `AUTH_HR_DEMO_PASSWORD`.
- **Test invocation**: API `bunx vitest run apps/api/...` from repo root; web from `apps/web`; Python `uv run pytest apps/worker/tests tests/`; Go `cd packages/cli && go test ./cmd/ ./internal/client/`.
- **CI gates** (`make ci-local`): node-major + i18n + agent policy + `CI=true make check-build` + test-coverage + check-route-auth (`scripts/route-auth-policy.json`) + check-node (api-types regen must match HEAD) + **check-mutation-entry-points** (every public Convex mutation registered in `packages/convex/convex/_mutations_registry.ts` with `{file,name,quiesceAware,reason}`).
- **React 19 root pin** (root devDeps `^19`; `apps/web/vitest.config.ts` aliases to root copy). react-i18next test mocks MUST return a module-scope `t` (`src/test/setup.ts` provides one) — inline `t` arrows destabilize `useCallback([..., t])` and cause update-depth loops. Keep `t` in callback deps.
- **Vault lint baseline**: 80 pre-existing errors (sensitive_content 41 + broken_wikilinks 39, false positives). Target: lint-delta 0 (no NEW errors). Baseline errors reference only `2026-07-29-my-industry-evidence-self-maintenance-search-ux` and `2026-07-30-industry-maintenance-ops-automation`.
- **Vault push flow**: `bash /root/.grok/installed-plugins/vault-sync-ae1287d3/skills/vault-presync/wiki-sync.sh --execute`, then in `/root/wiki`: `git add -A && git commit -m "..." && git push`.
- **Convex local backend**: heap grows ~1 GB per UAT pass; at <4 GB available restart via `scripts/dev.sh --convex-only --no-seed`. Kill by port-derived PID, never `pkill -f "convex dev --local"` (self-matches the invoking shell).
- **AI model policy**: default `openai/deepseek-v4-flash-e` (Poe `AI_API_BASE=https://api.poe.com/v1`); see `docs/runbooks/llm-api-provider-fallback.md`. Poe `deepseek-v4-flash` has a known `response_format` bug (HTTP 400) — stays `AI_FALLBACK_MODEL`, do not promote.

## 8. Session References

- Campaign handoff: `/root/workspace/HANDOFF.md`
- Prior transcripts: `/root/.grok/sessions/%2Froot%2Fworkspace/01a014c0-4dfb-7f03-a47b-88f5450018a3/compaction/INDEX.md` (read-only, do not modify)
- Vault index: `/root/wiki/projects/trends/index.md` (review-pending + human-only sections)
- Agent policy: `AGENTS.md` (canonical), `dev-docs/AGENTS.md` (generated mirror — edit source, run `make sync-agent-policy`)

## 9. Suggested Review Order

1. Auth-sensitive: `bd142b2e` (undo-500), `82d4713d` (route auth) + `63cf6105` (mutations registry)
2. Data-integrity: `cef3f5fd` (idempotent crawl), `25ac7676` (resume dedup)
3. Mixed pile `3ec04044` by subsystem: Convex → API → web → CLI → scripts → docs
4. Docs/runbooks: `f4ef1318`, `5e8c6cfa`, `918cf3a5`
5. Vault review-pending items (§4) — produce findings only
6. Before claiming anything done: `make ci-local` green + vault lint-delta 0 + `git status` clean
