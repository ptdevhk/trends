# Handoff: Industry verification coverage + MY research pipeline health

**To:** Codex (implement + verify)  
**From:** Grok session (coverage panel + live diagnosis)  
**Date:** 2026-07-31  
**Repo:** `/Users/karlchow/Desktop/code/trends`  
**Branch:** `main` (ahead of origin by ~49; local work unpushed)  
**HEAD at handoff:** `566377d5` — `fix(web): industry lookup submit reads FormData companyKey`  
**Status:** Coverage UI **implemented uncommitted**; research pipeline **still broken/incomplete**

**Requested action:** Commit coverage work if clean, then **solve all pipeline issues** below so MY resumes can progress through research → ready_for_review → attended approve → card projection. Do not auto-approve employers as CNC.

---

## Mission (one sentence)

Restore industry-evidence **research execution** on local dev (FastAPI worker + optional web discovery for MY), drive open proposals from empty → sourced → `ready_for_review`, then leave a clear steward path so verified resume coverage rises above the current **1/83**.

---

## TL;DR diagnosis (read this first)

| Symptom on UI | Meaning | Class |
|---|---|---|
| Coverage panel shows numbers | Panel **works** | ✅ Done (uncommitted) |
| Pink: `failed; worker unreachable` | API POSTs to FastAPI worker `:8000` and gets connection failure | **Infra now** |
| Amber: `17/487` open with sources, ready `0` | Research not filling steward-ready evidence | **Pipeline/config** |
| Resumes `1/83` verified | Only bootstrap-approved employers projected | **Expected until approve+recompute** |
| Process `scripts/worker.py` running | CDP scrape poller — **not** industry FastAPI | Easy false positive |

**Coverage panel is not broken.** It correctly reports unhealthy research.

---

## Uncommitted work (commit first)

Dirty tree (coverage panel + API):

```
M  apps/api/src/routes/companies.ts
M  apps/api/src/routes/companies.test.ts
M  apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx
M  apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx
M  packages/convex/convex/companies.ts
M  apps/web/src/lib/api-types.ts          # may include unrelated gen noise — inspect before commit
?? apps/api/src/services/company-industry-coverage-service.ts
?? apps/api/src/services/company-industry-coverage-service.test.ts
```

### What was shipped (uncommitted)

1. **Convex** `companies:getIndustryCoverageSummary` — proposal status counts, open with/without sources (via `company_industry_evidence_sources`), resume digest verified counts, profile verified/rejected, last useful / last failed / latest maintenance.
2. **API** `GET /api/company-industry-coverage` (admin) — thin wrapper + parser.
3. **UI** `CoverageHealthPanel` on Industry verification (`/admin/system/settings/industry-verification` or workspace settings path) — bottleneck banners, pipeline chips, metric cards, maintenance strip, link to Operations.
4. **Tests** parser + route admin/403 + page bottleneck render.

### Suggested commit message

```
feat(industry): coverage & research health panel on Industry verification

Add Convex summary + admin GET /api/company-industry-coverage and surface
pipeline counts, open-source fill, resume verified coverage, and maintenance
health so empty ready-for-review is not mistaken for done.
```

### Verify before commit

```bash
cd /Users/karlchow/Desktop/code/trends
bunx vitest run apps/api/src/services/company-industry-coverage-service.test.ts \
  apps/api/src/routes/companies.test.ts
cd apps/web && bunx vitest run src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx
```

Vault work item (plan/spec/notes):  
`~/wiki/projects/trends/work/2026-07-31-industry-verification-coverage-panel/`

---

## Live state snapshot (2026-07-31, workspace `dev`)

From `GET /api/company-industry-coverage` (admin cookie + `X-Workspace-Slug: dev`):

