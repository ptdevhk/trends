import { describe, expect, it } from "vitest";

import {
  aiScoreFor,
  buildCohortPairs,
  evaluateCohort,
  hrRatingFor,
  parseAuditCsv,
  parityDelta,
} from "./evaluate-hr-cohort-ranking.js";
import { computeMetrics } from "./lib/ranking-metrics.js";

// Perfectly ordered cohort: scores descend exactly with ratings, two boards.
// Overall relevance by score = [6,5,4,3,2,1] = ideal → NDCG@K = 1 for all K,
// Spearman ρ = 1 (distinct rating values, no ties).
const PERFECT_CSV = [
  "Profile Resume ID,Name,HR Category,HR Expected,Current Final AI Score",
  "p1,Alice,high,6,90",
  'p2,"Doe, Jane",high,5,85',
  "p3,Carol,high,4,80",
  "p4,Dave,low,3,75",
  "p5,Eve,low,2,70",
  "p6,Frank,low,1,65",
].join("\n");

const PERFECT_RATINGS = [6, 5, 4, 3, 2, 1];
const PERFECT_SCORES = [90, 85, 80, 75, 70, 65];

// Anti-correlated cohort: scores descend while ratings ascend.
const ANTI_CSV = [
  "Profile Resume ID,HR Category,HR Expected,Current AI Score",
  "a1,high,1,90",
  "a2,high,2,80",
  "a3,high,3,70",
  "a4,high,4,60",
  "a5,high,5,50",
].join("\n");

describe("parseAuditCsv", () => {
  it("parses headers, quoted commas, and escaped quotes", () => {
    const rows = parseAuditCsv(PERFECT_CSV);
    expect(rows).toHaveLength(6);
    expect(rows[0].profileresumeid).toBe("p1");
    expect(rows[1].name).toBe("Doe, Jane");
    expect(rows[1].currentfinalaiscore).toBe("85");
  });

  it("handles \\r\\n line endings and blank lines", () => {
    const rows = parseAuditCsv(
      "Profile Resume ID,HR Category\np1,high\n\np2,low\r\n"
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].hrcategory).toBe("low");
  });

  it("returns an empty list for empty input", () => {
    expect(parseAuditCsv("")).toEqual([]);
  });
});

describe("hrRatingFor / aiScoreFor", () => {
  it("prefers numeric HR Expected over category mapping", () => {
    expect(hrRatingFor({ hrexpected: "90", hrcategory: "low" })).toBe(90);
    expect(hrRatingFor({ hrexpected: "", hrcategory: "High" })).toBe(3);
    expect(hrRatingFor({ hrexpected: "", hrcategory: "MEDIUM" })).toBe(2);
    expect(hrRatingFor({ hrexpected: "", hrcategory: "low" })).toBe(1);
  });

  it("returns null for unresolvable ratings", () => {
    expect(hrRatingFor({ hrexpected: "", hrcategory: "unknown" })).toBeNull();
    expect(hrRatingFor({})).toBeNull();
  });

  it("resolves score from Final AI Score with Current AI Score fallback", () => {
    expect(aiScoreFor({ currentfinalaiscore: "88.5" })).toBe(88.5);
    expect(aiScoreFor({ currentfinalaiscore: "", currentaiscore: "70" })).toBe(70);
    expect(aiScoreFor({})).toBeNull();
  });
});

describe("buildCohortPairs", () => {
  it("joins rows into pairs and counts exclusions", () => {
    const rows = [
      { profileresumeid: "p1", hrcategory: "high", currentfinalaiscore: "90" },
      { profileresumeid: "p2", hrcategory: "high", currentfinalaiscore: "" }, // no score
      { profileresumeid: "p3", hrcategory: "zzz", currentfinalaiscore: "70" }, // no rating
      { hrcategory: "low", currentfinalaiscore: "60" }, // no stable id
    ];
    const { pairs, excluded } = buildCohortPairs(rows);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({
      profileResumeId: "p1",
      board: "high",
      rating: 3,
      score: 90,
    });
    expect(excluded).toEqual({ noRating: 1, noScore: 1, noStableId: 1 });
  });
});

describe("evaluateCohort", () => {
  it("reports NDCG@K = 1 and exact recall for a perfectly ordered cohort", () => {
    const report = evaluateCohort(
      buildCohortPairs(parseAuditCsv(PERFECT_CSV)).pairs,
      "fixture.csv"
    );
    expect(report.totalPairs).toBe(6);
    expect(report.overall.ndcg5).toBe(1);
    expect(report.overall.ndcg10).toBe(1);
    expect(report.overall.ndcg20).toBe(1);
    expect(report.overall.recall5).toBeCloseTo(5 / 6, 10);
    expect(report.overall.recall10).toBe(1);
    expect(report.overall.spearmanRho).toBe(1);
    expect(report.overall.confidence).toBe("low"); // n=6 → low band
  });

  it("stratifies per board with independently computed metrics", () => {
    const report = evaluateCohort(
      buildCohortPairs(parseAuditCsv(PERFECT_CSV)).pairs,
      "fixture.csv"
    );
    expect(report.boards.map((b) => b.board)).toEqual(["high", "low"]);
    const high = report.boards.find((b) => b.board === "high")!;
    const low = report.boards.find((b) => b.board === "low")!;
    expect(high.n).toBe(3);
    expect(low.n).toBe(3);
    expect(high.metrics.ndcg10).toBe(1);
    expect(low.metrics.ndcg10).toBe(1);
    // Board metrics equal computeMetrics over that board's own pairs
    expect(high.metrics).toEqual(computeMetrics([90, 85, 80], [6, 5, 4]));
  });

  it("flags anti-correlated ordering with negative Spearman and low NDCG", () => {
    const report = evaluateCohort(
      buildCohortPairs(parseAuditCsv(ANTI_CSV)).pairs,
      "fixture.csv"
    );
    expect(report.overall.spearmanRho).toBe(-1);
    expect(report.overall.pearsonR).toBeLessThan(0);
    expect(report.overall.ndcg5).toBeLessThan(0.9);
  });
});

describe("parityDelta", () => {
  const current = computeMetrics(PERFECT_SCORES, PERFECT_RATINGS);
  const degradedBaseline = { ...current, ndcg10: current.ndcg10 + 0.1 };
  const cleanBaseline = { ...current, ndcg10: current.ndcg10 + 0.04 };

  it("flags degradation beyond tolerance", () => {
    const parity = parityDelta(current, degradedBaseline, 0.05, 0.05);
    expect(parity.degraded).toBe(true);
    expect(parity.ndcg10Delta).toBeCloseTo(-0.1, 10);
  });

  it("stays clean within tolerance", () => {
    const parity = parityDelta(current, cleanBaseline, 0.05, 0.05);
    expect(parity.degraded).toBe(false);
  });

  it("flags recall degradation independently of NDCG", () => {
    const recallBaseline = {
      ...current,
      ndcg10: current.ndcg10 - 0.01,
      recall10: current.recall10 + 0.1,
    };
    expect(parityDelta(current, recallBaseline, 0.05, 0.05).degraded).toBe(true);
  });
});
