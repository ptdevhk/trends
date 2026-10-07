# MY/TH CNC Service Engineer — rank-then-collect UAT (2026-10-06)

Local (pvelxc + Mac `:9222`) findings after quoted-phrase soft-match on prod
and approach C (engineer ranker, then owner-gated TH Seek collect).

> No fixtures. No candidate-status writes. MY ~500 and prod TH ingest remain
> human gates. Ranker code is uncommitted on `feat/my-th-service-engineer-ranker`.

## Goldens (quoted AND must stay quoted)

Local / prod TH:

```
/hr/resumes?location=Thailand&q=%22CNC%22+%22Service+Engineer%22&minRoleYears=1&roleType=engineer
```

Prod MY (order still the bug; ranker not on prod):

```
/hr/resumes?location=Malaysia&q=%22CNC%22+%22Service+Engineer%22&minRoleYears=1&roleType=engineer
```

## What shipped vs what this session added

| Piece | State |
|-------|--------|
| Quoted Latin AND soft-match | Prod `4530a569` (PR #1423). MY AND 26→163. |
| Engineer-lane ranker | Uncommitted. Tests 31/31. Local BFF still 0.4.23 without it. |
| TH Seek collect | Approved 2026-10-06, `collectLimit: 50`. Ingested to **local** BFF only. |

## Collect (Phase B)

- Live Seek employer session on Mac chrome-debug `:9222` (Pro-Technic).
- Preview ingest failed (`Failed to fetch`; preview TLS broken from this host).
- Collector `serverUrl` pointed at local BFF `http://localhost:3000` (submit token verified).
- Auto-sync stopped at **20** with `no-next-page` while Seek UI still showed pages 1–7. Cause: talentsearch pager selector `nav[aria-label="PAGINATION_OF_RESULTS"]` missed the live pager (`getSeekPaginationInfo` → `totalPages=currentPage`).
- Page 1 + page 2 reloads submitted 20+20. Do **not** raise YAML to 200–500 until that pager is fixed; extra `collectLimit` still yields ~20/run.

## Local TH filter + ingest (read of the 32)

| View | Count |
|------|------:|
| Thailand location only (UI) | 37 |
| Quoted AND + engineer y≥1 | **32** |

The 5 dropped by keyword AND and/or engineer y≥1. None of the 32 are Accountant / Quantity Surveyor.

Work history: 32/32 have jobs (103 entries); **75/103** descriptions >80 chars (talentsearch V3 enrich, not empty list titles). About **11/32** current CNC/machine-tool service; ~19 current *service* with CNC somewhere (including adjacent: chamber, tower crane, aesthetics/medical, nitrogen dosing); 1 CNC Manager.

**Recommendation:** 200–500 MY/TH collect is **not** required to prove this live test. MY prod already has 163 (order problem). Local TH 32 is enough for G5>0 and scoring UAT.

## E2E AI analyze (local hr-demo)

- UI: AI mode on → Analyze loaded 32. Workspace must be `/hr/resumes` on `localhost:5173` as hr-demo.
- Task keywords `cnc` + `service engineer`, location thailand, prompt v14: **32/32**, 0 failed, avg **58**, **3** high-score.

### GET-by-id (search-mode) — fixed locally, live-tested 2026-10-06

UI analyze creates `dispatchMode: search`. GET `/api/resumes/analysis-tasks/{id}` used to call only `analysis_tasks:getExactStatus`, which throws `is not an exact dispatch` → BFF **500**. List poll still worked.

Fix (uncommitted, same branch): Convex `analysis_tasks:get` + BFF fallback when the exact-status error is `is not an exact dispatch`. Exact tasks still return `verification`. Diagnostics tests 52/52.

Live (hr-demo, `X-Workspace-Slug: hr`, local API restarted so tsx loaded the fallback):

| ID | http | mode | analyzed |
|----|------|------|----------|
| 9-resume MY search | 200 | search | 9/9 |
| 32-resume TH search | 200 | search | 32/32 |
| 10-resume CN sales | 200 | search | 10/10 |
| Quoted TH AND search | 200 | — | total **32** |

Stale API on :3000 (started before the patch) still 500’d once; kill/restart of `tsx watch` was required. Prod/preview do **not** have this code until commit + deploy.

### Hang / 401 leftover pollers — no product fix

Not bugs. No further debug.

- **Hang:** first CDP job (buffered Python, `wait_for` after navigate) printed nothing and died ~139s. App was not stuck.
- **401:** next job stayed on public `…/resumes?…` (no `/hr`). Public resume route is unauthenticated; Analyze is gated on login (`canManageCandidateData`) → tooltip “No permission to analyze candidates”; in-page fetch → **401 Authentication required**. Intended. Do not loosen public `/resumes`.

Use `/hr/resumes` as hr-demo. Optional later copy: tooltip “Sign in to analyze” on the public route — not required.

## Next-agent handoff (2026-10-06)

Branch `feat/my-th-service-engineer-ranker` tracking `origin/main` (`4530a569`). **Uncommitted** (do not add `config/daily-reports/snapshots/*`):

- Engineer ranker + tests + four sort sites (`q=` not `keyword=`)
- Seek collect `--limit` / `tr_limit`
- GET-by-id search fallback (`analysis_tasks.ts`, `resumes_diagnostics.ts` + test, `AnalysisTaskDetailSchema` verification optional)
- This runbook (+ one-line link from the MY refine runbook)

Do **not** start 200–500 MY/TH collect. Do **not** write candidate-status. Do **not** relax CN `minRoleYears`. Keep quoted golden URLs.

Human gates still: ranker+GET-by-id **commit/PR**, prod deploy, prod TH ingest, MY ~500 refine. Optional Seek pager fix before any 50–500 one-shot auto-sync.

Score vs work-exp read:

- True CNC/machine-tool service (Brother / FANUC / Penta / Makino-class) → **73–83 match**.
- Adjacent (coffee machines, chambers, aesthetics, crane) and CNC operator/manager → **50–55 potential**; summaries name the adjacent domain.
- Large **55 potential** shelf — AI agrees with ingest quality but does not sort page-1. That is the uncommitted engineer ranker’s job.

## Still gated

1. Commit/PR + prod deploy of the ranker → prod G4 page-1 re-walk.
2. Prod TH ingest (prod G5 still 0).
3. MY ~500 refine (see `docs/runbooks/seek-my-service-engineer-refine-collect.md`).
4. Optional: fix Seek talentsearch pager detection before any 50–500 one-shot auto-sync.

## Related

- Work item: `projects/trends/work/2026-10-06-my-th-service-engineer-rank-then-collect/spec.md`
- Soft-match: `docs/runbooks/seek-my-service-engineer-refine-collect.md`
- TH profile: `config/search-profiles/seek-thailand-talent-search-service-engineer.yaml`
- Ranker: `packages/shared/src/cnc-sales-rank.ts`
