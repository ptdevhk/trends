export type RankingLabel = "shortlist" | "reject" | 1 | 0 | true | false | null | undefined;

export type LabelLookup = Record<string, RankingLabel> | Map<string, RankingLabel>;

export interface ScoreSample {
  score: number;
  label: RankingLabel;
}

export interface ScoreDistributionBucket {
  count: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
}

export interface ScoreDistributionStatsResult {
  overall: ScoreDistributionBucket;
  shortlist: ScoreDistributionBucket;
  reject: ScoreDistributionBucket;
  separation: {
    meanGap: number;
    medianGap: number;
    overlapRate: number;
    shortlistAboveRejectRate: number;
  };
}

function clampAtLeastOne(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function readLabel(labels: LabelLookup, resumeId: string): RankingLabel {
  if (labels instanceof Map) {
    return labels.get(resumeId);
  }
  return labels[resumeId];
}

function toBinaryRelevance(label: RankingLabel): 0 | 1 {
  if (label === "shortlist" || label === true || label === 1) {
    return 1;
  }
  return 0;
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(4));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const clampedQ = Math.max(0, Math.min(1, q));
  const position = (sorted.length - 1) * clampedQ;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function summarizeScores(scores: number[]): ScoreDistributionBucket {
  if (scores.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      p25: 0,
      p75: 0,
      min: 0,
      max: 0,
    };
  }

  const sorted = [...scores].sort((left, right) => left - right);
  const sum = sorted.reduce((acc, value) => acc + value, 0);

  return {
    count: sorted.length,
    mean: roundMetric(sum / sorted.length),
    median: roundMetric(quantile(sorted, 0.5)),
    p25: roundMetric(quantile(sorted, 0.25)),
    p75: roundMetric(quantile(sorted, 0.75)),
    min: roundMetric(sorted[0]),
    max: roundMetric(sorted[sorted.length - 1]),
  };
}

function shortlistAboveRejectRate(shortlistScores: number[], rejectScores: number[]): number {
  if (shortlistScores.length === 0 || rejectScores.length === 0) {
    return 0;
  }

  let higherCount = 0;
  let comparisons = 0;

  for (const shortlistScore of shortlistScores) {
    for (const rejectScore of rejectScores) {
      comparisons += 1;
      if (shortlistScore > rejectScore) {
        higherCount += 1;
      }
    }
  }

  if (comparisons === 0) {
    return 0;
  }

  return roundMetric(higherCount / comparisons);
}

export function ndcgAtK(ranked: string[], labels: LabelLookup, k: number): number {
  if (ranked.length === 0) {
    return 0;
  }

  const topK = ranked.slice(0, clampAtLeastOne(k));
  let dcg = 0;

  for (let index = 0; index < topK.length; index += 1) {
    const relevance = toBinaryRelevance(readLabel(labels, topK[index]));
    if (relevance === 0) {
      continue;
    }
    dcg += relevance / Math.log2(index + 2);
  }

  const positives = topK
    .map((resumeId) => toBinaryRelevance(readLabel(labels, resumeId)))
    .reduce<number>((acc, relevance) => acc + relevance, 0);

  if (positives === 0) {
    return 0;
  }

  let idcg = 0;
  for (let index = 0; index < positives; index += 1) {
    idcg += 1 / Math.log2(index + 2);
  }

  if (idcg === 0) {
    return 0;
  }

  return roundMetric(dcg / idcg);
}

export function shortlistAtK(ranked: string[], labels: LabelLookup, k: number): number {
  if (ranked.length === 0) {
    return 0;
  }

  const topK = ranked.slice(0, clampAtLeastOne(k));
  if (topK.length === 0) {
    return 0;
  }

  const shortlisted = topK
    .map((resumeId) => toBinaryRelevance(readLabel(labels, resumeId)))
    .reduce<number>((acc, relevance) => acc + relevance, 0);

  return roundMetric(shortlisted / topK.length);
}

function rank(values: number[]): number[] {
  const sorted = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let j = 0;
  while (j < sorted.length) {
    let k = j;
    while (k + 1 < sorted.length && sorted[k + 1].v === sorted[j].v) k++;
    const avgRank = (j + k) / 2 + 1;
    for (let t = j; t <= k; t++) ranks[sorted[t].i] = avgRank;
    j = k + 1;
  }
  return ranks;
}

export function spearmanRho(xs: number[], ys: number[]): number {
  if (xs.length < 3) return 0;
  const xRanks = rank(xs);
  const yRanks = rank(ys);
  let sumD2 = 0;
  for (let i = 0; i < xs.length; i++) sumD2 += (xRanks[i] - yRanks[i]) ** 2;
  return 1 - (6 * sumD2) / (xs.length * (xs.length ** 2 - 1));
}

export function scoreDistributionStats(samples: ScoreSample[]): ScoreDistributionStatsResult {
  const shortlistScores = samples
    .filter((sample) => toBinaryRelevance(sample.label) === 1)
    .map((sample) => sample.score)
    .filter((score) => Number.isFinite(score));
  const rejectScores = samples
    .filter((sample) => toBinaryRelevance(sample.label) === 0)
    .map((sample) => sample.score)
    .filter((score) => Number.isFinite(score));
  const allScores = [...shortlistScores, ...rejectScores];

  const shortlistSummary = summarizeScores(shortlistScores);
  const rejectSummary = summarizeScores(rejectScores);
  const overallSummary = summarizeScores(allScores);

  const overlapRate = shortlistScores.length > 0 && rejectScores.length > 0
    ? roundMetric(
      shortlistScores.filter((score) => score <= rejectSummary.median).length / shortlistScores.length
    )
    : 0;

  return {
    overall: overallSummary,
    shortlist: shortlistSummary,
    reject: rejectSummary,
    separation: {
      meanGap: roundMetric(shortlistSummary.mean - rejectSummary.mean),
      medianGap: roundMetric(shortlistSummary.median - rejectSummary.median),
      overlapRate,
      shortlistAboveRejectRate: shortlistAboveRejectRate(shortlistScores, rejectScores),
    },
  };
}
