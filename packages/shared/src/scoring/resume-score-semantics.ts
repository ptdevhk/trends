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
export const INDUSTRY_DB_SINGLE_HIT_SCORE = 40;
export const MY_INDUSTRY_DB_FLOOR = 40;
export const TH_INDUSTRY_DB_FLOOR = 40;

export function computeIndustryDbDirectHitScore(
  hasBrandHits: boolean,
  hasCompanyHits: boolean,
): number {
  const hasAnyHit = hasBrandHits || hasCompanyHits;
  const hasBothHits = hasBrandHits && hasCompanyHits;
  return (hasAnyHit ? INDUSTRY_DB_SINGLE_HIT_SCORE : 0) + (hasBothHits ? 10 : 0);
}

export function summarizeNonEmployerBrandHits(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const brandKeys = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const context = typeof record.context === "string" ? record.context.trim().toLowerCase() : "";
    if (context === "employer") {
      continue;
    }
    const brand = typeof record.brand === "string" ? record.brand.trim() : "";
    if (brand.length === 0) {
      continue;
    }
    brandKeys.add(brand);
  }

  return [...brandKeys];
}

export function applyMarketIndustryDbFloor(
  market: string | undefined,
  industryDb: number | undefined,
): number {
  const normalizedMarket = typeof market === "string" ? market.trim().toUpperCase() : "";
  const safeIndustryDb = industryDb !== undefined && Number.isFinite(industryDb) ? Math.max(0, industryDb) : 0;
  return normalizedMarket === "MY" ? Math.max(MY_INDUSTRY_DB_FLOOR, safeIndustryDb)
    : normalizedMarket === "TH" ? Math.max(TH_INDUSTRY_DB_FLOOR, safeIndustryDb)
    : safeIndustryDb;
}

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
