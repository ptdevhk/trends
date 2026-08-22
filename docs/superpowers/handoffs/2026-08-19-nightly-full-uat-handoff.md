# Handoff: Nightly full UAT + fix loop

**To:** New session (run the nightly full UAT sweep + fix loop)
**From:** Grok session (preview-v0.4.23 round closeout: UI/UX UAT + fix-to-empty round — F1–F5, backlog empty)
**Date:** 2026-08-19
**Repo:** `/root/workspace` (trends)
**Branch:** `preview-v0.4.23` (local, NO-PUSH; **ahead 46** of origin — do not push without explicit approval)
**HEAD at handoff:** `50135277` — `docs(claude): UI/UX UAT round complete — Closeout table + reference-index bullet`
**Status:** Prior round **complete & verified** (`make ci-local` GREEN run 5, web 2041/2041, vault pushed `35b50f994`); workspace tree clean except `?? artifacts/` (evidence screenshots — leave untracked). Your mission is **fresh work**: a nightly full UAT pass over the dev stack, then fix what you find.
**Requested action:** Run a full browser-verified UAT sweep over the app (localhost dev stack only), collect evidence, then TDD-fix every confirmed issue until the backlog is empty. Do **not** touch prod or preview. Do **not** push anything to GitHub without explicit user approval.

---

## Mission (one sentence)

