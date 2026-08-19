# Handoff: UAT pass + UI/UX next-actions discovery

**To:** New session (run UAT + discover next UI/UX actions to fix)
**From:** Grok session (preview-v0.4.23 round closeout: company-policy umbrella, MY scoring cohort harness, policy-override validation nit)
**Date:** 2026-08-19
**Repo:** `/root/workspace` (trends)
**Branch:** `preview-v0.4.23` (local, NO-PUSH; **ahead 38** of origin — do not push without explicit approval)
**HEAD at handoff:** `77c41159` — `docs(claude): policy-override T6 nit FIXED — link 2026-08-19-policy-override-validation`
**Status:** All prior rounds **complete & verified**; workspace tree **clean**; vault pushed. Your mission is **fresh work**: UAT + UI/UX discovery.
**Requested action:** Run a full UAT pass over the web app (dev stack, real browser tooling), then discover and prioritize the next UI/UX actions to fix. Fix the top items with evidence. Do **not** touch prod. Do **not** push anything to GitHub without explicit user approval.

---

## Mission (one sentence)

Run a browser-verified UAT pass over the app's recently-touched UI surfaces (industry verification inbox, policies scope switcher, unresolved queue, resume-dedup admin, audit compliance, search), and produce a prioritized UI/UX defect + improvement backlog with file:line evidence, then fix the top items end-to-end.

---

## State snapshot (2026-08-19)

```json
{
  "repo": { "dir": "/root/workspace", "branch": "preview-v0.4.23", "ahead": 38,
    "head": "77c41159", "tree": "clean", "tag": "v0.4.23 (local + ptcloud mirror; GitHub 33d0e13c untouched)" },
  "vault": { "dir": "/root/wiki", "head": "84ee6315a", "pushed": true,
    "recent": ["2026-08-19-policy-override-validation", "2026-08-19-preview-uat-followups", "2026-08-18-preview-sync-hardening"] },
  "preview": { "url": "https://preview.pt-mes.com", "version": "0.4.23", "commit": "6486bcf9",
    "data": "full prod copy (49,516 rows; candidate_actions 406=406)", "creds": "/home/ubuntu/trends-preview/.env.preview" },
  "prod": { "dir": "/opt/trends", "version": "0.4.16", "commit": "30b9015a", "creds": "/etc/trends/env" }
}
```

Recent completed work (context for what UAT should cover — all browser-verified at the time, re-verify in this round):

| Round | UI surface | Last evidence |
|---|---|---|
| `2026-08-01-industry-verification-grouped-inbox-undo` | Industry inbox grouped 可批准/需检查/历史, one-click approve, session Undo, History reconciliation | v2 UAT 12/12 + mobile approve→Undo→re-approve green |
| `2026-08-11` review-workflow navigation | Workspace-scoped review base (SystemAccessGate bounce fix), scroll-to-detail, legacy notice | Browser UAT green |
| company-policy umbrella (T5) | PoliciesPage scope switcher 工作区/中国大陆/马来西亚 (admin-only CN/MY tabs) | Round closeout |
| `2026-08-18-resume-dedup-multisource-heuristics` | `/admin/system/settings/resume-dedup` suggest-merge page | 4/4 page tests; **suggestion list empty on PII-free corpus by design** |
| `2026-08-18-resume-scoring-explainability-drift` | `/audit-compliance` (bias canary + cohort evaluator) | Tests green (verify + document only) |
| `2026-08-19-policy-override-validation` | POST `/api/policy-overrides` 500→400 nit (no web change) | API 5/5 new + 82/82 regression |

---

## UAT runbook (do this)

### Stack + login

