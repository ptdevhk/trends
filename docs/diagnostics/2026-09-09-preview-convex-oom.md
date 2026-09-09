# 2026-09-09 Preview Convex OOM — Diagnostic Evidence Bundle

**Status:** Recovered 2026-09-09 ~13:25 HKT via `docker restart trends-preview-convex`.
**Symptom reported by user:** `https://preview.pt-mes.com/hr/resumes` stuck on `正在加载最近搜索...` forever.

---

## Root-cause chain (confirmed)

1. **2026-09-08 23:53:38 HKT** — `convex-local-backend` (child of the `trends-preview-convex` container) hit the **12 GiB cgroup memory limit** and was **OOM-killed**. Its anon-RSS at kill: **12,358,280 kB (~12.3 GB)**.
2. **Docker did not respawn it.** `restart: unless-stopped` only restarts when the *container* exits; the OOM killed a *child* process, so PID 1 (`sh /app/start-convex.sh`) stayed alive and the container kept running (`OOMKilled=true`, `RestartCount=0`).
3. The Convex CLI (`node .../convex dev`) was left wedged: alive in `ep_poll`, holding only the 6790/6791 dashboard sockets. **Ports 3210/3211 were never re-bound**, so `/version` and `/api/query` hung/`ECONNRESET` for ~14 hours.
4. **Every convex-backed BFF route 500'd** after 3×3s retries (`fetch failed` / `ECONNRESET` in `convex-utils.ts:41`). Non-convex routes kept returning 200, so the app shell loaded but all data was dead.
5. **The stuck hero string is a symptom, not the bug.** `SearchHero.tsx:286` renders `loadingRecentSearches` while `recentSearchesLoading === true` (`useResumeSearchState.ts:2216`), which stays true because `useQuery(api.sessions.recentSearches)` — a **direct Convex WebSocket** from the browser to `https://preview.pt-mes.com/convex` → Caddy → `127.0.0.1:4210` — never resolves.

---

## Evidence

### Kernel OOM kill (`sudo journalctl -k`, timestamps HKT)
```
Sep 08 23:53:38 vmi2853904 kernel: memory: usage 12582912kB, limit 12582912kB, failcnt 311344
Sep 08 23:53:38 vmi2853904 kernel: swap: usage 0kB, limit 12582912kB, failcnt 0
Sep 08 23:53:38 vmi2853904 kernel: Memory cgroup out of memory: Killed process 3799853 (convex-local-ba)
                          total-vm:37215680kB, anon-rss:12358280kB, file-rss:76812kB, shmem-rss:0kB, UID:0 pgtables:26264kB oom_score_adj:0
Sep 08 23:53:40 vmi2853904 kernel: oom_reaper: reaped process 3799853 (convex-local-ba), now anon-rss:0kB, file-rss:136kB, shmem-rss:0kB
```

### Container / cgroup state before restart
- `docker inspect` → `OOMKilled=true`, `RestartCount=0`, `StartedAt=2026-09-08T13:54:56Z`, `FinishedAt` zero.
- `memory.events` → `oom 1 oom_kill 1`.
- Ports `3210/3211` = 0 listeners inside container; Convex CLI (PID 2885) wedged in `ep_poll`, held only 6790/6791 (dashboard).
- Convex CLI `main.js dev` + `dev --once` both re-bound 3210 and printed `✔ Convex functions ready!` — i.e. the backend binary **could** boot, but the long-running `convex dev` never restarted it after the OOM.

### BFF page-load trace (09:51:05–09:51:12 HKT, user's page open)
```
Convex-backed routes → all 500:
  1× GET /api/blocks
  1× GET /api/companies?includeArchived=true
  3× GET /api/company-policies (base + market=cn + market=my)
  1× GET /api/policy-overrides
  2× GET /api/resumes/analysis-tasks
  2× GET /api/search-profiles
Non-convex routes → all 200:
  2× auth/me · 2× industry/keywords · 2× industry/brands · 2× industry/brand-display-map
  2× config/custom-keywords · 2× config/resume-field-usage-policy · 1× actions
  1× company-industry-verified-employer-count · 2× system/resume-work-history-limit
```
- Config routes also call Convex (`WorkspaceConfigService.callConvex` → `fetch failed`) but **catch and fall back** to defaults → 200.
- All 10 500s are exactly the routes that **propagate** the `callConvexQuery` error.
- BFF error signature: `TypeError: fetch failed` at `convex-utils.ts:41 fetchWithRetry` → `callConvexQuery` (`convex-utils.ts:67`), `[cause]: Error: read ECONNRESET`.

### Last successful resume traffic before OOM
- Up to `Sep 08 22:10:28` resume queries all 200 (paged `limit=200` × offsets 0–1000).
- Zero API traffic between 23:53 and the user's page open at 09:51 the next morning (matches overnight inactivity).

---

## Recovery (performed)

```
docker restart trends-preview-convex
# → start-convex.sh re-ran;  ✔ Convex functions ready! (14.05s)
# → container "Up About a minute (healthy)", /version 200
# → preview-doctor --recover summary: 0 failure(s)
# → convex query search_profiles:list now returns success; BFF /api/search-profiles → 200
```

---

## Open questions for permanent fix research
1. What drove convex-local-backend to 12.3 GB anon-RSS at 23:53 on a ~9k-resume / ~3k-source dataset, when the documented steady-state headroom is ~4.2 GB / 12 GiB? (Tantivy index rebuild burst? Search-query blowup? A specific user query? Restored-data import residue?)
2. Why did `restart: unless-stopped` + the wedged CLI leave the backend down for 14 h with no auto-recovery? (`preview-convex-restart.sh --watch --recover` exists but is not scheduled.)
3. Should the web recentSearches query (and the broader Convex-dependent surface) get an explicit error state + retry instead of infinite loading?
