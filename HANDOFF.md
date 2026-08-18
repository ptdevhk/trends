# HANDOFF — Trends dev-loop high (resume work items) — 2026-08-18

> Purpose: let a fresh session resume without losing state to context truncation.
> Read this file FIRST. Prior session transcripts (full verbatim) live at
> `/root/.grok/sessions/%2Froot%2Fworkspace/01a01235-911f-71e2-97eb-c5e2d8220207/`
> (`compaction/INDEX.md` = TOC; `compaction/segment_*.md` = per-segment rollouts).
> Do NOT modify anything under that session dir.

## 0. Mission (authoritative, carried verbatim)

**"run /dev-loop high until all wiki and docs stable"** — attended dev-loop at
INTENSITY=high until the trends vault (`/root/wiki/projects/trends/`) + repo docs
hold a finding-free state. User directive (carried): brainstorming is DONE (vault
specs/plans exist per item); implement ALL claimed work items **EXCLUDING
`2026-06-18-prod-unpin-auth-readiness`** — that one requires authorized prod
cutover + HR disposition of 19 prod-only rows; **NEVER touch it** (do not claim,
edit, or commit anything for it).

## 1. Board state (13 claimed items, prod-unpin excluded)

| # | Item | Status | Evidence / next step |
|---|------|--------|----------------------|
| 1 | industry-verification-grouped-inbox-undo | **Closeout remains** | §6.1 |
| 2 | historical-preview-backup-rehearsal | Committed; **rehearsal log pending in vault** | §6.2 |
| 3 | convex-search-byte-budget | DONE | commit `f4ef1318` (item1) + runbook |
| 4 | extension-mv3-cdp | DONE | commit `763be521` (item3) + F18b hazard note |
| 5 | hono-server-timing | DONE | commit `5e8c6cfa` (item2) |
| 6 | ai-scoring-evaluation-ndcg-recall | DONE | local-data demo run done |
| 7 | cjk-segmentation-convex-tantivy | DONE | commit `918cf3a5` (item7) + runbook + vault closeout `da3ba3a26` |
| 8 | worker | DONE | commit `cef3f5fd` (item8) + vault closeout (2026-08-18) |
| 9 | dedup | PENDING | §6.4 |
| 10 | resume-scoring-explainability-drift | b5 done; **delta doc pending** | §6.5 |
| 11 | company-policy | DONE | 3 items all implemented |
| 12 | workspace-portability P2–P4 | DONE | incl. vault closeout |
| 13 | my-scoring-cohort | **BLOCKED — log only** | needs HR-rated MY resumes |

Branch: `preview-v0.4.23` (ahead 5, **NO-PUSH** policy; local commits only).
Vault push IS allowed via `bash /root/.grok/installed-plugins/vault-sync-ae1287d3/skills/vault-presync/wiki-sync.sh --execute`.

## 2. Environment & conventions

- Dev servers RUNNING (verify before resuming): Convex local `http://127.0.0.1:3210`,
  BFF `:3000`, web Vite `:5173`, worker python `:8000`.
- Scripts must live under repo root (tsx module resolution fails from /tmp);
  env first: `set -a; source .env; set +a` (bun/tsx children do NOT inherit .env vars).
- Direct Convex access: `new ConvexHttpClient("http://127.0.0.1:3210")` + `api` from
  `packages/convex/convex/_generated/api.js`. Dev DB has 1000+ resume_digest rows.
- **Subagent policy: ALL subagent spawns fail with gateway errors**
  (`reasoning_content must be passed back` HTTP 400). Implement everything
  INLINE on the main agent; parent owns edits + verification. Do not retry spawns.
- Browser verification: no browser MCP available in this session; verify via
  tests/curl/scripts and say what could not be verified.
- Convex local backend heap grows ~1 GB per UAT pass; at <4 GB free, restart via
  `scripts/dev.sh --convex-only --no-seed`. Kill by port-derived PID, never
  `pkill -f "convex dev --local"`.
- CI conventions that must not be reintroduced: React 19 pinned at repo root
  (never remove root pin, never let package-lock.json drift); react-i18next test
  mocks must return module-scope `t`; keep `t` in useCallback deps. Before push:
  `make ci-local`.

