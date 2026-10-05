# Resume Search UAT Runbook

Operator-facing runbook for the **HR resume-search UAT** — the repeatable walk
that scores five golden searches against the live search surface and records
accuracy, hit rate, and new issues.

> **Scope:** this runbook is **read-only with respect to candidate status**. The
> UAT observes search quality; it does **not** shortlist, reject, block, or
> otherwise mutate candidate status. Search-ranking code is **not** changed as
> part of a UAT cycle.

## Environments

| Env | URL | How to start / reach | Status |
|-----|-----|----------------------|--------|
| **Dev (local)** | `http://localhost:5173` | `make dev` (full local stack; see `docs/agent-runbook.md` → *Local Dev Stack*) | **Live UAT target** |
| **Prod** | `https://trends.pt-mes.com` | Deployed host (`ptcloud`, `/opt/trends`) | **Live UAT target — human-gated** |
| **Preview** | ~~`https://preview.pt-mes.com`~~ | — | **RETIRED** — do not use as a UAT target |

- **Preview is retired.** It is no longer a live UAT target and must not be
  walked as one. `docs/preview-upgrade-runbook.md` is retained for historical
  reference only.
- **Prod deploy is a human gate.** Agents do not deploy to production. A UAT
  cycle observes whatever is already deployed; promoting new code to prod is an
  operator action (`make on-prod-deploy` after `make on-prod-deploy-check`),
  never part of the UAT loop.

## Auth

- Log in as **`hr-demo`** — the **HR Team** account (admin membership, workspace
  `hr`).
- Local dev: seed/sign in via `npm run auth:bootstrap-hr-demo`, then sign in at
  `/dev/login` (or the login route). Local `hr-demo` credentials are independent
  of prod — re-run the seed if in doubt.
- Prod: sign in as `hr-demo` on `https://trends.pt-mes.com`.
- **No secrets in the wiki.** Never paste passwords, API keys, or session tokens
  into a SkillWiki page or transcript. Record only *that* a login succeeded.

## The five golden searches

Source of truth: SkillWiki query
`queries/2026-10-05-prod-five-search-uat-hr-demo` (workspace **`hr`**).
Run all five, in order, as `hr-demo`:

| # | Query | Market |
|---|-------|--------|
| 1 | CN CNC sales (age 25–40, minRoleYears ≥ 1) | CN |
| 2 | CN 3D scanner sales | CN |
| 3 | CN CMM sales | CN |
| 4 | MY CNC AND Service Engineer | MY |
| 5 | TH CNC Service Engineer (same as #4) | TH |

For each query, capture the URL you actually ran (the `/hr/resumes?...` search
URL, including filters) so the walk is reproducible. The query page above holds
the expected baseline numbers (API hits, UI list, status chips, filter-valid,
verdict) from the 2026-10-05 prod walk — compare against those, do not re-derive
the baseline.

## Recording results

One row per golden search. Columns:

| # | Query | Accuracy | Hit rate | Valid | New issues | Suggestions |
|---|-------|----------|----------|-------|------------|-------------|

- **Accuracy** — intent accuracy: does the current job match the query intent,
  or is it synonym bleed? (e.g. CNC-strict vs bare-machinery expansion.)
- **Hit rate** — volume vs the query's floor (CNC floor ≥ 100; 3D/CMM after a
  full collect; MY/TH after Seek ingest). Distinguish the **UI verified working
  set** from the **API keyword total** and the **status-chip counts** — they
  differ (see the baseline page's "four competing totals" issue).
- **Valid** — filter validity: age range, location, roleType, `minRoleYears`.
- **New issues** — anything not already listed on the baseline query page.
- **Suggestions** — candidate fixes for the operator to triage; **do not**
  implement search-ranking changes during the UAT.

Append the completed table to the cycle's report artifact (or a new dated
SkillWiki query page) — do not overwrite the baseline page.

## Hard rules

1. **No candidate-status writes during UAT.** No shortlist / reject / block /
   bulk actions. Observe and record only.
2. **No search-ranking code changes** as part of a UAT cycle. Findings feed a
   separate, operator-approved change.
3. **No secrets in the wiki.** `[REDACTED:<kind>]` only.
4. **Prod deploy is a human gate.** Agents never deploy.
5. **Preview is retired** — not a UAT target.

## Related

- Baseline query: `{WIKI_VAULT}/queries/2026-10-05-prod-five-search-uat-hr-demo.md`
- Agent runbook: `docs/agent-runbook.md`
- Dev-loop config: `.claude/dev-loop.config.md`
- Preview upgrade runbook (historical only): `docs/preview-upgrade-runbook.md`
