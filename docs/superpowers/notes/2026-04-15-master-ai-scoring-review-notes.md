# Master AI Scoring Review Notes

Date: 2026-04-15  
Scope: Resume analysis scoring (`related_exp`, `industry_db`, `score`, `recommendation`) and filter handoff paths that impact observed scoring outcomes on `/dev/resumes`.

## 1) Canonical Scoring Contract (Current)

### 1.1 Source of truth
- Primary scoring normalization happens at Convex write-time in:
  - `packages/convex/convex/analyze.ts` (`normalizeAnalysisResult`)
- This is the canonical place that enforces final persisted score semantics.

### 1.2 Formula
- Raw AI field:
  - `breakdown.related_exp` is preserved as raw `0-100`.
- Weighted contribution:
  - `related_exp_contribution = round(clamp(related_exp, 0, 100) * 0.5)` => `0-50`.
- `industry_db` contribution:
  - Computed from ingest evidence, not trusted from raw AI field:
    - If `companyHits` exists, or non-employer `brandHits` exists => `industry_db = 50`.
    - Else fallback to `clamp(industryDbV2Raw, 0, 50)`.
- Final score:
  - `score = clamp(related_exp_contribution + industry_db, 0, 100)`.

### 1.3 Recommendation thresholds
- `strong_match`: `score >= 85`
- `match`: `score >= 70`
- `potential`: `score >= 40`
- `no_match`: `< 40`

Threshold logic is aligned in:
- Convex normalize path (`packages/convex/convex/analyze.ts`)
- Web helper (`apps/web/src/lib/resume-scoring.ts`)

## 2) Sales-Specific Guardrails

### 2.1 Sales floor for related_exp
- When target role context is sales, and role evidence indicates direct sales with `>= 3y`, apply floor:
  - `related_exp = max(related_exp, 80)`
- Evidence uses `ingestData.roleSignals` and matched sales signals/work-entry hints.

### 2.2 Why this exists
- Prevents systematic under-scoring of direct sales candidates with clear sales evidence.
- Reduces unstable low `related_exp` values (e.g., repeatedly stuck in 20-30 range for clear sales resumes).

## 3) Summary Consistency Normalization

### 3.1 Problem addressed
- LLM summary text could mention stale score/recommendation (e.g., `score 58`) while normalized persisted score is different (e.g., 90).

### 3.2 Current fix
- On write, summary text is normalized to consistent numeric/recommendation mentions:
  - Replace stale `score` mentions with normalized score.
  - Replace stale recommendation tokens with normalized recommendation.
  - If mismatch was detected, append canonical normalized sentence.

### 3.3 Practical outcome
- Prevents user-facing contradictions like:
  - Stored `score: 90`, `recommendation: strong_match`
  - But summary says “综合 score 58 … 潜在匹配”.

## 4) UI Display Contract

### 4.1 `relatedExp` shown on `/dev/resumes`
- Expected UI transform:
  - `displayed relatedExp = round(clamp(raw related_exp, 0, 100) * 0.5)`

### 4.2 Recommendation display
- Valid stored recommendation is displayed.
- Invalid values are coerced by `toRecommendation`.
- Web threshold helper is also aligned with Convex normalization thresholds.

### 4.3 Industry DB display nuance
- Web can recompose/override `industry_db` breakdown for certain views using normalized cohort handling (`overrideIndustryDbBreakdown`) to keep display consistent with current contract.

## 5) Quick-Start Role Years Handoff (Important)

This is not a score formula change, but directly affects candidate set and therefore observed score distribution.

### 5.1 Root issue (fixed)
- Landing quick-start flow previously dropped role-year constraints:
  - Quick-start seed lacked `minRoleYears`.
  - `SearchHero` click payload omitted `minRoleYears` / `roleFilterType`.
  - `submitSearch` options did not accept these fields.

### 5.2 Current behavior
- Quick-start seed now carries:
  - `minRoleYears`, `roleFilterType` (when available).
- Sales quick-start compatibility fallback:
  - If explicit `minRoleYears` missing and context implies sales, fallback from `minExperience`.
- `submitSearch` now accepts and syncs:
  - `minRoleYears`
  - `roleFilterType`
- When role-years are used for quick-start, `minExperience` is intentionally not double-applied.

## 6) Review Checklist For Users

1. Open target search URL (example):
   - `/dev/resumes?location=China&q=CNC+%E9%94%80%E5%94%AE&minRoleYears=2&minAge=25&maxAge=40`
2. Confirm URL contains `minRoleYears` and optional `roleType`.
3. Sample 5-10 rows and compare:
   - Displayed `relatedExp`
   - Stored raw `analysis.breakdown.related_exp` (AI debugger / Convex query)
4. Verify recommendation-score consistency:
   - `>=85 strong_match`, `70-84 match`, `40-69 potential`, `<40 no_match`
5. Check summary text for contradictions:
   - No stale score text against persisted score.

## 7) Verification Commands

### 7.1 Focused web tests
```bash
npm --workspace @trends/web run test -- \
  src/components/search/SearchHero.test.tsx \
  src/pages/ResumeSearchPage.test.tsx \
  src/hooks/useIndustryKeywords.test.tsx
```

### 7.2 Convex scoring normalization tests
```bash
bunx vitest run \
  packages/convex/convex/__tests__/analysis-strict-evidence.test.ts \
  packages/convex/convex/__tests__/analysis-idempotency.test.ts
```

### 7.3 Full repo check gate
```bash
make check
```

## 8) Anchor Files

- Convex normalization:
  - `packages/convex/convex/analyze.ts`
  - `packages/convex/convex/analysis_tasks.ts`
- Prompt contract:
  - `config/resume/ai-prompts.md`
  - `config/resume/ai-prompts.en.md`
  - `packages/shared/src/generated/resume-ai-prompts.ts`
- Web scoring/render:
  - `apps/web/src/lib/resume-scoring.ts`
  - `apps/web/src/hooks/useResumeSearchState.ts`
  - `apps/web/src/components/search/SearchHero.tsx`
  - `apps/web/src/hooks/useIndustryKeywords.ts`
  - `apps/web/src/pages/ResumeSearchPage.tsx`

## 9) Current Known Good Example

- Resume ID: `k176cmvm479sbj1chphgnz3zdx84wmg3`
- Expected latest consistent state:
  - `score: 90`
  - `recommendation: strong_match`
  - `breakdown.related_exp: 80`
  - `breakdown.industry_db: 50`
  - Summary text aligned with normalized result (no stale `score 58` mismatch).
