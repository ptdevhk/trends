# Rerank-Gap Analysis: AI Score vs HR Rating

## What this is

Quantifies how well AI-score ordering agrees with HR-rated ordering for a
cohort of reviewed resumes, and locates the boards/categories where the
agreement is weakest. Use it before changing scoring logic: a scoring change
is only justified if it closes a measured ordering gap, and every change
should be verified against the previous evaluation (parity).

## Inputs

Two supported sources, both feeding the shared metric functions in
`scripts/lib/ranking-metrics.ts`:

1. **HR feedback audit CSV** — produced by the resume-ai-scoring-audit skill
   (`.agents/skills/resume-ai-scoring-audit/scripts/audit_hr_feedback_export.py`)
   from a reference HR cohort joined to a current export:
   `output/resume-ai-scoring-audit/hr-feedback-audit.csv`.
   Columns used: `Profile Resume ID`, `HR Category`, `HR Expected`,
   `Current Final AI Score` (fallback `Current AI Score`).
2. **Local SQLite ratings** — `output/resume_screening.db`
   `candidate_actions` (rating actions) joined with AI scores from a backup
   JSON via `scripts/compute-scoring-metrics.ts`.

## Commands

```bash
# Full cohort evaluation (overall + per-board + parity vs previous run)
bun run scripts/evaluate-hr-cohort-ranking.ts \
  --audit-csv output/resume-ai-scoring-audit/hr-feedback-audit.csv \
  --baseline output/resume-ai-scoring-audit/cohort-ranking-eval.json \
  --out-json output/resume-ai-scoring-audit/cohort-ranking-eval.json

# SQLite ratings + backup scores (Spearman/Pearson/MAE/NDCG/Recall)
bun run scripts/compute-scoring-metrics.ts --backup output/resume-backups/file.json
```

Rating resolution per row: numeric `HR Expected` wins; otherwise `HR Category`
maps high=3, medium=2, low=1. Rows without a resolvable rating or score are
excluded and counted in the report.

## Interpreting the report

| Metric | Meaning | Guide |
|---|---|---|
| Spearman ρ | Rank agreement (ordering quality) | >0.7 strong, 0.4–0.7 moderate, <0.4 weak |
| Pearson r | Linear agreement | same scale; sensitive to outliers |
| MAE | Average |score − rating| | <10 tight, 10–20 moderate, >20 recalibrate |
| NDCG@K | Top-K ranking quality vs ideal (1.0 = perfect) | ≥0.9 near-optimal, 0.8–0.9 acceptable, <0.8 investigate |
| Recall@K | Fraction of all rated candidates inside top K by AI score | compare K=5/10/20 |

Confidence bands: N=≥100 high, ≥30 medium, ≥5 low, else insufficient. Do not
make scoring changes on low/insufficient samples.

Per-board rows (HR Category) surface the weakest segment: a low NDCG in one
category with an acceptable overall number points at category-specific
evidence gaps rather than global calibration.

## Parity guard

`--baseline` compares NDCG@10 and Recall@10 against a previous evaluation and
exits 2 when either drops beyond tolerance (default 0.05):

```bash
bun run scripts/evaluate-hr-cohort-ranking.ts \
  --audit-csv <audit.csv> --baseline <previous.json> \
  --ndcg-tolerance 0.05 --recall-tolerance 0.05
```

Wire this into CI/cron after every scoring-affecting deploy. A degraded exit
means the change reordered the cohort worse than before; investigate before
promoting.

## Worked example: local-data demo run (2026-08-18)

Fully-local demo without live prod access, using the prod backup bundle:

```bash
# 1. Build the demo cohort: ratings from backup sqlite candidate_actions,
#    AI scores from backup convex-export.zip resume_analyses (latest by updatedAt)
python3 /tmp/build-local-demo-cohort.py output/resume-ai-scoring-audit/local-demo-20260818

# 2. Evaluate (no --baseline → clean exit 0)
bunx tsx scripts/evaluate-hr-cohort-ranking.ts \
  --audit-csv output/resume-ai-scoring-audit/local-demo-20260818/hr-feedback-audit.csv \
  --out-json output/resume-ai-scoring-audit/local-demo-20260818/cohort-ranking-eval.json

# 3. Cross-check with the SQLite-metrics path
bun run scripts/compute-scoring-metrics.ts \
  --backup output/resume-ai-scoring-audit/local-demo-20260818/scores-backup.json
```

Result: N=19, ρ=0.412, NDCG@10=0.85–0.87, Recall@10=0.526 [low confidence].
MAE (~71) is a scale artifact — ratings are 0–3 while AI scores are 0–100; read
the rank metrics (ρ/NDCG/Recall), not MAE. Full record:
`/root/wiki/projects/trends/work/2026-08-18-ai-scoring-evaluation-ndcg-recall/log.md`.

## When NOT to act on a gap

- N is small (<30) or confidence is low/insufficient.
- One board dominates the cohort — stratify first and compare per-board.
- The gap is driven by score *calibration* (MAE) rather than *ordering*
  (ρ/NDCG): ranking quality is what affects which resumes surface.
- No baseline parity run exists for the proposed change — run one first.

## Fix loop

1. Rerun the audit export for the same reference cohort (stable profile
   resume IDs, not Convex IDs).
2. Evaluate with baseline parity; confirm the gap is real and not a cohort
   artifact.
3. Inspect the weakest board's rows: `Current AI Summary` /
   `Current Highlights` / `Current Concerns` and `Missing Reasons` explain
   why scores diverged from HR expectations.
4. Change scoring inputs (factors, prompts, thresholds), re-analyze the
   cohort, re-evaluate with the same baseline.
5. Keep the change only if parity is clean or improved; otherwise revert.
