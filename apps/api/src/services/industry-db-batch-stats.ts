import {
  computeIndustryDbDirectHitScore,
  INDUSTRY_DB_DISPLAY_CAP,
} from "@trends/shared";

export type IndustryDbV2BatchStats = {
  size: number;
  p80: number;
  histogram50: number[];
  min?: number;
  max?: number;
  p50?: number;
  mean?: number;
  stddev?: number;
};

export type NormalizedIndustryDbScore = {
  raw: number;
  normalized: number;
  percentileRank: number;
  guardRailApplied: boolean;
};

const INDUSTRY_DB_V2_SCORE_CAP = INDUSTRY_DB_DISPLAY_CAP;
const INDUSTRY_DB_V2_HISTOGRAM_SIZE = 51;
const INDUSTRY_DB_V2_MIN_NORMALIZATION_SAMPLE_SIZE = 30;
const INDUSTRY_DB_V2_MIN_NONZERO_SAMPLE_SIZE = 5;

function roundTo2(value: number): number {
  return Number(value.toFixed(2));
}

export function clampIndustryDbV2RawScore(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(INDUSTRY_DB_V2_SCORE_CAP, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const clampedQ = clamp(q, 0, 1);
  const position = (sorted.length - 1) * clampedQ;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function normalizeHistogram50(histogram50: number[]): number[] {
  return Array.from({ length: INDUSTRY_DB_V2_HISTOGRAM_SIZE }, (_, score) => {
    const count = histogram50[score];
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  });
}

function countHistogramSamples(histogram50: number[]): number {
  return histogram50.reduce((total, count) => total + count, 0);
}

export function bumpIndustryDbV2Raw(
  raw: number | undefined,
  hasBrandHits: boolean,
  hasCompanyHits: boolean
): number {
  const directHitScore = computeIndustryDbDirectHitScore(hasBrandHits, hasCompanyHits);
  return Math.max(clampIndustryDbV2RawScore(raw), directHitScore);
}

function hasNonEmployerBrandHit(brandHits: unknown[] | undefined): boolean {
  return (brandHits ?? []).some(
    (hit) => typeof hit === "object" && hit !== null && (hit as { context?: string }).context !== "employer"
  );
}

export function computeEffectiveIndustryDbV2Raw(ingestData: {
  brandHits?: unknown[];
  companyHits?: unknown[];
  industryDbV2Raw?: number;
} | null | undefined): number {
  return bumpIndustryDbV2Raw(
    ingestData?.industryDbV2Raw,
    hasNonEmployerBrandHit(ingestData?.brandHits),
    (ingestData?.companyHits?.length ?? 0) > 0,
  );
}

export function computeDirectIndustryDbScore(ingestData: {
  brandHits?: unknown[];
  companyHits?: unknown[];
  industryDbV2Raw?: number;
} | null | undefined): number {
  return computeEffectiveIndustryDbV2Raw(ingestData);
}

function nonZeroP80FromHistogram(histogram50: number[]): { p80: number; count: number } {
  const sorted: number[] = [];
  histogram50.forEach((count, score) => {
    if (score > 0) {
      for (let i = 0; i < count; i++) {
        sorted.push(score);
      }
    }
  });
  return { p80: quantile(sorted, 0.8), count: sorted.length };
}

function percentileRankFromHistogram(histogram50: number[], raw: number): number {
  const total = countHistogramSamples(histogram50);
  if (total <= 1) {
    return 1;
  }

  const roundedRaw = Math.round(clamp(raw, 0, INDUSTRY_DB_V2_SCORE_CAP));
  let lowerBound = 0;
  let upperBound = 0;

  histogram50.forEach((count, score) => {
    if (score < roundedRaw) {
      lowerBound += count;
      upperBound += count;
      return;
    }

    if (score === roundedRaw) {
      upperBound += count;
    }
  });

  if (upperBound === 0) {
    return 0;
  }

  if (lowerBound === total) {
    return 1;
  }

  const midpoint = (lowerBound + upperBound - 1) / 2;
  return midpoint / (total - 1);
}

export function computeBatchStats(rawScores: Array<number | undefined>): IndustryDbV2BatchStats {
  const sorted = rawScores
    .map((score) => clampIndustryDbV2RawScore(score))
    .sort((left, right) => left - right);
  const histogram50 = Array.from({ length: INDUSTRY_DB_V2_HISTOGRAM_SIZE }, () => 0);

  sorted.forEach((score) => {
    histogram50[Math.round(score)] += 1;
  });

  if (sorted.length === 0) {
    return {
      size: 0,
      min: 0,
      max: 0,
      p50: 0,
      p80: 0,
      mean: 0,
      stddev: 0,
      histogram50,
    };
  }

  const mean = sorted.reduce((total, score) => total + score, 0) / sorted.length;
  const variance = sorted.reduce((total, score) => total + (score - mean) ** 2, 0) / sorted.length;

  return {
    size: sorted.length,
    min: roundTo2(sorted[0]),
    max: roundTo2(sorted[sorted.length - 1]),
    p50: roundTo2(quantile(sorted, 0.5)),
    p80: roundTo2(quantile(sorted, 0.8)),
    mean: roundTo2(mean),
    stddev: roundTo2(Math.sqrt(variance)),
    histogram50,
  };
}

function guardRailResult(safeRaw: number): NormalizedIndustryDbScore {
  return {
    raw: safeRaw,
    normalized: Math.round(safeRaw),
    percentileRank: 0,
    guardRailApplied: true,
  };
}

type PreparedNormalizationContext = {
  histogram50: number[];
  sampleSize: number;
  p80: number;
};

function prepareNormalizationContext(
  stats: IndustryDbV2BatchStats
): PreparedNormalizationContext | null {
  if (stats.size < INDUSTRY_DB_V2_MIN_NORMALIZATION_SAMPLE_SIZE) {
    return null;
  }

  const histogram50 = normalizeHistogram50(stats.histogram50);
  const sampleSize = countHistogramSamples(histogram50);
  if (sampleSize < INDUSTRY_DB_V2_MIN_NORMALIZATION_SAMPLE_SIZE) {
    return null;
  }

  const { p80: effectiveP80, count: nonZeroCount } = nonZeroP80FromHistogram(histogram50);
  if (nonZeroCount < INDUSTRY_DB_V2_MIN_NONZERO_SAMPLE_SIZE) {
    return null;
  }

  return { histogram50, sampleSize, p80: effectiveP80 };
}

function normalizeWithContext(
  raw: number | undefined,
  ctx: PreparedNormalizationContext
): NormalizedIndustryDbScore {
  const safeRaw = clampIndustryDbV2RawScore(raw);
  const percentileRank = percentileRankFromHistogram(ctx.histogram50, safeRaw);
  const base = 40 * clamp(safeRaw / Math.max(ctx.p80, 1), 0, 1);
  const bonus = 10 * clamp((percentileRank - 0.8) / 0.2, 0, 1);

  return {
    raw: safeRaw,
    normalized: Math.round(Math.min(INDUSTRY_DB_V2_SCORE_CAP, base + bonus)),
    percentileRank,
    guardRailApplied: false,
  };
}

export function normalizeIndustryDbScore(
  raw: number | undefined,
  stats: IndustryDbV2BatchStats | undefined
): NormalizedIndustryDbScore {
  const safeRaw = clampIndustryDbV2RawScore(raw);
  if (!stats) {
    return guardRailResult(safeRaw);
  }

  const ctx = prepareNormalizationContext(stats);
  if (!ctx) {
    return guardRailResult(safeRaw);
  }

  return normalizeWithContext(raw, ctx);
}

export function createBatchNormalizer(
  stats: IndustryDbV2BatchStats | undefined
): (raw: number | undefined) => NormalizedIndustryDbScore {
  if (!stats) {
    return (raw) => guardRailResult(clampIndustryDbV2RawScore(raw));
  }

  const ctx = prepareNormalizationContext(stats);
  if (!ctx) {
    return (raw) => guardRailResult(clampIndustryDbV2RawScore(raw));
  }

  return (raw) => normalizeWithContext(raw, ctx);
}