```json
{
  "proposalsByStatus": {
    "new": 427,
    "researching": 0,
    "ready_for_review": 0,
    "needs_more_evidence": 60,
    "approved": 16,
    "rejected": 3,
    "superseded": 3
  },
  "openTotal": 487,
  "openWithSources": 17,
  "openWithoutSources": 470,
  "emptyEvidenceBottleneck": true,
  "readyBacklogBottleneck": true,
  "resumes": { "total": 83, "withVerifiedEvidence": 1 },
  "profiles": { "total": 9, "verified": 4, "rejected": 5 },
  "maintenance": {
    "lastUseful": {
      "runId": "run-m9wcm1ymms7pjkzr",
      "status": "completed",
      "triggerSource": "manual",
      "counts": { "proposalsResearched": 20, "readyCreated": 0 },
      "operatorSummary": "completed; 0 ready, 0 demoted, 0 refreshed.",
      "failureMessage": "The operation was aborted due to timeout"
    },
    "lastFailed": {
      "runId": "run-ft47yxopms89qicb",
      "status": "failed",
      "triggerSource": "restore",
      "operatorSummary": "failed; worker unreachable.",
      "failureMessage": "fetch failed"
    }
  }
}
```

Verified CNC-ish profiles (bootstrap): `eonmetall-group`, `haas-automation`, `destini-oil-services` (+ `alps-electric` industrial). Several rejected.

Ports observed at handoff:

| Port | Service | Status |
|---|---|---|
| 3210 | Convex local | up |
| 3000 | API | up |
| 5173 | Web (Vite) | up |
| **8000** | **FastAPI industry worker** | **DOWN** (connection refused) |

Running but **not** industry HTTP:

- `uv run python scripts/worker.py` — CDP/scrape Convex poller only.

API posts maintenance to:

- `WORKER_URL` default `http://localhost:8000`
- path `/worker/industry/maintenance`
- on failure finishes run as `failed; worker unreachable.`  
  (`apps/api/src/services/industry-maintenance-pipeline-service.ts`)

---

## Product truth (do not “fix” by changing governance)

1. Automation may **discover / fetch / propose** only.
2. **Only human approve** creates immutable verdict revisions.
3. Recruiter cards only show **approved** `verifiedIndustryEvidenceSummaries`.
4. Keyword `?q=CNC` hits ≠ industry-verified employer.
5. Never bulk auto-approve open proposals as CNC.

Canonical runbook: `docs/runbooks/company-industry-evidence-stewardship.md`

---

## Issues to solve (ordered)

### P0 — FastAPI worker down (infra)

**Problem:** Industry maintenance cannot run; restore/import triggers fail pink banner.

**Fix:**

```bash
cd /Users/karlchow/Desktop/code/trends
# Option A
make dev-api-worker
# Option B
uv run uvicorn apps.worker.api:app --reload --port "${TRENDS_WORKER_PORT:-8000}"
```

**Prove:**

```bash
curl -sS http://localhost:8000/worker/status
# then trigger:
# Operations UI → Run maintenance now
# or POST /api/worker/industry-maintenance (see Operations page / routes)
```

**Hardening (optional code if stack keeps losing worker):**

- Ensure `scripts/dev.sh` / `make dev` always starts `apps.worker.api` and fails health if `:8000` down.
- Surface “worker down” on coverage panel from a live probe (not only last failed run).
- Do not confuse with `scripts/worker.py` in status copy.

### P1 — Research produces 0 ready (config + behavior)

**Problem:** Even successful manual run: `proposalsResearched: 20`, `readyCreated: 0`. Open fill ~3%.

**Root causes to validate:**

1. **Discovery off by default** — needs both:
   - `INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED=1`
   - `WEB_RESEARCH_ENABLED=1`
   - for MY: `WEB_RESEARCH_MARKET=my`
2. Optional keys for better recall: `TAVILY_API_KEY`, `BRAVE_API_KEY` (not committed).
3. Relevance demotion may keep sources discovery-tier → not ready alone.
4. Timeout on long runs (`failureMessage: The operation was aborted due to timeout` on “useful” run).

**Code entrypoints:**

- `apps/worker/industry_evidence_research.py` — `build_discovery_job_from_env`, maintenance job
- `apps/worker/api.py` — `POST /worker/industry/maintenance`
- Runbook discovery section in stewardship doc

**Local `.env` (never commit secrets):**

