# Corpus-Evidence Fast-Track for Industry-Proof Accuracy

**Date:** 2026-08-06  
**Branch:** `preview-v0.4.23`  
**Status:** Approved (brainstorming complete)

## Problem

The verified-only search gate (`minRoleYears=1&roleType=sales`) currently returns 37 resumes for the MY golden query (CNC Sales) and 447 for CN. The pre-verified-only baseline was 142 for MY. The gap exists because ~1,875 industry proposals are stuck in `new` status, waiting for worker web research (3-5 min per batch round). Draining the full backlog through the existing pipeline would take hours and may never resolve employers with no web presence.

The user wants to grow the verified count faster while maintaining accuracy, then run the UAT to confirm go/no-go for the prod upgrade.

## Solution

A **tiered corpus-evidence fast-track** that uses resume work-history agreement to skip web research for high-confidence employers, followed by one reingest and a full UAT verification pass. Industry-standard pattern (Facebook/LinkedIn patent US20150371277A1, Checkr/Truv verification vendors): aggregate multiple employees' job titles per employer, fast-track high-confidence cases, web-research only the ambiguous remainder, human approval gate preserved.

## Architecture

### Three-tier pipeline, one reingest at the end

```
Tier 1 (Corpus fast-track, strongest):
  2+ distinct resumes at same employer
  + at least 1 work entry has CNC/engineer title tokens
  -> ready_for_review with corpus_evidence source

Tier 2 (Corpus fast-track, strong):
  1 resume with EXPLICIT CNC title tokens only
  (cnc, 数控, 机床, machinist, milling, turning, mechatronics, etc.)
  -> ready_for_review with corpus_evidence source

Tier 3 (Selective web research, ambiguous):
  1 resume with generic sales/engineer title
  + employer name not in approved catalog
  -> worker web research (existing pipeline)
  -> OR Wikidata P452 lookup (light supplement, if time permits)

Final step: one reingest -> stamps industryVerified on all newly approved employers
```

Tiers 1-2 skip web research entirely. They create/upsert proposals directly at `ready_for_review` with a `corpus_evidence` source. The existing `auto-verify-proposals.ts` then batch-approves them. Tier 3 is the existing worker pipeline, shrunk to only the ambiguous remainder.

### Governance preserved

The human approval gate still applies. `auto-verify-proposals.ts` does the approval using the existing governed machinery (attestation schema, immutable verdict revisions). We are not adding an auto-approve bypass; we are pre-filling `ready_for_review` from corpus evidence instead of from web research.

## Components

### New script: `scripts/industry-data/corpus-fast-track.ts`

Single script that replaces the multi-round drain-backlog loop with one pass. Reuses existing Convex mutation/query machinery - no schema changes, no new Convex functions.

### Data flow

1. **Scan:** Query `/api/resumes` for both markets (MY + CN) without the verified gate. Extract all unverified work entries with sales role signals. Group by normalized employer surface.

2. **Classify:** For each employer, apply the title-token gate:
   - Tier 1: 2+ resumes + CNC/engineer title -> fast-track
   - Tier 2: 1 resume + explicit CNC title -> fast-track
   - Tier 3: everything else -> leave for worker research

3. **Upsert:** For each fast-track employer:
   - Check if proposal already exists (by companyKey/surface)
   - If not: `companies:upsert` + `companies:upsertIndustryProposal` with `status="ready_for_review"`, `triggerReasons=["corpus_evidence"]`
   - If yes and status is `new`/`needs_more_evidence`: upgrade to `ready_for_review`
   - If yes and status is `approved`/`rejected`: skip (never overwrite a human decision)

