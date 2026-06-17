import { describe, expect, it } from "vitest";

import {
    ndcgAtK,
    scoreDistributionStats,
    shortlistAtK,
    spearmanRho,
} from "../scoring-metrics";

describe("ndcgAtK", () => {
    it("returns 0 for empty ranking", () => {
        expect(ndcgAtK([], { a: "shortlist" }, 5)).toBe(0);
    });

    it("returns 1 for perfect ranking", () => {
        const labels = { a: "shortlist", b: "shortlist", c: "reject" } as const;
        expect(ndcgAtK(["a", "b", "c"], labels, 3)).toBe(1);
    });

    it("returns 0 when no positives in top-k", () => {
        const labels = { a: "reject", b: "reject", c: "shortlist" } as const;
        expect(ndcgAtK(["a", "b"], labels, 2)).toBe(0);
    });

    it("penalizes imperfect ranking", () => {
        const labels = { a: "reject", b: "shortlist", c: "shortlist" } as const;
        const score = ndcgAtK(["a", "b", "c"], labels, 3);
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(1);
    });

    it("supports Map labels", () => {
        const labels = new Map([["a", "shortlist" as const]]);
        expect(ndcgAtK(["a"], labels, 1)).toBe(1);
    });
});

describe("shortlistAtK", () => {
    it("returns 0 for empty ranking", () => {
        expect(shortlistAtK([], { a: "shortlist" }, 5)).toBe(0);
    });

    it("returns 1 when all top-k are shortlisted", () => {
        const labels = { a: "shortlist", b: "shortlist", c: "reject" } as const;
        expect(shortlistAtK(["a", "b"], labels, 2)).toBe(1);
    });

    it("returns 0.5 when half are shortlisted", () => {
        const labels = { a: "shortlist", b: "reject" } as const;
        expect(shortlistAtK(["a", "b"], labels, 2)).toBe(0.5);
    });

    it("supports boolean and numeric labels", () => {
        expect(shortlistAtK(["a", "b"], { a: true, b: false }, 2)).toBe(0.5);
        expect(shortlistAtK(["a", "b"], { a: 1, b: 0 }, 2)).toBe(0.5);
    });
});

describe("spearmanRho", () => {
    it("returns 0 for fewer than 3 values", () => {
        expect(spearmanRho([1, 2], [3, 4])).toBe(0);
    });

    it("returns 1 for perfectly correlated arrays", () => {
        expect(spearmanRho([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    });

    it("returns -1 for perfectly anti-correlated arrays", () => {
        expect(spearmanRho([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
    });

    it("handles tied values", () => {
        const rho = spearmanRho([1, 1, 2, 3], [1, 2, 3, 4]);
        expect(rho).toBeGreaterThan(0);
        expect(rho).toBeLessThanOrEqual(1);
    });
});

describe("scoreDistributionStats", () => {
    it("computes stats for mixed shortlist/reject samples", () => {
        const samples = [
            { score: 90, label: "shortlist" as const },
            { score: 80, label: "shortlist" as const },
            { score: 30, label: "reject" as const },
            { score: 20, label: "reject" as const },
        ];
        const stats = scoreDistributionStats(samples);

        expect(stats.overall.count).toBe(4);
        expect(stats.shortlist.count).toBe(2);
        expect(stats.reject.count).toBe(2);
        expect(stats.shortlist.mean).toBe(85);
        expect(stats.reject.mean).toBe(25);
        expect(stats.separation.meanGap).toBe(60);
        expect(stats.separation.medianGap).toBe(60);
    });

    it("handles empty samples", () => {
        const stats = scoreDistributionStats([]);
        expect(stats.overall.count).toBe(0);
        expect(stats.shortlist.count).toBe(0);
        expect(stats.reject.count).toBe(0);
    });

    it("computes shortlistAboveRejectRate", () => {
        const samples = [
            { score: 90, label: "shortlist" as const },
            { score: 10, label: "reject" as const },
        ];
        const stats = scoreDistributionStats(samples);
        expect(stats.separation.shortlistAboveRejectRate).toBe(1);
    });

    it("computes overlapRate when shortlist scores overlap reject median", () => {
        const samples = [
            { score: 60, label: "shortlist" as const },
            { score: 40, label: "shortlist" as const },
            { score: 30, label: "reject" as const },
            { score: 50, label: "reject" as const },
        ];
        const stats = scoreDistributionStats(samples);
        // reject median = 40, shortlist score 40 <= 40 → overlap, 60 > 40 → no overlap
        expect(stats.separation.overlapRate).toBe(0.5);
    });
});
