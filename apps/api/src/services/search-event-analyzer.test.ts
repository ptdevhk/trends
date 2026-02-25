import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resetResumeScreeningDb } from "./database";
import { MatchStorage } from "./match-storage";
import { SearchEventAnalyzer } from "./search-event-analyzer";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "search-event-analyzer-"));
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");

  fs.writeFileSync(
    path.join(root, "config", "resume", "skills.md"),
    `---
version: 1
updated_at: '2026-02-25'
---

# Skills Knowledge

## Domain Taxonomy

### cnc
- displayName: CNC
- keywords: cnc, 数控, 车床

## Synonym Table

- cnc: 数控, 加工中心

## Learning Log (Append Only)

- 2026-02-20: shortlist_pattern: fanuc + 渠道客户 -> high_priority
- 2026-02-21: reject_pattern: 培训岗 -> low_quality
`,
    "utf8"
  );

  const events = [
    { type: "search_query", query: "cnc 东莞", resultCount: 3, topScore: 90, ts: "2026-02-25T01:00:00.000Z" },
    { type: "search_query", query: "cnc机台 东莞", resultCount: 0, ts: "2026-02-25T01:05:00.000Z" },
    { type: "search_zero_results", query: "cnc机台 东莞", ts: "2026-02-25T01:05:00.000Z" },
    { type: "candidate_action", resumeId: "r1", action: "shortlist", query: "cnc 东莞", ts: "2026-02-25T01:10:00.000Z" },
    { type: "candidate_action", resumeId: "r2", action: "reject", query: "cnc 东莞", ts: "2026-02-25T01:11:00.000Z" },
    { type: "candidate_action", resumeId: "r3", action: "shortlist", query: "cnc 东莞", ts: "2026-02-25T01:12:00.000Z" },
  ];
  fs.writeFileSync(
    path.join(root, "output", "search-events.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8"
  );

  resetResumeScreeningDb();
  const storage = new MatchStorage(root);
  storage.saveMatches([
    {
      resumeId: "r1",
      jobDescriptionId: "lathe-sales",
      result: {
        score: 92,
        recommendation: "strong_match",
        highlights: [],
        concerns: [],
        summary: "r1",
        breakdown: {
          skillMatch: 24,
          experienceMatch: 20,
          educationMatch: 12,
          locationMatch: 15,
          industryMatch: 9,
          brandRelevance: 8,
        },
        scoreSource: "rule",
      },
      aiModel: "rule-scoring",
      processingTimeMs: 1,
    },
    {
      resumeId: "r2",
      jobDescriptionId: "lathe-sales",
      result: {
        score: 58,
        recommendation: "potential",
        highlights: [],
        concerns: [],
        summary: "r2",
        breakdown: {
          skillMatch: 14,
          experienceMatch: 13,
          educationMatch: 8,
          locationMatch: 8,
          industryMatch: 9,
          brandRelevance: 6,
        },
        scoreSource: "rule",
      },
      aiModel: "rule-scoring",
      processingTimeMs: 1,
    },
    {
      resumeId: "r3",
      jobDescriptionId: "lathe-sales",
      result: {
        score: 86,
        recommendation: "match",
        highlights: [],
        concerns: [],
        summary: "r3",
        breakdown: {
          skillMatch: 22,
          experienceMatch: 18,
          educationMatch: 10,
          locationMatch: 12,
          industryMatch: 10,
          brandRelevance: 8,
        },
        scoreSource: "rule",
      },
      aiModel: "rule-scoring",
      processingTimeMs: 1,
    },
  ]);

  return root;
}

function cleanupFixtureRoot(root: string): void {
  resetResumeScreeningDb();
  fs.rmSync(root, { recursive: true, force: true });
}

afterEach(() => {
  resetResumeScreeningDb();
});

describe("SearchEventAnalyzer", () => {
  it("builds analysis report with ranking metrics and suggestions", () => {
    const root = createFixtureRoot();

    try {
      const analyzer = new SearchEventAnalyzer(root);
      const report = analyzer.analyze({ periodDays: 30, k: 3 });

      expect(report.summary.searchQueries).toBeGreaterThan(0);
      expect(report.summary.candidateActions).toBe(3);
      expect(report.rankingMetrics.ndcgAtK).toBeGreaterThan(0);
      expect(report.queryMetrics.find((item) => item.query === "cnc 东莞")?.actions).toBe(3);
      expect(report.suggestions.synonymSuggestions.length).toBeGreaterThan(0);
      expect(report.learningPatterns.shortlistPatterns.length).toBeGreaterThan(0);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("computes metrics and validates projected category weights", () => {
    const root = createFixtureRoot();

    try {
      const analyzer = new SearchEventAnalyzer(root);
      const metrics = analyzer.computeJobMetrics({
        jobDescriptionId: "lathe-sales",
        periodDays: 30,
        k: 3,
      });

      expect(metrics.rankedCount).toBe(3);
      expect(metrics.labeledCount).toBe(3);
      expect(metrics.shortlistCount).toBe(2);
      expect(metrics.rejectCount).toBe(1);

      const validation = analyzer.validateCategoryWeights({
        jobDescriptionId: "lathe-sales",
        periodDays: 30,
        k: 3,
        proposedCategoryWeights: {
          skillMatch: 27,
          experienceMatch: 24,
          educationMatch: 14,
          locationMatch: 14,
          industryMatch: 12,
          brandRelevance: 9,
        },
      });

      expect(validation.sampleSize).toBe(3);
      expect(validation.current.ndcgAtK).toBeGreaterThan(0);
      expect(validation.projected.ndcgAtK).toBeGreaterThan(0);
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
