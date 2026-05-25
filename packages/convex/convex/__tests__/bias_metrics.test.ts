/**
 * Unit tests for lib/bias_metrics.ts
 */
import { describe, expect, it } from "vitest";
import {
    computeDemographicParity,
    computeEqualizedOdds,
    computeDisparateImpactRatio,
    computePSI,
    ageToBracket,
    fnvHash,
    type GroupOutcome,
    type GroupConfusion,
} from "../lib/bias_metrics.js";

// ---------------------------------------------------------------------------
// ageToBracket
// ---------------------------------------------------------------------------
describe("ageToBracket", () => {
    it("maps ages to correct brackets", () => {
        expect(ageToBracket(22)).toBe("under_25");
        expect(ageToBracket(25)).toBe("25-29");
        expect(ageToBracket(30)).toBe("30-34");
        expect(ageToBracket(35)).toBe("35-39");
        expect(ageToBracket(40)).toBe("40-44");
        expect(ageToBracket(45)).toBe("45-49");
        expect(ageToBracket(50)).toBe("50_plus");
        expect(ageToBracket(65)).toBe("50_plus");
    });
});

// ---------------------------------------------------------------------------
// fnvHash
// ---------------------------------------------------------------------------
describe("fnvHash", () => {
    it("returns deterministic 8-char hex string", () => {
        const hash = fnvHash("test");
        expect(hash).toMatch(/^[0-9a-f]{8}$/);
        expect(fnvHash("test")).toBe(hash);
    });

    it("produces different hashes for different inputs", () => {
        expect(fnvHash("foo")).not.toBe(fnvHash("bar"));
    });
});

// ---------------------------------------------------------------------------
// computeDemographicParity
// ---------------------------------------------------------------------------
describe("computeDemographicParity", () => {
    it("passes four-fifths rule for equal rates", () => {
        const groups: GroupOutcome[] = [
            { groupKey: "A", total: 100, positive: 50, avgScore: 70, scoreStdDev: 10 },
            { groupKey: "B", total: 100, positive: 50, avgScore: 70, scoreStdDev: 10 },
        ];
        const result = computeDemographicParity(groups);
        expect(result.disparityRatio).toBe(1);
        expect(result.passing).toBe(true);
        expect(result.maxDifference).toBe(0);
    });

    it("fails four-fifths rule for disparate rates", () => {
        const groups: GroupOutcome[] = [
            { groupKey: "A", total: 100, positive: 80, avgScore: 80, scoreStdDev: 10 },
            { groupKey: "B", total: 100, positive: 20, avgScore: 40, scoreStdDev: 10 },
        ];
        const result = computeDemographicParity(groups);
        expect(result.disparityRatio).toBe(0.25);
        expect(result.passing).toBe(false);
    });

    it("handles zero-total groups", () => {
        const groups: GroupOutcome[] = [
            { groupKey: "A", total: 0, positive: 0, avgScore: 0, scoreStdDev: 0 },
            { groupKey: "B", total: 100, positive: 50, avgScore: 70, scoreStdDev: 10 },
        ];
        const result = computeDemographicParity(groups);
        expect(result.disparityRatio).toBe(0);
        expect(result.passing).toBe(false);
    });

    it("passes with clearly above 80% ratio", () => {
        const groups: GroupOutcome[] = [
            { groupKey: "A", total: 100, positive: 80, avgScore: 80, scoreStdDev: 10 },
            { groupKey: "B", total: 100, positive: 70, avgScore: 70, scoreStdDev: 10 },
        ];
        const result = computeDemographicParity(groups);
        expect(result.disparityRatio).toBeCloseTo(0.875, 10);
        expect(result.passing).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// computeEqualizedOdds
// ---------------------------------------------------------------------------
describe("computeEqualizedOdds", () => {
    it("passes when TPR and FPR are equal across groups", () => {
        const groups: GroupConfusion[] = [
            { groupKey: "A", truePositives: 80, falsePositives: 10, trueNegatives: 80, falseNegatives: 20 },
            { groupKey: "B", truePositives: 40, falsePositives: 5, trueNegatives: 40, falseNegatives: 10 },
        ];
        const result = computeEqualizedOdds(groups);
        expect(result.tprDifference).toBe(0);
        expect(result.fprDifference).toBe(0);
        expect(result.passing).toBe(true);
    });

    it("fails when TPR difference exceeds 0.1", () => {
        const groups: GroupConfusion[] = [
            { groupKey: "A", truePositives: 90, falsePositives: 10, trueNegatives: 90, falseNegatives: 10 },
            { groupKey: "B", truePositives: 10, falsePositives: 10, trueNegatives: 90, falseNegatives: 90 },
        ];
        const result = computeEqualizedOdds(groups);
        expect(result.passing).toBe(false);
    });

    it("handles zero-total groups", () => {
        const groups: GroupConfusion[] = [
            { groupKey: "A", truePositives: 0, falsePositives: 0, trueNegatives: 0, falseNegatives: 0 },
            { groupKey: "B", truePositives: 50, falsePositives: 5, trueNegatives: 45, falseNegatives: 50 },
        ];
        const result = computeEqualizedOdds(groups);
        expect(result.groupMetrics).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// computeDisparateImpactRatio
// ---------------------------------------------------------------------------
describe("computeDisparateImpactRatio", () => {
    it("returns 1 for equal rates", () => {
        const protectedGroup: GroupOutcome = { groupKey: "A", total: 100, positive: 50, avgScore: 70, scoreStdDev: 10 };
        const referenceGroup: GroupOutcome = { groupKey: "B", total: 100, positive: 50, avgScore: 70, scoreStdDev: 10 };
        expect(computeDisparateImpactRatio(protectedGroup, referenceGroup)).toBe(1);
    });

    it("returns correct ratio for disparate rates", () => {
        const protectedGroup: GroupOutcome = { groupKey: "A", total: 100, positive: 30, avgScore: 60, scoreStdDev: 10 };
        const referenceGroup: GroupOutcome = { groupKey: "B", total: 100, positive: 60, avgScore: 75, scoreStdDev: 10 };
        expect(computeDisparateImpactRatio(protectedGroup, referenceGroup)).toBe(0.5);
    });

    it("returns 1 when reference group has zero total", () => {
        const protectedGroup: GroupOutcome = { groupKey: "A", total: 100, positive: 50, avgScore: 70, scoreStdDev: 10 };
        const referenceGroup: GroupOutcome = { groupKey: "B", total: 0, positive: 0, avgScore: 0, scoreStdDev: 0 };
        expect(computeDisparateImpactRatio(protectedGroup, referenceGroup)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// computePSI
// ---------------------------------------------------------------------------
describe("computePSI", () => {
    it("returns low PSI for identical distributions", () => {
        const scores = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        const result = computePSI(scores, scores);
        expect(result.psi).toBeCloseTo(0, 1);
        expect(result.driftDetected).toBe(false);
    });

    it("detects drift for significantly different distributions", () => {
        const baseline = [10, 20, 30, 40, 50];
        const current = [80, 85, 90, 95, 100];
        const result = computePSI(baseline, current);
        expect(result.driftDetected).toBe(true);
    });

    it("returns correct bin counts", () => {
        const baseline = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
        const result = computePSI(baseline, baseline, 10);
        expect(result.baselineCounts).toHaveLength(10);
        expect(result.currentCounts).toHaveLength(10);
    });
});
