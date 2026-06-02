/**
 * Shared score semantics for full-score audit integration.
 *
 * Centralises the final AI score formula, related-exp contribution,
 * and recommendation thresholds so Convex, Web, API export, and
 * audit scripts all derive from one contract.
 *
 * Final AI Score = round(relatedExp * 0.5) + industryDb
 * Related Exp Audit Factor = breakdown.related_exp (raw/effective, 0-100)
 * Related Exp Contribution = round(Related Exp Audit Factor * 0.5)
 */

export const RELATED_EXP_DISPLAY_WEIGHT = 0.5;
export const INDUSTRY_DB_DISPLAY_CAP = 50;

/**
 * Convert a related-exp audit factor (0-100) into its weighted 0-50
 * contribution for normal UI display and final-score computation.
 */
export function computeRelatedExpContribution(relatedExp: number | undefined): number {
  if (relatedExp === undefined || !Number.isFinite(relatedExp)) {
    return 0;
  }
  const clamped = Math.max(0, relatedExp);
  return Math.round(clamped * RELATED_EXP_DISPLAY_WEIGHT);
}

/**
 * Compute the product AI score from a related-exp audit factor and a
 * deterministic industry_db value.
 *
 * Formula: round(relatedExp * 0.5) + industryDb, clamped to 0-100.
 */
export function computeFinalAiScore(
  relatedExp: number | undefined,
  industryDb: number | undefined,
): number {
  const contribution = computeRelatedExpContribution(relatedExp);
  const db = industryDb !== undefined && Number.isFinite(industryDb) ? Math.max(0, industryDb) : 0;
  return Math.min(100, Math.max(0, contribution + db));
}

/**
 * Derive the product recommendation from a final AI score.
 *
 * Thresholds:
 * - >= 85 → strong_match
 * - >= 70 → match
 * - >= 40 → potential
 * - < 40  → no_match
 */
export function recommendationFromFinalAiScore(
  score: number,
): "strong_match" | "match" | "potential" | "no_match" {
  if (score >= 85) return "strong_match";
  if (score >= 70) return "match";
  if (score >= 40) return "potential";
  return "no_match";
}
