# Company Industry Evidence Stewardship

## Purpose

This runbook covers the attended lifecycle for reviewed company-industry evidence used by `行业验证`, verified role years, recruiter source previews, and targeted resume recomputation.

The governing rule is simple: automated research may discover, fetch, compare, and propose evidence, but it cannot approve, reject, revoke, or replace current truth. Only an authenticated human reviewer can advance an immutable verdict revision.

## Runtime boundaries

- Search, filtering, scoring, and Resume Detail read materialized data only.
- Recruiter-facing cards expose only human-approved `verified` summaries.
- A stale, unavailable, or changed source creates a proposal; it does not remove a current verified badge.
- `candidate`, `rejected`, worker confidence, conflicts, and unreviewed URLs stay inside stewardship surfaces.
- Preview and production strict cutover require separate authorization.

## Proposal lifecycle

Proposals may be coalesced from three trigger classes:

1. Ingest-driven unknown, weak, frequent, or high-value employer surfaces.
2. Scheduled freshness checks for approved evidence.
3. Recruiter-requested refresh from Resume Detail.

Repeated triggers merge into the existing open proposal by canonical `companyKey`, or by normalized unresolved employer surface when no company mapping exists.

The normal attended flow is:

1. Open the Industry Verification page under System Settings.
2. Select a `ready_for_review` proposal.
3. Confirm the canonical company, current revision, source domains, source types, excerpts, fetch timestamps, and material-change summary.
4. Approve only durable public HTTP(S) sources. Search-result pages and discovery-trust sources are not approval evidence.
5. Choose `verified` or `rejected`, the taxonomy class, decision reason, taxonomy version, and next review date.
6. Approve. The system creates a new immutable revision and advances the current profile atomically.
7. Start or monitor targeted recomputation for linked resumes.

Use `needs_more_evidence` when the evidence is insufficient. Use `rejected` on the proposal to reject the proposed change without creating a company truth revision. A company verdict of `rejected` is a separate attended approval that creates an immutable rejected revision.

## MY bootstrap

Prepare a reviewed JSON array with one entry per canonical company:

```json
[
  {
    "companyKey": "example-cnc",
    "employerName": "Example CNC Sdn. Bhd.",
    "industryClass": "cnc",
    "verificationLevel": "verified",
    "evidenceSummary": "Official product catalog confirms CNC machine tools.",
    "decisionReason": "Reviewed primary company evidence.",
    "taxonomyVersion": "industry-v1",
    "nextReviewAt": 1816982400000,
    "sources": [
      {
        "url": "https://example.com/products/cnc",
        "sourceType": "official_site",
        "trustTier": "primary",
        "title": "CNC products",
        "evidenceExcerpt": "Reviewer-selected bounded excerpt."
      }
    ]
  }
]
```

Validate and generate deterministic IDs without changing state:

```bash
bunx tsx scripts/industry-data/import-my-bootstrap-profiles.ts \
  --input output/industry-data/my-reviewed-evidence.json
```

Inspect the generated `*-bootstrap-plan.json`. Then, during an attended local session, apply it:

```bash
TRENDS_AUTH_USERNAME=... \
TRENDS_AUTH_PASSWORD=... \
bunx tsx scripts/industry-data/import-my-bootstrap-profiles.ts \
  --input output/industry-data/my-reviewed-evidence.json \
  --api-url http://localhost:3000 \
  --workspace dev \
  --apply
```

The apply step writes:

- `*-apply-results.json`;
- `*-rollback-packet.json`.

IDs are deterministic, so an interrupted retry coalesces with the same proposals and sources. Approval also uses optimistic current-revision matching, preventing a stale bootstrap packet from silently overwriting newer truth.

## Rollback

Verdict revisions are immutable. Never delete or mutate the imported current revision.

Use the rollback packet to create a new attended compensating proposal:

1. Compare the packet’s `previousCurrentRevisionId` with current state.
2. Re-open the prior evidence and decision context.
3. Create a new proposal that explicitly supersedes the imported revision.
4. Approve a new compensating revision with a clear rollback reason.
5. Run targeted recomputation for the company.

If the prior state had no approved revision, approve a new `rejected` or corrected classified revision only when evidence supports it. Do not restore legacy seed truth by direct database patch.

## Local strict cutover

Strict mode may be enabled locally only after:

- reviewed bootstrap coverage is accepted for the intended MY golden cohort;
- every projected verified summary references a current immutable revision;
- affected resumes have completed targeted recomputation;
- golden searches return semantically verified direct work entries;
- recruiter cards and Resume Detail show the same revision IDs;
- no request-time research or external fetch appears in browser network traces.

Set locally:

```bash
INDUSTRY_EVIDENCE_COMPATIBILITY_MODE=strict-reviewed
```

Restart the API, run the compute-mode reingest/targeted recompute, and verify the MY CNC golden queries. If coverage regresses, unset the variable, restart locally, and investigate missing company mappings or revisions. Do not enable strict mode in preview or production from this runbook.

## Failure handling

- Catalog unavailable: ingest marks the catalog degraded and invents no verification.
- Revision mismatch: digest years become unverified/stale until recomputation.
- Source fetch failed: preserve current truth and create/coalesce a maintenance proposal.
- Approval concurrency conflict: reload current revision and review again.
- Partial recompute: retry the durable run; completed resume identities remain idempotent.
- Unsafe URL: reject before persistence or projection.

## Audit evidence

For each attended approval retain:

- proposal ID and trigger reasons;
- canonical company key;
- approved source IDs and normalized domains;
- immutable revision ID;
- reviewer and review timestamp;
- decision reason and taxonomy/rule version;
- targeted recompute run ID, counts, failures, and final state;
- rollback packet for bootstrap batches.
