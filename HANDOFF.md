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
| 1 | industry-verification-grouped-inbox-undo | DONE | §6.1 |
| 2 | historical-preview-backup-rehearsal | DONE | §6.2 |
| 3 | convex-search-byte-budget | DONE | commit `f4ef1318` (item1) + runbook |
| 4 | extension-mv3-cdp | DONE | commit `763be521` (item3) + F18b hazard note |
| 5 | hono-server-timing | DONE | commit `5e8c6cfa` (item2) |
| 6 | ai-scoring-evaluation-ndcg-recall | DONE | local-data demo run done |
| 7 | cjk-segmentation-convex-tantivy | DONE | commit `918cf3a5` (item7) + runbook; vault evidence pushed `5621fd8ab` |
| 8 | worker | DONE | commit `cef3f5fd` (item8) + vault closeout |
| 9 | dedup | DONE | commits `25ac7676` (#9-core) + `3ec04044` (wiring) + vault evidence |
| 10 | resume-scoring-explainability-drift | DONE | commit `3ec04044` (delta doc + evidence) |
| 11 | company-policy | DONE | commits `3ec04044`/`82d4713d` (policy overrides) + vault evidence |
| 12 | workspace-portability P2–P4 | DONE | commits `3ec04044`/`cc9a1a48`/`82d4713d`/`63cf6105` + vault evidence/log |
| 13 | my-scoring-cohort | **BLOCKED — log only** | §6.6: vault log records the block (2026-08-18) |

Branch: `preview-v0.4.23` (ahead 13, **NO-PUSH** policy; local commits only).
Vault push IS allowed via `bash /root/.grok/installed-plugins/vault-sync-ae1287d3/skills/vault-presync/wiki-sync.sh --execute`.
ALL local work committed (last: `63cf6105` mutations registry); working tree clean.

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
results JSON + `docs/runbooks/cjk-segmentation-measurement.md`), vault evidence
pushed `5621fd8ab` (log + completed status; earlier item-closeout pushes at
`da3ba3a26` and prior). Key findings preserved in the runbook:
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

## 5. Repo state (final, 2026-08-18)

- Working tree CLEAN; all 13 local commits present (see §1 commit refs; last
  `63cf6105` mutations registry). Branch ahead of origin by 13 — NO-PUSH.
- All session artifacts committed as evidence: `scripts/output/cjk-measurement-results.json`,
  spike script, runbooks, api-types regen, route-auth entries, mutations registry.
- `make ci-local` GREEN (exit 0, all gates incl. check-mutation-entry-points).

## 6. Remaining items — concrete steps

### 6.1 Item #1 industry-verification-grouped-inbox-undo — DONE
Closeout completed 2026-08-18 (owner sign-off granted):
(a) error-injection matrix — 3 new tests: service propagates non-stale undo
mutation failures unchanged with no recompute traffic; route returns 500 with
no success/reversal envelope; web 409 blocks same-row undo (conflict message,
no Retry, Undo disabled, session approval retained) and web 500 fails cleanly
with Retry recovery + pending cleared. API 66/66, web 36/36 green. Stale-409
translation was already covered by pre-existing tests.
(b) screen-reader color audit — no color-only signaling: every colored surface
(status icon, progress bars, amber borders, error box) carries text/aria/
placeholder counterparts; contrast ≥4.5:1 text, icons ≥3:1 graphical; app is
light-theme only.
(d) vault work item → completed (log/plan/spec/index updated; commit pushed).
Code itself was implemented + browser-UAT'd (commit `bd142b2e` + `72bdabff`
hardening; undo-500 fix in `company-industry-proposal-service.ts`); closeout
tests (error matrix) committed in `3ec04044` (mixed Commit 2).

### 6.2 Item #2 historical-preview-backup-rehearsal — DONE
Code committed (workspace backup + snapshot routes). Rehearsal-log decision
recorded 2026-08-18: **NO host run** (no prod/preview data restore rehearsal
on this host). `rehearsal-log.md` written (dry-run evidence: 71/71 safety
tests, backup manifest-verified on `ptcloud`, controller checkout not ready)
+ status completed for the claimed scope; live run stays an owner-authorized
on-host follow-up.

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