4. **Add corpus evidence source:** For each fast-tracked proposal, add an evidence source row so it passes the auto-verify approval-safe filter. The existing `approveIndustryProposal` function (Convex `companies.ts:2555`) requires `normalizeIndustryEvidenceUrl(source.url)` to return non-null - meaning the URL must be a valid public HTTP/HTTPS URL (not localhost, not synthetic). The resume's `profileUrl` (e.g. `https://hk.employer.seek.com/profile/...`) IS the evidence - it's the real web page where the work history was captured. We use it as the source URL:
   - `sourceType: "other"` (existing catch-all; no schema change needed)
   - `url: <resume.profileUrl>` (real HTTPS URL from Seek/51job, passes URL validation)
   - `sourceDomain: <extracted from profileUrl>` (e.g. `hk.employer.seek.com`)
   - `title: "Corpus evidence: <N> resume(s) with CNC-relevant titles"`
   - `evidenceExcerpt: "<jobTitle1> (<years1>y), <jobTitle2> (<years2>y), ..."`
   - `trustTier: "corroborating"` (existing literal, not discovery)
   - `reviewStatus` is set to `"unreviewed"` by `upsertIndustryEvidenceSource` (the mutation doesn't accept reviewStatus as a parameter). The `approveIndustryProposal` function sets it to `"approved"` during the approval step (Convex `companies.ts:2609`). The auto-verify filter and approval gate both pass `unreviewed` sources - they only block `rejected` and `disputed`.
   - `fetchStatus: "fetched"` (the resume data was already fetched during ingest)
   - `sourceState: "active"` (set by `upsertIndustryEvidenceSource` by default)

   For multi-resume employers (Tier 1), add one evidence source per distinct resume (each with its own `profileUrl`). For single-resume employers (Tier 2), add one source.

5. **Auto-verify:** Run existing `auto-verify-proposals.ts --apply`. Batch-approves all `ready_for_review` proposals. Existing approval-safe filter applies (trustTier, fetchStatus, sourceState - corpus sources pass all checks).

6. **Reingest:** One `migrations:reIngestAllResumes` run. Stamps `industryVerified=true` on all work entries at newly approved employers. Golden query count grows immediately.

7. **UAT:** Run the 7-step UAT verification plan (see below).

### What changes vs. existing code

| Component | Change |
|-----------|--------|
| `scripts/industry-data/corpus-fast-track.ts` | **New** - the scan + classify + upsert script |
| `scripts/industry-data/auto-verify-proposals.ts` | **Already modified** (uncommitted) - stricter approval-safe filter (`fetchStatus !== "failed"`, `sourceState === "active"`, `reviewStatus !== "disputed"`) |
| Convex schema/functions | **No changes** - reuse existing `upsertIndustryProposal`, `setIndustryProposalResearchState`, `approveIndustryProposal` |
| Worker | **No changes** - still runs for Tier 3 ambiguous cases |
| `drain-backlog.sh` | **No changes** - still available for full prod drain, just not needed for this session |

## False-Positive Defense

### Gate 1: Title-token gate (precision filter)

The job title must contain explicit CNC/industrial keywords. Employer name keywords never count as evidence.

**Explicit CNC tokens** (qualify for Tier 1 and Tier 2):
- English: `cnc`, `machinist`, `milling`, `turning`, `machine tool`, `precision engineering`, `tooling`, `mechatronics`
- Chinese: `数控`, `机床`, `机加工`, `加工中心`, `模具`, `刀具`, `精密机械`

**Engineer tokens** (qualify for Tier 1 only, insufficient alone for Tier 2):
- `technical sales engineer`, `sales engineer`, `application engineer`, `field engineer`
- `技术销售`, `销售工程师`

Tier classification:
- Tier 1 (2+ resumes): passes if ANY work entry has explicit CNC tokens OR engineer tokens
- Tier 2 (1 resume): passes ONLY if the title has explicit CNC tokens (engineer alone is insufficient - too generic for single-resume evidence)

### Gate 2: Employer-name exclusion (the "CNC AUTOMOBILE" trap)

Even if the title passes Gate 1, block if the employer name contains tokens that contradict CNC industry:

**Exclusion tokens:**
- `automobile`, `car`, `auto parts`, `automotive`, `汽车`
- `food`, `beverage`, `食品`, `饮料`
- `retail`, `mart`, `shop`, `store`, `零售`
- `real estate`, `property`, `地产`

If employer name matches an exclusion token, the proposal is NOT fast-tracked. It goes to Tier 3 (worker web research) where the existing distinctive-content gate can properly evaluate it.

### Expected yield (from corpus analysis)

| Market | Tier 1 (2+ resumes) | Tier 2 (1 resume, CNC title) | Total fast-track |
|--------|---------------------|------------------------------|------------------|
| MY | 4 employers | 9 employers | ~13 employers |
| CN | 1 employer | 17 employers | ~18 employers |
| **Total** | **5** | **26** | **~31** |

Each newly approved employer may unlock multiple resumes in the golden query (a single employer like "Seco Tools Sdn Bhd" with 13.7 years of sales evidence could verify 2+ resumes). Conservative estimate: golden MY count grows from 37 to ~50-60.

## Error Handling

- Script is **dry-run by default** - prints the classification and upsert plan, writes nothing
- `--apply` flag required for any Convex mutations
- Each upsert is logged with: employer name, tier, resume count, titles, decision (fast-track/exclude/defer)
- If a proposal already exists and is `approved` or `rejected`, skip it (never overwrite a human decision)
- If a proposal exists as `new` or `needs_more_evidence`, upgrade to `ready_for_review`
- If no proposal exists, create one with `triggerReasons: ["corpus_evidence"]`
- Convex write failures are caught per-employer and logged; one failure does not abort the batch

## UAT Verification Plan

After the corpus fast-track + auto-verify + reingest runs, verify accuracy before declaring go/no-go.

### Step 1: Endpoint preconditions
Convex (:3210), API (:3000), Web (:5173), Worker (:8000) all responding. Already verified.

### Step 2: API search scenarios
Three queries, captured to `/tmp/uat-search-{a,b,c}.json`:

| Scenario | Query | Gate | Expected |
|----------|-------|------|----------|
| a | MY `CNC Sales` | `minRoleYears=1&roleType=sales` | total >= 37 (current), should grow after fast-track |
| b | MY `CNC Sales` | no role-years filter | total > (a) total |
| c | CN `CNC 销售` | `minRoleYears=1&roleType=sales` | total >= 447 (current), should grow |

Run scenario (a) twice - the two totals must be identical (consistency check).

### Step 3: Verified-only gate cross-check
Sample 5+ resumes from scenario (a) and confirm each has:
- `verifiedRoleYears.sales >= 1` in ingestData, AND/OR
- At least one `matchedWorkEntries` item with `industryVerified: true` and `directRoleMatch: true`
- Cross-check: the employer companyKey appears in the approved proposal set from `listIndustryProposals`

Capture to `/tmp/uat-sample.json`.

### Step 4: Corpus fast-track accuracy audit
The new check specific to this work:
- For each employer fast-tracked via corpus evidence, verify the approved profile exists in Convex
- For at least 3 fast-tracked employers, confirm the resume work entries now show `industryVerified: true` after reingest
- Confirm zero false positives: none of the fast-tracked employers should have exclusion-token names

### Step 5: Browser UAT (honest degradation)
- Load `http://localhost:5173/hr/resumes?location=Malaysia&q=CNC+Sales&minRoleYears=1&roleType=sales` with an authenticated session
- Verify zero console errors, results count matches API total
- Open one resume detail, verify industry-evidence panel renders
- If no auth session achievable, capture the failure and fall back to API + structural checks

### Step 6: Fixture check
`bun run verify:industry-review-uat -- --base-url http://localhost:3000` must exit 0 with status `passed`. Capture to `/tmp/uat-fixture.log`.

### Step 7: Go/no-go report at `/tmp/uat-report.md`
- Per-scenario rows (observed count vs expectation)
- Fast-track accuracy audit results
- Defects found (with fixes if made)
- Explicit go/no-go recommendation for prod upgrade

### Success criteria
All gate cross-checks pass, zero false positives in the fast-track audit, golden query count grew from 37, and no browser errors (or documented fallback).

## Non-goals

- Performing the prod upgrade/deploy itself - this plan ends at the go/no-go recommendation.
- Draining the full ~1,875-proposal `new` backlog (a long-running prod-phase operation via `drain-backlog.sh`).
- Changing the verified-only gate semantics or the worker's research logic.
- Adding Wikidata P452 lookup as a required step (it is an optional supplement for Tier 3 if time permits).
- Modifying the Convex schema or adding new Convex functions.

## Research sources

- **Deep research (vault):** `queries/2026-08-06-employer-industry-verification-fast-path.md` + `concepts/corpus-evidence-fast-path-verification.md`
- **PavedPath code search:** Facebook patent US20150371277A1 (majority-vote employer classification), `enrichment-kit` waterfall short-circuit, `Elzawawy/industry-text-classifier` title->industry training data
- **Wiki vault:** `concepts/governed-web-research-discovery-layer.md`, `concepts/ingest-driven-gazetteer-maintenance.md`, `work/2026-07-29-my-industry-evidence-self-maintenance-search-ux/spec.md`
- **Local repo:** `docs/runbooks/company-industry-evidence-stewardship.md`, `scripts/industry-data/curate-my-cnc-employers.ts`, `apps/worker/industry_evidence_research.py`
