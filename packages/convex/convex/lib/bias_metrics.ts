/**
 * Fairness/bias metric computations for EU AI Act compliance.
 *
 * Implements demographic parity (four-fifths rule), equalized odds,
 * and disparate impact ratio. No external dependencies required —
 * the statistical definitions are straightforward; the value is in
 * applying them correctly, not in the code complexity.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroupOutcome {
    groupKey: string; // e.g. "age_25-30", "location_shanghai"
    total: number;
    positive: number; // Count of scores above threshold
    avgScore: number;
    scoreStdDev: number;
}

export interface GroupConfusion {
    groupKey: string;
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
}

export interface DemographicParityResult {
    disparityRatio: number; // min/max selection rate; >= 0.8 passes
    maxDifference: number;
    passing: boolean; // four-fifths rule
    groupRates: Array<{ groupKey: string; rate: number }>;
}

export interface EqualizedOddsResult {
    tprDifference: number;
    fprDifference: number;
    passing: boolean; // both TPR and FPR diff <= 0.1
    groupMetrics: Array<{ groupKey: string; tpr: number; fpr: number }>;
}

// ---------------------------------------------------------------------------
// Demographic Parity (Statistical Parity)
// ---------------------------------------------------------------------------

/**
 * Compute demographic parity across groups.
 * The four-fifths rule requires min-rate / max-rate >= 0.8.
 */
export function computeDemographicParity(
    groups: GroupOutcome[],
): DemographicParityResult {
    const groupRates = groups.map((g) => ({
        groupKey: g.groupKey,
        rate: g.total > 0 ? g.positive / g.total : 0,
    }));

    const rates = groupRates.map((r) => r.rate);
    const maxRate = Math.max(...rates);
    const minRate = Math.min(...rates);

    const disparityRatio = maxRate > 0 ? minRate / maxRate : 1;

    return {
        disparityRatio,
        maxDifference: maxRate - minRate,
        passing: disparityRatio >= 0.8,
        groupRates,
    };
}

// ---------------------------------------------------------------------------
// Equalized Odds
// ---------------------------------------------------------------------------

/**
 * Compute equalized odds: TPR and FPR should be equal across groups.
 * Requires ground-truth labels (human review outcomes).
 */
export function computeEqualizedOdds(
    groups: GroupConfusion[],
): EqualizedOddsResult {
    const groupMetrics = groups.map((g) => {
        const totalPositive = g.truePositives + g.falseNegatives;
        const totalNegative = g.trueNegatives + g.falsePositives;
        return {
            groupKey: g.groupKey,
            tpr: totalPositive > 0 ? g.truePositives / totalPositive : 0,
            fpr: totalNegative > 0 ? g.falsePositives / totalNegative : 0,
        };
    });

    const tprs = groupMetrics.map((m) => m.tpr);
    const fprs = groupMetrics.map((m) => m.fpr);

    const tprDiff = Math.max(...tprs) - Math.min(...tprs);
    const fprDiff = Math.max(...fprs) - Math.min(...fprs);

    return {
        tprDifference: tprDiff,
        fprDifference: fprDiff,
        passing: tprDiff <= 0.1 && fprDiff <= 0.1,
        groupMetrics,
    };
}

// ---------------------------------------------------------------------------
// Disparate Impact Ratio
// ---------------------------------------------------------------------------

/**
 * Compute the disparate impact ratio between a protected group
 * and a reference group. A ratio < 0.8 indicates potential bias.
 */
export function computeDisparateImpactRatio(
    protectedGroup: GroupOutcome,
    referenceGroup: GroupOutcome,
): number {
    const protectedRate = protectedGroup.total > 0
        ? protectedGroup.positive / protectedGroup.total
        : 0;
    const referenceRate = referenceGroup.total > 0
        ? referenceGroup.positive / referenceGroup.total
        : 0;
    return referenceRate > 0 ? protectedRate / referenceRate : 1;
}

// ---------------------------------------------------------------------------
// Population Stability Index (PSI)
// ---------------------------------------------------------------------------

/**
 * Compute the Population Stability Index between a baseline and current
 * score distribution. PSI > 0.25 indicates significant drift.
 *
 * Both distributions are bucketed into equal-width bins across [0, 100].
 * Returns PSI value and a boolean indicating whether drift is significant.
 */
export function computePSI(
    baseline: number[],
    current: number[],
    numBins: number = 10,
): { psi: number; driftDetected: boolean; baselineCounts: number[]; currentCounts: number[] } {
    const binWidth = 100 / numBins;
    const baselineCounts = new Array(numBins).fill(0) as number[];
    const currentCounts = new Array(numBins).fill(0) as number[];

    for (const score of baseline) {
        const bin = Math.min(Math.floor(score / binWidth), numBins - 1);
        baselineCounts[bin]++;
    }
    for (const score of current) {
        const bin = Math.min(Math.floor(score / binWidth), numBins - 1);
        currentCounts[bin]++;
    }

    // Convert to proportions with Laplace smoothing to avoid zero divisions
    const smooth = 0.001;
    const baselineTotal = baseline.length + numBins * smooth;
    const currentTotal = current.length + numBins * smooth;

    let psi = 0;
    for (let i = 0; i < numBins; i++) {
        const p = (baselineCounts[i] + smooth) / baselineTotal;
        const q = (currentCounts[i] + smooth) / currentTotal;
        psi += (q - p) * Math.log(q / p);
    }

    return {
        psi,
        driftDetected: psi > 0.25,
        baselineCounts,
        currentCounts,
    };
}

// ---------------------------------------------------------------------------
// Protected Attribute Hashing
// ---------------------------------------------------------------------------

/**
 * Map an age to a bracket before hashing — prevents re-identification.
 */
export function ageToBracket(age: number): string {
    if (age < 25) return "under_25";
    if (age < 30) return "25-29";
    if (age < 35) return "30-34";
    if (age < 40) return "35-39";
    if (age < 45) return "40-44";
    if (age < 50) return "45-49";
    return "50_plus";
}

/**
 * FNV-1a hash for audit logging. Not cryptographically strong but
 * sufficient for grouping by bracket without storing raw values.
 */
export function fnvHash(input: string): string {
    let hash = 2166136261;
    for (const char of input) {
        hash ^= char.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
