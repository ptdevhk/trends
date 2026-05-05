# Keyword Search Load + E2E Tests

Date: 2026-05-05

## Goal
Comprehensive test coverage for all keyword search paths, validating:
- Correctness of AND/OR mode search logic
- Convex 16 MiB byte-read limit safety
- Pagination boundary correctness
- p50/p95/p99 latency under concurrent load
- Memory stability across iterations
- Production fixes hold under stress (scanResumePageSlim batch=200, getResumes query)

## Scope

### Convex Search Queries (8 primary paths to test)
1. `search` (L2206) — basic search with OR→AND post-filter
2. `searchWithIngestData` (L2231) — search + ingest scoring
3. `searchWithTagExpansion` (L2263) — tag expansion with provenance
4. `searchWithTagExpansionPage` (L2345) — offset-based pagination
5. `searchWithTagExpansionPaginated` (L2388) — cursor-based pagination
6. `searchWithTagExpansionScanPage` (L2451) — scan-based pagination
7. `scanResumePageSlim` (L2616) — AND-mode phase 1 slim scan
8. `getResumes` (L2649) — backward-compat simple list

### BFF API Paths (4 dispatcher routes)
- Path A: AND-mode BFF (scanResumePageSlim → getResumeDocsByIds)
- Path B: OR-mode cursor scan (searchWithTagExpansionScanPage)
- Path C: Simple fallback (searchWithTagExpansion)
- Path D: List (listWithIngestDataPage / listWithIngestData)

## Test Plan

### File 1: `packages/convex/convex/__tests__/resumes-search-load.test.ts`
**Type:** Vitest unit tests (handler-level, no live Convex needed)

Tests:
- `buildTagExpansionSearchQuery`: AND uses narrowest group, OR combines all
- `matchesTagExpansionSearchText`: AND requires all groups, OR accepts any
- `collectSearchTextProvenance`: deduplication, source tracking
- AND/OR mode with empty keyword groups, single group, many groups
- Byte-limit safety: validate slim doc projections exclude content/ingestData
- Pagination boundary: numItems capped at 200 for scanResumePageSlim
- Provenance tracking across expanded variants
- Chinese + English keyword mixing

### File 2: `scripts/benchmark-keyword-search.ts`
**Type:** Standalone load test (live Convex via ConvexHttpClient)

Structure (follows existing benchmark-critical-path.ts patterns):
- CLI flags: `--concurrency`, `--iterations`, `--keyword`, `--keyword-groups`, `--mode`
- Per-query-type metrics: min/p50/p95/p99/max latency, success rate
- Byte-read estimation: approximate based on page sizes × doc count
- Memory tracking: heap snapshots between iterations
- Concurrent load: N parallel queries per iteration
- Validation: assert no results exceed expected limits, all responses parseable
- Output: JSON report + human-readable summary

Queries tested under load:
1. `resumes.search` — basic keyword
2. `resumes.searchWithIngestData` — with JD scoring
3. `resumes.searchWithTagExpansion` — tag expansion AND/OR
4. `resumes.searchWithTagExpansionPaginated` — paginated with cursor
5. `resumes.searchWithTagExpansionScanPage` — scan pagination
6. `resumes.scanResumePageSlim` — slim scan with various numItems
7. `resumes.getResumes` — simple list

### File 3: `apps/api/src/routes/resumes.search-integration.test.ts`
**Type:** Vitest integration tests (BFF route logic with mocked Convex)

Tests:
- AND-mode dispatch: verifies scanResumePageSlim + getResumeDocsByIds flow
- OR-mode cursor scan: verifies searchWithTagExpansionScanPage call
- Simple fallback: verifies searchWithTagExpansion for non-paginated
- List mode: verifies listWithIngestDataPage dispatch
- Pagination cursor propagation
- Empty result handling
- Filter parameter passthrough (age, experience, location, etc.)

## Execution Order
1. Write Convex unit tests (File 1) — immediate validation of search logic
2. Write load benchmark script (File 2) — live Convex stress testing
3. Write BFF integration tests (File 3) — API route validation
4. Run all tests + `make check-node`

## Acceptance Criteria
- [ ] All unit tests pass: `bunx vitest run packages/convex/convex/__tests__/resumes-search-load.test.ts`
- [ ] Load benchmark runs successfully against local Convex
- [ ] BFF integration tests pass
- [ ] `make check-node` passes
- [ ] No test introduces flakiness or depends on specific data state
