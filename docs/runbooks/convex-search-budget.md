# Convex search-index byte-budget patterns

Audit record for work item `2026-08-18-convex-search-byte-budget-patterns`
(audited 2026-08-18). The resume keyword-search surface is **compliant** with
Convex's search-index limits after two defensive caps (see below).

## Platform limits (Convex full-text search)

| Limit | Value | Enforcement |
|-------|-------|-------------|
| Search terms per expression | 16 | Runtime rejection above the cap |
| Equality filters per query | 8 | Runtime rejection above the cap |
| Scan per search query | 1024 results | Silent truncation (no error) |
| `.collect()` on a search query | at most 1024 docs | Silent truncation |

Source: <https://docs.convex.dev/search/text-search> and
<https://docs.convex.dev/production/state/limits>.

## Trends search surface

- Single module: `packages/convex/convex/resumes_search.ts` — all
  `withSearchIndex("search_body")` call sites live here.
- Index: `resume_digests` `searchIndex("search_body")` with
  `searchField: "searchText"`, `filterFields: ["isArchived", "sourceKey"]`
  (`packages/convex/convex/schema.ts`).
- **Large resume bodies never enter the indexed field.** `searchText` is a
  compact digest capped at 1500 chars (`MAX_DIGEST_SEARCH_TEXT_LENGTH` in
  `packages/convex/convex/lib/resume_digests.ts`), with priority tokens
  (domain presence, e.g. cnc/数控/销售/sales/机床) emitted first so they always
  survive the cap. Full bodies stay in `resumes.content`; search returns
  digest rows, then fetches full docs by id (`.take()`-bounded).

## Call-site inventory (all 7 sites, 2026-08-18)

| Site | Mechanism | Bound | Verdict |
|------|-----------|-------|---------|
| `searchDigestRowsForTokens` (:99) | `.take()` per token + intersection | ≤200 per token, ≤16 tokens | OK |
| `runSearchWithTagExpansionPageQuery` (:241) | `.take()` | ≤400 (`MAX_SAFE_SEARCH_TAKE_LIMIT`) | OK |
| `runSearchWithTagExpansionScanPageQuery` (:331) | `.paginate()` | `PAGINATE_MAX_BYTES_READ`/`MAX_ROWS` + page ≤128 filtered / ≤16 unfiltered | OK |
| `search` single token (:401) | `.take()` | caller limit; Convex scan caps at 1024 | OK |
| `searchWithIngestData` single token (:433) | `.take()` | ≥200 over-fetch; Convex scan caps at 1024 | OK |
| `searchWithTagExpansion` (:490) | `.take()` | ≤4000 over-fetch; Convex scan caps at 1024 | OK |
| `collectSearchIndexDocIds` (:1331) | `.paginate()` | `PAGINATE_MAX_BYTES_READ`/`MAX_ROWS`, numItems ≤256 | OK |

All sites use one equality filter (`isArchived`) — well under the 8-filter cap.
No site uses `.collect()` on a search index. The
`resume-digest-callsite-inventory.test.ts` test enforces "bounded `.take()` /
`.paginate()`, never `.collect()`" as a static invariant.

### Defensive caps added by this audit

- `MAX_SEARCH_INDEX_TERMS = 16` (`packages/convex/convex/lib/resumes_pagination.ts`)
- `buildTagExpansionSearchQuery` caps the generated expression (AND anchor
  variants and OR expanded terms) at 16 terms — previously an oversized
  variant list could produce a runtime-rejected query string.
- `splitQueryTokens` caps the multi-token AND loop at 16 tokens — previously
  an unbounded number of sequential index queries per request.

## Gotchas

1. **`maximumBytesRead` does NOT apply to search.** `maximumBytesRead` /
   `maximumRowsRead` are `.paginate()` options only; they have no effect on
   `.take()` or `.collect()` on a search index. Search take paths are bounded
   by the 1024 scan cap instead — that is why digest rows must stay small
   (each row contributes its full size to the 16 MiB query read budget, and
   `resume_digests` rows are ~1KB while `resumes` rows average ~27KB).
2. **`.collect()` truncates silently at 1024.** Long-tail result sets beyond
   the scan cap are dropped with no error. Never collect a search query.
3. **Over-fetch beyond 1024 is harmless but wasteful.** `.take()` values above
   1024 (e.g. the 4000 over-fetch path) return at most 1024 rows; prefer
   `MAX_SAFE_SEARCH_TAKE_LIMIT`-style bounds for new code.
4. **Terms vs tokens.** Convex counts whitespace-separated terms per
   expression. `searchDigestRowsForTokens` keeps each expression single-term
   and intersects results, which also gives AND semantics (Convex ORs terms
   within one query string).

## Rules for future changes

- Never `.collect()` a search-index query; use `.take()` or `.paginate()`.
- Keep expressions ≤16 terms and filters ≤8 — route builders through
  `MAX_SEARCH_INDEX_TERMS` and the bounded helpers above.
- Keep large bodies out of the indexed field; the digest `searchText` cap is
  the contract that keeps take-path reads under the 16 MiB query budget.
- When adding a `.paginate()` search path, pass
  `PAGINATE_MAX_BYTES_READ` / `PAGINATE_MAX_ROWS_READ`.
