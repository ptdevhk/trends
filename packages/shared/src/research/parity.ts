/**
 * Pure parity decision for Research Eng dual-run kill switch.
 *
 * Green only when all of:
 * 1. aggregateRatio >= 0.80
 * 2. No enabled platform with shadowCount > 0 has nativeCount == 0
 * 3. Every golden companyKey has >= 1 signal
 * 4. Native ingest is non-empty (nativeTotal > 0)
 */

export type PlatformParityRow = {
  platform: string;
  nativeCount: number;
  shadowCount: number;
};

export type GoldenCompanyInput = {
  companyKey: string;
  signalCount: number;
};

export type ParityDecisionInput = {
  platformBreakdown: readonly PlatformParityRow[];
  goldenCompanies: readonly GoldenCompanyInput[];
  /** When omitted, sum of platform nativeCount */
  nativeTotal?: number;
  /** When omitted, sum of platform shadowCount */
  shadowTotal?: number;
};

export type PlatformParityResult = PlatformParityRow & {
  ratio: number;
  zeroWithShadow: boolean;
};

export type GoldenCompanyResult = {
  companyKey: string;
  signalCount: number;
  pass: boolean;
};

export type ParityDecision = {
  nativeTotal: number;
  shadowTotal: number;
  aggregateRatio: number;
  platformBreakdown: PlatformParityResult[];
  goldenCompanyResults: GoldenCompanyResult[];
  nativeNonEmpty: boolean;
  green: boolean;
  reasons: string[];
};

const AGGREGATE_RATIO_THRESHOLD = 0.8;

function safeRatio(native: number, shadow: number): number {
  if (shadow <= 0) {
    return native > 0 ? 1 : 1;
  }
  return native / shadow;
}

export function evaluateResearchParity(input: ParityDecisionInput): ParityDecision {
  const platformBreakdown: PlatformParityResult[] = input.platformBreakdown.map((row) => {
    const ratio = safeRatio(row.nativeCount, row.shadowCount);
    const zeroWithShadow = row.shadowCount > 0 && row.nativeCount === 0;
    return {
      platform: row.platform,
      nativeCount: row.nativeCount,
      shadowCount: row.shadowCount,
      ratio,
      zeroWithShadow,
    };
  });

  const nativeTotal =
    typeof input.nativeTotal === "number"
      ? input.nativeTotal
      : platformBreakdown.reduce((sum, row) => sum + row.nativeCount, 0);
  const shadowTotal =
    typeof input.shadowTotal === "number"
      ? input.shadowTotal
      : platformBreakdown.reduce((sum, row) => sum + row.shadowCount, 0);

  const aggregateRatio = safeRatio(nativeTotal, shadowTotal);
  const goldenCompanyResults: GoldenCompanyResult[] = input.goldenCompanies.map((g) => ({
    companyKey: g.companyKey,
    signalCount: g.signalCount,
    pass: g.signalCount >= 1,
  }));

  const nativeNonEmpty = nativeTotal > 0;
  const reasons: string[] = [];

  if (aggregateRatio < AGGREGATE_RATIO_THRESHOLD) {
    reasons.push(`aggregateRatio ${aggregateRatio.toFixed(3)} < ${AGGREGATE_RATIO_THRESHOLD}`);
  }
  for (const row of platformBreakdown) {
    if (row.zeroWithShadow) {
      reasons.push(`platform ${row.platform} has shadow without native`);
    }
  }
  for (const g of goldenCompanyResults) {
    if (!g.pass) {
      reasons.push(`golden company ${g.companyKey} has no signals`);
    }
  }
  if (!nativeNonEmpty) {
    reasons.push("native ingest empty");
  }

  const green =
    aggregateRatio >= AGGREGATE_RATIO_THRESHOLD &&
    !platformBreakdown.some((row) => row.zeroWithShadow) &&
    goldenCompanyResults.every((g) => g.pass) &&
    nativeNonEmpty;

  return {
    nativeTotal,
    shadowTotal,
    aggregateRatio,
    platformBreakdown,
    goldenCompanyResults,
    nativeNonEmpty,
    green,
    reasons,
  };
}

export function nextGreenStreak(previousStreak: number, green: boolean): number {
  if (!green) {
    return 0;
  }
  return Math.max(0, previousStreak) + 1;
}
