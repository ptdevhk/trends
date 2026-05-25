import { describe, expect, it } from "vitest";

import {
  ageToBracket,
  computeDemographicParity,
  computeDisparateImpactRatio,
  computeEqualizedOdds,
  computePSI,
  fnvHash,
  type GroupConfusion,
  type GroupOutcome,
} from "../lib/bias_metrics.js";

describe("bias_metrics", () => {
  describe("computeDemographicParity", () => {
    it("returns ratio 1 when all groups have equal selection rates", () => {
      const groups: GroupOutcome[] = [
        { groupKey: "a", total: 100, positive: 50, avgScore: 0.5, scoreStdDev: 0.1 },
        { groupKey: "b", total: 200, positive: 100, avgScore: 0.5, scoreStdDev: 0.1 },
      ];
      const result = computeDemographicParity(groups);
      expect(result.disparityRatio).toBe(1);
      expect(result.maxDifference).toBe(0);
      expect(result.passing).toBe(true);
    });

    it("fails four-fifths rule when disparity ratio < 0.8", () => {
      const groups: GroupOutcome[] = [
        { groupKey: "favoured", total: 100, positive: 80, avgScore: 0.8, scoreStdDev: 0.1 },
        { groupKey: "disfavoured", total: 100, positive: 50, avgScore: 0.5, scoreStdDev: 0.1 },
      ];
      const result = computeDemographicParity(groups);
      // 0.5 / 0.8 = 0.625 < 0.8
      expect(result.disparityRatio).toBeCloseTo(0.625, 4);
      expect(result.passing).toBe(false);
      expect(result.maxDifference).toBeCloseTo(0.3, 4);
    });

    it("passes four-fifths rule when ratio >= 0.8", () => {
      const groups: GroupOutcome[] = [
        { groupKey: "a", total: 100, positive: 90, avgScore: 0.9, scoreStdDev: 0.05 },
        { groupKey: "b", total: 100, positive: 75, avgScore: 0.75, scoreStdDev: 0.1 },
      ];
      const result = computeDemographicParity(groups);
      // 0.75 / 0.9 ≈ 0.833 > 0.8
      expect(result.disparityRatio).toBeCloseTo(0.75 / 0.9, 4);
      expect(result.passing).toBe(true);
    });

    it("handles zero-total groups with rate 0", () => {
      const groups: GroupOutcome[] = [
        { groupKey: "a", total: 100, positive: 50, avgScore: 0.5, scoreStdDev: 0.1 },
        { groupKey: "empty", total: 0, positive: 0, avgScore: 0, scoreStdDev: 0 },
      ];
      const result = computeDemographicParity(groups);
      // min rate = 0, max rate = 0.5 → ratio = 0
      expect(result.disparityRatio).toBe(0);
      expect(result.passing).toBe(false);
    });

    it("returns ratio 1 when all groups have zero total", () => {
      const groups: GroupOutcome[] = [
        { groupKey: "a", total: 0, positive: 0, avgScore: 0, scoreStdDev: 0 },
        { groupKey: "b", total: 0, positive: 0, avgScore: 0, scoreStdDev: 0 },
      ];
      const result = computeDemographicParity(groups);
      expect(result.disparityRatio).toBe(1);
      expect(result.passing).toBe(true);
    });

    it("includes per-group rates in output", () => {
      const groups: GroupOutcome[] = [
        { groupKey: "age_25-30", total: 50, positive: 25, avgScore: 0.5, scoreStdDev: 0.1 },
        { groupKey: "age_30-35", total: 60, positive: 30, avgScore: 0.5, scoreStdDev: 0.1 },
      ];
      const result = computeDemographicParity(groups);
      expect(result.groupRates).toEqual([
        { groupKey: "age_25-30", rate: 0.5 },
        { groupKey: "age_30-35", rate: 0.5 },
      ]);
    });
  });

  describe("computeEqualizedOdds", () => {
    it("passes when TPR and FPR are equal across groups", () => {
      const groups: GroupConfusion[] = [
        { groupKey: "a", truePositives: 80, falsePositives: 10, trueNegatives: 90, falseNegatives: 20 },
        { groupKey: "b", truePositives: 40, falsePositives: 5, trueNegatives: 45, falseNegatives: 10 },
      ];
      const result = computeEqualizedOdds(groups);
      // Both: TPR = 0.8, FPR = 0.1
      expect(result.tprDifference).toBeCloseTo(0, 4);
      expect(result.fprDifference).toBeCloseTo(0, 4);
      expect(result.passing).toBe(true);
    });

    it("fails when TPR difference exceeds 0.1", () => {
      const groups: GroupConfusion[] = [
        { groupKey: "a", truePositives: 90, falsePositives: 10, trueNegatives: 90, falseNegatives: 10 },
        { groupKey: "b", truePositives: 50, falsePositives: 10, trueNegatives: 90, falseNegatives: 50 },
      ];
      const result = computeEqualizedOdds(groups);
      // a: TPR = 90/100 = 0.9, b: TPR = 50/100 = 0.5 → diff = 0.4
      expect(result.tprDifference).toBeCloseTo(0.4, 4);
      expect(result.passing).toBe(false);
    });

    it("fails when FPR difference exceeds 0.1", () => {
      const groups: GroupConfusion[] = [
        { groupKey: "a", truePositives: 80, falsePositives: 20, trueNegatives: 80, falseNegatives: 20 },
        { groupKey: "b", truePositives: 80, falsePositives: 5, trueNegatives: 95, falseNegatives: 20 },
      ];
      const result = computeEqualizedOdds(groups);
      // a: FPR = 20/100 = 0.2, b: FPR = 5/100 = 0.05 → diff = 0.15
      expect(result.fprDifference).toBeCloseTo(0.15, 4);
      expect(result.passing).toBe(false);
    });

    it("handles zero-total groups (no positives or negatives)", () => {
      const groups: GroupConfusion[] = [
        { groupKey: "a", truePositives: 80, falsePositives: 10, trueNegatives: 90, falseNegatives: 20 },
        { groupKey: "empty", truePositives: 0, falsePositives: 0, trueNegatives: 0, falseNegatives: 0 },
      ];
      const result = computeEqualizedOdds(groups);
      // empty: TPR = 0, FPR = 0 → diffs = 0.8 and 0.1
      expect(result.tprDifference).toBeCloseTo(0.8, 4);
      expect(result.passing).toBe(false);
    });

    it("includes per-group TPR and FPR in output", () => {
      const groups: GroupConfusion[] = [
        { groupKey: "a", truePositives: 80, falsePositives: 10, trueNegatives: 90, falseNegatives: 20 },
      ];
      const result = computeEqualizedOdds(groups);
      expect(result.groupMetrics).toEqual([
        { groupKey: "a", tpr: 0.8, fpr: 0.1 },
      ]);
    });
  });

  describe("computeDisparateImpactRatio", () => {
    it("returns 1 when both groups have equal selection rates", () => {
      const protectedGroup: GroupOutcome = { groupKey: "p", total: 100, positive: 50, avgScore: 0.5, scoreStdDev: 0.1 };
      const referenceGroup: GroupOutcome = { groupKey: "r", total: 200, positive: 100, avgScore: 0.5, scoreStdDev: 0.1 };
      expect(computeDisparateImpactRatio(protectedGroup, referenceGroup)).toBe(1);
    });

    it("returns ratio < 0.8 when protected group is disadvantaged", () => {
      const protectedGroup: GroupOutcome = { groupKey: "p", total: 100, positive: 30, avgScore: 0.3, scoreStdDev: 0.1 };
      const referenceGroup: GroupOutcome = { groupKey: "r", total: 100, positive: 70, avgScore: 0.7, scoreStdDev: 0.1 };
      // 0.3 / 0.7 ≈ 0.4286
      expect(computeDisparateImpactRatio(protectedGroup, referenceGroup)).toBeCloseTo(0.4286, 3);
    });

    it("returns 1 when reference group has zero total", () => {
      const protectedGroup: GroupOutcome = { groupKey: "p", total: 100, positive: 50, avgScore: 0.5, scoreStdDev: 0.1 };
      const referenceGroup: GroupOutcome = { groupKey: "r", total: 0, positive: 0, avgScore: 0, scoreStdDev: 0 };
      expect(computeDisparateImpactRatio(protectedGroup, referenceGroup)).toBe(1);
    });

    it("returns 0 when protected group has zero positives", () => {
      const protectedGroup: GroupOutcome = { groupKey: "p", total: 100, positive: 0, avgScore: 0, scoreStdDev: 0 };
      const referenceGroup: GroupOutcome = { groupKey: "r", total: 100, positive: 50, avgScore: 0.5, scoreStdDev: 0.1 };
      expect(computeDisparateImpactRatio(protectedGroup, referenceGroup)).toBe(0);
    });
  });

  describe("ageToBracket", () => {
    it("maps ages to correct brackets", () => {
      expect(ageToBracket(20)).toBe("under_25");
      expect(ageToBracket(24)).toBe("under_25");
      expect(ageToBracket(25)).toBe("25-29");
      expect(ageToBracket(28)).toBe("25-29");
      expect(ageToBracket(29)).toBe("25-29");
      expect(ageToBracket(30)).toBe("30-34");
      expect(ageToBracket(34)).toBe("30-34");
      expect(ageToBracket(35)).toBe("35-39");
      expect(ageToBracket(39)).toBe("35-39");
      expect(ageToBracket(40)).toBe("40-44");
      expect(ageToBracket(44)).toBe("40-44");
      expect(ageToBracket(45)).toBe("45-49");
      expect(ageToBracket(49)).toBe("45-49");
      expect(ageToBracket(50)).toBe("50_plus");
      expect(ageToBracket(65)).toBe("50_plus");
    });

    it("handles boundary values", () => {
      expect(ageToBracket(0)).toBe("under_25");
      expect(ageToBracket(1)).toBe("under_25");
    });
  });

  describe("fnvHash", () => {
    it("produces consistent 8-char hex strings", () => {
      const hash = fnvHash("test-input");
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it("produces different hashes for different inputs", () => {
      const hash1 = fnvHash("input-a");
      const hash2 = fnvHash("input-b");
      expect(hash1).not.toBe(hash2);
    });

    it("produces the same hash for the same input", () => {
      expect(fnvHash("consistent")).toBe(fnvHash("consistent"));
    });

    it("handles empty string", () => {
      const hash = fnvHash("");
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it("handles unicode input", () => {
      const hash = fnvHash("年龄-30-34");
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe("computePSI", () => {
    it("returns low PSI for identical distributions", () => {
      const scores = Array.from({ length: 100 }, (_, i) => (i + 1));
      const result = computePSI(scores, scores);
      expect(result.psi).toBeLessThan(0.1);
      expect(result.driftDetected).toBe(false);
    });

    it("returns high PSI for shifted distributions", () => {
      // Baseline: uniform 0-100
      const baseline = Array.from({ length: 100 }, (_, i) => i);
      // Current: all scores shifted to 80-100
      const current = Array.from({ length: 100 }, (_, i) => 80 + (i * 0.2));
      const result = computePSI(baseline, current);
      expect(result.psi).toBeGreaterThan(0.25);
      expect(result.driftDetected).toBe(true);
    });

    it("handles small sample sizes with Laplace smoothing", () => {
      const baseline = [50, 60, 70];
      const current = [80, 90, 95];
      // Should not throw, just return a value
      const result = computePSI(baseline, current);
      expect(typeof result.psi).toBe("number");
      expect(isFinite(result.psi)).toBe(true);
    });

    it("returns zero-like PSI for similar distributions", () => {
      // Use deterministic data to avoid flaky CI from Math.random()
      const baseline = Array.from({ length: 50 }, (_, i) => 30 + (i * 0.8));
      const current = Array.from({ length: 50 }, (_, i) => 32 + (i * 0.76));
      const result = computePSI(baseline, current);
      expect(result.psi).toBeLessThan(0.25);
      expect(result.driftDetected).toBe(false);
    });

    it("returns bin counts for transparency", () => {
      const scores = Array.from({ length: 100 }, (_, i) => i);
      const result = computePSI(scores, scores, 5);
      expect(result.baselineCounts.length).toBe(5);
      expect(result.currentCounts.length).toBe(5);
    });
  });
});
