/**
 * Shared ranking-quality metrics for AI scoring evaluation.
 *
 * Pure functions — no I/O, no external dependencies. Used by:
 *   - scripts/compute-scoring-metrics.ts (SQLite rating cohort)
 *   - scripts/evaluate-hr-cohort-ranking.ts (HR feedback audit cohort)
 */

export interface MetricsResult {
  n: number;
  spearmanRho: number;
  pearsonR: number;
  mae: number;
  meanScore: number;
  meanRating: number;
  ndcg5: number;
  ndcg10: number;
  ndcg20: number;
  recall5: number;
  recall10: number;
  recall20: number;
  confidence: "high" | "medium" | "low" | "insufficient";
}

export const RANKING_K_VALUES = [5, 10, 20] as const;

export function rank(values: number[]): number[] {
  const sorted = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let j = 0;
  while (j < sorted.length) {
    let k = j;
    while (k + 1 < sorted.length && sorted[k + 1].v === sorted[j].v) {
      k++;
    }
    const avgRank = (j + k) / 2 + 1;
    for (let t = j; t <= k; t++) {
      ranks[sorted[t].i] = avgRank;
    }
    j = k + 1;
  }
  return ranks;
}

export function spearmanRho(xs: number[], ys: number[]): number {
  const n = xs.length;
  const xRanks = rank(xs);
  const yRanks = rank(ys);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    sumD2 += (xRanks[i] - yRanks[i]) ** 2;
  }
  return 1 - (6 * sumD2) / (n * (n ** 2 - 1));
}

export function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? 0 : cov / denom;
}

export function mae(xs: number[], ys: number[]): number {
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += Math.abs(xs[i] - ys[i]);
  }
  return sum / xs.length;
}

export function dcgAtK(relevance: number[], k: number): number {
  const limit = Math.min(k, relevance.length);
  let dcg = 0;
  for (let i = 0; i < limit; i++) {
    dcg += relevance[i] / Math.log2(i + 2);
  }
  return dcg;
}

export function ndcgAtK(relevance: number[], idealSorted: number[], k: number): number {
  const dcg = dcgAtK(relevance, k);
  const ideal = dcgAtK(idealSorted, k);
  return ideal === 0 ? 0 : dcg / ideal;
}

export function recallAtK(relevance: number[], totalRelevant: number, k: number): number {
  if (totalRelevant === 0) return 0;
  const limit = Math.min(k, relevance.length);
  let relevantInTop = 0;
  for (let i = 0; i < limit; i++) {
    if (relevance[i] > 0) relevantInTop++;
  }
  return relevantInTop / totalRelevant;
}

export function computeMetrics(scores: number[], ratings: number[]): MetricsResult {
  const n = scores.length;
  const rho = n >= 3 ? spearmanRho(scores, ratings) : 0;
  const r = n >= 3 ? pearsonR(scores, ratings) : 0;
  const maeVal = n > 0 ? mae(scores, ratings) : 0;
  const meanScore = n > 0 ? scores.reduce((a, b) => a + b, 0) / n : 0;
  const meanRating = n > 0 ? ratings.reduce((a, b) => a + b, 0) / n : 0;

  let confidence: MetricsResult["confidence"] = "insufficient";
  if (n >= 100) confidence = "high";
  else if (n >= 30) confidence = "medium";
  else if (n >= 5) confidence = "low";

  const indexed: Array<{ score: number; rating: number }> = [];
  for (let i = 0; i < n; i++) {
    indexed.push({ score: scores[i], rating: ratings[i] });
  }
  indexed.sort((a, b) => b.score - a.score);
  const sortedRelevance = indexed.map((x) => x.rating);

  const idealSorted = [...sortedRelevance].sort((a, b) => b - a);
  let totalRelevant = 0;
  for (let i = 0; i < sortedRelevance.length; i++) {
    if (sortedRelevance[i] > 0) totalRelevant++;
  }

  const ndcg: Record<number, number> = {};
  const recall: Record<number, number> = {};
  for (const k of RANKING_K_VALUES) {
    ndcg[k] = ndcgAtK(sortedRelevance, idealSorted, k);
    recall[k] = recallAtK(sortedRelevance, totalRelevant, k);
  }

  return {
    n,
    spearmanRho: rho,
    pearsonR: r,
    mae: maeVal,
    meanScore,
    meanRating,
    ndcg5: ndcg[5],
    ndcg10: ndcg[10],
    ndcg20: ndcg[20],
    recall5: recall[5],
    recall10: recall[10],
    recall20: recall[20],
    confidence,
  };
}
