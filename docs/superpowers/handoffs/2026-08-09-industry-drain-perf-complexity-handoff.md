# Handoff: Industry evidence drain findings + performance & complexity plan

**To:** Next session (Grok / Codex)
**From:** Grok session — industry backlog drain rounds 1–4 + full inspection
**Date:** 2026-08-09
**Repo:** `/Users/karlchow/Desktop/code/trends`
**Branch:** `preview-v0.4.23` — tip `3ebc673a`, tag `v0.4.23` (retagged, pushed)
**Prod:** pinned at `64fa1dfb` — **do not touch** (`/opt/trends`)
**Preview host:** `ptcloud` (root@217.217.255.28), app at `/home/ubuntu/trends-preview` (rsync target, NOT a git repo)
**Companion artifact:** `docs/superpowers/handoffs/2026-08-09-industry-drain-decisions.jsonl` (30 audit entries, rounds 1–4)

Related wiki work items: `projects/trends/work/2026-08-08-apply-session-findings-fixes/`, `projects/trends/work/2026-08-07-two-lane-auto-verify-workflow/`, `projects/trends/work/2026-08-03-targeted-industry-evidence-research-queue/`.

---

## Mission (one sentence)

Take the industry-evidence drain from **manual agent-per-round** to **product-supported**: ship the bulk approve/reject workflow for unknown employers (the original product ask, still undelivered), and execute the performance/complexity plan below so open proposals stop accumulating (9,675 "new", only 81 with sources).

## TL;DR state (preview, verified 2026-08-09)

| Metric | Value | Meaning |
|---|---|---|
| openTotal | 9,776 | proposals in flight |
| openWithSources | 81 | evidence researched ✅ pipeline works |
| openWithoutSources | 9,695 | **the bottleneck** — no sources fetched yet |
| ready_for_review | 16 | awaiting human/agent decision (all 16 decided in audit, none actionable without override) |
| approved / rejected | 5 / 25 | drain cumulative |
| new | 9,675 | untouched backlog |
| resumes withVerifiedEvidence | **0** / 8,958 | end-goal metric — resume coverage still 0 |
| emptyEvidenceBottleneck | true | coverage endpoint's own verdict: evidence, not governance |
| Convex local backend | ~10.5k ops/query budget, 1s query ceiling | hardcoded, no knobs (verified in knobs.rs) |
| Worker | systemd `trends-preview-worker-api` active, 0 errors | `INDUSTRY_PROPOSAL_LIMIT=50` in `.env.preview` |

Services all green; coverage endpoint HTTP 200; prod untouched.

---

## What shipped this session (all on preview-v0.4.23)

Ordered oldest → newest (relative to previous handoff):

| Commit | Change |
|---|---|
| `1acd2c19` | worker: extract legal-name identity candidates from full page text |
| `b7c21ab3` | worker: capture JSON-LD org names + alternateName; hold `needs_more_evidence` on no-churn re-research |
| `38d5ffca` | api: budget-safe industry coverage query; paginate proposal list (no 500 cap) |
| `d9f09bd8` | api: leave maintenance runs for worker-side completion on dispatch timeout |
| `0dd416f4` | deploy: systemd unit in repo, convex compose knobs, upgrade/doctor worker handling |
| `2c3d5354` | convex: coverage query — one sources scan instead of per-proposal probes |
| `6fde4f66` | convex: unblock Checks (Query.count type shim + api-types regen) |
| `85960eb1` | web: code-review findings (deps, watchdog/setup docs, node-version-file) |
| `d6949bc5` | worker: copyright-line legal names, AB/Berhad/LLC suffixes, best-match candidates, guarded fetcher with URL-sibling fallback |
| `3ebc673a` | api: failed junk sources no longer hard-block approvals; **split coverage query under op budget** |

Test suites green at close: API 3,181 / Convex 2,130 / Worker 311.

---

## New findings (learned live this session)