Run a complete browser-verified UAT over all recently-touched UI surfaces (industry verification inbox + Undo, review-workflow navigation, policies scope switcher, unresolved queue, resume-dedup admin, audit compliance, search, plus this round's F1–F5 fixes as regression targets), log every finding with file:line evidence and severity, and fix the confirmed issues end-to-end until the backlog is empty.

---

## State snapshot (2026-08-19)

```json
{
  "repo": { "dir": "/root/workspace", "branch": "preview-v0.4.23", "ahead": 46,
    "head": "50135277", "tree": "clean (except ?? artifacts/ evidence PNGs)",
    "tag": "v0.4.23 (local + ptcloud mirror; GitHub 33d0e13c untouched)" },
  "vault": { "dir": "/root/wiki", "pushed": true, "head": "35b50f994",
    "recent": ["2026-08-19-uiux-uat (COMPLETED)", "2026-08-19-policy-override-validation", "2026-08-19-preview-uat-followups"] },
  "dev-stack": { "web": "http://localhost:5173", "convex": "localhost:3210", "bff": "http://localhost:3000",
    "cdp": "localhost:9222 (chrome-debug profile; cmux-cdp-proxy healthy)", "up": true },
  "preview": { "url": "https://preview.pt-mes.com", "out-of-scope": true },
  "prod": { "dir": "/opt/trends", "out-of-scope": true }
}
```

Recent completed work (context for what UAT must re-verify — all browser-verified at the time):

| Round | UI surface | Last evidence |
|---|---|---|
| `2026-08-01-industry-verification-grouped-inbox-undo` | Industry inbox grouped 可批准/需检查/历史, one-click approve, session Undo, History reconciliation | v2 UAT 12/12 + mobile approve→Undo→re-approve green |
| `2026-08-11` review-workflow navigation | Workspace-scoped review base (SystemAccessGate bounce fix), scroll-to-detail, legacy notice | Browser UAT green |
| company-policy umbrella (T5) | PoliciesPage scope switcher 工作区/中国大陆/马来西亚 (admin-only CN/MY tabs) | Round closeout |
| `2026-08-18-resume-dedup-multisource-heuristics` | `/admin/system/settings/resume-dedup` suggest-merge page | 4/4 page tests; **suggestion list empty on PII-free corpus by design** |
| `2026-08-18-resume-scoring-explainability-drift` | `/audit-compliance` (bias canary + cohort evaluator) | Tests green (verify + document only) |
| `2026-08-19-policy-override-validation` | POST `/api/policy-overrides` 500→400 nit (no web change) | API 67/67 + typecheck clean |
| **`2026-08-19-uiux-uat` (this round)** | F1–F5 fixes (see regression targets below) | Backlog empty; re-walk 4/4 green |

---

## Nightly full-UAT scope & cadence

This is a **full sweep** (not a spot check): every surface below walked per role in the browser, automated gates run, findings logged, fixes TDD'd to empty. Deliver a report in the nightly format:

- `/tmp/uat-report-<date>.md` — one row per pass/surface with verdicts (PASS / FAIL / OPEN finding + severity)
- Evidence screenshots under `/tmp/uat-evidence/`
- Vault captures at `/root/wiki/raw/transcripts/YYYY-MM-DD-nightly-uat-*.md` for P1/P2 findings
- FINAL SUMMARY at the end: pass count, fixed/open findings, per-surface verdicts, one-line retro

The unattended scheduler loop (10-min fires, `/tmp/nightly-uat.lock` guard, 30–40 min passes, 09:00 stop) exists for overnight runs; in a single handoff session, run the full pass + fix loop once, attended, and write the FINAL SUMMARY yourself.

### Operational flow (adapted from `docs/agent-runbook.md:186-248` — the canonical source)

1. **Branch guard:** `preview-v0.4.23`, clean worktree. Never commit/push off preview, never open PRs, never tag/deploy, never touch remote hosts (ptcloud / preview.pt-mes.com / prod).
2. **Self-enable (idempotent):** boot `make dev` if :5173 down; seed `hr-demo` (`npm run auth:bootstrap-hr-demo`) and `uat-reviewer` (`npx tsx scripts/auth/manage-user.ts --username uat-reviewer --workspace hr --role reviewer --password-env AUTH_BOOTSTRAP_PASSWORD`); ensure the chrome-debug profile + `Page.bringToFront` on the ACTIVE tab (backgrounded tabs throttle rAF → smooth scroll-to-detail silently no-ops, F16); restart cmux-devtools if the CDP websocket wedges.
3. **Memory trim (pre-gate):** if `free -m` available < 4000 MB or swap > 90% → restart the convex local backend via `scripts/dev.sh --convex-only --no-seed` (F18: pkill+respawn does NOT work on the precompiled supervisor; kill by port-derived PID; healthy ~30s; worker heartbeat lags ~1–2 gate runs after restart, self-recovers).
4. **Gates (all exit 0):** `bun run verify:critical-path`, `npm run e2e` (e2e-smoke), `bun run setup:industry-review-uat` (if fixtures missing) + `bun run verify:industry-review-uat -- --base-url http://localhost:3000`, `make check` when code changed. The industry-review fixture's `companyKeyByCase` maps to CN companies present in local Convex (explicit-cnc → `polywell`; see the stewardship runbook for rebinding rules). The browser UAT stage takes `--workspace` (default `hr`; `dev` for the dev workspace) and selects the manual-approval row by `data-testid`, so it never depends on localized button text.
5. **Browser UAT (playwright-cli, localhost:5173 only):** hr-demo smoke routes + 6-step checklist (`dev-docs/qa/critical-path-ui-smoke.md`); uat-reviewer industry-review workflow (sidebar 行业验证 entry, proposals list, 查看 no SystemAccessGate bounce, queue-ordered prev/next, scroll-to-detail, verdict revision, evidence sources, legacy notice). 0 app console errors.
6. **Fix loop:** confirmed issue → systematic-debugging → TDD tests first → minimal fix → re-run affected gate + unit tests → browser re-verify → commit `fix(...): ... [nightly-uat]`. **Runbook says push to origin on green; the workspace convention since 2026-08-18 is NO-PUSH — commit locally only, never push without explicit user approval.**
7. **Report:** `/tmp/uat-report-<date>.md`, evidence under `/tmp/uat-evidence/`, vault captures for P1/P2, then FINAL SUMMARY.

### Gotchas (all observed; F-numbers reference the nightly report — do not reintroduce)

- `bun run <pkg-script>` does not propagate .env to tsx children — export `CONVEX_WRITE_SECRET`/auth vars before gates (F32).
- chrome-debug profile is shared across UAT roles — sessions flip between passes and silently bounce `/admin/*` routes; e2e self-heals via `ensureDevAdminSession` (F12); re-login per role walk.
- 智通直聘 extension auto-scrape can hijack the driven tab to job5156 (F18b) — settle recovery tracks completed API responses + query-param re-navigation, not DOM state alone.
- Search failure panel (重试) vs true empty state (`没有匹配到简历`): assert the correct one (F11/F14).
- `sales` empty state after e2e bulk actions = default new-only status filter, not a bug (F19); `?status=shortlisted` shows them.
- e2e first-run flakes after cmux/chrome restarts = extension re-scrape churn (F17); settle polls reload on stuck loading + wait for analysis quiescence.
- Convex local backend heap grows with activity (~100–150 MB/pass steady-state); trim floor 4 GB available; restart is the correct mitigation (F18) — glibc-malloc heap ratchet in the precompiled backend, no backend knob. See `~/wiki/raw/transcripts/2026-08-12-nightly-uat-root-cause-fixes.md`.

---

## UAT surface checklist (walk every surface per role, desktop + mobile 375×812-class)

1. **Industry verification inbox + review queue** — `/settings/industry-verification` (workspace-scoped base per 2026-08-11 nav fix; gates: workspace admin/reviewer) and `/settings/industry-verification/proposals/:proposalId`. Probe: grouped tabs 可批准/需检查/历史, one-click approve, session Undo, History reconciliation after manual refresh, prev/next row navigation, scroll-to-detail, legacy notice. Mobile: approve→Undo→re-approve.
2. **PoliciesPage scope switcher** — `/settings/policies` (工作区/中国大陆/马来西亚; CN/MY tabs admin-only). Probe: switcher persistence, admin vs reviewer visibility, empty market state.
3. **Unresolved queue** — `/settings/unresolved-queue` (tabs/search/bulk link/ignore). Probe: bulk selection edge cases, empty state, keyboard navigation.
4. **Industry data** — `/settings/industry-data` (admin-only ops gate).
5. **Resume dedup admin** — `/admin/system/settings/resume-dedup`. Probe: empty suggestion list (**by design on PII-free corpus — do not flag as bug**), scoring explanation columns.
6. **Audit compliance** — `/audit-compliance`: bias canary + cohort evaluator surfaces.
7. **Search + resume list** — `/dev/resumes?q=…`: failure panel vs empty state distinction, CJK search paths (CNC编程/CNC操机/UG编程 persisted 0→hundreds after backfill; 数控 no-regression probe), query expansion drift, result count rendering (`0 条结果` not `0+ 条结果`).
8. **F1–F5 regression targets (this round's fixes — re-verify each):**
   - F1 (`f2fa22cd`): industry-verification inbox + coverage panel tolerate malformed proposal rows (skip accounting, trigger-reason allowlist) — no 500s.
   - F2 (`43bdba25`): detail-pane approve registers in the session registry immediately (counter 0→1, 撤销 → Undo → 0) without page refresh.
   - F3 (`f7c21e3b`): settings sidebar labels 设置/搜索设置/导出字段 across zh-CN/en/zh-TW.
   - F4 (`9843d268`): non-admin sees scope switcher 工作区 only and fires **no** admin-only market GETs (`/api/company-policies?market=cn|my`) — verify via network capture.
   - F5 (`0e5a7c5f`): zero result count renders without `+` suffix (quick-start no-query state included).
9. **Cross-cutting on every surface:** axe a11y scan (e2e-smoke runs AxeBuilder; no color-only signaling), CWV vs `scripts/benchmarks/cwv-baselines.json` (ttfb/lcp/cls/fcp), console errors (collectConsoleErrors), i18n EN/ZH toggle (error strings must not stay in old language after runtime switch — `t` stays in callback deps), empty/error/loading states.

---

## Fix-loop contract

- Severity: P0 broken > P1 confusing > P2 a11y > P3 polish/i18n. Record every finding: file:line, repro steps, severity, suggested fix.
- **TDD first**: write the failing test (RED), then implement. Never weaken thresholds on gate failure.
- Parent (you) owns planning, review, final verification, and commits. Implementation via sonnet-pinned gp subagents — spawn gp **without** a `model` field so the pin applies; file:line evidence; no nested subagent trees.
- Browser-verify every fix end to end (behavior, not just render; related routes; desktop + mobile). Evidence screenshot per fix.
- Gate: `make ci-local` GREEN at round end (node-major check + i18n + agent policy + check-build + test-coverage; Node 22 per `.nvmrc`). Known pre-existing web typecheck debt (5 errors in PoliciesPage.test.tsx TS2550, SystemSettingsUnresolvedQueuePage TS2339/TS2353) — do not count as new.
- Commit NO-PUSH per fix; vault log record per round (`## YYYY-MM-DD — …` in the work item's log.md).

---

## House rules (carry forward)

- **NO-PUSH:** workspace commits stay local. Vault push IS sanctioned with `NO_UPDATE_NOTIFIER=1`; run the vault presync lint-delta gate first (`bash /root/.grok/installed-plugins/vault-sync-ae1287d3/skills/vault-presync/wiki-sync.sh --execute`; `new_errors > 0` = STOP).
- **Prod and preview are never touched.** Human-only / never-auto-claim: industry-data R1+R2+R4, workspace portability P3/P4, prod-unpin auth readiness, MY golden-set cohort.
- React 19 root pin + module-scope mock `t` in web tests — never remove, never inline `t` in `vi.mock` factories. Web tests from `apps/web` (root `npx vitest run` excludes web).
- **Vault convention:** work item `spec.md` (frontmatter `status`/`completed` when done), `plan.md`, `log.md`, `evidence.md`; `skillwiki validate <file> --vault /root/wiki --apply` (multi-file validate only checks the first); `skillwiki work-complete`; index.md Active → Completed under "### Completed evidence".
- **AI model policy:** default `openai/deepseek-v4-flash-e` (Poe gateway). `deepseek-v4-flash` known bug (rejects `response_format`) — fallback only.

---

## Quick reference

| Thing | Command / location |
|---|---|
| Dev stack | `scripts/dev.sh`; web `http://localhost:5173`; Convex restart `scripts/dev.sh --convex-only --no-seed` (kill by port-derived PID) |
| Env export | `set -a; source .env; set +a` (before tsx/vitest; `bun run` does not propagate) |
| e2e baseline | `bunx tsx scripts/e2e-smoke.ts` (repo root; CDP 9222 chrome-debug; CWV baselines `scripts/benchmarks/cwv-baselines.json`) |
| Deep scan / parity | `scripts/e2e-deep-scan.mjs`; `scripts/browser_cdp.py`; `apps/web/e2e/*.spec.ts` (blacklist, industry-verification-manual-review, my-market-industry-db-placeholder, provider-membership-admin, resume-role-filter) |
| UAT gates | `bun run verify:critical-path`; `npm run e2e`; `bun run setup:industry-review-uat` + `bun run verify:industry-review-uat -- --base-url http://localhost:3000`; `make check` |
| CI gate | `make ci-local`; node `.nvmrc`; React 19 root pin + mock-`t` convention |
| Nightly UAT source of truth | `docs/agent-runbook.md:186-248` ("Nightly UAT & Fix Loop") + `CLAUDE.md` conventions bullet |
| Handoff convention | `docs/superpowers/handoffs/2026-08-19-uiux-uat-handoff.md` (prior round; format + UAT surfaces source) |
| Vault presync | `bash /root/.grok/installed-plugins/vault-sync-ae1287d3/skills/vault-presync/wiki-sync.sh --execute` |
| Report / evidence | `/tmp/uat-report-<date>.md`, `/tmp/uat-evidence/`, vault `raw/transcripts/YYYY-MM-DD-nightly-uat-*.md` |

**Suggested first steps:** (1) branch guard + `git status`; (2) verify dev stack (ports :5173/:3210/:3000/:9222) + memory trim per step 3; (3) run the 4 gates; (4) walk the 9 surface groups per role (hr-demo / uat-reviewer / demo-admin) with evidence; (5) open the vault work item `2026-08-20-nightly-full-uat/` (or date-appropriate slug), log findings, prioritize; (6) fix to empty (TDD → sonnet-pinned gp → parent review → browser verify → `make ci-local` GREEN → NO-PUSH commit → vault log); (7) write `/tmp/uat-report-<date>.md` + FINAL SUMMARY and report back.

---

## Closeout

**Done by:** the receiving session (this handoff's follow-up session)
**Branch:** `preview-v0.4.23` — all commits local, **NO-PUSH**

| Commit | Change |
|---|---|
| _(fill in)_ | |
| _(fill in)_ | |

**Verification (evidence):** _(fill in — per-surface verdicts, gates run, test counts)_

**Wiki:** _(fill in — work item path, index entry, push state)_

**Out of scope (unchanged):** prod untouched; GitHub push withheld; human-only vault items never auto-claimed.
