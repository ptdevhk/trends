# Deep Research — Convex Local Backend Memory Knobs & OOM Recovery

> Topic: Convex self-hosted local backend memory behavior under search-index
> write churn; knobs for Tantivy segment compaction; Docker child-OOM recovery.
> Evidence cutoff: 2026-09-09 · Verification: locally verified only (binary
> extraction) + one web-search result.
> Context: preview convex OOM-killed at 12.3 GB / 12 GiB on 2026-09-08 during an
> epoch-6 search-index reingest drain.

## TL;DR
- The deployed `convex-local-backend` binary (`precompiled-2026-08-25-7cce8fb`)
  exposes **real env-var knobs** for search index size, Tantivy compaction, and
  worker pacing — several of which the preview compose does **not** currently set.
- The four compaction knobs (`MAX_CONCURRENT_SEGMENT_COMPACTIONS`,
  `MIN_COMPACTION_SEGMENTS`, `MAX_COMPACTION_SEGMENTS`,
  `MAX_SEGMENT_DELETED_PERCENTAGE`) directly bound segment-merge memory and are
  the highest-leverage lever for a re-ingest drain.
- A web search found no public GitHub issue exactly matching "convex local
  backend OOM during ingest", but surfaced a related `get-convex/convex-backend`
  OOM issue (#414) about Node heap exhaustion during schema push.
- Docker `restart: unless-stopped` cannot recover a child-process OOM; an
  external watchdog (systemd timer / docker-events watcher) is required.

## Findings

### 1. Search-index / Tantivy knobs (from deployed binary strings)
Extracted via `grep -a -oE "[A-Z_]{4,45}"` on the backend binary. Occurrence
count ≥3 indicates a real env var (has default + Rust symbol paths).

| Env var | Count | Role |
|---|---|---|
| `SEARCH_INDEX_SIZE_SOFT_LIMIT` | 3 | Soft cap on search index size (bytes) |
| `TEXT_INDEX_SIZE_HARD_LIMIT` | 3 | Hard cap for text index |
| `SEARCH_INDEX_SIZE_HARD_LIMIT` | 1 | Present; likely used in error path |
| `SEARCH_WORKER_PAGES_PER_SECOND` | 3 | Index write pacing (pages/s) |
| `SEARCH_WORKER_PASSIVE_PAGES_PER_SECOND` | 3 | Passive drain pacing |
| `SEARCH_COMPACTOR_INITIAL_BACKOFF` | 4 | Compactor retry backoff |
| `SEARCH_COMPACTOR_MAX_BACKOFF` | 3 | Compactor max backoff |
| `SEARCH_INDEX_FLUSHER_MAX_BACKOFF` | 4 | Flusher backoff |
| `MAX_CONCURRENT_SEGMENT_COMPACTIONS` | 3 | **Bounds simultaneous merges** |
| `MIN_COMPACTION_SEGMENTS` | 3 | Min segments before merge triggers |
| `MAX_COMPACTION_SEGMENTS` | 3 | Max segments per merge |
| `MAX_SEGMENT_DELETED_PERCENTAGE` | 3 | Merge threshold for deleted docs |
| `DOCUMENTS_PER_NEW_SEARCH_SEGMENT_TOTAL` | 2 | New-segment sizing |

The last four are the Tantivy segment-compaction levers. Setting
`MAX_CONCURRENT_SEGMENT_COMPACTIONS=1` (currently default) would prevent
parallel merges from compounding RAM; `MIN/MAX_COMPACTION_SEGMENTS` tune when
and how big merges get.

### 2. General memory knobs (confirmed present)
| Env var | Count | Note |
|---|---|---|
| `DOCUMENTS_IN_MEMORY` | 4 | Already set to 256 in preview compose |
| `APPLICATION_MAX_CONCURRENT_QUERIES` | 4 | Already set to 8 |
| `APPLICATION_MAX_CONCURRENT_MUTATIONS` | 4 | Already set to 8 |
| `UDF_CACHE_MAX_SIZE` | 4 | Already set to 50 MB |
| `DOCUMENT_RETENTION_DELAY` | 4 | Already set to 2 days |
| `SHARED_UDF_CACHE_MAX_SIZE` | **0** | **NOT in this binary** (compose sets it but it's a no-op on 0.4.23) |

**Key finding:** `SHARED_UDF_CACHE_MAX_SIZE` is set in `docker-compose.preview.yml`
(100 MB) but the deployed `precompiled-2026-08-25-7cce8fb` binary does **not**
contain that string. It may be a newer/older knob name or a no-op on this
version. This means the compose memory tuning is partially ineffective.

### 3. Docker child-OOM recovery
- `restart: unless-stopped` only restarts on container **exit**; a child-process
  OOM does not exit the container.
- The healthcheck (POST `/api/query` on 3210) detects the dead backend but
  nothing consumes `unhealthy`.
- The Convex CLI v1.39.1 `.on("exit")` handler only logs; offline recovery
  (`onActivity` → `ensureBackendRunning`) requires a live WS client.
- **Required**: an external supervisor. The project's
  `preview-convex-restart.sh --recover` is the intended tool but is not
  scheduled (see `docs/runbooks/preview-convex-watchdog-proposal.md`).

### 4. Known OOM issues (web search)
- `get-convex/convex-backend#414` — "out of memory" during schema push (Zod v4
  validation bloat). Different mechanism (Node heap vs Rust backend) but same
  family. No issue found for the Rust `convex-local-backend` OOM during ingest.

## Freshness & Verification Status
| Claim | Status | Source route |
|---|---|---|
| `MAX_CONCURRENT_SEGMENT_COMPACTIONS` etc. exist as env vars | locally verified only | binary strings extraction |
| `SHARED_UDF_CACHE_MAX_SIZE` not in deployed binary | locally verified only | binary strings |
| Docker restart policy cannot recover child OOM | locally verified + general knowledge | `docker docs` (not fetched) |
| No public Rust-backend OOM issue during ingest | search-summary only | grok-search (`dc6b16d6e8ca`) |

## Verification Methods
- Binary strings: `grep -a -oE "[A-Z_]{4,45}" <convex-local-backend> | sort | uniq -c`
  inside `trends-preview-convex` (binary at
  `/root/.cache/convex/binaries/precompiled-2026-08-25-7cce8fb/convex-local-backend`).

## Coverage and uncertainty
- **Evidence gap:** external docs for the exact env-var semantics were not
  fetched (web-search denials for this session); the names are verified against
  the deployed binary only. Semantic defaults (e.g. default `MAX_CONCURRENT_SEGMENT_COMPACTIONS`) are unverified.
- **Execution topology:** grok-search web_search used for the known-issues
  probe; deep-fetch/get_sources blocked by session permission rules.
- **Topic-inherent unknown:** whether the epoch-6 drain's segment merges are
  what actually consumed 8 GB is inferred, not measured on the live backend.
