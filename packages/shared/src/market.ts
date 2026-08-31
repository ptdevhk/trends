/**
 * Canonical market discriminator for resume sources.
 * Used by ingest pipeline, rule scoring, and UI to apply
 * market-specific behavior (e.g., industry DB graceful degradation for MY).
 */
export type KeywordMarket = "CN" | "MY" | "TH";

/**
 * Maps sourceKey values (from Convex resume.sourceKey and collectionSource.type)
 * to their canonical market.
 */
export const SOURCE_KEY_TO_MARKET: Record<string, KeywordMarket> = {
  job5156: "CN",
  "51job": "CN",
  seek: "MY",
};

/**
 * Derive market from a sourceKey string.
 * Returns "CN" as default when sourceKey is unrecognized or missing,
 * since all legacy data is CN-market.
 */
export function deriveMarketFromSourceKey(sourceKey?: string | null): KeywordMarket {
  if (!sourceKey) return "CN";
  return SOURCE_KEY_TO_MARKET[sourceKey] ?? "CN";
}
