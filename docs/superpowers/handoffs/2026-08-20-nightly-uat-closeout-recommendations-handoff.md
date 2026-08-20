# Handoff: Nightly UAT closeout — apply recommendations (fix or implement)

**To:** New session (apply the recommendations backlog from the 2026-08-19/20 nightly full UAT round)
**From:** Grok session (preview-v0.4.23 nightly full UAT + fix loop — backlog empty, 12 findings fixed)
**Date:** 2026-08-20
**Repo:** `/root/workspace` (trends)
**Branch:** `preview-v0.4.23` (local, NO-PUSH; **ahead 58** of origin — do not push without explicit approval)
**HEAD at handoff:** `8bf9d896` — `fix(api): typecheck shadowing-regression test response bodies [nightly-uat]`
**Status:** UAT round **complete & verified** (10/10 surfaces PASS, 4 gates EXIT 0, `make ci-local` GREEN, 0 open findings); workspace tree clean except `?? artifacts/` (evidence screenshots — leave untracked). Your mission is **fresh work**: apply each recommendation below (fix or implement), TDD-first, browser-verified.

---

## Mission (one sentence)

Work the recommendations backlog left by the 2026-08-19/20 nightly full UAT round: fix R3 (dead code), implement R2 (fixture) and R4 (CWV measurement), document R5 (runbook note) and R6 (locale determinism), each verified by tests + browser where applicable, committed locally NO-PUSH.

---

## State snapshot (2026-08-20)

```json
{
  "repo": { "dir": "/root/workspace", "branch": "preview-v0.4.23", "ahead": 58,
    "head": "8bf9d896", "tree": "clean (except ?? artifacts/ evidence PNGs)",
    "tag": "v0.4.23 (local + ptcloud mirror; GitHub 33d0e13c untouched)" },
  "vault": { "dir": "/root/wiki", "work-item": "/root/wiki/projects/trends/work/2026-08-19-nightly-full-uat/",
    "log.md": "status: completed — gates, surfaces, 11 commits, by-design list, 0 open" },
  "dev-stack": { "web": "http://localhost:5173", "convex": "localhost:3210", "bff": "http://localhost:3000",
    "cdp": "localhost:39382 (chrome-debug profile; CDP port per runbook)", "up": true },
  "preview": { "url": "https://preview.pt-mes.com", "out-of-scope": true },
  "prod": { "dir": "/opt/trends", "out-of-scope": true }
}
```

## What was done this round (11 commits, all local NO-PUSH, backlog empty)

| Commit | Change |
|---|---|
| `bc0f19bb` | fix(scripts): forward `--allow-local-write` in setup:industry-review-uat entrypoint (F6) |
| `7d4acdac` | fix(web): audit compliance dashboard never fetched — derive admin from memberships (P1) |
| `11efbfe2` | fix(api): unshadow `/api/resumes/bias-report` + `anomaly-alerts` behind `{resumeId}` (P1b) |
| `5451a94f` | fix(web): guard `useConvexResumeDetail` against non-Convex-id URL segments (P1c) |
| `fbe969c8` | fix(web): localize zh-TW research nav label (nav-label regression) |
| `31f13e1e` | fix(web): localize industry review detail + evidence summary (H8/H10, 103 i18n keys ×3 locales) |
| `817879dc` | chore(web): sync generated api-types for hard-reset-reingest route |
| `c8050bf3` | fix(e2e): match zh-TW labels (採集/選擇/全選/取消選擇/批量入圍/重試/登入) in locators |
| `0169712f` | fix(e2e): scope settle progress to search responses to recover hung searches |
| `3216081c` | fix(e2e): gate empty verdict on completed search response |
| `8bf9d896` | fix(api): typecheck shadowing-regression test response bodies |

Gates: `verify:critical-path` EXIT 0 · `npm run e2e` EXIT 0 (97.73s, run 6) · `verify:industry-review-uat` EXIT 0 · `make ci-local` GREEN · web suite 36/36 files 299/299 · API 202 files/3380 tests. Full report: `/tmp/uat-report-2026-08-19.md` (+ copy at `/tmp/grok-goal-906e1e07d052/implementer/uat-report-2026-08-19.md`); evidence `/tmp/uat-evidence/` (symlink → `{SCRATCH}/uat-evidence/`); findings log `{SCRATCH}/findings.md` (sections S1–S7, P1/P1b/P1c, F1/F2/F2b, H1–H10, t4b–t7).

---

## Recommendations to apply (fix or implement) — the backlog

> **R1 is RESOLVED** (verified 2026-08-20, no code change needed): the deferred P3 candidate "GET /api/resumes/:resumeId with non-id path segment → raw 500" no longer occurs. Live probes: `GET /api/resumes/not-a-valid-convex-id` → HTTP 404 `{"success":false,"error":"Resume not found: not-a-valid-convex-id"}`; valid-format nonexistent id `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` → 404 envelope. Route already returns the 404 envelope on null (apps/api/src/routes/resumes.ts:1244-1295). Do NOT re-open; drop from any carry-forward list.