```bash
INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED=1
WEB_RESEARCH_ENABLED=1
WEB_RESEARCH_MARKET=my
# optional:
# TAVILY_API_KEY=...
# BRAVE_API_KEY=...
```

Restart FastAPI worker after env change.

**Prove:**

```bash
# After maintenance
curl -sS -b "$COOKIE" -H "X-Workspace-Slug: dev" \
  http://localhost:3000/api/company-industry-coverage | jq '.item | {openWithSources, openTotal, proposalsByStatus, maintenance}'
# Expect: openWithSources ↑ and/or ready_for_review > 0
```

If still `readyCreated: 0` after discovery on:

- Inspect ledger: `GET /api/company-industry-maintenance-runs/:runId/ledger`
- Check demotion reasons, provider bot-walls (DuckDuckGo CAPTCHA), empty provider chain
- Consider scoped trigger for a known employer (`POST /api/industry-data/trigger` with companyKey) from Industry Data Control center

### P2 — Steward path to raise resume coverage

**Problem:** `resumes.withVerifiedEvidence = 1/83`.

**Path (attended):**

1. Wait until coverage shows `ready_for_review > 0` or use bootstrap import for high-value employers.
2. Industry verification → approve durable HTTP(S) sources only → verified/rejected + taxonomy class.
3. Targeted recompute starts on approve; monitor recompute runs.
4. Coverage panel resume ratio should climb; cards show 行业验证 strip.

Bootstrap tools:

- `scripts/industry-data/import-my-bootstrap-profiles.ts`
- `scripts/industry-data/export-my-employer-candidates.ts`
- Runbook “MY bootstrap” section

**Do not** mark success by keyword-only CNC search hits.

### P3 — Coverage UX follow-ups (optional after P0–P2 green)

Nice-to-haves already brainstormed:

- Clickable pipeline chip → filtered proposal list by status
- Top unverified employers table (from proposals sampleReferences / digests)
- Live worker reachability badge (probe `:8000` or dedicated health via API)
- Severe-fill already treated as bottleneck when fill &lt; 5%

---

## Architecture map (for debugging)

```
Seek MY resumes (83 digests)
  → ingest computeBatchWithCatalog
  → promoteIndustryMaintenanceCandidates → proposals (new / NME)
  → API enqueueIndustryMaintenance → POST WORKER_URL/worker/industry/maintenance
  → worker research (+ optional WEB_RESEARCH discovery)
  → sources on company_industry_evidence_sources
  → status ready_for_review
  → human approve → immutable revision + profile
  → recompute → verifiedIndustryEvidenceSummaries on digests/cards
```

Admin surfaces:

| Surface | Path |
|---|---|
| Coverage + queue + lookup | `/admin/system/settings/industry-verification` (or `/:ws/settings/industry-verification`) |
| Run maintenance | Operations → Industry evidence maintenance |
| Industry Data seed/control/audit | Industry Data settings page |
| Coverage API | `GET /api/company-industry-coverage` |
| Proposals | `GET /api/company-industry-proposals?status=…` |
| Maintenance runs | `GET /api/company-industry-maintenance-runs` |

Statuses for proposals: `new | researching | ready_for_review | needs_more_evidence | approved | rejected | superseded`

Open set for research: `new`, `researching`, `ready_for_review`, `needs_more_evidence`.

---

## Success criteria (Codex “done”)

1. **Commit** coverage panel (or leave cleanly staged with green tests).
2. **FastAPI worker** listening on `:8000`; `curl /worker/status` OK.
3. **Manual maintenance run** completes without `worker unreachable`.
4. Coverage shows **openWithSources significantly above 17** and/or **`ready_for_review > 0`** after discovery-enabled run (document provider limitations if hard-blocked).
5. Document exact env flags used (redact keys).
6. Optionally approve 1–2 ready proposals and show resume verified count increase after recompute (attended; if no ready, stop after research evidence and explain ledger).
7. Update this handoff or vault notes with final numbers.

Non-goals:

