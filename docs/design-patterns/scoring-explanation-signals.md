# Resume Score Explanation Signals

## Status

Design note for explainability and drift auditability of resume AI scoring
(work item `2026-08-18-resume-scoring-explainability-drift`).

Implemented and verified: the drift canary (Convex `bias_audit` module +
cron, BFF routes `/api/resumes/anomaly-alerts` and
`/api/resumes/bias-anomaly-notify`, web `AuditCompliancePage`), the cohort
evaluator with parity gating (`scripts/evaluate-hr-cohort-ranking.ts`, see
`docs/runbooks/rerank-gap-analysis.md`), and the scoring-health metrics CLI
(`scripts/compute-scoring-metrics.ts` — Spearman/Pearson/MAE/NDCG/Recall
against HR ratings, usage documented in the same runbook). Verified
2026-08-18: resumes_admin 32 tests, cohort evaluator 13 tests,
AuditCompliancePage 20 tests, full web suite 1971 tests green.

Recommended-only (not implemented): the reviewer-visible score-explanation
block below and the multi-agent explanation contract in the future section.

## Problem

A reviewer must be able to answer two questions from the UI, not from a
support ticket:

1. **Why this score?** Which factors moved the score, and what evidence
   supports each factor?
2. **Why this order?** When the cohort evaluator (see
   `docs/runbooks/rerank-gap-analysis.md`) reports a ranking gap for a board,
   the reviewer needs per-resume signals to explain *why* scores diverged
   from HR expectations.

## Reviewer-visible signals today

| Signal | Where | Shape |
|---|---|---|
| `breakdown` (experience/skills/industry_db/education/location) | DebugAI page (`extractBreakdown`, `apps/web/src/lib/debug-ai-score-utils.ts`) | 0–100 factor values |
| `aiSummary` | Search page summary panel | Free-text narrative |
| `Current AI Summary` / `Highlights` / `Concerns` | Audit exports | Free text |
| `Missing Reasons` | Audit exports | Reason list (P1 evidence ceiling) |
| `Related Exp Audit Factor` / `Industry DB` / `Evidence Band Max` / `Effective Related Exp` | Audit exports | Numeric factor + ceiling state |

Gaps: the search-page reviewer sees the narrative summary but not the factor
breakdown; the breakdown is debug-only. Missing Reasons and the evidence band
ceiling exist in exports but are not surfaced in the reviewer UI.

## Reviewer UI shape (recommended)

A compact "score explanation" block on the resume detail/search result:

- Total score + `breakdown` bars (the five factors), matching DebugAI so
  debug and reviewer views never disagree.
- `Missing Reasons` chips when present (why the evidence ceiling capped a
  factor).
- One-line evidence citation per factor when available (matched work entries
  for related-exp, verified industry hits for industry_db).
- No new backend storage: read the existing `analysis` document fields.

## Multi-agent shape (future)

If scoring moves to a multi-agent pipeline (per-factor agents), each emitted
explanation must carry, per factor:

- **Agent attribution**: which agent/step produced the factor (stable id,
  not free text).
- **Factor confidence**: high/medium/low, with the same banding convention
  as `MetricsResult.confidence` (n-based bands) or evidence-based.
- **Source citations**: stable references (work-entry ids, industry-db
  revision ids, rule names) rather than prose.
- **Ceiling state**: which cap applied (`Evidence Band Max`) and why.

Contract: the explanation document must remain derivable from a single
resume `analysis` doc so audits and the drift canary never need to call the
LLM again to explain a score.

## Drift linkage

- The cohort evaluator's per-board rows identify *where* ordering degrades;
  the explanation signals identify *why* at the row level.
- The drift canary (Convex `bias_audit` + BFF route, per-board) compares
  score/rating agreement over time; explanation signals let a human confirm
  whether the drift is evidence-driven (expected) or prompt/factor-driven
  (actionable).
- Parity checks in `evaluate-hr-cohort-ranking.ts` gate scoring changes;
  explanation shape changes must not alter `analysis.score` semantics
  (guarded by the existing scoring tests).