### R2 (implement) — UAT fixture resume linked to an approved company

- **Why:** `IndustryEvidenceSummary` / `VerifiedCompanyBadge` (search surface) has unit coverage 5/5 + locale guards but **zero on-screen rendering evidence** — the corpus has no resume linked to any approved company. Evidence chain (2026-08-19/20): `company_resume_links:listAffectedResumesByCompany` for all 27 approved seed companies + UAT fixture keys (`cnc-cockpit-uat-company` / `uat-clean-standard-co` / `explicit-cnc`) → 0 links; links derive from the same ingestData as summaries (`resumes_mutations.ts:210 replaceCompanyResumeLinksForResume ← deriveCompanyResumeLinks`) and are BROADER (any companyKey work-entry match, no industryVerified requirement) → 0 links ⇒ 0 possible summaries; direct scan of 5000 newest crawls → 0 docs with `verifiedIndustryEvidenceSummaries`; `q=polywell` company-token search → 0 hits; no migration backfills the field. The 27 approved companies are MY-style employers (polywell, adastream-sdn-bhd, yd-laser-technologies-co-ltd…) absent from the CN-heavy corpus.
- **Do:** add a UAT fixture resume linked to an approved company (e.g. seed via the industry-review fixture machinery so the summary renders on the search page), then browser-verify `IndustryEvidenceSummary` in zh-TW + en, desktop + mobile, evidence screenshots under `uat-evidence/`. Keep the fixture out of prod paths (fixture-only seed, like `setup:industry-review-uat`).
- **Acceptance:** search for the fixture resume's company token renders the verified evidence summary + badge with 0 console errors; `make ci-local` still GREEN.

### R3 (fix, P3) — SettingsSidebar dead `isAdmin` gate

- **Evidence:** `apps/web/src/components/SettingsSidebar.tsx:42` `const { slug, isAdmin } = useWorkspace()`; `:52` `(!item.requiresAdmin || isAdmin)`; `:62` deps `[canReviewIndustryEvidence, isAdmin, slug, t]`. But `useWorkspace().isAdmin` is hardcoded `false` (`apps/web/src/contexts/WorkspaceContext.tsx:15,44`) and **no nav item sets `requiresAdmin: true`** → the condition is always true → dead code (also pollutes `useCallback` deps).
- **Do:** minimal cleanup — either remove the `isAdmin` branch + deps (if `requiresAdmin` items are truly never used) or wire the real admin check (`hasWorkspaceAdminAccess(memberships, slug)`, the pattern from `7d4acdac`) if items should be admin-gated. Decide by scanning for `requiresAdmin` usages first; TDD a small guard test if behavior changes. P3 polish — no user-visible change expected.

### R4 (implement, measurement) — fresh-context Core Web Vitals measurement

- **Evidence:** `scripts/e2e-utils.ts:29` `measureWebVitals(page)` installs CWV observers in the pre-navigation document; the e2e CDP-attach + `page.goto` flow destroys them → all CWV nulls this round (ttfb/lcp/cls/fcp never collected; baseline file `scripts/benchmarks/cwv-baselines.json` unused).
- **Do:** add a fresh-context CWV run (navigate first, then attach/observe — or a dedicated playwright run that installs observers via `page.addInitScript` before any navigation) and report real values vs `scripts/benchmarks/cwv-baselines.json`. If addInitScript is the fix, apply it to `measureWebVitals` so future e2e runs emit real numbers.
- **Acceptance:** a CWV run produces non-null ttfb/lcp/cls/fcp values on the search + settings surfaces.

### R5 (document) — BFF manual-restart env gotcha → runbook note

- **Why:** bare `nohup` restart of the BFF loses `.env` (F32: `bun run <pkg-script>` does not propagate .env to children) → `CONVEX_WRITE_SECRET` missing → `/api/resumes/:id/analysis-tasks` 500s with Convex "Unauthorized Convex read". Restart with `set -a; source .env; set +a` restores 200. Ops note, not a code bug.
- **Do:** add the note to `docs/agent-runbook.md` (dev-stack restart section): "BFF manual restart must source `.env` first (`set -a; source .env; set +a; nohup … &`), otherwise analysis-tasks 500s."

### R6 (implement, optional tooling) — e2e locale determinism

- **Why:** the shared chrome-debug profile persists `i18nextLng=zh-TW`, so e2e locators must match all three locales (`/选择|選擇|Select/` etc. — see `c8050bf3`). Works but is brittle.
- **Do:** optionally pin the locale per role run (e.g. set `i18nextLng` via localStorage before each role walk, or run one pass per locale) so locators can be single-locale. If you do this, keep the tri-lingual locators working anyway (the shared profile can flip mid-run) — this is a determinism improvement, not a locator simplification.