### 6.4 Item #9 dedup — DONE (2026-08-18)
Implemented inline + verified: capture-time contact-signal normalization
(`lib/resume_identity.ts`: email/phone/linkedin normalizers +
`deriveResumeContactSignals`/`deriveResumeBlockKeys`), blocking
(`phone:<first7>|<source>` + `email:<domain>|<source>` → new
`resume_dedup_blocks` table, maintained by `maintainResumeDedupBlocks` from
`submitResumes`), advisory `suggestMergeCandidates` query with
`scoreMergePair` fingerprint (exact PII +2, name +1.5, company tokens +1,
timeline +0.75, schools +0.5), admin review page
`/admin/system/settings/resume-dedup` (lazy route, nav item, i18n
en/zh-Hans/zh-Hant). **NO auto-merge, NO identityKey mutation.** Verification:
2196/2196 convex tests (17 new), 648/648 shared, dedup page 4/4,
system-settings 235/235, tsc exit 0, i18n sync exit 0. Suggestion list is
empty against the current PII-free corpus by design. Vault closeout done
(spec/plan/log/index). Commits: `25ac7676` (#9-core files), `3ec04044`
(mixed wiring + items 10–12 pile).

### 6.5 Item #10 resume-scoring-explainability-drift — DONE
b5 done (convex + web). Delta doc verified: `docs/design-patterns/scoring-explanation-signals.md`
Status section + runbook `docs/runbooks/rerank-gap-analysis.md` +
`scripts/compute-scoring-metrics.ts` (SQLite path) + cohort evaluator
`scripts/evaluate-hr-cohort-ranking.ts`. Evidence.md written (verify+document
only; deep-research candidates 1/3/4 unimplemented by design). Commits:
`3ec04044`. Vault evidence pushed `5621fd8ab`.

### 6.6 Item #13 my-scoring-cohort — BLOCKED (log only)
BLOCKED: needs HR-rated MY (Malaysia) resumes. Block recorded in vault
log.md 2026-08-18 (no implementation, no spec/plan flips; `automation_ready:
false` retained). Unblock = MY HR/product reviewer provides a scored cohort.

## 7. Final gates — ALL PASSED (2026-08-18)

1. `make ci-local` GREEN (exit 0: node-major + i18n + agent policy + check-build
   + test-coverage + check-route-auth + check-node + check-mutation-entry-points;
   registry fix committed `63cf6105`)
2. `make check-agent-policy` — passed within ci-local chain (AGENTS.md untouched)
3. Vault: lint-delta 0 (`skillwiki lint`: 80 errors = known baseline, 0 new),
   `work-validate --require-complete` valid on all 12 completed items, #13 valid
   in default mode (9 human-gated boxes open by design), pushed `5621fd8ab`
   (presync gate: behind=0 ahead=0 dirty=19 → lint delta new=0, no collisions)
4. All local work committed (NO-PUSH, ahead 13)
5. REMAINING: claims audit summary to user (DONE/BLOCKED/excluded per item)

## 8. Session references

- Vault: `/root/wiki/projects/trends/` (index: `projects/trends/index.md`)
- Repo policy: `AGENTS.md`, `docs/agent-runbook.md`, `CLAUDE.md` (repo root)
- AI model policy: `docs/runbooks/llm-api-provider-fallback.md` + CPA ops
  `docs/runbooks/ptcloud-cpa.md`; default `openai/deepseek-v4-flash` via CPA
  (`https://cpa.pt-mes.com/v1` local, `http://127.0.0.1:8317/v1` on ptcloud);
  fallback `openai/deepseek-v4-flash-e`

## 9. CPA official layout on ptcloud (2026-08-28)

Migrated live CPA to the **official installer layout** so this is the whole
upgrade:

```bash
ssh ptcloud
cliproxyapi-installer upgrade
```

- Tree: `/home/ubuntu/cliproxyapi` (ubuntu user systemd, linger=yes)
- Installer: `/home/ubuntu/cliproxyapi-installer` → `/usr/local/bin/cliproxyapi-installer`
  (official bytes, sha256 `8e440762…`)
- Version **7.2.144**. System unit **removed** (dual-bind hazard). Root tree
  snapshotted at `/root/cliproxyapi.bak-pre-official-home-20260828T073247Z`.
- Trends BFF still `AI_API_BASE=http://127.0.0.1:8317/v1`. `:8317` HTTP 200.
- Host runbook: `/home/ubuntu/cliproxyapi/UPGRADE-RUNBOOK.md`
- **Forbidden:** recreate `/etc/systemd/system/cliproxyapi.service`; run the
  installer as root; disable linger for ubuntu.

Vault: `projects/trends/work/2026-08-28-cpa-official-upgrade-helper/`.

## 10. chrome-debug loadUnpacked unattended extension install (2026-08-29, macos-dev)

Collect extension install is now **fully unattended** on the live collect
Chrome. Human picker gate resolved without the picker (spec human_gate: RESOLVED).

- **Contract:** branded Chrome 137+ removed `--load-extension`; the official
  unattended path is CDP `Extensions.loadUnpacked` (or WebDriver BiDi). Chrome
  152.0.7977.64 accepts it over the plain TCP debug port when launched with
  `--enable-unsafe-extension-debugging`.
- **Release state:** the original one-line patch was promoted to authoritative
  `karlorz/agent-skills` source and released as `playwright-cli-1.3.3` with
  launcher contract v3, tests, and documentation. The managed user launcher at
  `~/.local/share/playwright-cli/chrome-debug.sh` now carries the released flag;
  the old cached 1.3.2 edit is historical only.
- **Live state:** collect Chrome on :9222 (profile clone
  `chrome-debug-profile-from-default`, Seek cookies preserved) has 智通直聘
  Resume Collector **v1.3.7** loaded from
  `/Users/karlchow/Desktop/code/trends-ext-load-unpacked/apps/browser-extension`
  (`id pafaiemddagkegcjcaihcomblnpjfmkf`, service worker running).
- **Re-install rule:** persists across restarts; only a `--refresh-from-default`
  profile re-sync wipes it — one CDP call re-installs.
- **Collection follow-up:** completed; see §11 for the TH/MY results, private
  artifacts, safety evidence, and recommended next work.

Vault: `projects/trends/work/2026-08-29-chrome-debug-loadunpacked-unattended-install/`
(evidence `evidence.md`) + `queries/2026-08-29-chrome-unpacked-launch-unattended-install.md`
+ `concepts/chrome-unpacked-extension-install-contract.md` + experiment log
`raw/transcripts/2026-08-29-note-cdp-loadunpacked-experiments.md`.
No ingest. Prod off. #1365 hold-merge.

## 11. MY/TH CNC Service Engineer collection (2026-08-29, macos-dev)

The first bounded MY/TH collection is **complete**. It used the existing branded
Chrome 152 collect profile on TCP CDP `:9222`; Chrome was not relaunched and the
PR #1367 pipe helper was not used.

- **Employer session:** authenticated SEEK Talent Search for Pro-Technic
  Machinery Ltd on `hk.employer.seek.com`.
- **Extension:** 智通直聘 Resume Collector **v1.3.7**, id
  `pafaiemddagkegcjcaihcomblnpjfmkf`, loaded from
  `/Users/karlchow/Desktop/code/trends-ext-load-unpacked/apps/browser-extension`.
  The runtime payload is byte-identical to the extension in the #1366 worktree.
- **Query gate passed for both markets:** `SearchProfilesByNaturalLanguage`,
  `searchQuery=CNC`, keyword `CNC`, `matchAll=false`, `matchLatestOnly=false`,
  and exactly `Services Engineer`, `Service Technician`, `Service Manager`,
  `Service Coordinator`, `Service Supervisor`.
- **Thailand:** displayed pool **616**; captured 50 profiles over 3 pages; 50
  unique stable identities.
- **Malaysia:** displayed pool **2,076**; captured 50 rows over 3 pages. Two
  repeated stable identities were removed offline, retaining the richer row;
  final artifact has **48 unique profiles**. Deduplication audit metadata stores
  the original row count and original SHA-256.
- **Private artifacts** (candidate data; never commit or publish):
  - `/Users/karlchow/Downloads/trends-collect-2026-08-29/seek-thailand-cnc-service-engineer-2026-08-29.json`
    — SHA-256 `58ff46c9de2842676353079c5116f4ab8f53fa38571dbc06df181ed381623381`
  - `/Users/karlchow/Downloads/trends-collect-2026-08-29/seek-malaysia-cnc-service-engineer-2026-08-29.json`
    — SHA-256 `5e1d1f82571a6871a4fd30faafaf8b59c723d57f5d56fa6f74435d77f968d9ff`
  - Directory mode `0700`; file modes `0600`.
- **Safety evidence:** `tr_auto_sync` stayed `skipped`; monitored requests to
  `trends.pt-mes.com`, `preview.pt-mes.com`, `localhost`, and `127.0.0.1` were
  zero; no rate-limit or network/server errors; **no ingest and no production
  writes**.
- **Browser state:** Chrome remains running on `:9222`; the MY Talent Search tab
  is open on page 3 with the required role-title context preserved.
- **PR state after collection:** #1365 open @ `bc736fbb` (hold-merge); #1366
  open @ `de02f68d` (checks green); #1367 open @ `a7a2b937` (`verify` red from
  project-skill mirror drift, unrelated to collection).
