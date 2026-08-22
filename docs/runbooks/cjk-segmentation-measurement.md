# CJK segmentation & search recall measurement

Measurement report for work item `2026-08-18-cjk-segmentation-convex-tantivy`
(measured 2026-08-18, spike `scripts/cjk-measurement-spike.ts`, raw results
`scripts/output/cjk-measurement-results.json`). The spike measured recall of
the two shipped resume-search paths against a controlled CN fixture corpus,
with ground truth defined on the raw fixture content. **No search-path code
change is made as a result of this spike** — the measured gaps are
tokenization-boundary behaviors, not missing-index defects, and each candidate
fix requires a follow-up decision.

## Search surface under test

### Digest construction (ingest side)

`resume_digests` `searchText` is built by
`buildCompactDigestSearchText` (`packages/convex/convex/lib/resume_digests.ts:106`):

1. Compact fields only: `name`, `desiredPosition`, `education`,
   `expectedSalary`, `skills` (≤20), `companies` (≤20), `locationHierarchy`,
   `workHistory`. **Free-form prose (e.g. selfIntro) is NOT included.**
2. Domain-presence tokens (`cnc`/`数控`/`销售`/`sales`/`机床`/`machine tool(s)`)
   are collected from `resume.searchText` (the resume's cold search text), not
   from the compact content (`resume_digests.ts:129`), and emitted first with
   cap priority so they always survive a rebuild.
3. `limitSearchText` (`resume_digests.ts:222`) whitespace-tokenizes, dedupes
   via a seen set, emits priority tokens first, and stops at
   `MAX_DIGEST_SEARCH_TEXT_LENGTH = 1500` chars, dropping the tail on overflow.

### CJK tokenization (ingest side)

`segmentChineseRuns` (`packages/convex/convex/search_text.ts:51`) applies
`/[\u4e00-\u9fff\u3400-\u4dbf]{3,}/g`: each maximal CJK run of ≥3 chars is
replaced with `[run + Intl.Segmenter("zh-CN") words]` space-joined, so the run
itself is always the first token, followed by its dictionary words. Runs of
1–2 chars are left literal, and punctuation (，、。) is outside the CJK range
so it stays literal — a comma can glue two words into ONE whitespace token
(e.g. the stored token `服务，涵盖模具设计开发`).

`addScriptBoundarySpaces` (`search_text.ts:40`) inserts spaces at CJK↔ASCII
boundaries. It is applied **on ingest only** (`search_text.ts:241`); the query
side does not boundary-split. Consequence: `CNC编程` ingests as two tokens
`cnc 编程`, but the query `CNC编程` is one index term that exists nowhere.

### Path A — web quick search (`resumes_search.search`, `resumes_search.ts:377`)

- Single token (`splitQueryTokens` returns 1): direct index search
  `.search("searchText", args.query)` + `isArchived` filter + `.take(limit)`
  (`:401`) — BM25-ranked, tantivy query analyzer splits the string on
  punctuation, OR semantics across segments.
- Multi token: `searchDigestRowsForTokens` — per-token `.take()` (≤200 rows
  per token, ≤16 tokens) + intersection + `matchesAllTokens` post-filter.

### Path B — BFF tag-expansion scan (`searchWithTagExpansionScanPage`, `:331`)

Emulated in the spike as `expandKeyword` (`apps/api/src/services/
unified-search-service.ts:160`): per-whitespace-token keywordGroups,
variants = `[token]` in the spike (the real BFF adds synonym variants), AND
mode, tokens <2 chars dropped before any Convex call (`:179`, `:187`).
Convex side: unfiltered scan-page pagination, 16 rows/page, no BM25 ranking,
1024-row scan cap per term (`MAX_SEARCH_INDEX_TERMS = 16`,
`packages/convex/convex/lib/resumes_pagination.ts:34`).

## Method

- 7 fixture resumes (f1–f7), distinct CN profiles (数控车床师傅, 品质主管,
  跨境电商运营, 平面磨床技工, 模具设计师, 电工/焊工, CNC编程技术员), ingested
  through the shipped `submitResumes` + `upsertResumeDigestForTest` path into
  the local dev backend (`http://127.0.0.1:3210`, 1000+ pre-existing digest
  rows). Fixtures were deleted at the end of the run (`remainingFixtures: 0`).
- 40 probes (39 queries + 1 repeat) in 10 classes; ground truth = fixtures
  whose RAW content (lowercased JSON) contains every whitespace-split query
  token (`expectedFixtureIds`, spike `:257`).
- Per probe: Path A at `limit` 50 and 500 (to separate BM25 rank-cutoff from
  tokenization misses), Path B full scan-page loop (guard >2000 items), plus a
  digest dump per fixture and a token-overlap check on every fixture hit
  (`scanTokenOverlapFailures`, 0 everywhere).
- 0 errors across all 40 probes. Generated `2026-08-18T11:12:41Z`.

Digest searchText lengths: f1 = 523 (22 identical boilerplate sentences
collapsed by the seen-set dedupe — repeated content does NOT push a digest
toward the 1500 cap), f2 = 95, f3 = 115, f4 = 100, f5 = 94, f6 = 100, f7 = 93.

## Class-level recall

| Class | Probes | Path A mean recall | Path B mean recall | Errors |
|-------|--------|--------------------|--------------------|--------|
| single | 6 | 0.83 | 0.92 | 0 |
| compound | 7 | 0.79 | 0.79 | 0 |
| cjk-ascii | 5 | 0.40 | 0.40 | 0 |
| multi | 6 | 0.58 | 0.83 | 0 |
| long-compound | 3 | 0.33 | 0.33 | 0 |
| alias | 4 | 0.00 | 0.50 | 0 |
| cap-length | 5 | 0.60 | 0.00 | 0 |
| cap-terms | 1 | n/a (no expected) | n/a | 0 |
| single-char | 2 | 0.25 | n/a (BFF drops <2-char) | 0 |
| noise | 1 | n/a (no expected) | n/a | 0 |

Key: `@50`/`@500` totals of exactly 50/500 mean the `.take()` was capped
(≥500 matching docs under BM25); Path B totals of exactly 1024 mean the
1024-row scan window was saturated. Recall is computed at `@500`.

## Per-probe results

| # | Class | Query | Expected | A tot@500 | A fx@500 | B tot | B fx | A / B recall |
|---|-------|-------|----------|-----------|----------|-------|------|--------------|
| 0 | single | 数控 | f1,f7 | 500 | — | 1014 | f7 | 0 / 0.5 |
| 1 | single | 磨床 | f4 | 92 | f4 | 92 | f4 | 1 / 1 |
| 2 | single | 模具 | f1,f5 | 500 | f5,f1 | 779 | f5,f1 | 1 / 1 |
| 3 | single | 焊工 | f6 | 9 | f6 | 9 | f6 | 1 / 1 |
| 4 | single | 电工 | f6 | 42 | f6 | 42 | f6 | 1 / 1 |
| 5 | single | 跨境电商 | f3 | 9 | f3 | 9 | f3 | 1 / 1 |
| 6 | compound | 数控车床 | f1 | 245 | f1 | 245 | f1 | 1 / 1 |
| 7 | compound | 平面磨床 | f4 | 2 | f4 | 2 | f4 | 1 / 1 |
| 8 | compound | 冲压模具 | f1,f5 | 5 | — | 5 | — | 0 / 0 |
| 9 | compound | 品质主管 | f2 | 33 | f2 | 33 | f2 | 1 / 1 |
| 10 | compound | 跨境电商运营 | f3 | 8 | f3 | 8 | f3 | 1 / 1 |
| 11 | compound | 模具设计 | f1,f5 | 28 | f5 | 28 | f5 | 0.5 / 0.5 |
| 12 | compound | 数控车床师傅 | f1 | 3 | f1 | 3 | f1 | 1 / 1 |
| 13 | cjk-ascii | CNC编程 | f7 | 0 | — | 0 | — | 0 / 0 |
| 14 | cjk-ascii | CNC操机 | f7 | 0 | — | 0 | — | 0 / 0 |
| 15 | cjk-ascii | ISO9001 | f2 | 21 | f2 | 21 | f2 | 1 / 1 |
| 16 | cjk-ascii | Mastercam | f7 | 85 | f7 | 85 | f7 | 1 / 1 |
| 17 | cjk-ascii | UG编程 | f1,f7 | 0 | — | 0 | — | 0 / 0 |
| 18 | multi | 数控 车床 | f1 | 13 | — | 48 | — | 0 / 0 |
| 19 | multi | 模具 设计 | f1,f5 | 19 | f5 | 293 | f5,f1 | 0.5 / 1 |
| 20 | multi | 磨床 技工 | f4 | 11 | f4 | 15 | f4 | 1 / 1 |
| 21 | multi | 品质 主管 | f2 | 13 | f2 | 116 | f2 | 1 / 1 |
| 22 | multi | 跨境电商 运营 | f3 | 5 | f3 | 9 | f3 | 1 / 1 |
| 23 | multi | CNC 操机 | f7 | 9 | — | 550 | f7 | 0 / 1 |
| 24 | long-compound | 五金冲压模具设计 | f1,f5 | 0 | — | 0 | — | 0 / 0 |
| 25 | long-compound | 跨境电商运营经验 | f3 | 0 | — | 0 | — | 0 / 0 |
| 26 | long-compound | 平面磨床技工 | f4 | 1 | f4 | 1 | f4 | 1 / 1 |
| 27 | alias | cnc | f7 | 500 | — | 1024 | f7 | 0 / 1 |
| 28 | alias | 机床 | f1,f4,f7 | 500 | — | 787 | — | 0 / 0 |
| 29 | alias | machine tools | (none) | 129 | — | 968 | — | n/a |
| 30 | alias | sales | (none) | 500 | — | 1016 | — | n/a |
| 31 | cap-length | 本公司主营…五金零件 (20-char prefix) | f1 | 0 | — | 0 | — | 0 / 0 |
| 32 | cap-length | …优化服 (32-char prefix) | f1 | 0 | — | 0 | — | 0 / 0 |
| 33 | cap-length | …服务，涵盖模具设计 (40-char) | f1 | 1 | f1 | 0 | — | 1 / 0 |
| 34 | cap-length | …工作全 (64-char) | f1 | 1 | f1 | 0 | — | 1 / 0 |
| 35 | cap-length | …工作全流程 (66-char, full run) | f1 | 1 | f1 | 0 | — | 1 / 0 |
| 36 | cap-terms | 16 real terms + `zzzzz` (17 terms) | (none) | 0 | — | 0 | — | n/a |
| 37 | single-char | 车 | f1 | 500 | — | bff-dropped | — | 0 / n/a |
| 38 | single-char | 模 | f1,f5 | 500 | f5 | bff-dropped | — | 0.5 / n/a |
| 39 | noise | 汽车维修 | (none) | 10 | — | 10 | — | n/a |

## Findings per class

- **single (0.83 / 0.92) — works.** Every query that is a standalone stored
  token matches (磨床, 模具, 焊工, 电工, 跨境电商). Misses (`数控`@0,
  `车`@0, `模`@0.5) are BM25 rank-cutoff on very common terms in the 1000+
  row dev DB — fixtures are short digests and never reach the top-500, even
  though they contain the term. Not a tokenization defect.
- **compound (0.79 / 0.79) — works when the compound is a segmenter word or
  stored run; misses when it is a substring of a longer token.** 数控车床,
  平面磨床, 品质主管, 跨境电商运营, 数控车床师傅 all hit. 冲压模具 = 0
  (fixture content has it only inside `五金冲压模具设计改进`; stored tokens
  are `五金冲压` + `模具设计`). 模具设计 = 0.5 (f5 stores the segmenter word
  模具设计; f1's occurrence is inside the same longer run, and f1's
  selfIntro — where 冲压模具/模具设计 also live — is not in the digest at
  all). Tantivy matches exact terms; there is no substring semantics.
- **cjk-ascii (0.40 / 0.40) — the clearest boundary defect.** Pure-ASCII
  (ISO9001, Mastercam) and pure-CJK queries work; every mixed-script query
  (CNC编程, CNC操机, UG编程) returns **0 hits on both paths**, because the
  ingest side inserts script-boundary spaces (`cnc 编程` as two tokens) but
  the query side does not — the query term `cnc编程` exists nowhere in the
  index. A query-side boundary split (or storing both joined and split
  forms) would fix this class.
- **multi (0.58 / 0.83) — Path B beats Path A on common terms.** 磨床 技工,
  品质 主管, 跨境电商 运营 are 1/1 on both. 模具 设计: Path B finds both
  fixtures (per-token AND over a 1024-row window), Path A finds only f5 —
  f1's row falls outside the ≤200-row per-token `.take()` window for the very
  common term 模具 (probe 2 shows 779 docs contain it). CNC 操机: Path A
  misses f7 (rank cutoff), Path B finds it. 数控 车床: see anomaly below.
- **long-compound (0.33 / 0.33) — recall is decided by whether the exact
  compound is a stored token.** 平面磨床技工 is f4's jobTitle, so the run is
  stored verbatim and matches. 五金冲压模具设计 and 跨境电商运营经验 occur
  only in selfIntro prose (excluded from the digest) or inside longer runs →
  0 hits.
- **alias (0.00 / 0.50) — literal tokens only.** `cnc` matches on Path B via
  the literal token in f7's digest (domain-presence emission); Path A misses
  (500+ docs, rank cutoff). 机床 = 0/0: all three expected fixtures contain
  "机床" in selfIntro prose (熟悉机床操作调试…, 机床保养, 数控机床调试),
  but no digest stores a standalone 机床 token — the segmenter emits the
  compounds (数控车床, 平面磨床), and the domain-presence mechanism
  (`collectDomainPresenceTokens` on `resume.searchText`) did not fire because
  the fixture cold search text also excludes selfIntro prose. Alias recall in
  production additionally depends on BFF synonym expansion (variants beyond
  `[token]`), which the spike's Path B emulation deliberately did not
  include — measured alias recall is therefore a lower bound.
- **cap-length (0.60 / 0.00) — substrings never match; punctuation splits
  save Path A.** 20- and 32-char prefixes of the 33-char stored run1 token →
  0 hits on both paths (exact-term tantivy). The 40/64/66-char probes hit f1
  on Path A (tot = 1) because Path A's query analyzer splits the string at
  `，` and the first segment equals the stored run1 token
  `本公司主营高精密数控车床加工中心五金零件批量生产制造与工艺优化服务`
  exactly. Path B passes the whole string (comma included) as ONE index term
  → 0 for all four long probes. Long/compound query strings are effectively
  unsupported on the BFF scan path.
- **cap-terms — validated.** The 17-term query (16 real terms + `zzzzz`)
  returned 0 rows and **no error** on both paths: the upstream 16-term cap
  (`splitQueryTokens` / `MAX_SEARCH_INDEX_TERMS`) silently truncates before
  Convex would reject the expression.
- **single-char — effectively unsupported.** The BFF drops <2-char tokens
  before any Convex call (spike marks these `bff-dropped`). Path A runs them
  but they are BM25 noise (500+ hits; `模` finds f5 only at limit 500).
- **noise — no false positives.** 汽车维修 (10 real hits) touched none of the
  fixtures.

## Anomaly: `数控` and `数控 车床` miss f1 while f1 stores the tokens

Probe 0 (`数控`) expected f1 and f7; Path B scanned 1014 matching rows but
only f7 appeared; Path A returned 500 (capped) without either fixture. This is
**not** a tokenization miss: the digest dump shows f1's `searchText` starts
`cnc 数控 陈师傅 陈 师傅 中专 数控车床 数 控 车床 …` — 数控 and 车床 are
standalone stored tokens. The handoff's earlier attribution to the 66-char
run substring is disproven by the digest dump.

Plausible mechanisms, in order of fit:

1. **Posting-list tail / scan-window truncation (Path B).** The unfiltered
   scan-page pagination reads at most 1024 rows per term. For very common
   terms (数控 alone matches ~1014+ rows; `cnc` saturates the 1024 cap exactly
   in probe 27), newly inserted fixture rows sort to the tail of the term's
   posting list and fall outside the window — probe 27 shows f1 (whose digest
   also contains literal `cnc`) missing while f7 is found. Probe 18
   (`数控 车床`, 48 matching rows) missing f1 is consistent: the AND
   intersection excludes rows outside the 数控 half-window.
2. **Per-token `.take()` window (Path A).** `searchDigestRowsForTokens` caps
   each token's take at 200 rows; probe 19 (`模具 设计`) shows the same
   family: f1 contains both tokens and Path B finds it, but Path A's 200-row
   模具 window excludes f1's row.
3. **Index backfill race (probe 0 only).** Probe 0 ran immediately after the
   fixture upserts; f1's patched row may not have been reindexed yet while
   f7's insert was. Later probes against f1's tokens (数控车床 @245 rows,
   probe 6) hit f1, consistent with the index settling.

None of these is a segmentation defect, and all are effects of platform
limits interacting with a large dev DB. Follow-up: re-run the spike after the
index settles and confirm f1 appears for `数控`/`数控 车床`/`cnc`; if it does,
the anomaly is closed.

## Verdict

**No search-path code change from this spike.** The measured gaps are
tokenization-boundary behaviors with identified mechanisms:

| Gap | Root cause (measured) | Candidate fix (follow-up decision required) |
|-----|----------------------|---------------------------------------------|
| Mixed CJK-ASCII queries 0 hits | Boundary spacing applied on ingest only (`search_text.ts:241`) | Query-side script-boundary split, or store joined+split forms on ingest |
| Compound/substring queries miss | Tantivy exact-term matching; segmenter emits the run + dictionary words, not all sub-compounds | jieba pre-segmentation on ingest would add word boundaries; only worth it if substring-ish recall is a product goal |
| Alias tokens (机床) absent | selfIntro prose excluded from digest content and from `resume.searchText` domain-presence input | Include selfIntro-derived runs in digest content, or widen domain-presence source |
| Long queries with punctuation on Path B | BFF keywordGroups are whitespace-split only; comma stays inside one term | BFF-side split on punctuation (and drop <2-char), aligning Path B with Path A's analyzer |
| single-char queries | BFF drops <2-char tokens; Path A is BM25 noise | Accept as unsupported; do not build around it |

Behavior validated as correct: the 16-term cap truncates silently without
error; the 1500-char cap with seen-set dedupe collapses repeated boilerplate
(f1: 22 identical sentences → 523 chars); punctuation-split query segments
can exactly match stored run tokens (cap-length probes 33–35); noise queries
produce no fixture false positives.

## Gotchas

1. **Recall on common terms is window-bound, not tokenization-bound.** In a
   large index, fixture (or real long-tail) rows can be invisible to Path A
   (≤200 rows/token) and Path B (≤1024 rows/term). Treat a capped probe
   (`@500` = 500, or B = 1024) as "unmeasurable", not "missed".
2. **Ground truth is content-based, digests are compact-field-based.**
   selfIntro prose matches raw-content expectations but never reaches the
   index; a content hit is not a search hit by design.
3. **The spike's Path B is an emulation** (variants = `[token]`); real BFF
   synonym expansion may lift alias recall beyond the 0.50 measured here.
4. **`服务，涵盖模具设计开发`-style tokens exist in the index** (punctuation
   glued to CJK words). Queries that split at the comma can match the
   pre-comma segment; queries that keep the comma cannot.
5. Fixtures are cleaned up at the end of the spike (`remainingFixtures: 0`);
   the spike is idempotent and re-runnable.

## Re-running

Requires the local Convex backend at `127.0.0.1:3210` (dev DB). Environment
variables must be exported before `bunx tsx` runs (children do not inherit
`.env`):

```bash
set -a; source .env; set +a
bunx tsx scripts/cjk-measurement-spike.ts   # writes scripts/output/cjk-measurement-results.json
```

## Sources

- Local repo: `scripts/cjk-measurement-spike.ts`,
  `scripts/output/cjk-measurement-results.json`,
  `packages/convex/convex/search_text.ts`,
  `packages/convex/convex/lib/resume_digests.ts`,
  `packages/convex/convex/resumes_search.ts`,
  `apps/api/src/services/unified-search-service.ts`,
  `packages/convex/convex/lib/resumes_pagination.ts`
- Vault: `projects/trends/work/2026-08-18-cjk-segmentation-convex-tantivy/plan.md`