### Documentation candidates (CDP tooling notes — add to runbook/CLAUDE.md if useful)

- `tmp/cdp.mjs` matches tabs by URL-prefix with silent fallback to FIRST page tab — a tab-ID prefix (e.g. `C4EC3B46`) never matches a URL → probes hit the wrong tab and report fake session flips. Use full URL prefixes (`http://localhost:5173/admin`) with cdp.mjs; tab-ID prefixes only with the id-based tools (cdp-click-net/cdp-shot-abs/cdp-mobile/cdp-wake-*).
- Backgrounded tabs freeze: `Page.getLayoutMetrics` returns 0x0, captures are blank, `scrollTo` no-ops. Wake via same-URL `Page.navigate` or `Input.dispatchMouseEvent`, then capture with `captureBeyondViewport:false` + `Emulation.setDeviceMetricsOverride`.

---

## House rules (carry forward)

- **NO-PUSH:** workspace commits stay local on `preview-v0.4.23`. Vault push IS sanctioned with `NO_UPDATE_NOTIFIER=1`; run the vault presync lint-delta gate first (`bash /root/.grok/installed-plugins/vault-sync-ae1287d3/skills/vault-presync/wiki-sync.sh --execute`; `new_errors > 0` = STOP).
- **Prod and preview are never touched.** Human-only / never-auto-claim: industry-data R1+R2+R4, workspace portability P3/P4, prod-unpin auth readiness, MY golden-set cohort.
- **TDD first:** RED test → fix → GREEN → browser re-verify → NO-PUSH commit `fix(...): ... [nightly-uat]` (or `docs(...)` for R5). Never weaken thresholds on gate failure.
- **Gate conventions:** `make ci-local` runs env-unset (`env -u AI_MODEL -u AUTH_HR_DEMO_TOKEN -u AUTH_HR_DEMO_PASSWORD -u AUTH_BOOTSTRAP_PASSWORD -u CONVEX_WRITE_SECRET make ci-local`); e2e/gates need `set -a; source .env; set +a; export CDP_PORT=39382`. React 19 root pin + module-scope mock `t` — never remove, never inline `t` in `vi.mock` factories.
- **AI model policy:** default `openai/deepseek-v4-flash-e` (Poe gateway). `deepseek-v4-flash` known bug (rejects `response_format`) — fallback only.

---

## Quick reference

| Thing | Command / location |
|---|---|
| Dev stack | `scripts/dev.sh`; web `http://localhost:5173`; Convex restart `scripts/dev.sh --convex-only --no-seed` (kill by port-derived PID) |
| Env export | `set -a; source .env; set +a` (before tsx/vitest; `bun run` does not propagate) |
| UAT gates | `bun run verify:critical-path`; `npm run e2e`; `bun run verify:industry-review-uat -- --base-url http://localhost:3000`; `make ci-local` |
| Industry fixture | `bun run setup:industry-review-uat` (pass `-- --allow-local-write` if the entrypoint drops it, F6) |
| CWV baselines | `scripts/benchmarks/cwv-baselines.json`; measurement `scripts/e2e-utils.ts:29` |
| Vault presync | `bash /root/.grok/installed-plugins/vault-sync-ae1287d3/skills/vault-presync/wiki-sync.sh --execute` |
| Report / evidence | `/tmp/uat-report-2026-08-19.md`, `/tmp/uat-evidence/`, findings log `{SCRATCH}/findings.md` |
| Prior handoff | `docs/superpowers/handoffs/2026-08-19-nightly-full-uat-handoff.md` (full UAT runbook + surface checklist) |

**Suggested first steps:** (1) branch guard + `git status`; (2) R3 first (small, self-contained, P3) — scan `requiresAdmin` usages, then TDD the cleanup; (3) R4 CWV fresh-context run (implement `addInitScript`-based observation, capture real values vs baselines); (4) R2 fixture resume (biggest item — seed via industry-review fixture machinery, browser-verify evidence summary zh-TW + en, desktop + mobile); (5) R5 runbook note; (6) R6 locale pinning if desired; (7) `make ci-local` GREEN, evidence under `/tmp/uat-evidence/`, vault log update in `2026-08-19-nightly-full-uat/` (or new work item `2026-08-20-uat-recommendations/`), NO-PUSH commits.

---

## Closeout

**Done by:** the receiving session (this handoff's follow-up session)
**Branch:** `preview-v0.4.23` — all commits local, **NO-PUSH**

| Commit | Change |
|---|---|
| _(fill in)_ | |
| _(fill in)_ | |

**Verification (evidence):** _(fill in — per-recommendation verdicts, gates run, test counts)_

**Wiki:** _(fill in — work item path, index entry, push state)_

**Out of scope (unchanged):** prod untouched; GitHub push withheld; human-only vault items never auto-claimed.
