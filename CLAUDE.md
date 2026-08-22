# Trends Agent Reference Index

## Path Aliases
- `{REPO_ROOT}` = repository root (`/root/workspace`)
- `{WIKI_VAULT}` = skillwiki vault root (default `~/wiki`; resolve with `skillwiki path`)

## Repo Entry Points
- Canonical agent policy: `{REPO_ROOT}/AGENTS.md`
- Agent runbook: `{REPO_ROOT}/docs/agent-runbook.md`
- Browser extension guide: `{REPO_ROOT}/apps/browser-extension/CLAUDE.md`
- Dev docs usage: `{REPO_ROOT}/dev-docs/README.md`
- Generated governance mirror: `{REPO_ROOT}/dev-docs/AGENTS.md`

## Wiki Entry Points
- Vault root: `{WIKI_VAULT}`
- Trends wiki index: `{WIKI_VAULT}/projects/trends/index.md`
- Trends project README: `{WIKI_VAULT}/projects/trends/README.md`
- Completed UI/UX UAT + fix-to-empty round (2026-08-19): `{WIKI_VAULT}/projects/trends/work/2026-08-19-uiux-uat/` · full browser UAT over 8 recently-touched surfaces per role (hr-demo/demo-admin/uat-reviewer, CDP + net capture) → 5 defects fixed, backlog **empty** per user decision: F1 industry-verification inbox + coverage panel 500s (BFF tolerates malformed proposal rows — skip accounting `skippedCount`/`skippedProposalIds` + trigger-reason allowlist, `f2fa22cd`) · F2 detail-pane approve ignored the `/approve` response (controlled-lift session registry, `43bdba25`) · F3 settings sidebar 设置/搜索设置/导出字段 labels missing `titleKey`s in 3 locales + guard test (`f7c21e3b`) · F4 non-admins fired admin-only market policy GETs → mode-keyed (`full`/`restricted`) cache + `useAuth()` gate, scope switcher 工作区 only for non-admins (`9843d268`) · F5 lower-bound `+` suffix on zero counts ("0+ 条结果" → "0 条结果", `0e5a7c5f`) · regression re-walk 4/4 surfaces green · `make ci-local` GREEN (gate debt fixed `5abb3386`; **F4 side effect: `useCompanyPolicies`/`useCompanyPolicyIndex` now call `useAuth()` — tests rendering consumers need AuthContext mocks with `memberships`**) · workspace commits NO-PUSH
- Completed preview restore company-industry re-seed (2026-08-19): `{WIKI_VAULT}/projects/trends/work/2026-08-19-preview-restore-company-industry/` · full-state preview restore drops the `company_industry_*` tables and **prod has ZERO such rows** (approach A falsified: 32-table export, `company_industry_profiles | 0 | 27 of 27`) → deterministic post-restore re-seed leg **Step 3c.2** (FATAL) in `restore-preview-from-prod.sh` via `seed_preview_company_industry()` (`deploy/lib-preview-common.sh`): in-container ESM driver (`deploy/seed-data/seed-company-industry.mjs` + byte-stable `company-industry-seed-plan.json`, 27 companies / 71 sources) replaying the July attended-bootstrap with existing mutations only (`companies:upsert` → `upsertIndustryProposal` → `upsertIndustryEvidenceSource` → `approveIndustryProposal` human path, reviewer "restore-helper", `expectedInputFingerprint` omitted by design — stale-check needs both fields) · standalone verify 0→27 + idempotent re-run; sync timing research: actual ≈9m34s (NOT ~30 min), floor = cloud snapshot export + backend import; refactor A (log timestamps) / B (health-gated force-recreate via `convex_healthy()`, `FORCE_CONVEX_RECREATE=1` override) / C (`SKIP_RESUME_EXPORT=1` in sync Phase 1) · full canonical re-sync 2026-08-19 `SYNC_EXIT=0` ~10m00s: `SEED_OK companies=27 sources=71` (log line 664), import `Added 49516 documents`, `candidate_actions` 406=406, `PARITY OK` (version-drift WARNs only), post-sync probe `PROFILES=27` · workspace commits NO-PUSH
- Completed preview deploy test 0.4.23 (2026-08-18): `{WIKI_VAULT}/projects/trends/work/2026-08-18-preview-deploy-test/` · **preview now runs pile code 0.4.23 @ `6486bcf9`** (tag `v0.4.23` moved locally + ptcloud mirror; GitHub tag `v0.4.23` force-updated to `6486bcf9` 2026-08-22 — **pile PR #1361 merged** (preview→main merge commit `582bc83b`); `preview-v0.4.23` re-synced to main) · canonical prod→preview sync (`preview-sync-from-prod.sh --data-only`) **6/6 legs green**: backup manifest `prod-complete-20260818T181956Z` (prod_sha `30b9015a`, version 0.4.16), Convex import A5 completed **49,516 rows**, sqlite `candidate_actions` 406=406, isolate (10 AI env vars re-synced), stabilize (`/version` 200, API auth 401s), `TOTAL_TOLERANCE=0` parity **PARITY OK** (WARNs = version drift 0.4.16→0.4.23 by design: search_total_cn 313 vs 639, search_total_my 427 vs 60, statusCounts new:48/rev:263 vs 373/264) · **import-failure root cause: NOT an executor wedge** — A1–A4 `Import canceled` = CLI `timeout 900` killing the client mid-import (backend cancels the job); the middle-journal `documents` DELETE was self-inflicted and broke backend startup (restored from sqlite copy — journal is append-only) · **schema-divergence finding**: sync drops `system_settings/` → `--replace-all` leaves the table EMPTY, schema push recreates it → preview settings revert to defaults; preview also loses company-industry tables (flagged pre-approval) · search-total drift = 0.4.23 query expansion (CNC → 17-term `expandedTo`, 销售 → 4-term, mode AND); `summary.total` ignores `minScore` (flat at 80/90/95 on both sides) → CHECK_MIN_SCORE=80 bucket FAIL is the same version-drift signal, not a scoring regression (9,512 `resume_analyses` imported 1:1) · doctor `--full` 0 failures; endpoint smokes `/` 200 `/convex/version` 200 `/api/blocks`+`/api/resumes` 401; CDP parity smoke = identical UI + identical 403 (headerless in-page fetch) on both · defect follow-up (stale-import cleanup) **FIXED** in `8a843e82` — see the hardening bullet below · workspace commits local (NO-PUSH)
- Completed preview sync hardening D1/D2/R3/R4 + UAT follow-ups F1–F3 (2026-08-18/19): `{WIKI_VAULT}/projects/trends/work/2026-08-18-preview-sync-hardening/` + `{WIKI_VAULT}/projects/trends/work/2026-08-19-preview-uat-followups/` · D1 pre-upload stale-import cleanup (`cancel_stale_convex_imports`/`stale_import_ids_from_sqlite` in `deploy/lib-preview-common.sh`: read-only journal scan + `POST /api/cancel_import`, journal append-only, fail-fast) · D2 `CONVEX_IMPORT_TIMEOUT_SEC` default 3600 (was `timeout 900`) · R3 `system_settings/` row filter to env-local keys (`maintenanceMode`, `industryMaintenanceSchedulePaused`) in `deploy/lib-convex-export-fix.sh` + post-sync smoke · R4 `CHECK_MIN_SCORE` bucket gated on `api_version` (version drift = WARN, `PARITY_STRICT_SEARCH=1` fails) · canonical re-sync 6/6 legs green (49,516 rows, PARITY OK, candidate_actions 406=406) · second UAT 37/37 · follow-ups: F1 approve-nonexistent → 404 + error envelope + OpenAPI 404 schema + regression test (API 67/67, typecheck clean; web unchanged — `requestJson` already surfaces 404, stops pointless 500-retry) · F2 ext manifest 1.3.7 doc note · F3 handoff Status + Closeout · deploy tests green · commits `8a843e82` + `b60fa04d` + `4a0b2ba1` + `5aaf2278` local (NO-PUSH)
- Completed CJK search-path fixes (2026-08-19): `{WIKI_VAULT}/projects/trends/work/2026-08-19-cjk-search-fixes/` · A1 query-side script-boundary split (`normalizeSearchQuery` in shared) + A2 BFF punctuation split (`unified-search-service.expandKeyword`) · A3 selfIntro prose tokens into digest searchText (1500-char cap) · A4 segmentit union augmentation (deep-subpath ESM `segmentit/dist/esm/segmentit.js`, chunk-capped ≤20 chars vs exponential dict chunking, lazy memoized, ambient `segmentit.d.ts` + triple-slash ref) · A5 single-char = decision, no code · epoch bump → 4 + `migrations:reIngestStaleSkillsVersion` drain (10,730 rows, LIMIT=50 vs 200-surface cap; lagging=0 verified) · preview-doctor 0 failures · corpus 0-hit fixes persist post-backfill (CNC编程 0→373, CNC操机 0→619, UG编程 0→190) + 数控 no-regression probe ✓ · `make ci-local` green · commit `b368eea6` (NO-PUSH)
- Completed MY scoring cohort harness (2026-08-19): `{WIKI_VAULT}/projects/trends/work/2026-08-19-my-scoring-cohort-harness/` · deterministic synthetic MY resume generator `scripts/generate-my-cohort.ts` (mulberry32 seed 20260819, N=35 = L1:5/L2:9/L3:10/L4:7/L5:4, 4 MY archetypes, EN+BM templates, zero PII, rubric-blind) · 5×5 BARS rubric `scripts/my-cohort/rubric.{en,ms}.json` + `rater-kit.md` (FoR, 3 vignettes) · IRR gate CLI `scripts/run-my-cohort-gate.ts` (QWK/AC2 ≥ 0.65, ρ ≥ 0.70, NDCG@10 ≥ 0.85, MAE ≤ 0.75; Fleiss κ ≥ 0.61 with `--panel-csv`; exit 0/2/1; REPORT.md + JSON) · additive evaluator extension (`irr`/`fleiss` on overall report only) · PDPA 2010/Amendment-2024 doc `docs/design-patterns/my-scoring-cohort-pdpa.md` · battery 70/70 (2141 expect); demos clean exit 0 / noisy exit 2 / panel κ=0.8781 exit 0; `make ci-local` green · human-gated golden-set `2026-07-20-my-scoring-cohort-golden-set` NOT claimed · commit `36cfff20` (Tasks 1–2) + round commit (NO-PUSH)
- Completed company-policy follow-ups round T1–T6 (2026-08-19): `{WIKI_VAULT}/projects/trends/work/2026-08-19-company-policy-followups-round/` · T1 de-prioritize preset + chip · T2 BFF hidden-company filter + `?includeHidden=true` admin escape · T3 durable `resumes.companyKeyProjection` snapshot `{epoch, companyKeys, companyTokens}` + `migrations.recomputeCompanyKeyProjections` (drain 10,922 rows, stale=0; `ingest-compute-epoch` shared) · T4 unresolved-queue link/ignore admin actions (`/api/industry-data/unresolved` GET + `/resolve` POST, queue page tabs/search/bulk; browser UAT link/ignore/bulk/empty green) · T5 market > workspace precedence (scope rank `{market:2,workspace:1,global:0}`, `resumes.sourceKey` top-level schema field + 4 projections, `resume-policy-enforcer.ts` per-market merged index fail-open, `PoliciesPage` scope switcher 工作区/中国大陆/马来西亚; GET `/api/company-policies?market=cn|my`, POST scoped) · T6 candidate override closed-as-shipped (cleanup-check exit 0 + live smoke; hardening nit: invalid resumeId → 500 envelope, **FIXED** in `{WIKI_VAULT}/projects/trends/work/2026-08-19-policy-override-validation/` — BFF 500→400) · all six per-topic decisions defaulted to Recommended · `make ci-local` GREEN (gate fixes: i18n `unresolvedQueue` namespace move to top-level ×3 locales + api-types commit) · commits `26e5b70b` + `60fe6888` + `d658f6a9` + `97df2335` + `6c87f7f9` (NO-PUSH)
- Completed CJK segmentation measurement spike (2026-08-18): `{WIKI_VAULT}/projects/trends/work/2026-08-18-cjk-segmentation-convex-tantivy/` · report `{REPO_ROOT}/docs/runbooks/cjk-segmentation-measurement.md` · 40 probes/10 classes · real gap = CJK–ASCII mixed queries (ingest-side-only boundary spacing) · `数控` anomaly = posting-list/1024-window artifacts · **no search-path code change** (candidate fixes recorded)
- Completed FastAPI worker idempotent crawl hardening (2026-08-18): `{WIKI_VAULT}/projects/trends/work/2026-08-18-fastapi-worker-idempotent-crawl/` · dispatch envelope parsing (queued:false/maintenance → skipped, real taskId logged) · per-profile crawl progress persisted atomically (`apps/worker/crawl_progress.py` → `output/worker/crawl-progress.json`) · retry polls `resume_tasks:getById` before re-dispatch (outcomes reused/queued/skipped_maintenance/error) · graceful shutdown pre-existed (`shutdown(wait=True)` drain); `arq` queue swap not applicable · 409 pytest + live Convex roundtrip verified
- Completed resume dedup multisource heuristics (2026-08-18): `{WIKI_VAULT}/projects/trends/work/2026-08-18-resume-dedup-multisource-heuristics/` · capture-time contact-signal normalization (`lib/resume_identity.ts`) + blocking (`phone:<first7>|<source>`, `email:<domain>|<source>` → `resume_dedup_blocks`) + advisory suggest-merge query (`scoreMergePair`: exact PII +2, name +1.5, company tokens +1, timeline +0.75, schools +0.5) · admin review page `/admin/system/settings/resume-dedup` · **NO auto-merge, NO identityKey mutation** · 2196/2196 convex tests (17 new), 648/648 shared, dedup page 4/4, i18n exit 0 · suggestion list empty on PII-free corpus by design
- Completed resume scoring explainability drift (2026-08-18): `{WIKI_VAULT}/projects/trends/work/2026-08-18-resume-scoring-explainability-drift/` · verify+document only (no new implementation): drift canary (`bias_audit` + cron + BFF routes + `AuditCompliancePage`), cohort evaluator parity gate (`evaluate-hr-cohort-ranking.ts`), metrics CLI (`compute-scoring-metrics.ts`) · delta doc `docs/design-patterns/scoring-explanation-signals.md` (reviewer-visible signals today vs recommended score-explanation block + future multi-agent contract) · 32/13/20/1971 tests green
- Completed industry-verification grouped inbox + audit-safe Undo (2026-08-18): `{WIKI_VAULT}/projects/trends/work/2026-08-01-industry-verification-grouped-inbox-undo/` · inbox-first 可批准/需检查/历史 UI, one-click clean-row approval, session 已批准 · Undo, manual-refresh History reconciliation, append-only compensating Convex revision (stale guards, recompute supersession, idempotency) · undo-500 fix: replacement recompute targets the reversal revision (`apps/api/src/services/company-industry-proposal-service.ts`) · browser UAT v2 12/12 + mobile approve→Undo→re-approve green · closeout: error-injection matrix (3 new tests — service non-stale propagation, route 500 no-envelope, web 409-block + 500-Retry recovery; API 66/66 + web 36/36 green) + screen-reader color audit (no color-only signaling) + owner sign-off · workspace commits pending (NO-PUSH)
- Completed historical preview backup rehearsal (2026-08-18, claimed scope): `{WIKI_VAULT}/projects/trends/work/2026-07-28-historical-preview-backup-rehearsal/` · rehearsal-log decision = **NO host run** (dry-run only: 71/71 safety tests, backup `prod-complete-20260722T191315Z` manifest-verified on `ptcloud`, controller checkout missing scripts/tag) · live restore/migration/rollback stays an owner-authorized on-host follow-up · workspace code committed (backup + snapshot routes)
- Completed industry-review UAT unblock + CN fixture rebound (2026-08-14): CJK company keys in the Convex resume-impact response caused the reviewer review-queue 500 (non-ASCII field names are rejected by Convex's JSON serializer); fixed with ASCII-safe entries + route-side ASCII key filtering + live `getConvexWriteSecret()` getter; fixture `companyKeyByCase` rebound to CN companies (explicit-cnc → `polywell`, zero links + zero revisions → clean +1 delta); browser-uat hardened to workspace route + `data-testid` row selection
- Completed review-workflow navigation fix (2026-08-11): `docs/superpowers/specs/2026-08-11-industry-review-workflow-navigation-design.md` · workspace-scoped review base (fixes SystemAccessGate bounce on 查看/row/prev-next) · scroll-to-detail · legacy notice for workspace reviewers/admins · 行业验证 settings sidebar entry for reviewers
- Completed Seek talentsearch detail + MY expand **v0.4.21** (2026-07-24): `{WIKI_VAULT}/projects/trends/work/2026-07-24-seek-talentsearch-detail-v0.4.21/` · `84b20e23` + local tag `v0.4.21` · ext 1.3.6 at the time (not pushed; manifest now 1.3.7, bumped in v0.4.22 `11776c01`)
- Completed web-research real-source layer (2026-07-30): `{WIKI_VAULT}/projects/trends/work/2026-07-30-web-research-real-source-layer/` · 16 local commits `c2142e23..830ae8ef` (not pushed) · **CN is the core market (internal users are China users); MY is additional** · CN upstream = NewsNow-compatible API ([ourongxing/newsnow](https://github.com/ourongxing/newsnow), TrendRadar upstream) via existing `RESEARCH_HOTLIST_API_URL` hook · `WEB_RESEARCH_MARKET` default `cn`
- Completed Research hub CNC + pulse keywords (2026-07-22): `{WIKI_VAULT}/projects/trends/work/2026-07-22-research-hub-cnc-pulse-keywords/` · local tip `c519b6e4` (not pushed)
- Completed ingestComputeEpoch + search-freshness doctor (2026-07-21): `{WIKI_VAULT}/projects/trends/work/2026-07-21-ingest-compute-epoch-search-freshness/` · compound same slug · commits `4447382a` + `0bd7aa85` + `02c5ce6d` (2026-07-22: greenwash fix, floors 100, MY preview/local 142 parity)
- Completed Seek MY talentsearch editor + minRoleYears gate (2026-07-18): `{WIKI_VAULT}/projects/trends/work/2026-07-18-seek-my-talentsearch-profile-editor-search-gate/`
- Completed clear-analyses AI-only / HR status preserve (2026-07-17): `{WIKI_VAULT}/projects/trends/work/2026-07-17-clear-analyses-ai-only-hr-status/`
- Completed K3 company policy B+C (2026-07-17): `{WIKI_VAULT}/projects/trends/work/2026-07-10-company-registry-policy-architecture/`
- Completed preview auth migration P1 (2026-07-17): `{WIKI_VAULT}/projects/trends/work/2026-07-16-preview-auth-workspace-portability/`
- Industry-data R1+R2+R4 (discuss/review, do not auto-claim): `{WIKI_VAULT}/projects/trends/work/2026-07-17-industry-data-r1-r2-r4-web-steward/`
- Company-policy follow-ups (human-only, do not auto-claim): `{WIKI_VAULT}/projects/trends/work/2026-07-17-company-policy-followups-human-only/`
- Workspace portability: **P2 completed 2026-08-18**; P3/P4 deferred (human-only, do not auto-claim): `{WIKI_VAULT}/projects/trends/work/2026-07-17-workspace-portability-p2-p4-human-only/`
- Prod deferred (do not local-claim): `{WIKI_VAULT}/projects/trends/work/2026-06-18-prod-unpin-auth-readiness/`
- Completed seats/onboarding (2026-07-16): `{WIKI_VAULT}/projects/trends/work/2026-07-16-admin-user-workspace-onboarding/`

## Test/CI Conventions (loop-class regressions — do not reintroduce)

CI Tests workflow stalled for hours in 2026-07 ("Maximum update depth exceeded"
infinite loops + hangs). The following conventions are hard-won; the guards are
enforced by tests/CI:

- **React 19 is pinned at the repo root** (root devDeps `react`/`react-dom`
  `^19`). `apps/web/vitest.config.ts` aliases every react import to the ROOT
  copy so tests and @testing-library/react share one reconciler; a stale root
  hoist (July-2026 root cause: a stale lockfile hoisted React 18 to root while
  the bun tree had 19) silently splits the suite across two React majors in
  one jsdom process — divergent act()/effect behavior, races, stalls. Note the
  update-depth guard code is identical in React 18/19; the failure was the
  mixed-reconciler split, not React 18 being loop-prone. `src/test/setup.ts`
  hard-fails at test start if resolved React is not 19.x. Never remove the
  root pin; never let `package-lock.json` drift out of the tree (it is
  committed and CI-installs it).
- **Keep `t` in callback deps — `t` is stable.** react-i18next memoizes `t`
  (stable identity across renders; changes only on a language switch), and the
  test mocks below return a module-scope `t`, so `useCallback(..., [t])` is
  stable and mount effects run once. Do NOT omit `t` from deps to "fix" loops:
  it stalls error strings in the old language after a runtime language switch.
  If a loop appears, the cause is an unstable mock or an unstable non-`t` dep,
  not `t`.
- **react-i18next test mocks must return a module-scope `t`.** An inline
  `t: (key) => ...` arrow inside a `vi.mock('react-i18next', ...)` factory
  creates a fresh `t` every render, destabilizing every `useCallback([..., t])`
  in the tree. Hoist it: `const mockT = (key, opts) => ...` at module scope,
  then `t: mockT`. `src/test/setup.ts` provides a shared default.
- **Loop watchdog (smoke signal):** `apps/web/vitest.config.ts` `onConsoleLog`
  throws when a worker logs "Maximum update depth exceeded" — the throw
  surfaces in the main process as an unhandled rejection and the run exits 1,
  instead of streaming warnings until the 30-minute CI timeout. It does NOT
  fail the offending test and does NOT interrupt a worker stuck in a loop; the
  stable-mock-`t` convention above is the real protection.
- **Node 22 / CI parity:** `.nvmrc` pins node 22; both GitHub workflows read
  it via `node-version-file` so it is the single source of truth. Before
  pushing, run `make ci-local` (node-major check + i18n + agent policy +
  `CI=true make check-build` + `make test-coverage`) — it reproduces the CI
  gates locally. `NODE_VERSION_STRICT=1` upgrades the node-major mismatch to a
  hard failure.
- **Nightly UAT & fix loop conventions (2026-08-12, 35 unattended passes on
  preview-v0.4.23 — do not reintroduce):**
  - **`bun run <pkg-script>` does NOT propagate `.env` vars to `tsx` children**
    (F32). Export `CONVEX_WRITE_SECRET`, `AUTH_BOOTSTRAP_PASSWORD`,
    `AUTH_HR_DEMO_PASSWORD` (`set -a; source .env; set +a`) before gate/seed runs.
  - **The chrome-debug profile is shared across UAT roles** (hr-demo / demo-admin /
    uat-reviewer): sessions flip between passes and silently bounce `/admin/*`
    routes. e2e self-heals via `ensureDevAdminSession` (F12); loop re-logs per role walk.
  - **The 智通直聘 extension auto-scrape can navigate the driven tab to job5156
    mid-test** (F18b): e2e settle recovery must track completed API responses +
    query-param re-navigation, not DOM state alone.
  - **Search failure panel ≠ empty state**: a dropped BFF search shows the failure
    panel with 重试 (F11 fix); an explicit empty state means genuinely zero matches.
    Assert the right one.
  - **`sales` empty state after e2e bulk actions is expected** (F19): the default
    new-only status filter hides shortlisted fixtures; `?status=shortlisted` shows them.
  - **Convex local backend heap grows ~1 GB per UAT pass**; at <4 GB available,
    restart via `scripts/dev.sh --convex-only --no-seed` (F18) — the precompiled
    supervisor does NOT respawn a killed backend. Kill by port-derived PID, never
    `pkill -f "convex dev --local"` (self-matches the invoking shell).
  - **e2e settle polls must tolerate** analysis churn (Vite proxy drops large
    responses, browser-only), extension churn, and slow-backend loading skeletons.
    Reload/query-param recovery beats retry-clicks (connection-level drops).

## AI Model Policy (locked 2026-08-13)
- Default/basic model for all daily agent tasks and basic services: `openai/deepseek-v4-flash-e` (Poe gateway `AI_API_BASE=https://api.poe.com/v1`). Historical ADR still at `{WIKI_VAULT}/projects/trends/architecture/decisions/2026-08-13-deepseek-v4-flash-default-model.md` — operational default swapped 2026-08-17 after live probe.
- **Known bug (keep tracking):** Poe `deepseek-v4-flash` rejects `response_format` (HTTP 400 `Invalid input`). It is **not** the default. It stays `AI_FALLBACK_MODEL` / `POE_DEEPSEEK_V4_FLASH_KNOWN_BUG.status=open`. Do not promote it back until that bug is closed. Notes: `docs/runbooks/llm-api-provider-fallback.md`. Runtime change is `convex env set` / `scripts/sync-convex-env.sh`, not the BFF import-time `aiConfig` snapshot.
- Canonical env form is `provider/model` (app validation requires it; `scripts/ai-model-check.sh` known-good list has both forms). Code fallback default: `apps/api/src/services/ai-config.ts`.
- Reasoning-model caveat: Poe returns empty `content` with populated `reasoning_content` for this model on short prompts — expected.

<!-- AGENT_POLICY:BEGIN -->
<!--
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
- `make check` must fail if policy checks fail.
-->
<!-- AGENT_POLICY:END -->
