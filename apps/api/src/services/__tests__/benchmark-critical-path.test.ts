import { describe, expect, it } from "vitest";

import {
    compareSummaries,
    computeMedian,
    computePercentile,
    shouldFailStrict,
    summarizeRuns,
    type BenchmarkModeSummary,
    type BenchmarkRun,
} from "../../../../../scripts/benchmark-critical-path";

function makeRun(durationMs: number, status: BenchmarkRun["overallStatus"]): BenchmarkRun {
    return {
        mode: "seeded",
        runIndex: 1,
        overallStatus: status,
        collectionStatus: status,
        searchStatus: status,
        analysisStatus: status,
        durationMs,
        exitCode: 0,
        stderr: null,
        error: null,
    };
}

function makeSummary(medianMs: number, p95Ms: number): BenchmarkModeSummary {
    return {
        count: 3,
        passRate: 1,
        degradedRate: 0,
        failRate: 0,
        medianMs,
        p95Ms,
        minMs: medianMs,
        maxMs: p95Ms,
    };
}

describe("benchmark-critical-path stats", () => {
    it("computes median and p95 for a fixed dataset", () => {
        expect(computeMedian([10, 20, 30, 40, 50])).toBe(30);
        expect(computeMedian([10, 20, 30, 40])).toBe(25);
        expect(computePercentile([10, 20, 30, 40, 50], 95)).toBe(50);
        expect(computePercentile([10, 20, 30, 40], 95)).toBe(40);
    });

    it("computes status rates and latency summary", () => {
        const summary = summarizeRuns([
            makeRun(100, "PASS"),
            makeRun(120, "DEGRADED_PASS"),
            makeRun(200, "FAIL"),
        ]);

        expect(summary.count).toBe(3);
        expect(summary.passRate).toBeCloseTo(1 / 3, 5);
        expect(summary.degradedRate).toBeCloseTo(1 / 3, 5);
        expect(summary.failRate).toBeCloseTo(1 / 3, 5);
        expect(summary.medianMs).toBe(120);
        expect(summary.p95Ms).toBe(200);
        expect(summary.minMs).toBe(100);
        expect(summary.maxMs).toBe(200);
    });
});

describe("benchmark-critical-path baseline regression", () => {
    it("flags warning/failure thresholds and strict exit behavior", () => {
        const current = {
            seeded: makeSummary(120, 160),
        };
        const baseline = {
            seeded: makeSummary(100, 120),
        };

        const strictReport = compareSummaries(current, baseline, "baseline.json", true);
        expect(strictReport.comparisons).toHaveLength(2);
        expect(strictReport.warnings).toHaveLength(1);
        expect(strictReport.failures).toHaveLength(1);
        expect(shouldFailStrict(strictReport)).toBe(true);

        const nonStrictReport = compareSummaries(current, baseline, "baseline.json", false);
        expect(shouldFailStrict(nonStrictReport)).toBe(false);
    });
});