### Governance behavior
1. **Six non-overridable hard-block flags** in `company-industry-review-service.ts` (`canonical_mapping_missing`, `source_conflict`, `only_discovery_sources`, `weak_industry_signal`, `cnc_claim_inferred`, `stale_or_failed_source`). Every observed case had `canApproveWithRiskOverride: false` — **no override path exists in practice**, so any flagged proposal is permanently held until a human acts in the UI.
2. **Real-but-non-industrial companies stall forever**: Watsons, Lovisa, The Store (Malaysia), Ascendzone Communication, Alfa Laval, Body Glove, Homecity — all legitimate employers, none industrial, all blocked by `weak_industry_signal` + `canonical_mapping_missing`. They are **not noise** (reject would corrupt the data) and **cannot be approved** → permanent hold. There is no "classify as non_industry" resolution lane.
3. **`stale_or_failed_source` was a false-positive generator**: search-result junk sources (failed fetch, `sourceState=unavailable`) hard-blocked approval. Fixed in `3ebc673a` — approvalSafeCandidate gate now applies (normalized URL + non-search-result + non-discovery trust). This unblocked United Marking Technology and Seiko/Gin Seiko approvals (round 3).
4. **Flag sets evolve as sources change**: The Store was held round 1 on `source_conflict`; by round 4 its flags recomputed to only `weak_industry_signal`. Re-scanning the queue is cheap and sometimes changes the verdict.
5. **Reject vs hold semantics** (learned by doing): reject = noise/garbage (25 rejected); hold = real but ambiguous/unclassifiable (18 held). Holds wait for human UI review — which currently happens only when an agent drives the session.

### Extraction quality
6. **Copyright-line legal names now captured**: "The Store (Malaysia) Sdn. Bhd." extracted from `© 2024 The Store (Malaysia) Sdn. Bhd.` footer (copyright path skips page-chrome trimming). Suffix set extended (SDN BHD, PTE/PTY LTD, BERHAD, GMBH, AB/AS/AG/BV/NV/KK/SA with case guard for short suffixes).
7. **Junk candidates still get created**: "CNC MACHINIST CAREERS - GMI CORP" (conf 0.88) is a page **title**, not a legal name — the candidate table accepts it. **No candidate-quality gate at creation time** (legal-suffix check exists in extraction, not enforced on candidate persistence).
8. **Ambiguous short names need entity disambiguation**: "GMI" in one resume maps to 3 real distinct companies (German-Malaysian Institute gmi.edu.my / GMI Corp gmicorp.com / Global Medical Instrumentation gmi-inc.com). The drain correctly held it unmapped rather than guessing.

### Scale limits (hard evidence)
9. **Convex local backend is the ceiling**: per-query system-op budget empirically ~10.5k (10,407 OK / 11,031 fail) and a 1s query execution ceiling. Both hardcoded, no knobs (verified against knobs.rs). The coverage query hit it twice: first with per-proposal probes (regressed when sources grew 545→~1,050), then fixed by splitting into `getIndustryCoverageSummary` + `countIndustryOpenProposalSources` (service merges + recomputes).
10. **Sweep throughput is the chokepoint**: `INDUSTRY_PROPOSAL_LIMIT=50` per maintenance run; each run is network-bound (evidence fetch with retries). At ~50 proposals/run and 9,675 waiting, full drain = ~194 runs. Runs are triggered one-at-a-time via `POST /api/industry-data/trigger` (coalesced).
11. **Proposal status distribution is unhealthy**: 9,699/9,806 rows stuck in `new` with zero sources; only 81 open proposals have sources. `needs_more_evidence` (85) is the second bucket.
12. **Audit trail is agent-side and ephemeral**: decisions live in `/tmp/grill-snapshot/resume/decisions.jsonl` on the host (copied to this repo as companion artifact). Product records `auditId` in API responses but has no audit UI.

---

## Performance plan (prioritized)