## 3. CJK #7 — DONE (closed 2026-08-18)

Spike + report + vault closeout complete: commit `918cf3a5` (spike script +
results JSON + `docs/runbooks/cjk-segmentation-measurement.md`), vault pushed
`da3ba3a26` (log + completed status). Key findings preserved in the runbook:
measured recall per class (A/B), substring-vs-exact-term tantivy behavior,
cap behavior (16-term BFF cap, dedupe-at-1500 quirk), **no search-path code
change**; candidate fixes (query-side segmentation/ngram) recorded for
follow-up. Historical detail (for reference only) below.

**Vault work item:** `/root/wiki/projects/trends/work/2026-08-18-cjk-segmentation-convex-tantivy/`
(`plan.md` + `spec.md` exist; **log.md missing, status not completed**).

**Acceptance (plan.md):** spike script + corpus committed under `scripts/`;
report `docs/runbooks/cjk-segmentation-measurement.md` with measured recall +
cap behavior + verdict per query class; NO search-path code change without
evidence; vault status completed.

**Spike script (complete, 500 lines):** `scripts/cjk-measurement-spike.ts` —
7 fixtures f1–f7 (CN profiles), 39 queries in 9 classes, ground truth = raw
content contains every whitespace-split token, both shipped paths probed:
- Path A `resumes_search.search` (web quick search; single-string = OR-any-term,
  NO post-filter; multi-token = AND + matchesAllTokens)
- Path B `searchWithTagExpansionScanPage` (BFF tag-expansion scan; per-token
  keywordGroups, variants=[token], AND mode, `<2-char` tokens dropped by BFF
  emulation; scan-page pagination cursor loop; `item.resume` has no searchText —
  read it from digest dump `scanResumeDigestPage` keyed by `String(row.resumeId)`)

**JUST RAN (2026-08-18 11:12 UTC, exit 0, cleanup verified 0 remaining):**
results at `scripts/output/cjk-measurement-results.json` (full per-probe detail).
Class-level mean recall:

| Class | probes | Path A (search) | Path B (scan) |
|-------|--------|-----------------|---------------|
| single | 6 | 0.83 | 0.92 |
| compound | 7 | 0.79 | 0.79 |
| cjk-ascii | 5 | 0.40 | 0.40 |
| multi | 6 | 0.58 | 0.83 |
| long-compound | 3 | 0.33 | 0.33 |
| alias | 4 | 0.00 | 0.50 |
| cap-length | 5 | 0.60 | 0.00 |
| cap-terms | 1 | null (no expected) | null (no expected) |
| single-char | 2 | 0.25 | null (bff-dropped) |
| noise | 1 | null (no expected) | null (no expected) |

Key misses to explain in report (all in results JSON):
- `数控` → f1 MISSED on both paths (f7 hit): 数控 IS in f1's searchText, but
  f1's stored run1 token is the 66-char maximal run `本公司主营高精密数控车床...`;
  tantivy exact-term match fails for the substring; Path B's index query also
  fails (non-exact term → no pages) so the in-memory AND post-filter never runs.
  Same root cause for `冲压模具`, `五金冲压模具设计`, `UG编程`, `CNC编程/操机`,
  `机床` (f1/f4/f7 all missed), `数控 车床` (Path A), cap-length 20/32-char probes.