- **Dev stack:** `scripts/dev.sh` (web Vite on `http://localhost:5173`, Convex local backend). If the Convex backend has grown (~1 GB heap per UAT pass), restart via `scripts/dev.sh --convex-only --no-seed` — the precompiled supervisor does **NOT** respawn a killed backend. Kill by **port-derived PID**, never `pkill -f "convex dev --local"` (self-matches the invoking shell).
- **Env:** `set -a; source .env; set +a` before any tsx/vitest run — `bun run <pkg-script>` does **NOT** propagate `.env` vars to `tsx` children. Never paste secrets into committed files.
- **Roles (workspace `hr`):** `hr-demo` (HR user), `demo-admin` (workspace admin), `uat-reviewer` (reviewer). Credentials in `.env` (`AUTH_HR_DEMO_PASSWORD`, `AUTH_BOOTSTRAP_PASSWORD`).
- **Browser tooling:** check for browser MCP at session start (none was connected here). This environment's browser path is: `playwright-cli` skill (chrome-debug profile attach; `playwright-cli open` fallback) + repo Playwright scripts. **Do not finish with a single render screenshot — exercise flows end-to-end** (user rule): click/type/submit/navigate, check every route sharing touched state, desktop **and** mobile viewports, empty/error/flag variants.
- **Automated baseline first:** `bunx tsx scripts/e2e-smoke.ts` from repo root (Playwright + `connectToChrome` CDP port 9222, AxeBuilder a11y scan, `measureWebVitals` vs `scripts/benchmarks/cwv-baselines.json`, `collectConsoleErrors`, deterministic query `'sales'`). Also available: `scripts/e2e-deep-scan.mjs`, `scripts/browser_cdp.py`, `scripts/preview-prod-parity-smoke.mjs` (CDP 39382; needs `AUTH_HR_DEMO_PASSWORD`).

### Known traps (hard-won, do not reintroduce)

- **chrome-debug profile is shared across roles** (hr-demo / demo-admin / uat-reviewer): sessions flip between passes and silently bounce `/admin/*` routes. e2e self-heals via `ensureDevAdminSession`; re-log per role walk.
- **智通直聘 extension auto-scrape can navigate the driven tab mid-test**: settle recovery must track completed API responses + query-param re-navigation, not DOM state alone.
- **Search failure panel ≠ empty state**: dropped BFF search shows failure panel with 重试; empty state means genuinely zero matches (`没有匹配到简历` etc.). Assert the right one.
- **`sales` empty state after e2e bulk actions is expected**: default new-only status filter hides shortlisted fixtures; `?status=shortlisted` shows them.
- **e2e settle polls must tolerate** analysis churn (Vite proxy drops large responses), extension churn, slow-backend loading skeletons. Reload/query-param recovery beats retry-clicks.
- **Preview site caveats (if used):** preview `system_settings` at defaults after sync (expected), search totals differ from prod (0.4.23 query expansion — feature, not data loss), `summary.total` ignores `minScore`.

---

## UI/UX discovery agenda (seed — probe these, then widen)

Prioritize by impact: broken flows > confusing states > a11y > polish. For every finding record file:line, repro steps, severity, and a suggested fix. Open a vault work item (`~/wiki/projects/trends/work/2026-08-19-uiux-uat/` pattern) and log findings as you go.

