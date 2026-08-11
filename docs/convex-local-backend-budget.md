# Convex Local Backend Budget Limits (preview)

> Hard-won operational limits of the self-hosted Convex local backend at
> preview scale (~9k resumes, ~3k industry sources). Two 500-incidents and
> one regression on 2026-08-09 came from ignoring these. See
> `deploy/docker/docker-compose.preview.yml` for the tuned knobs.

## Measured limits (verified 2026-08-09 against knobs.rs)

| Limit | Value | Evidence |
|---|---|---|
| Per-query system-op budget | **~10.5k ops** (10,407 OK / 11,031 fail observed) | coverage query regressed when sources grew 545 → ~1,050 |
| Query execution ceiling | **1s** | hardcoded, no knobs |
| Budget/ceiling knobs | **none** | verified against `crates/common/src/knobs.rs` |

Both limits are hardcoded in the Convex backend binary — there is no
configuration knob. The compose file's `DOCUMENTS_IN_MEMORY=256`,
`APPLICATION_MAX_CONCURRENT_QUERIES=8`, and cache-size env vars are the
only pressure-relief levers, and they bound memory/parallelism, not the
per-query budget.

## Budget math (why it matters)

A `collect()` over a full table costs ~1 system op per document plus fixed
overhead. Full-table scans are therefore bounded:

- ~9,776 open proposals table → a single full scan ≈ 9.8k ops — **over
  budget alone**.
- Per-row probes (`withIndex(...).first()` in a loop) multiply: N rows ×
  per-probe ops blows the budget almost immediately. This exact pattern
  regressed the coverage endpoint (per-proposal source probes), fixed by
  splitting into `getIndustryCoverageSummary` + `countIndustryOpenProposalSources`
  (one sources scan, indexed proposal lookups) — `3ebc673a`.

## Rules for new queries/mutations

1. **Never loop with per-row `first()` probes** over a full table. Scan
   once and index in memory, or use a single indexed lookup per row with a
   bounded row count (≤ ~256 rows, per `DOCUMENTS_IN_MEMORY`).
2. **Full-table scans are budget-consuming**: one scan per query max, and
   only when the table is small (sources ~1k OK; proposals ~10k NOT).
3. **Keep derived metrics out of live queries**: the coverage counters
   pattern (C5/P1.8, 2026-08-09 plan) precomputes at maintenance time so
   the endpoint reads one document.
4. After adding a query, verify op usage empirically:
   `curl http://127.0.0.1:4210/api/query -d '{"path":"...","args":{...}}'`
   and check the log for system-op warnings, or watch for 500s under load.

## Symptom → cause

| Symptom | Cause | Fix |
|---|---|---|
| HTTP 500 on a list/coverage query that passed before | sources grew past the budget | split scan, single indexed pass, or precompute |
| Query latency spikes to exactly ~1s then 500 | execution ceiling | reduce scan width / paginate |
| Convex container OOM-killed (history: 4g, 8g) | full-table collect() churn + cache | 12g mem_limit + knobs above; keep scans single-pass |
