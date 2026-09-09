# Preview Convex Reliability Gap — Permanent-Fix Analysis

> Source pin: `6cb0452f` (v0.4.23-280-g6cb0452f). Incident: 2026-09-09.
> Evidence bundle: [`docs/diagnostics/2026-09-09-preview-convex-oom.md`](../diagnostics/2026-09-09-preview-convex-oom.md).

## 1. Executive summary

On 2026-09-08 23:53 HKT the preview Convex local backend (`convex-local-backend`,
child of the `trends-preview-convex` Docker container) hit the container's
**12 GiB cgroup memory cap** and was OOM-killed at **12.3 GB anon-RSS**. The
container itself never exited, so `restart: unless-stopped` did nothing, the
Convex CLI was left wedged (its `.on("exit")` handler only logs, and its
offline-recovery path only runs on live WebSocket activity — there was none
overnight), and ports 3210/3211 stayed down for **~14 hours**. Every
Convex-backed BFF route 500'd; the web stayed on `正在加载最近搜索...` forever
because `useQuery(api.sessions.recentSearches)` stays PENDING while the Convex
WS client reconnects indefinitely.

**Recovery was `docker restart trends-preview-convex`** (2026-09-09 13:25 HKT);
`preview-doctor --recover` then reported **0 failures**.

## 2. Root-cause chain (confirmed)

1. **2026-09-08 13:54Z** preview was upgraded/rebuilt (web `dist` timestamp
   21:54 HKT == container `StartedAt` 13:54Z). That deploy carried
   **`CURRENT_INGEST_COMPUTE_EPOCH = 6`** (MY/SEEK no-verdict relaxation,
   introduced 2026-09-08).
2. An epoch bump makes **every resume with `ingestComputeEpoch < 6` stale**. The
   existing `crons.interval("reingest stale compute rows", {minutes:15})`
   (`packages/convex/convex/crons.ts`) began draining up to **200 rows/pass**.
3. Each re-ingest (`internal.ingest_agent.processNewResumes`) recomputes
   `searchText` (CJK segmentation) and **writes to the Tantivy search index**.
   Over many passes this produces segment churn; a segment merge holds multiple
   segments in RAM simultaneously. On a ~9k-resume corpus the backlog was in the
   thousands → ~11h of sustained index writes at 800 rows/hour.
4. Preview's Convex container has **`mem_limit: 12g`**; prod's systemd unit has
   **no cgroup cap** (host has 24 GiB). Prod's convex peaked at only 6.4 GiB
   during the same epoch-6 drain. Preview hit 12.3 GiB → **OOM-kill**.
5. Docker `restart: unless-stopped` restarts a container **only when the
   container exits**. The OOM killed a *child* process, so PID 1 stayed alive.
   The healthcheck failed (`unhealthy`) but nothing consumes that status.
6. The Convex CLI (v1.39.1) does **not** respawn a killed backend:
   - `.on("exit", code2 => { logVerbose(...) })` — log only.
   - `onActivity` (which calls `ensureBackendRunning` and would `ctx.crash()` on
     5s timeout) fires **only on WebSocket client activity**. Zero clients
     overnight → never ran.
   - The WS client backoff (1s→16s) keeps reconnecting forever, so the browser
     `useQuery` stays **PENDING**, never `Error`.
7. Result: `recentSearchHistoryRecords === undefined` forever →
   `searchHistoryLoading === true` (`useResumeSearchState.ts:2216`) →
   `SearchHero.tsx:286` renders `loadingRecentSearches` indefinitely.

## 3. Module / seam analysis (focused)

### 3.1 Deployment topology (preview)
- `trends-preview-convex` Docker container (`node:25-slim`, `mem_limit: 12g`,
  ports `4210:3210`, `4211:3211`), entrypoint `start-convex.sh` → `npx convex dev --tail-logs disable`.
- BFF `trends-preview-api.service` (systemd, `CONVEX_URL=http://127.0.0.1:4210`)
  calls Convex via `apps/api/src/services/convex-utils.ts` `callConvexQuery` /
  `callConvexMutation` (3×1s retry, then throw).
- Web static served by Caddy; browser Convex client points at
  `https://preview.pt-mes.com/convex` (Caddy `handle_path /convex/*` →
  `127.0.0.1:4210`).
- Prod differs: `trends-convex.service` (systemd, **no cgroup cap**,
  `Restart=on-failure`, `RestartSec=5`, `ExecStartPre` prewarm) on `:3210`.