### P0 — Evidence throughput (the real bottleneck, 9,695 proposals without sources)
1. **Raise/parameterize sweep batch**: `INDUSTRY_PROPOSAL_LIMIT` 50 → 200+ with concurrency-aware batching in the worker; measure run duration before/after (runs currently minutes each, network-bound).
2. **Parallelize evidence fetch inside the worker**: fetch sources for multiple proposals concurrently (thread/asyncio pool), respecting per-domain rate limits and the 1s/op-budget constraints on the Convex side (batch status updates, don't per-proposal mutate). *Mid-run observation (200/run sweep, 2026-08-09): ~34s/proposal with zero proposal-level parallelism — dominated by 30s HTTP timeouts to unreachable hosts (duckduckgo `198.252.206.x`, dead sites on `185.124.160.3`/adtrak) during discovery fetches. Parallelism without per-host fail-fast/timeout-shortening would multiply the same wasted time; fix both together (provider-level circuit breaker, connect-timeout < 10s, per-proposal budget).*
3. **Source/evidence dedup across proposals**: the same employer surfaces recur across resumes (SMC, GMI, The Store…). Cache evidence fetch results by normalized URL/domain; reuse candidate extractions across proposals instead of re-fetching.
4. **Order sweeps by resume impact**: research proposals whose employer appears in the most resumes first — raises `resumes withVerifiedEvidence` fastest (currently 0/8,958).
5. **Batch the CN hotlist API**: `RESEARCH_HOTLIST_API_URL` (NewsNow-compatible, CN default market) — query hotlist once per sweep and match surfaces in-batch rather than per-proposal web discovery.

### P1 — Convex budget discipline
6. **Document the ~10.5k ops / 1s limits in dev-docs** (they cost a 500-incident and a regression this session).
7. **Audit other queries for per-row `first()` probes** (the pattern that blew the budget): `listIndustryProposals`, `countIndustryOpenProposalSources`, coverage path are known-good now; check any remaining `withIndex(...).first()` in loops.
8. **Precompute counters at maintenance time**: nightly counter table for coverage numbers (openTotal 9,776 etc.) instead of live count queries — turns 2 queries + service-side merge into 1 doc read.

### P2 — Data hygiene
9. **Archive/supersede policy for rejected + superseded proposals** (25 rejected) so the proposals table stops growing unboundedly.
10. **Prune junk identity candidates** (page-title extractions) and add the quality gate at creation (C4).

---

## Complexity-reduction plan (prioritized)

### C1 — Ship the bulk approve/reject workflow (original product ask, still open)
The session-opening request — *"add a better workflow to approve all unknown/pending companies in resume research results"* — is **still undelivered** (designs abandoned twice; ad-hoc drain adopted instead). The drain proved the API contract works: resolve → review-packet → approve/reject per item. Productize:
- Industry verification page: multi-select on `ready_for_review` (filter by flag), **Approve / Reject selected** with per-item attestation (`industry-review-attestation.v1`, decisionMode `standard`).
- Batch endpoint looping the existing per-proposal approve/resolve paths (they're already governance-enforced — safe to batch).
- Show the recommendation packet inline (class, flags, sources) so a human can decide without opening each row.

### C2 — Human override path for hard-block flags
`canApproveWithRiskOverride` is always false in practice. Define a policy: HR-workspace users may override `weak_industry_signal` (with evidence note) or `cnc_claim_inferred`; keep `source_conflict` and `canonical_mapping_missing` strictly human+UI. This converts the 18-item permanent-hold queue into resolvable work.

### C3 — Non-industry resolution lane
Real-but-non-industrial companies (Watsons, Lovisa, The Store, Ascendzone…) need a "classify `non_industry`" action distinct from reject — the reject lane is for noise. This alone drains ~7 of the 16 ready items.

### C4 — Candidate quality gate
Enforce the legal-suffix/shape check on candidate **persistence**, not just extraction: reject page-title candidates ("CNC MACHINIST CAREERS - GMI CORP") at creation. Prevents junk from reaching the review queue.

### C5 — Consolidate the split coverage path
Service layer currently merges 2 Convex queries + recomputes derived metrics. With P1.8 (precomputed counters), delete the merge logic and the `openWithSources`/`emptyEvidenceBottleneck` recompute.

### C6 — Move the audit trail product-side
Surface the existing `auditId` rows in the UI (who approved what, when, with which attestation) so agent-side `/tmp` scripts become unnecessary and decisions are reviewable.

### C7 — Document the governance model
Write the flag → condition → override table into dev-docs (it took 4 drain rounds to learn empirically). Include: the 6 flags, approvalSafeCandidate gate, reject-vs-hold semantics, attestation contract.

---

## Open questions for the next session

1. **Drain or build?** Continue agent-driven sweeps (bounded value; 50/run) or invest the session in C1+C3 to make humans self-sufficient? Recommendation: one sweep round to keep the queue fresh, then C1. **→ Decided in follow-up: build (C1).**
2. **Batch semantics**: should a batch approve require per-item confirmation, or one attestation covering the batch (with item list in the audit row)? **→ Decided: one attestation per batch** (server materializes per-item clones with the shared `batchId` on every approved revision).
3. **non_industry classification**: does it need its own verification level, or is `verified` + class `non_industry` sufficient? **→ Decided: `verified` + `non_industry` class, no schema change.**
4. **Tag policy**: handoff doc commit is on the branch but the `v0.4.23` tag stays at `3ebc673a` (app code state) — retag on next app-code change. **→ Follow-up retagged `v0.4.23` after shipping app code.**

---

## Follow-up session (2026-08-09): C1 shipped — bulk approve/reject workflow

The bulk approve/reject workflow (the original product ask) shipped end-to-end: API batch endpoint, governance override lane for `weak_industry_signal`, and multi-select UI with one-attestation-per-batch dialogs. Deployed to preview and live-verified; prod untouched.

### What shipped

| Piece | Change |
|---|---|
| Governance (C2-lite) | `weak_industry_signal` moved out of `INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS` (`packages/shared/src/industry-review.ts`) — an attended reviewer who explicitly classifies the employer may override it via `risk_override` attestation + reason. New `INDUSTRY_REVIEW_OVERRIDABLE_RISK_FLAGS` constant documents the policy. `cnc_claim_inferred` stays hard (it additionally trips `INDUSTRY_REVIEW_CNC_EVIDENCE_REQUIRED`); `canonical_mapping_missing`, `source_conflict`, `only_discovery_sources`, `stale_or_failed_source` stay hard. |
| API batch endpoint | `POST /api/company-industry-proposals/batch-review` (`apps/api/src/services/company-industry-batch-review-service.ts` + route in `apps/api/src/routes/companies.ts`). Body: `actions[]` (kind `approve` with optional `industryClass` override, or kind `reject` with optional `reviewNote`) + one `attestation` + optional `batchNote`. Per-item governance: packet fingerprint, ready_for_review status, explicit class (CLASS_REQUIRED), approval-safe sources, hard-flag gate, attestation validation, stale checks. Items fail individually (`summary.total/succeeded/failed` + per-item `code`/`error`); one batch never aborts the rest. Server generates revisionIds and materializes per-item attestation clones (`inputFingerprint` = item fingerprint, per-item mode/flags, shared `batchId`) stored on each immutable revision. Approvals trigger one coalesced maintenance run. Max 50 actions. |
| Attestation extension | `batchId?: string` added (optional, backward-compatible) to `IndustryReviewAttestation` in shared types, API route schema, Convex validator, and contracts parser — the audit trail links every revision approved in a batch. |
| Bug fixed (found live) | Convex `companies:resolveIndustryProposal` required `reviewNote` while the API contract marks it optional — any reject without a note 500'd. Made `reviewNote` optional in the mutation (`(args.reviewNote ?? "").trim()`), matching the contract; new convex test covers it. |
| Web UI | `apps/web/src/pages/system-settings/IndustryBatchReview.tsx`: batch action bar (sticky, shows selection count, Approve/Reject/Clear), approve dialog (per-item classification select incl. `non_industry`, risk-flag union chips, decision mode, reason textarea, CNC acknowledgement, excluded-item warnings), reject dialog (shared note). `IndustryReviewRow` gained a batch checkbox. Inbox wires selection → POST → per-item results → session undo-ability for batch approvals + queue refresh. Model helpers (`getBatchApproveEligibility`, `unionRiskFlags`, `batchAttestationMode`, `batchRequiresCncAcknowledgement`) mirror the server gates. |

### Live verification (preview, workspace hr, 2026-08-09)

- T1: approve `industry-maintenance-956530723aa8da63a89b` (only flag `weak_industry_signal`) with class `non_industry`, no attestation → per-item `INDUSTRY_REVIEW_ATTESTATION_REQUIRED` (proves the flag no longer hard-blocks; previously this was impossible).
- T2: approve Lovisa (`canonical_mapping_missing` + `weak_industry_signal`) with full risk-override attestation → per-item `INDUSTRY_REVIEW_HARD_RISK` — governance preserved live; mapping lane still required.
- T3: reject without `reviewNote` → before fix: `ArgumentValidationError`; after convex fix: clean mutation call failing only on business rule ("Proposal is not open: rejected" for an already-rejected id).
- No data mutated by smoke tests (coverage unchanged: openTotal 9,776 · ready 16 · rejected 25 · approved 5). Web bundle contains the new chunk; API + convex restarted healthy.

### Remaining (from this handoff's plan)

- **C3 (partial)**: `non_industry` lane exists in the batch UI (verified + class `non_industry`) but held items also carry `canonical_mapping_missing`/`source_conflict`, so the queue still needs the **identity-resolution** workflow (7 audit items) before batch approval can drain them.
- **C2 (partial)**: only `weak_industry_signal` is overridable. `cnc_claim_inferred` intentionally still hard.
- **C4** candidate-quality gate, **C5** coverage consolidation, **C6** audit UI, **C7** governance dev-docs — not started.
- **P0** throughput (batch/parallel sweep) — not started.
- Success criteria status: C1 shipped ✅ · ready queue below 5 ❌ (needs identity lane) · openWithSources ↑ ❌ (P0) · junk candidates gate ❌ (C4) · governance docs ❌ (C7) · prod pinned `64fa1dfb` ✅ · preview parity ✅.

---

## Follow-up session 2 (2026-08-09): C4/C5/C7 + P0.1 + architecture deepening shipped

Second follow-up: completed C4 (candidate gate), C5 (coverage consolidation), C7 (governance docs), P1.6 (budget docs), P2.10 (prune), P0.1 (sweep batch raise), plus the two top `/codebase-architecture` / `/improve-codebase-architecture` deepening candidates (shared governance primitives + approval-decision module). All suites green; deployed + live-verified on preview; prod untouched (pinned `64fa1dfb`).

### What shipped (commit `e5328b75` on preview-v0.4.23)

| Piece | Change |
|---|---|
| Arch#1 shared governance primitives | `selectApprovalSafeSources(recommendation)` + `requiresReviewAttestation(riskFlags, industryClass)` in `packages/shared/src/industry-review.ts` (15 shared tests). Single source of truth now used by the API approval service, batch service, and web model — the web previously re-implemented both. Rebuild `packages/shared/dist` after changes (runtime resolves from dist). |
| Arch#2 approval-decision module | `apps/api/src/services/company-industry-approval-service.ts` (new): `buildIndustryApprovalDecision` centralizes the full gate chain (INVALID_STATUS → CLASS_REQUIRED → NO_SAFE_SOURCE → INDUSTRY_REVIEW_HARD_RISK → attestation validate) + payload/materialization (server `revisionId`, expected* fields, per-item attestation clones). Both the approve route and the batch service now delegate to it; 13 unit tests. |
| C4/P2.10 candidate shape gate | `isJunkIdentityCandidateName` enforced at convex `upsertIndustryIdentityCandidate` (8–80 chars; rejects ` \| `; rejects ALL-CAPS multi-word lead before ` - `). New `listAllIndustryIdentityCandidates` query + `deleteIndustryIdentityCandidates` mutation (≤200/call) + `scripts/industry-data/prune-junk-identity-candidates.ts` (dry-run default). `scripts/check-mutation-entry-points.sh` now also checks reverse drift (registered names must exist). |
| C5/P1.8 coverage counters | New `industry_coverage_counters` table (by_workspace) + two budget-safe refresh mutations (proposal scan ~9.8k ops / evidence scan ~4k ops, each under the ~10.5k ceiling) + slim `getIndustryCoverageSummary` (1 doc read + live maintenance/research-queue). API service awaits an inline refresh on a null doc, then serves with a 5-min TTL. **Found + fixed a real insert-branch bug**: defaults after `...material` clobbered the first write's counts (would have zeroed statuses/openTotal forever on a real backend). Removed dead `countIndustryOpenProposalSources`. |
| C7 + P1.6 docs | `docs/industry-evidence-governance.md` (flag→condition→override table, approval-safe rules, attestation contract, batch semantics, candidate shape contract) and `docs/convex-local-backend-budget.md` (~10.5k ops / 1s, budget math). |
| P0.1 sweep batch | `INDUSTRY_PROPOSAL_LIMIT` default 20 → 200 (`apps/worker/industry_evidence_research.py`), scan headroom clamped to the Convex 500-row list cap; host `.env.preview` set to 200. |

### Live verification (preview, workspace hr, 2026-08-09)

- Coverage endpoint now reads the counters doc: first request 12.6s (inline refresh of both counters), subsequent **0.058s**. Numbers match baseline exactly: openTotal 9,776 · openWithSources 81 · openWithoutSources 9,695 · resumes 8,958/0 · ready 16 · approved 5 · rejected 25.
- Prune applied: `CNC MACHINIST CAREERS - GMI CORP` (the handoff's observed junk) flagged by the gate mirror and deleted via `companies:deleteIndustryIdentityCandidates` (39 candidates remain).
- Sweep duration before/after P0.1: **before (50/run): 7.8 min for 50 proposals (9.3s/proposal, 2 ready) · after (200/run): exactly 50.0 min for 200 proposals (15s/proposal, 51 ready, 0 errors)** — run `cc2026ef-b4ac-4f5a-9a54-31be0768375d`, measured 2026-08-09 17:57→18:47 HKT. Batch raise delivered 4× the drain per run; per-proposal cost rose (dead-host discovery timeouts — see P0.2 note) but 51 ready items created vs 2 in the baseline run. Endpoint latency untouched (0.058s cached).
- Direct convex HTTP works at `http://127.0.0.1:4210/api/query|mutation` with `{"path","args"}` (NOT 127.0.0.1:3210 — that's **prod's** local backend; the `npx convex run` CLI path does not resolve on the host without a cloud token).

### Deploy pitfalls (learned live — avoid next time)

The rsync-based deploy (`rsync -az --delete` from the working tree) needs the **canonical exclude list** from `deploy/preview-upgrade.sh`: `.git node_modules .venv .cache logs coverage output .env.preview .env.production packages/convex/.env.local packages/convex/.convex apps/web/dist docker-compose.preview.yml start-convex.sh prod-convex-export.zip .digest-restore-epoch` **plus `.env`** (the worker's dotenv file; the canonical copy = `.env.preview`). This session's misses caused: (1) host `.venv` corrupted with macOS binaries → recreated via `uv venv && uv sync`; (2) root `.env` overwritten with local dev values → restored from `.env.preview`; (3) `start-convex.sh` + `docker-compose.preview.yml` deleted (setup artifacts, not in git) → re-copied from `deploy/docker/`. The convex container bind-mounts the repo root, so `--delete` breaks the container entrypoint.

### Remaining (deferred)

- **C6 audit UI** (auditId rows surfaced in the UI) — not started.
- **Arch#3** convex `companies.ts` split (~6k lines), **Arch#5** web HTTP convergence, **Arch#7** settings-page split — documented candidates, not started.
- **P0.2–P0.5** worker parallelism, source dedup, resume-impact ordering, CN hotlist batching — not started (P0.1 batch raise is the contained first step).
- Success criteria status: C1 ✅ · C4 ✅ · C7 ✅ · ready queue below 5 ❌ (needs C2 identity lane) · openWithSources ↑ (in progress via sweep) · prod pinned `64fa1dfb` ✅.

---

## Follow-up session 3 (2026-08-09): C2 identity-resolution lane shipped + batch-attestation schema bug fixed

Third follow-up: shipped the **identity-resolution lane in the review inbox** (the C2 queue bottleneck — 61 of 67 ready items carried `canonical_mapping_missing`), and found + fixed a **latent C1 bug** that made every batch approval fail at insert time on the local backend. All suites green; deployed to preview and live-drained 3 real items; prod untouched (pinned `64fa1dfb`).

### What shipped (branch `industry-identity-resolution-lane`, commits `47a54ff9` + `ee7080de`)

| Piece | Change |
|---|---|
| Identity lane UI | `IndustryIdentityResolutionDialog.tsx`: per-item identity candidates (name, confidence, jurisdiction, registration, conflict codes, source count, review state) with the best non-rejected candidate pre-selected; mapping mode choice — **create provisional** (display name pre-filled, optional alias) or **map to existing** registry company (client-side filter over `GET /api/companies`, merged rows excluded); candidate sources auto-attached; one shared review note (defaults to "Identity mapping reviewed from the batch review lane."). |
| Queue affordances | Batch action bar gains **Resolve identity** (enabled when the selection contains resolvable rows); `IndustryReviewRow` gains a per-row **Resolve identity** button for rows blocked by `canonical_mapping_missing`. Both open the same dialog (single item or selection). |
| Submission | Sequential per-item POSTs to the existing governed `/identity-resolution` endpoint (no new API surface); per-item failures become row errors (409 → conflict, 422 → policy); succeeded items leave the selection; queue + packet cache refresh. Items without candidates are shown as an excluded group with a "queue targeted research" hint. |
| Model helpers | `getIdentityResolutionEligibility` (any non-terminal, unmapped proposal) + `requiresIdentityResolution` (eligibility ∧ flag) in `industry-review-inbox-model.ts`; 4 new tests. |
| Tests | 8 dialog tests (default selection, both mapping payloads, validation gating, registry filter, excluded group) + 2 page-level inbox flow tests (batch-bar and row-entry, asserting the exact POST bodies) — all green (web 1849, api+convex+shared 3851). |
| **Bug fixed (found live)** | `company_industry_verdict_revisions` **table schema validator** never gained `batchId` on `reviewAttestation` — C1's function-level validator and the API contracts parser have it, but the table validator does not, so **every batch approval 500'd at insert** ("Object contains extra field `batchId`"). C1's smoke tests never actually approved, so it shipped undetected; my first live drain attempt caught it. Added `batchId: v.optional(v.string())` to `packages/convex/convex/schema.ts` + convex regression test (approve with a batch attestation, assert batchId persists on the revision). |

### Live verification (preview, workspace hr, 2026-08-09)

- **Queue census**: 67 ready → 61 with `canonical_mapping_missing` → **28 have identity candidates**, **22 candidate-bearing are blocked only by mapping (± weak_industry_signal)**; the other 39 have no candidates and need targeted research before resolution.
- **Full drain cycle × 3** (resolve identity → batch approve, governance intact):
  - Creative Precision Engineering Sdn. Bhd. → provisional + `industrial`
  - Do Re Mi Sound & Light Sdn. Bhd. → provisional + `non_industry`
  - Ghazco Energy Sdn Bhd. → provisional + `industrial`
  - All approvals carried `risk_override` attestations (weak_industry_signal) with reasons; revisions persisted with `batchId` (verified via `listIndustryVerdictRevisions`), identity audits in `industry_identity_resolution_audits`.
- **Counters converged**: approved 5→8, ready_for_review 67→64, openTotal 9,776→9,773 (open excludes approved), openWithSources 172. The approvals also triggered one coalesced maintenance run (by design — `researching: 1` observed).
- **Deploy note (learned live)**: schema.ts changes require **restarting the preview convex container** (`docker restart trends-preview-convex`) — the local backend loads the schema at boot; file sync alone leaves the old table validator running. Also, the coverage counters refresh is fire-and-forget on TTL expiry; a refresh in flight during approvals can write a pre-change snapshot — the next TTL cycle converges (observed: stale 67/5 for ~2 min, then 64/8).

### Remaining (deferred)

- **~19 candidate-bearing ready items** are now resolvable + approvable through the new lane (operator work in the UI); **39 ready items without candidates** need targeted research first (research → candidates → resolve → approve).
- **C6 audit UI** (auditId/batchId rows surfaced in the UI) — not started.
- **Arch#3** convex `companies.ts` split, **Arch#5** web HTTP convergence, **Arch#7** settings-page split — documented candidates, not started.
- **P0.2–P0.5** worker parallelism, source dedup, resume-impact ordering, CN hotlist batching — not started.
- Success criteria status: C1 ✅ (now actually working end-to-end) · C2 ✅ (identity lane) · C4 ✅ · C7 ✅ · ready queue below 5 ❌ (needs the operator pass + research for candidate-less items) · openWithSources ↑ (in progress via sweep) · prod pinned `64fa1dfb` ✅.

---

## Live state snapshot (observed 2026-08-09, workspace `hr`)

- Coverage (HTTP 200): `openTotal 9,776` · `openWithSources 81` · `openWithoutSources 9,695` · `emptyEvidenceBottleneck true` · `readyBacklogBottleneck false` · proposals by status: approved 5, needs_more_evidence 85, new 9,675, ready_for_review 16, rejected 25
- Last run: `run-omu5an4xmslgdlx6` completed ("2 ready, 0 demoted, 0 refreshed") — triggered by Kingsmen approval
- Queue (16): all decided in audit — approve 4 · identity_resolution 7 · hold 18 · reject 1 (30 entries total)
- Services: preview api + worker active, convex Up 10h healthy, worker log 0 errors; prod api+worker active at `64fa1dfb`
- Host memory: convex 6.99GiB/12GiB (58%), host 17Gi/23Gi

## Commands cheat sheet

```bash
# Host: ptcloud (root@217.217.255.28), app /home/ubuntu/trends-preview
# Auth: /tmp/inspect-hr.jar + /tmp/inspect-csrf.txt on host (X-CSRF-Token, X-Workspace-Slug: hr)
# Re-auth if jar expired: POST /api/auth/login with AUTH_HR_DEMO_PASSWORD from .env.preview

# Ready queue + packets
curl -b $JAR -H "X-CSRF-Token: $CSRF" -H "X-Workspace-Slug: hr" \
  "https://preview.pt-mes.com/api/company-industry-proposals/review-queue?status=ready_for_review&limit=50"
curl -b $JAR -H "X-CSRF-Token: $CSRF" -H "X-Workspace-Slug: hr" \
  "https://preview.pt-mes.com/api/company-industry-proposals/<proposalId>/review-packet"

# Map identity (create_provisional) → then approve or resolve
curl -b $JAR -H "X-CSRF-Token: $CSRF" -H "X-Workspace-Slug: hr" -H "Content-Type: application/json" -X POST \
  "https://preview.pt-mes.com/api/company-industry-proposals/<proposalId>/identity-resolution" \
  -d '{"expectedProposalUpdatedAt":<int>,"candidateFingerprint":"<fp>","mappingMode":"create_provisional","provisionalDisplayName":"...","provisionalAlias":"...","sourceIds":["industry-source-..."],"reviewNote":"..."}'

curl -b $JAR -H "X-CSRF-Token: $CSRF" -H "X-Workspace-Slug: hr" -H "Content-Type: application/json" -X POST \
  "https://preview.pt-mes.com/api/company-industry-proposals/<proposalId>/approve" \
  -d '{"revisionId":"industry-candidate-<fp>-<uuid>","expectedProposalUpdatedAt":<int>,"expectedInputFingerprint":"<fp>","verificationLevel":"verified","industryClass":"industrial|automation|cnc|metrology|non_industry","reviewAttestation":"industry-review-attestation.v1","decisionMode":"standard","approvedSourceIds":[...],"evidenceSummary":"...","decisionReason":"..."}'

# Reject (noise only)
curl -b $JAR -H "X-CSRF-Token: $CSRF" -H "X-Workspace-Slug: hr" -H "Content-Type: application/json" -X POST \
  "https://preview.pt-mes.com/api/company-industry-proposals/<proposalId>/resolve" -d '{"resolution":"rejected"}'

# Sweep trigger + runs
curl -b $JAR -H "X-CSRF-Token: $CSRF" -H "X-Workspace-Slug: hr" -H "Content-Type: application/json" -X POST \
  "https://preview.pt-mes.com/api/industry-data/trigger" -d '{"companyKey":"<any>"}'
curl -b $JAR -H "X-CSRF-Token: $CSRF" -H "X-Workspace-Slug: hr" \
  "https://preview.pt-mes.com/api/company-industry-maintenance-runs?limit=2"

# Coverage + convex direct (convex HTTP on host, NOT behind /convex)
curl -b $JAR -H "X-CSRF-Token: $CSRF" -H "X-Workspace-Slug: hr" "https://preview.pt-mes.com/api/company-industry-coverage"
curl -s http://127.0.0.1:4210/api/query -d '{"path":"companies:listIndustryProposals","args":{"writeSecret":"<CONVEX_WRITE_SECRET>","status":"ready_for_review","limit":200}}'

# Repo-side drain helper
bash scripts/industry-data/drain-backlog.sh   # PROPOSAL_LIMIT default 50

# Deploy sync (after repo changes): rsync to ptcloud:/home/ubuntu/trends-preview, then
systemctl restart trends-preview-worker-api   # byte-identical unit in deploy/
```

## Success criteria status (as of follow-up session 3, 2026-08-09)

- [x] C1 bulk approve/reject ships (UI + batch endpoint, attestation intact) — shipped; **batchId table-schema bug fixed** so batch approvals actually persist (was failing at insert on the local backend)
- [x] C2 identity-resolution lane ships (candidates → provisional/existing mapping from the inbox, row + batch affordances)
- [ ] `ready_for_review` queue drops below 5 without agent intervention (needs the operator pass over ~19 candidate-bearing items + targeted research for the 39 candidate-less ones)
- [ ] `openWithSources` ↑ measurably (P0 batch+parallel) — sweep 200/run delivers 51 ready/run; further parallelism is P0.2
- [x] Junk page-title candidates no longer created (C4 gate + test)
- [x] Governance model documented in dev-docs (C7)
- [x] Prod still pinned at `64fa1dfb`; preview parity green

## Code pointers

- Worker extraction + fetcher: `apps/worker/industry_evidence_research.py` (`_find_legal_names`, `_COPYRIGHT_LEGAL_NAME_RE`, `GuardedEvidenceFetcher`) + `apps/worker/tests/test_industry_evidence_research.py` (311 tests)
- Governance: `apps/api/src/services/company-industry-review-service.ts` (flags at ~L260–401) + tests
- Coverage: `apps/api/src/services/company-industry-coverage-service.ts`, convex `getIndustryCoverageSummary` + `refreshIndustryCoverage*Counters` mutations + `industry_coverage_counters` table in `packages/convex/convex/companies.ts` / `schema.ts`
- Routes: `apps/api/src/routes/companies.ts` (identity-resolution L1288, approve L1430), `apps/api/src/routes/industry-data-admin.ts` (trigger L334)
- Deploy: `deploy/trends-preview-worker-api.service`, `deploy/preview-upgrade.sh`, `deploy/preview-doctor.sh`
- Session scripts on host (may vanish on reboot; audit already copied): `/tmp/grill-snapshot/resume/`
