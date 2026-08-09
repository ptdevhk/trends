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
2. **Parallelize evidence fetch inside the worker**: fetch sources for multiple proposals concurrently (thread/asyncio pool), respecting per-domain rate limits and the 1s/op-budget constraints on the Convex side (batch status updates, don't per-proposal mutate).
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

1. **Drain or build?** Continue agent-driven sweeps (bounded value; 50/run) or invest the session in C1+C3 to make humans self-sufficient? Recommendation: one sweep round to keep the queue fresh, then C1.
2. **Batch semantics**: should a batch approve require per-item confirmation, or one attestation covering the batch (with item list in the audit row)?
3. **non_industry classification**: does it need its own verification level, or is `verified` + class `non_industry` sufficient?
4. **Tag policy**: handoff doc commit is on the branch but the `v0.4.23` tag stays at `3ebc673a` (app code state) — retag on next app-code change.

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

## Success criteria for the next session

- [ ] C1 bulk approve/reject ships (UI + batch endpoint, attestation intact) — **or** explicit decision to defer with reason
- [ ] `ready_for_review` queue drops below 5 without agent intervention (C2/C3 unblock)
- [ ] `openWithSources` ↑ measurably (P0 batch+parallel), ideally with a per-run duration benchmark before/after
- [ ] Junk page-title candidates no longer created (C4 gate + test)
- [ ] Governance model documented in dev-docs (C7)
- [ ] Prod still pinned at `64fa1dfb`; preview parity green

## Code pointers

- Worker extraction + fetcher: `apps/worker/industry_evidence_research.py` (`_find_legal_names`, `_COPYRIGHT_LEGAL_NAME_RE`, `GuardedEvidenceFetcher`) + `apps/worker/tests/test_industry_evidence_research.py` (311 tests)
- Governance: `apps/api/src/services/company-industry-review-service.ts` (flags at ~L260–401) + tests
- Coverage: `apps/api/src/services/company-industry-coverage-service.ts`, convex `getIndustryCoverageSummary` / `countIndustryOpenProposalSources` in `packages/convex/convex/companies.ts`
- Routes: `apps/api/src/routes/companies.ts` (identity-resolution L1288, approve L1430), `apps/api/src/routes/industry-data-admin.ts` (trigger L334)
- Deploy: `deploy/trends-preview-worker-api.service`, `deploy/preview-upgrade.sh`, `deploy/preview-doctor.sh`
- Session scripts on host (may vanish on reboot; audit already copied): `/tmp/grill-snapshot/resume/`
