import { describe, expect, it } from "vitest";

import { ndcgAtK, scoreDistributionStats, shortlistAtK } from "./scoring-metrics";

describe("scoring-metrics", () => {
  it("computes perfect ndcg when all shortlisted resumes are ranked first", () => {
    const ranked = ["r1", "r2", "r3", "r4"];
    const labels = {
      r1: "shortlist",
      r2: "shortlist",
      r3: "reject",
      r4: "reject",
    } as const;

    expect(ndcgAtK(ranked, labels, 4)).toBe(1);
  });

  it("returns lower ndcg for imperfect ranking", () => {
    const ranked = ["r1", "r2", "r3", "r4"];
    const labels = {
      r1: "reject",
      r2: "shortlist",
      r3: "reject",
      r4: "shortlist",
    } as const;

    expect(ndcgAtK(ranked, labels, 4)).toBeLessThan(1);
    expect(ndcgAtK(ranked, labels, 4)).toBeGreaterThan(0);
  });

  it("computes shortlist precision at k", () => {
    const ranked = ["r1", "r2", "r3", "r4"];
    const labels = {
      r1: "shortlist",
      r2: "reject",
      r3: "shortlist",
      r4: "reject",
    } as const;

    expect(shortlistAtK(ranked, labels, 2)).toBe(0.5);
    expect(shortlistAtK(ranked, labels, 3)).toBe(0.6667);
  });

  it("summarizes score distributions and separation", () => {
    const stats = scoreDistributionStats([
      { score: 92, label: "shortlist" },
      { score: 88, label: "shortlist" },
      { score: 84, label: "shortlist" },
      { score: 61, label: "reject" },
      { score: 58, label: "reject" },
      { score: 52, label: "reject" },
    ]);

    expect(stats.shortlist.count).toBe(3);
    expect(stats.reject.count).toBe(3);
    expect(stats.separation.meanGap).toBeGreaterThan(0);
    expect(stats.separation.shortlistAboveRejectRate).toBe(1);
    expect(stats.separation.overlapRate).toBe(0);
  });
});
