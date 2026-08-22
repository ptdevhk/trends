/**
 * Simple deterministic mock scorer for local testing of MY cohort evaluation and gates.
 *
 * Takes target profiles/ratings and generates AI scores with configurable noise levels.
 */

import { mulberry32 } from "../generate-my-cohort.js";

export interface MockScorerOptions {
  seed?: number;
  /**
   * "clean": Near-perfect scoring (QWK >= 0.85, high Spearman/NDCG, low MAE).
   * "noisy": Degraded scoring with high variance and inverted rankings.
   */
  noiseLevel?: "clean" | "noisy";
}

export function generateMockScores(
  targets: Record<string, { overall: number }>,
  options: MockScorerOptions = {}
): Record<string, number> {
  const seed = options.seed ?? 20260819;
  const noiseLevel = options.noiseLevel ?? "clean";
  const rng = mulberry32(seed);

  const scores: Record<string, number> = {};

  for (const [id, target] of Object.entries(targets)) {
    const rating = target.overall; // 1..5

    if (noiseLevel === "clean") {
      // Map 1..5 to roughly 30..90 with small perturbation (±3 points)
      // Base: 1 -> 35, 2 -> 50, 3 -> 65, 4 -> 80, 5 -> 95
      const base = 20 + rating * 15;
      const jitter = (rng() - 0.5) * 6; // -3 to +3
      scores[id] = Math.round(Math.min(100, Math.max(0, base + jitter)));
    } else {
      // Noisy: large random perturbation, breaks correlation
      const randomBase = 30 + rng() * 60; // 30..90 uniform
      // Invert slightly
      const inverted = 100 - rating * 15;
      const mixed = 0.5 * randomBase + 0.5 * inverted + (rng() - 0.5) * 20;
      scores[id] = Math.round(Math.min(100, Math.max(0, mixed)));
    }
  }

  return scores;
}
