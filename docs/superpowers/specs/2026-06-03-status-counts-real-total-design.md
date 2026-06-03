# Status Counts: Real Total from Server, Not Client-Side Estimate

**Date:** 2026-06-03
**Status:** approved

## Problem

Status counters (new/shortlisted/rejected) in BulkActionBar and FacetSidebar are computed client-side by iterating over currently loaded results (max 200 default, 2000 hard cap in `useFacetCounts.ts:63`). When the database has more matching resumes than the loaded page, the counters are wrong.

Example: 188 rejected + 1500+ new candidates ingested. UI loads 200 results, shows `new:19, rejected:181` instead of true totals.

## Root Cause

`useFacetCounts.ts` counts statuses by iterating `results.slice(0, 2000)` — the in-memory array from the current Convex page load. There is no server-side aggregation query for status counts.

## Design

### Architecture

```
ResumeSearchPage
  useConvexResumes(filters)     → paginated search results (existing)
  useStatusCounts(filters)  NEW → unpaginated status totals (new)
```

Count query fires in parallel with search query. Count query only re-fires on filter changes, not on page navigation. Count failure degrades gracefully to existing client-side estimation.

### Scope: Where Real Counts Apply

| Location | Status count source | Notes |
|----------|-------------------|-------|
| BulkActionBar | Real total (new query) | User decision-making depends on it |
| FacetSidebar status | Real total (same query) | Consistency with BulkActionBar |
| FacetSidebar other facets | Client-side (no change) | Cannot efficiently aggregate tags/brands server-side |

### Convex Layer: `countResumesByStatus`

New query in `packages/convex/convex/`:

**Args:** Same filter fields as `listWithIngestDataPaginated`, minus pagination opts, plus `workspaceSlug`.

**Logic:**
1. Query `candidate_status` by `workspaceSlug` → build `Map<identityKey, status>`
2. Paginate through all non-archived resumes (200/batch) with `maximumRowsRead` cap
3. Filter each batch with `matchesResumeListFilters`
4. Look up each matching resume's status (default `'new'`)
5. Accumulate counts, hard cap at 5000 matching resumes
6. Return `{new, shortlisted, rejected, total, overflow}`

**Cap rationale:** Convex 16MB read limit. 5000 resume filter reads ≈ 8-10MB.

**Keyword search gap:** This query only applies structural filters (location, roleType, experience, education, skills, salary, source). It does NOT apply keyword text search (that requires Convex search index, incompatible with `.paginate()` full scan). For OR-mode keyword searches, the count reflects structural-filter-only matches — e.g., with `q=CNC 销售` + location China, the count includes all China resumes matching structural filters, not just those whose searchText matches "CNC 销售". The BFF AND-mode path handles keyword matching server-side and does not have this gap.

**Mitigation:** In the UI, when both a keyword query and Convex-direct (OR) path are active, add a subtle indicator (e.g., `~` after the count) to signal approximate counts. On hover, tooltip: "Approximate count based on filters only; keyword matches may reduce actual results."

### BFF Layer: `GET /api/resumes` summary extension

Add `statusCounts` to the existing `summary` response:

```json
{
  "summary": {
    "total": 5000,
    "returned": 50,
    "statusCounts": { "new": 3200, "shortlisted": 800, "rejected": 1000 }
  }
}
```

The BFF already scans all matching results — count by status during the scan by looking up `candidate_status` (single batch query, max 500 records per workspace). No additional Convex reads needed.

### UI Layer

**New: `useStatusCounts(filters)` hook**

- Convex direct path → calls `countResumesByStatus` query
- BFF AND-mode path → reads `summary.statusCounts` from existing response
- Re-fires only on filter changes, not pagination
- Returns `{new, shortlisted, rejected, total, loading, overflow}`
- On failure/timeout → falls back to existing client-side counts

**Files changed:**

| File | Change |
|------|--------|
| `apps/web/src/hooks/useStatusCounts.ts` | NEW — hook for server-side status counts |
| `apps/web/src/hooks/useResumeSearchState.ts` | Wire `useStatusCounts` into `facetCounts.statuses` with fallback |
| `apps/web/src/pages/ResumeSearchPage.tsx` | Pass real counts to BulkActionBar |
| `packages/convex/convex/resumes.ts` | NEW query: `countResumesByStatus` |
| `apps/api/src/routes/resumes_search.ts` | Add `statusCounts` to BFF summary |
| `apps/api/src/services/resume-service.ts` | Count by status during filter scan |

**Files NOT changed:** BulkActionBar.tsx, FacetSidebar.tsx (props unchanged).

### Loading States

- BulkActionBar: show skeleton/spinner on count badges while `loading=true`
- FacetSidebar: show `--` or skeleton count while loading
- First paint: search results render immediately; counts fill in 200-800ms later

### Edge Cases

- **Overflow (>5000 matches):** Show "5000+" with tooltip explaining the cap
- **Count query error:** Fall back to client-side counts silently
- **Empty workspace:** Return `{0, 0, 0, 0, false}` — no resumes to count
- **Convex unavailable:** Fallback to client-side counts (existing behavior)
- **Status not in candidate_status:** Default to `'new'` (consistent with current `useCandidateStatus` behavior)
