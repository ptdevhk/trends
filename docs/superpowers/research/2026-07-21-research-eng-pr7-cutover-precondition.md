# PR7 hard-cut precondition status

**Date:** 2026-07-21  
**Status:** **BLOCKED** — cutover code is not executed until preconditions hold.

## Frozen legacy dependency matrix (Step 0a)

| Surface | Disposition | Notes |
|---------|-------------|--------|
| Worker `run_crawl_analyze` / `NewsAnalyzer` | **replace** after greens | Already gated by `LEGACY_TRENDRADAR_CRAWL=1` for shadow only |
| Worker product ingest | **keep** | `run_research_ingest` + Convex direct writes |
| `/api/trends` SQLite `DataService` readers | **replace** after greens | Product reads must use `/api/research/*` |
| `mcp_server` news MCP | **delete** (product path) after greens | MCP deferred P2 over new APIs if needed |
| Deploy docker `trendradar` / `trendradar-mcp` services | **delete** after greens | |
| Deploy systemd `python -m trendradar` entrypoints | **delete** after greens | |
| Dev scripts assuming legacy news services | **update** after greens | |
| Legacy docs/runbooks for SQLite news product path | **update** after greens | |
| Dual-run shadow SQLite | **keep** until 3 consecutive green `research_parity_runs` | |

## Step 0b — three consecutive green parity rows

**Not available in this implementation environment.**

- Parity pure decision, Convex `research_parity_runs` write/read path, API `/api/research/parity`, and CLI `trends research parity` are implemented.
- Live dual-run (native ingest window vs shadow SQLite for the full platform set) was not executed here; no green streak was fabricated.
- Kill switch remains: latest stored `greenStreak >= 3` on durable Convex rows.

## What operators must do before PR7

1. Enable `RESEARCH_INGEST_ENABLED=1` and optional `LEGACY_TRENDRADAR_CRAWL=1` for shadow.
2. Run dual-run windows until `research_parity_runs` shows three consecutive `green: true` with increasing `greenStreak`.
3. Freeze matrix above in the release PR, then disable legacy units and remove product SQLite readers.

## Honest blocker (this session)

PR7 product teardown is **intentionally not applied**. Product path still may include legacy surfaces until ops evidence exists. Native research path (Convex + `/api/research/*` + CLI + web route) is the sole *intended* product surface going forward; legacy remains dual-run/opt-in only.