- Auto-approve all 427 new proposals
- Production/preview strict cutover
- Confusing Industry Data Manage (CN seed brands) with employer evidence

---

## Commands cheat sheet

```bash
cd /Users/karlchow/Desktop/code/trends

# Stack pieces
make dev-api-worker          # FastAPI :8000
# convex + api + web already often via make dev / scripts/dev.sh

# Coverage
curl -sS -b /tmp/trends-admin-cookies2.jVEW -H "X-Workspace-Slug: dev" \
  http://localhost:3000/api/company-industry-coverage | jq .

# Proposals by status
for st in new needs_more_evidence ready_for_review approved; do
  echo -n "$st "; curl -sS -b /tmp/trends-admin-cookies2.jVEW -H "X-Workspace-Slug: dev" \
    "http://localhost:3000/api/company-industry-proposals?status=$st" | jq '.items|length'
done

# Convex one-shot (from packages/convex)
bunx convex run --inline-query 'const d=await ctx.db.query("resume_digests").collect(); return {total:d.length, verified:d.filter(x=> (x.verifiedIndustryEvidenceSummaries||[]).length>0).length}'

# Tests for coverage feature
bunx vitest run apps/api/src/services/company-industry-coverage-service.test.ts apps/api/src/routes/companies.test.ts
cd apps/web && bunx vitest run src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx
```

Auth: reuse admin cookie jar if present (`/tmp/trends-admin-cookies*`) or login as Demo Admin on workspace with admin role.

---

## Related commits already on branch (context)

- `566377d5` fix(web): industry lookup FormData companyKey  
- `59d3e5e3` feat(web): Industry verification companyKey lookup  
- `ba099e10` Industry Data nav + seed button  
- Industry Data Phase A central management (prior commits same branch tip stack)

---

## Codex start prompt (copy-paste)

```
Resume handoff: docs/superpowers/handoffs/2026-07-31-industry-verification-coverage-research-pipeline-handoff.md

1) Commit uncommitted coverage panel if tests green (inspect api-types.ts noise).
2) Start FastAPI industry worker on :8000; fix any start failures.
3) Enable local WEB_RESEARCH for MY + maintenance flags; run maintenance; raise openWithSources and/or ready_for_review.
4) Report ledger + coverage before/after; do not auto-approve CNC massively.
5) Optionally approve 1 ready proposal and confirm recompute + resume verified count.

Repo: /Users/karlchow/Desktop/code/trends on main @ 566377d5 + dirty coverage files.
```

---

## Sources / code pointers

| Area | Path |
|---|---|
| Coverage query | `packages/convex/convex/companies.ts` → `getIndustryCoverageSummary` |
| Coverage API | `apps/api/src/services/company-industry-coverage-service.ts`, `routes/companies.ts` |
| Coverage UI | `apps/web/.../SystemSettingsIndustryVerificationPage.tsx` → `CoverageHealthPanel` |
| Maintenance enqueue | `apps/api/src/services/industry-maintenance-pipeline-service.ts` |
| Worker research | `apps/worker/industry_evidence_research.py` |
| Worker HTTP | `apps/worker/api.py` |
| Stewardship | `docs/runbooks/company-industry-evidence-stewardship.md` |
| Vault | `~/wiki/projects/trends/work/2026-07-31-industry-verification-coverage-panel/` |

---

## Session update 2026-07-31 (Grok make-dev inspect+fix)

**Done**
- Fixed `scripts/sync-convex-env.sh` pre-start hang/fail when Convex is down (skip + post-start batch sync).
- `make dev` healthy including FastAPI worker `:8000`.
- Manual maintenance completes without `worker unreachable`.
- Logged to `~/wiki/projects/trends/log.md`.

**Still open (P1 research quality)**
- 0 ready / openWithSources stuck ~16 with discovery on + MY market.
- DDG bot-walled; Google News only helps public cos; no Tavily/Brave.
- Industry Data “scoped trigger” is not actually scoped (context string only).

Coverage panel already committed earlier (`c197a0f8`). Uncommitted now: i18n industry keys + ops toast `runId` interpolations + env-sync fix.