### 3.2 Recovery mechanisms inventory
| Mechanism | Exists? | Covers child-OOM? | Auto? |
|---|---|---|---|
| `restart: unless-stopped` (docker) | yes | **no** (only on container exit) | no |
| Docker healthcheck (POST /api/query on 3210) | yes | detects | no action on failure |
| `preview-convex-restart.sh --watch --recover` | yes | yes (restarts container) | **not scheduled** |
| `preview-doctor.sh --recover` | yes | yes (compose up -d convex) | manual |
| Convex CLI `.on("exit")` respawn | no | — | — |
| Convex CLI `onActivity` offline recovery | partial | only with live WS client | no (idle = dead) |
| systemd `Restart=on-failure` (prod only) | yes | no (CLI would have to die) | prod only |

### 3.3 Web loading-state seam
`useQuery` from `convex/react` throws on Error but stays PENDING while the WS
reconnects. There is **no eventual timeout to Error**. The only clean signal is
`useConvexConnectionState()` → `isWebSocketConnected: false` (plus
`hasEverConnected`, `connectionRetries`). The web currently does not use it.

## 4. Recommended permanent fixes (ranked)

| Fix | Type | Effort | Impact | Notes |
|---|---|---|---|---|
| **FIX-A** Schedule `preview-convex-restart.sh --recover` as a systemd timer (~every 5 min) | Ops | Low | High | Self-heals any future wedge in <5 min. Script already safe (preview-only, refuses `:3210`/non-preview, `docker_cmd` falls back to `sudo -n docker`). Proposal + install files: `docs/runbooks/preview-convex-watchdog-proposal.md`. |
| **FIX-B** Raise/remove preview `mem_limit: 12g` → 16–20 GiB (or unset) | Ops | Low-Med | High | Matches prod (no cap). Host has 24 GiB; convex 16g + others ~2g + OS ~2g leaves ~4g headroom. Gives the epoch-drain the same slack prod has. |
| **FIX-B2** Add Tantivy compaction knobs to the compose env | Ops | Low | Med-High | The deployed backend exposes `MAX_CONCURRENT_SEGMENT_COMPACTIONS`, `MIN/MAX_COMPACTION_SEGMENTS`, `MAX_SEGMENT_DELETED_PERCENTAGE`, `SEARCH_WORKER_PAGES_PER_SECOND`, `SEARCH_INDEX_SIZE_SOFT_LIMIT`. Setting `MAX_CONCURRENT_SEGMENT_COMPACTIONS=1` and lowering worker page pacing directly bounds merge RAM during the drain. See `docs/diagnostics/2026-09-09-convex-memory-knobs-research.md`. |
| **FIX-C** Bound the epoch-drain memory impact | Code | Med | Med | The 15-min cron with fixed limit 200 turns an epoch bump into ~11h of sustained index churn. Make the per-pass limit adaptive to backlog size, or gate on search-index churn / maintenance mode. See `packages/convex/convex/crons.ts` + `ingest_agent.ts:958`. |
| **FIX-D** Web connection-state resilience | Code | Med | Med | Use `useConvexConnectionState()`; when `isWebSocketConnected === false` for >N seconds, turn infinite loading states (recentSearches hero, etc.) into an explicit degraded/error state + retry banner. |
| **FIX-E** Docker supervisor acting on unhealthy | Ops | Low | Med | The healthcheck already fails; add something that consumes `unhealthy` (e.g. a `docker-events` watcher or compose `restart: on-failure` + a periodic restart-on-unhealthy). FIX-A's timer subsumes this. |
| **FIX-F** Drop `SHARED_UDF_CACHE_MAX_SIZE` from compose | Ops | Low | Low | Binary `precompiled-2026-08-25-7cce8fb` does not contain that env var; it is a no-op on 0.4.23. Keep `UDF_CACHE_MAX_SIZE` which IS present. |

## 5. Open questions / inferences

- **Inference:** the epoch-6 drain + Tantivy segment merge is the memory driver.
  Strong circumstantial evidence: preview deployed epoch-6 the same day, prod
  (same code, no cap) peaked 6.4 GiB, preview hit exactly the 12 GiB cap after
  ~2h / ~8 drain passes. Not verified with a backend memory profile of the
  merge itself.
- **Open:** could the drain be paused during restore / maintenance? The crons
  already skip when `isMaintenanceModeInternal` is true (embeddings backfill
  does); `reIngestStaleResumes` does **not** check maintenance.
- **Open:** should the reingest cron drain in smaller passes during the first
  hours after an epoch bump? (Adaptive backpressure.)
- **Open:** does `searchText` recompute need to re-write the full Tantivy
  document, or is there a cheaper update path?