- **Repository state:** `trends-my-th-service-eng` remains clean. Root `main`
  retains its pre-existing CPA/docs changes; do not mix them with collection
  work. #1367 helper-worktree scratch files remain untouched.

### Recommended next work

1. **Private quality review first:** review the 50 TH and 48 MY unique profiles
   for CNC/service-role relevance, usable work-history descriptions, location,
   and brand signals. Produce aggregate findings only; keep candidate data out
   of git and SkillWiki.
2. **Use the review to decide TH query width:** retain the current five-title
   stack if quality is acceptable. If yield is too thin, test Maintenance
   Engineer and Application Engineer in a separate change; do not add broad
   Mechanical/Electrical Engineer or sales titles.
3. **Keep ingest gated:** do not ingest until the owner explicitly chooses the
   target environment/workspace and resolves the #1365 hold. Production stays
   off.
4. **PR decisions remain human-owned:** #1366 can be merged when the owner wants
   the profile definitions shipped. Repair or supersede #1367 separately; its
   pipe helper is not the daily collect path. The authoritative unattended TCP
   launcher fix has shipped in `playwright-cli-1.3.3`.
5. After private quality review and owner decisions, update
   `projects/trends/work/2026-08-28-my-th-cnc-service-engineer-profiles/` through
   SkillWiki. Keep it in progress until collection review and the merge/ingest
   decision are recorded.