- `数控车床` hits f1 on both paths — 2-char→ run1 substring? NO: 数控车床 is a
  stored Segmenter word (f1's run1 words include `数控`/`车床`... verify in JSON).
  Actually measured: it hits. Stored word boundary makes it exact-match.
- cap-length: 20/32-char probes MISS (substring of stored run1 token, no exact
  term); 40-char probe (reaches `服务，涵盖模具设计`) HITS f1 via exact run1
  token + punctuation-split; 64/full = same. Path B scan = 0 for ALL cap probes
  (index query term non-exact → zero pages → post-filter never sees f1).
- cap-terms: 16-term AND + 17th `zzzzz` — A and B both return nothing because
  A splits multi-token and requires ALL 17 (17th never matches); this validates
  the 16-term splitQueryTokens cap exists upstream (BFF `resume_helpers.ts:89-107`).
- alias `cnc` → f7 hit on Path B only (f7 searchText contains literal `cnc` in
  skills; Path A single-string OR search with non-exact term fails — tantivy
  lowercases but `CNC编程` merged-token means no exact `cnc` term).
- single-char: BFF drops <2-char tokens entirely (`bff-dropped`); Path A only
  `模` → f5 at limit 500 (BM25 cutoff), `车` never.

**Digest samples (from JSON):** f1 searchTextLength=523 (CAP_FILLER deduped by
`limitSearchText` seen-set — 22 identical sentences collapse; dedupe means NO
tail-drop demonstration at 1500), f2=95, f3=115, f4=100, f5=94, f6=100, f7=93.

**Tokenization model (established, for the report):**
- `packages/convex/convex/lib/search_text.ts` `segmentChineseRuns` (~line 51):
  regex `/[\u4e00-\u9fff\u3400-\u4dbf]{3,}/g` matches maximal >=3-char CJK runs
  BROKEN by any non-CJK char (incl. ，、。); per run emits `[run]` + Intl.Segmenter
  zh-CN words, deduped, space-joined. QUIRK: punctuation stays in place between
  replacements → stored whitespace tokens MERGE punctuation with adjacent words
  (e.g. token `服务，涵盖模具设计` contains ，).
- `PRIORITY_KEYS` order = [name, desiredPosition, education, expectedSalary,
  skills, workHistory, companies, summary, locationHierarchy]; FIELD_BOOST
  skills:2, desiredPosition:2.
- `limitSearchText` (`resume_digests.ts:222`, unexported): whitespace tokenize,
  seen-set dedupe, priorityTokens (domain: cnc/数控/销售/sales/机床) first,
  hard-stop at MAX_DIGEST_SEARCH_TEXT_LENGTH=1500 (`resume_digests.ts:33`),
  overflow drops whole tail.
- `compactFragment` slices fragments at MAX_DIGEST_FRAGMENT_LENGTH=160;
  digest build: `buildResumeDigest` → `buildCompactDigestSearchText` (~line 107)
  → compactContent whitelist (name, desiredPosition, education, expectedSalary,
  skills 20, companies 20, locationHierarchy, workHistory 3).
- `addScriptBoundarySpaces` inserts spaces only at CJK↔ASCII boundaries.

## 4. CJK #7 — next steps (DONE — see §3 for closeout summary)

Original steps (all completed 2026-08-18):

1. Write `docs/runbooks/cjk-segmentation-measurement.md`: purpose, method
   (fixture corpus + ground-truth rule + both paths), measured recall table
   (use §3 table + `scripts/output/cjk-measurement-results.json`), cap behavior
   (dedupe-at-1500 quirk + substring-vs-exact-term finding + 16-term BFF cap),
   verdict PER QUERY CLASS (single: good; compound: good when stored word
   boundary exists, misses unsegmented substrings; cjk-ascii mix: poor — merged
   tokens; multi: Path B better than A; long-compound: poor; alias: Path B
   partial via literal tokens, no synonym expansion in path B emulation (real
   BFF has synonym variants — note as limitation); cap-length: substring probes
   fail, exact run token works; single-char: BFF-dropped; noise: no false
   positives), then recommendation: **no search-path code change** (evidence
   shows tokenization boundary issue, not missing index; candidate fixes are
   query-side segmentation/ngram — OUT of scope for #7).
2. Vault closeout: add `log.md` to work item (summary + results + verdict),
   set frontmatter `status: completed`, update `projects/trends/index.md` +
   CLAUDE.md completed-items line if convention demands.
3. Commit locally (NO-PUSH): spike script + results JSON + report + vault log.

## 5. Repo state at handoff

- `git status` (uncommitted, pre-existing): apps/api + apps/web + packages/convex
  + packages/shared + packages/cli + deploy + scripts modified; many new files
  (workspace-snapshots, candidate-policy-overrides, workspace_backup.go,
  SystemSettingsWorkspacePage, t3/t6/t12 scripts, ws-*.yaml dumps, etc.) — all
  belong to items #10/#11/#12 already implemented; DO NOT stash or revert.
- Recent local commits (NO-PUSH): `763be521` item3, `5e8c6cfa` item2,
  `f4ef1318` item1, `bd142b2e` fix undo reversal revision, `1ea67a0d` trends-cli
  docs, `bdd58d63` deepseek-v4-flash-e default (Poe gateway; `deepseek-v4-flash`
  has known `response_format` bug — stays FALLBACK, do not promote).
- Untracked dir `.claude/dev-loop/` and `scripts/output/` are session artifacts;
  `scripts/output/` now holds the CJK results JSON (commit it — it's evidence).

## 6. Remaining items — concrete steps

### 6.1 Item #1 industry-verification-grouped-inbox-undo — closeout
Remaining: (a) error-injection matrix (verify undo path fails cleanly when the
undo mutation throws / resume already deleted — via script or unit test),
(b) screen-reader color audit (review new UI colors for contrast/not-color-only
signaling in `apps/web` verification components), (c) owner sign-off (ask user),
(d) vault work item → completed. Code itself was implemented + browser-UAT'd
(commit `bd142b2e` + `72bdabff` hardening); verify current dev tree still passes
`apps/web` tests: `cd apps/web && bunx vitest run --reporter=dot` (or the
package's test script).

### 6.2 Item #2 historical-preview-backup-rehearsal
Code committed (workspace backup + snapshot routes). Decision made: NO host run
(no prod/preview data restore rehearsal on this host). Vault work item needs a
rehearsal-log.md documenting the dry-run/what-was-decided + status completed.

### 6.3 Item #8 worker — DONE (2026-08-18)
Implemented inline + verified: dispatch envelope parsing (queued:false/maintenance
→ skipped, real taskId logged), per-profile crawl progress persisted atomically
(`apps/worker/crawl_progress.py` → `output/worker/crawl-progress.json`,
keyed by profile id, `dispatchedAt` preserved on reuse), retry polls
`resume_tasks:getById` before re-dispatch (outcomes reused/queued/
skipped_maintenance/error). Graceful shutdown pre-existed (`shutdown(wait=True)`
drain); `arq` queue swap NOT applicable (recorded). Verification: 409 pytest
pass + live Convex roundtrip (task `jn7f3asm1szrfvpecnn3rtv3158cq01n`,
cancelled after smoke). Vault closeout done (spec/plan/log/index), vault pushed.
Commit: `cef3f5fd`.

### 6.4 Item #9 dedup
Scope: capture-time identity normalization + blocking + fingerprint suggestion
(NO auto-merge). Inspect `packages/convex/convex/company_resume_links.ts`,
`resumes_mutations.ts` submitResumes dedup fields (`deduped`,
`identityDeduped`, `identityMatched` — seen in spike submit output).
Implement normalization + blocking + fingerprint suggestion, tests.

### 6.5 Item #10 resume-scoring-explainability-drift
b5 done (convex + web). Remaining: delta doc — `docs/design-patterns/scoring-explanation-signals.md`
exists (untracked); write/verify the delta runbook documenting before/after
scoring explanation signals. Check `scripts/compute-scoring-metrics.ts` usage.

### 6.6 Item #13 my-scoring-cohort
BLOCKED: needs HR-rated MY (Malaysia) resumes. Log only — record the block in
vault log.md, do not implement.

## 7. Final gates (after all items)

1. `make ci-local` (node-major check + i18n + agent policy + check-build + test-coverage)
2. `make check-agent-policy` / `make sync-agent-policy` if AGENTS.md touched
3. Vault: lint-delta 0 (`skillwiki lint`), `work-validate` all work items,
   push via vault-presync wiki-sync script
4. Commit all local work (NO-PUSH), summarize to user with claims audit
   (which items DONE / BLOCKED / excluded)

## 8. Session references

- Vault: `/root/wiki/projects/trends/` (index: `projects/trends/index.md`)
- Repo policy: `AGENTS.md`, `docs/agent-runbook.md`, `CLAUDE.md` (repo root)
- AI model policy: `docs/runbooks/llm-api-provider-fallback.md`; default
  `openai/deepseek-v4-flash-e` (Poe `AI_API_BASE=https://api.poe.com/v1`)
