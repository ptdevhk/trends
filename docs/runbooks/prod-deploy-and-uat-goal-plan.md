# Prod deploy + basic UAT — `3b4adfeb` (2026-10-08)

Completed operator cycle: promote `main` `3b4adfeb` to prod, sample-collect five
goldens at 200, full AI analysis, public share, and read-only five-golden UAT.

> **Human gate.** Prod deploy is an owner approval gate. Agents never deploy
> without that grant. Preview is **RETIRED**. UAT is read-only: no
> candidate-status writes, no search-ranking code changes.

Handoff (full root-cause notes): wiki
`raw/transcripts/2026-10-08-task-handoff-prod-deploy-3b4adfeb-uat-5.md`.

## Outcome (2026-10-08)

| Phase | Result |
|---|---|
| 1. Deploy `3b4adfeb` | Done — HEAD `3b4adfeb6cc31027744e8d36c351976c61c497c3`, 5 services active, `https://trends.pt-mes.com` 200 |
| 1b. Freshness gate exit 0 | **Not met** — data is fresh (goldens 527 / 479); route still returns `exitCodeHint: 1` while `scanComplete: false`. Owner decision, not a one-line doctor fix. |
| 2. Collect goldens 1–5 @200 | Done — **5/5 = 1000 rows** (51job CN ×3 = 600; Seek MY + TH = 400) |
| 3. AI analysis | Done — task1 112/99 analyzed avg 13.74; task2 (limit 500) 98/81 analyzed avg 12.72 |
| 4. Public share `/s/{token}` | Done — `/s/Iz21KbXWEGSVW-fXqKcV8WyfU44Jd6jPjdowHommZ3U` |
| 5. Five-golden read-only UAT | Done — CN 490 / 3D 11 / CMM 8 / MY 163 / TH 0 |
| 6. Dev shutdown | Done — ~2.7 GiB freed on `pvelxc` |

Code already on `origin/main`: PR **#1429** (MY/TH ranker + share chrome) and PR **#1430** (collectLimit 200, cap 2000).

### Freshness gate (owner call)

`GET /api/resumes/search-freshness` sets `exitCodeHint: 1` whenever
`lag.scanComplete === false`, even with `computeStale: 0` (fail-closed;
`resumes_diagnostics.ts`). Fast `scanLimit` still leaves the scan incomplete.
A full prod scan exceeds the doctor's request budget (timeout / HTTP 400) and
also exits 1. Exit 0 needs either weaker fail-closed semantics or a lag-scan
perf overhaul. Do **not** treat CSRF / workspace-403 / public-origin as the
cause; credential is `hr-demo` (`hr:admin`).

### Collect launch notes that worked

- 51job: lift head-mode clamp with `tr_limit=200&tr_unsafe_limits=1` (plus age /
  work-func flags as in the live profile URL).
- Seek: URL-driven GraphQL (`searchQuery` + `market=MY|TH`), **not** `#searchInput`.
  Bare `/talentsearch` yields 0. Pager can still stop ~20/run (`no-next-page`).
- Collector extension `serverUrl` must be `https://trends.pt-mes.com` (not
  `http://localhost:3000`) when ingesting to prod.

### Do not commit

Scratch only: `uv.lock` churn, `convex_local_backend.sqlite3`, `orchestration.db`,
`config/daily-reports/snapshots/*`.

## Preconditions (as of this cycle)

| Input | Value |
|-------|-------|
| Target SHA | `3b4adfeb6cc31027744e8d36c351976c61c497c3` (merge of #1429 + #1430) |
| Prod path | `/opt/trends` on `ptcloud` (API `:3000`, Convex `:3210`, `trends.pt-mes.com`) |
| Deploy host | `ssh ptcloud`, `cd /opt/trends` |
| UAT login | `hr-demo` (HR Team, workspace `hr`) |
| Approval packet | wiki `projects/trends/work/2026-10-07-prod-deploy-3b4adfeb-human-gate/spec.md` |

## Procedure (historical — already run)

On `ptcloud`, from `/opt/trends`:

```bash
make on-prod-deploy-check      # dry run: skip / env-only / full upgrade
make on-prod-deploy            # preflight + snapshot + upgrade
```

Verify:

- `git rev-parse HEAD` == `3b4adfeb6cc31027744e8d36c351976c61c497c3`
- `systemctl status trends-convex trends-api trends-worker trends-worker-api trends-mcp`
- `curl -s -o /dev/null -w '%{http_code}' https://trends.pt-mes.com/` → 200
- Re-seed / Save profiles if Limit still shows 50
- `51job-cn-cmm-3d-scanning-sales` stays `collectLimit: 2000`

Goldens collected at 200 (`unsafeLimits` on 51job 1–3):

| # | Profile | Source |
|---|---------|--------|
| 1 | `51job-cn-cnc-sales` | ehire.51job.com |
| 2 | `51job-cn-3d-scanning-sales` | ehire.51job.com |
| 3 | `51job-cn-cmm-sales` | ehire.51job.com |
| 4 | `seek-malaysia-talent-search-service-engineer` | hk.employer.seek.com |
| 5 | `seek-thailand-talent-search-service-engineer` | hk.employer.seek.com |

Five-golden UAT vs wiki `queries/2026-10-05-prod-five-search-uat-hr-demo-rev2`
(do not overwrite the baseline). TH 0 until further prod ingest is expected.

## Open follow-ups

1. Freshness gate exit 0 — (a) weaken fail-closed, (b) lag-scan perf, or (c)
   accept as known limitation.
2. `analysisTopN`: profile-run route capped 100; use `POST /api/resumes/analyze`
   (`limit` / `resumeIds` ≤ 500) for a larger pass.
3. Seek collect requires the `searchQuery`+`market` URL shape.

## Related

- `docs/runbooks/resume-search-uat.md`
- `docs/agent-runbook.md`
- `docs/runbooks/seek-th-my-service-engineer-rank-collect-uat-2026-10-06.md`
- `docs/runbooks/seek-my-service-engineer-refine-collect.md`
- wiki `projects/trends/work/2026-10-07-prod-deploy-3b4adfeb-human-gate/spec.md`
- wiki `queries/2026-10-05-prod-five-search-uat-hr-demo-rev2.md`
- wiki `raw/transcripts/2026-10-08-task-handoff-prod-deploy-3b4adfeb-uat-5.md`
