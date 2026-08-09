# Industry Evidence Governance Model

> Single source of truth for the attended review rules behind company-industry
> proposals. Learned empirically across four drain rounds (2026-07-29 →
> 2026-08-09); encode changes here when the rules move.

Code home: `packages/shared/src/industry-review.ts` (pure rules),
`apps/api/src/services/company-industry-approval-service.ts` (approval
decision), `apps/api/src/services/company-industry-review-service.ts`
(recommendation production).

## The proposal lifecycle

```
new → researching → ready_for_review → approved | rejected | superseded
        ↘ needs_more_evidence (worker re-chew)   ↘ (undo → ready_for_review)
```

- `ready_for_review` = evidence researched, waiting on an attended decision.
- `approved` = immutable verdict revision written (never mutated; `undo-approval`
  writes a compensating revision).
- `rejected` = noise/garbage. `superseded` = replaced by a newer revision.

## Risk flags → condition → override

| Flag | Raised when | Overridable? | Override path |
|---|---|---|---|
| `canonical_mapping_missing` | no canonical `companyKey` | **No** | identity-resolution lane (UI / API) |
| `source_conflict` | sources (or a disputed/rejected source) suggest conflicting classes | **No** | resolve the conflicting sources first |
| `only_discovery_sources` | no attached source is approval-safe | **No** | fetch real evidence |
| `stale_or_failed_source` | an approval-safe candidate source failed/unavailable/not active | **No** | re-research the source |
| `cnc_claim_inferred` | CNC class without explicit industrial/product evidence | **No** (also trips `INDUSTRY_REVIEW_CNC_EVIDENCE_REQUIRED`) | explicit CNC evidence |
| `weak_industry_signal` | no industry class suggested (`unknown`) | **Yes** | `risk_override` attestation + explicit classification (e.g. `non_industry`) + reason |
| `low_source_diversity` | no eligible sources, or one non-primary | **Yes** | `risk_override` attestation + reason |
| `worker_unreachable` | latest maintenance run failed with worker unreachable | **Yes** | `risk_override` attestation + reason |
| `recompute_pending` | proposal awaiting recompute | **Yes** | `risk_override` attestation + reason |

The non-overridable set is `INDUSTRY_REVIEW_NON_OVERRIDABLE_RISK_FLAGS`
(shared). Overridable flags are documented in
`INDUSTRY_REVIEW_OVERRIDABLE_RISK_FLAGS`. Since 2026-08-09,
`weak_industry_signal` moved from non-overridable to overridable: an
attended reviewer who explicitly classifies the employer resolves the
ambiguity. CNC claims stay hard-blocked on purpose.

## Approval-safe sources

A source is **approval-safe** when ALL hold (see `approvalSafeCandidate`
in `company-industry-review-service.ts`):

- normalized URL parses,
- `sourceType !== "search_result"`,
- `trustTier !== "discovery"`,
- `fetchStatus === "fetched"` and `sourceState === "active"`,
- not disputed/rejected.

**Approval payload sources** = recommended selection ∩ approval-safe
decisions, computed by `selectApprovalSafeSources` (shared) — one
implementation used by the web affordance model, the batch endpoint, and
the producer. A failed search-result/discovery row never hard-blocks a
proposal whose official sources fetched cleanly (fix `3ebc673a`).

## Attestation contract

`industry-review-attestation.v1`:

| Field | Meaning |
|---|---|
| `inputFingerprint` | dataset fingerprint of the reviewed packet (server-derived) |
| `decisionMode` | `standard` (no flags) or `risk_override` (any flag; reason required) |
| `acknowledgedRiskFlags` | union of the item's visible flags (server-derived at approval time) |
| `cncEvidenceAcknowledged` | required for CNC class / `cnc_claim_inferred` |
| `acknowledgementReason` | human rationale; required for `risk_override` |
| `batchId` | optional; links every revision approved in one batch |

The server materializes the per-item attestation clone (item fingerprint,
per-item flags/mode, shared `batchId`) inside
`buildIndustryApprovalDecision` — client-supplied fingerprints/flags are
never trusted. Stored verbatim on each immutable verdict revision = the
audit trail.

## Decision gates (order)

`buildIndustryApprovalDecision(packet, class?, attestation?, batchId?)`:

1. status must be `ready_for_review` → `INVALID_STATUS`
2. effective class non-`unknown` (explicit override required otherwise) → `CLASS_REQUIRED`
3. approval-safe sources non-empty → `NO_SAFE_SOURCE`
4. no non-overridable flags → `INDUSTRY_REVIEW_HARD_RISK`
5. attestation required (any flag or CNC) and valid → `INDUSTRY_REVIEW_ATTESTATION_REQUIRED` / policy codes
6. payload: server `revisionId` (`industry-<companyKey>-<uuid>`), `expected*`
   from the packet dataset, `taxonomyVersion: "industry-v1"`, attestation clone

Stale detection happens at the Convex boundary (`expectedProposalUpdatedAt`
+ `expectedCurrentRevisionId` + `expectedSourceVersions` vs the DB) →
`INDUSTRY_REVIEW_STALE` → HTTP 409. Policy failures → HTTP 422 with the
code above.

## Bulk review (batch endpoint)

`POST /api/company-industry-proposals/batch-review` — one attestation
covers the batch; items fail individually (`summary.total/succeeded/failed`
+ per-item `code`/`error`); a stale or hard-blocked item never aborts the
rest. Approve items may carry an `industryClass` override (including
`non_industry` — records `verified` + class `non_industry`, distinct from
the reject lane for noise). Max 50 actions. Successful approvals enqueue
one coalesced maintenance run.

## Identity-candidate shape contract (persistence seam)

`upsertIndustryIdentityCandidate` (Convex) enforces the same 8-80 char
window the worker extraction claims, and rejects page-title shapes
(` | ` separators; multi-word ALL-CAPS lead before ` - `) — junk like
"CNC MACHINIST CAREERS - GMI CORP" never enters the review queue (gate
added 2026-08-09).

## Reject vs hold semantics

- **reject** = noise / garbage (no real company behind the surface).
- **hold** (no status change) = real but ambiguous — needs identity
  resolution, explicit classification, or more evidence.
- A real-but-non-industrial company (Watsons, Lovisa, …) is approved with
  `industryClass: "non_industry"`, never rejected.