1. **Industry verification inbox + review queue** — `/settings/industry-verification` (workspace-scoped base per 2026-08-11 nav fix; gates: workspace admin/reviewer) and `/settings/industry-verification/proposals/:proposalId`. Probe: grouped tabs 可批准/需检查/历史, one-click approve, session Undo, History reconciliation after manual refresh, prev/next row navigation, scroll-to-detail, legacy notice for workspace reviewers/admins. Mobile viewport: approve→Undo→re-approve was green — re-verify.
2. **PoliciesPage scope switcher** — `/settings/policies` (工作区/中国大陆/马来西亚; CN/MY tabs admin-only; market policy editor T5). Probe: switcher persistence, admin vs reviewer visibility, empty market state.
3. **Unresolved queue** — `/settings/unresolved-queue` (tabs/search/bulk link/ignore). Probe: bulk selection edge cases, empty state, keyboard navigation.
4. **Industry data** — `/settings/industry-data` (admin-only ops gate).
5. **Resume dedup admin** — `/admin/system/settings/resume-dedup`. Probe: empty suggestion list (by design on PII-free corpus — don't flag as bug), scoring explanation columns.
6. **Audit compliance** — `/audit-compliance`: bias canary + cohort evaluator surfaces.
7. **Search + resume list** — `/dev/resumes?q=…`: failure panel vs empty state distinction, CJK search paths (CNC编程/CNC操机/UG编程 persisted 0→hundreds after backfill), query expansion drift, result count rendering.
8. **Cross-cutting probes on every surface:** axe a11y scan (e2e-smoke already runs AxeBuilder; screen-reader color audit precedent — no color-only signaling), CWV vs `scripts/benchmarks/cwv-baselines.json` (ttfb/lcp/cls/fcp), console errors (collectConsoleErrors), i18n EN/ZH toggle (error strings must not stay in old language after runtime switch — `t` must stay in callback deps), empty/error/loading states, mobile viewport 375×812-class.

---

## House rules (carry forward)

- **NO-PUSH:** workspace commits stay local. Vault push IS sanctioned with `NO_UPDATE_NOTIFIER=1`; run vault presync lint-delta gate first (`skillwiki sync lint-delta --base-ref origin/main`; `new_errors > 0` = STOP).
- **Prod is never touched.** Human-only / never-auto-claim: industry-data R1+R2+R4, workspace portability P3/P4, prod-unpin auth readiness, MY golden-set cohort.
- **Gates:** `make ci-local` GREEN at round end (node-major check + i18n + agent policy + check-build + test-coverage; Node 22 per `.nvmrc`, local v24 = warning only unless `NODE_VERSION_STRICT=1`). React 19 root pin + module-scope mock `t` in web tests — never remove, never inline `t` in `vi.mock` factories.
- **TDD for fixes; never weaken thresholds on gate failure.** Parent owns review/verification/commits; implementation via sonnet-pinned subagents; file:line evidence; planning stays on the parent.
- **Vault convention:** work item `spec.md` (frontmatter `status`/`completed` when done), `plan.md`, `log.md` (`## YYYY-MM-DD — …`), `evidence.md`; `skillwiki validate` per file (loop — multi-file validate only checks the first); `skillwiki work-complete`; index.md Active → Completed under "### Completed evidence".
- **AI model policy:** default `openai/deepseek-v4-flash-e` (Poe gateway). `deepseek-v4-flash` known bug (rejects `response_format`) — fallback only.

---

## Quick reference

| Thing | Command / location |
|---|---|
| Dev stack | `scripts/dev.sh`; web `http://localhost:5173`; Convex restart `scripts/dev.sh --convex-only --no-seed` |
| Env export | `set -a; source .env; set +a` (before tsx/vitest; `bun run` does not propagate) |
| e2e baseline | `bunx tsx scripts/e2e-smoke.ts` (repo root; CDP 9222 chrome-debug; CWV baselines `scripts/benchmarks/cwv-baselines.json`) |
| Deep scan / parity | `scripts/e2e-deep-scan.mjs`; `scripts/preview-prod-parity-smoke.mjs` (CDP 39382) |
| UAT conventions source | `CLAUDE.md` → "Nightly UAT & fix loop conventions" (2026-08-12, 35 unattended passes) |
| Handoff convention | `docs/superpowers/handoffs/2026-08-18-preview-deploy-test-fixes-uat-handoff.md` |
| CI gate | `make ci-local`; node `.nvmrc`; React 19 root pin + mock-`t` convention |
| Vault presync | `bash /root/.grok/installed-plugins/vault-sync-ae1287d3/skills/vault-presync/wiki-sync.sh --execute` |
| Preview site | https://preview.pt-mes.com (creds on ptcloud; version drift expected) |

**Suggested first steps:** (1) check browser tooling (playwright-cli / chrome-debug / MCP), start dev stack; (2) run `e2e-smoke.ts` baseline; (3) walk the seed surfaces per role with evidence collection; (4) open the vault work item, log findings, prioritize; (5) fix top items (TDD + browser verify + `make ci-local` GREEN), commit NO-PUSH, vault push with `NO_UPDATE_NOTIFIER=1`; (6) report with evidence and the UI/UX backlog.

---

## Closeout

**Done by:** the receiving session (this handoff's follow-up session)
**Branch:** `preview-v0.4.23` — all commits local, **NO-PUSH**

| Commit | Change |
|---|---|
| _(fill in)_ | |

**Verification (evidence):** _(fill in — UAT pass results, backlog items fixed, test counts, `make ci-local` result)_

**Wiki:** _(fill in — work item path, index entry, push state)_

**Out of scope (unchanged):** prod untouched; GitHub push withheld; human-only vault items never auto-claimed.
