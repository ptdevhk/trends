import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resetResumeScreeningDb } from "./database";
import { MatchStorage } from "./match-storage";
import { loadRuleWeightsConfig, mergeRuleWeights } from "./rule-scoring";
import { ScoringAutoTuner } from "./scoring-auto-tuner";
import { WeightHistoryService } from "./weight-history";
import { workspaceConfigService } from "./workspace-config-service";

function isoMinutesAgo(baseTimeMs: number, minutesAgo: number): string {
  return new Date(baseTimeMs - minutesAgo * 60 * 1000).toISOString();
}

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-auto-tuner-"));
  const baseTimeMs = Date.now();
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");

  fs.writeFileSync(
    path.join(root, "config", "resume", "rule-weights.json5"),
    `{
  categoryWeights: {
    skillMatch: 15,
    roleMatch: 10,
    experienceMatch: 25,
    educationMatch: 15,
    locationMatch: 15,
    industryMatch: 10,
    brandRelevance: 10,
  },
  brandContextWithTarget: { employer: 10, sales: 9, equipment: 7, technical: 6, general: 4 },
  brandContextNoTarget: { employer: 4, sales: 3, equipment: 2, technical: 2, general: 1 },
  brandRoleMultipliers: { employer: 1, equipment: 0.7, both: 1 },
  recommendationThresholds: { strongMatch: 85, match: 70, potential: 50 },
}
`,
    "utf8"
  );

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

- cnc: 数控

## Learning Log (Append Only)

- 2026-02-21: shortlist_pattern: cnc + 东莞 -> high_priority
`,
    "utf8"
  );

  const events = [
    { type: "search_query", query: "cnc 东莞", resultCount: 4, topScore: 70, ts: isoMinutesAgo(baseTimeMs, 30) },
    { type: "search_query", query: "cnc机台 东莞", resultCount: 0, ts: isoMinutesAgo(baseTimeMs, 25) },
    { type: "search_zero_results", query: "cnc机台 东莞", ts: isoMinutesAgo(baseTimeMs, 25) },
    { type: "candidate_action", resumeId: "r1", action: "shortlist", query: "cnc 东莞", ts: isoMinutesAgo(baseTimeMs, 20) },
    { type: "candidate_action", resumeId: "r2", action: "reject", query: "cnc 东莞", ts: isoMinutesAgo(baseTimeMs, 19) },
    { type: "candidate_action", resumeId: "r3", action: "shortlist", query: "cnc 东莞", ts: isoMinutesAgo(baseTimeMs, 18) },
    { type: "candidate_action", resumeId: "r4", action: "reject", query: "cnc 东莞", ts: isoMinutesAgo(baseTimeMs, 17) },
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
        score: 70,
        recommendation: "match",
        highlights: [],
        concerns: [],
        summary: "r1",
        breakdown: {
          skillMatch: 18,
          roleMatch: 6,
          experienceMatch: 18,
          educationMatch: 10,
          locationMatch: 12,
          industryMatch: 7,
          brandRelevance: 5,
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
        score: 68,
        recommendation: "potential",
        highlights: [],
        concerns: [],
        summary: "r2",
        breakdown: {
          skillMatch: 16,
          roleMatch: 5,
          experienceMatch: 18,
          educationMatch: 10,
          locationMatch: 12,
          industryMatch: 7,
          brandRelevance: 5,
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
        score: 66,
        recommendation: "potential",
        highlights: [],
        concerns: [],
        summary: "r3",
        breakdown: {
          skillMatch: 17,
          roleMatch: 5,
          experienceMatch: 16,
          educationMatch: 10,
          locationMatch: 12,
          industryMatch: 6,
          brandRelevance: 5,
        },
        scoreSource: "rule",
      },
      aiModel: "rule-scoring",
      processingTimeMs: 1,
    },
    {
      resumeId: "r4",
      jobDescriptionId: "lathe-sales",
      result: {
        score: 64,
        recommendation: "potential",
        highlights: [],
        concerns: [],
        summary: "r4",
        breakdown: {
          skillMatch: 15,
          roleMatch: 4,
          experienceMatch: 16,
          educationMatch: 10,
          locationMatch: 12,
          industryMatch: 6,
          brandRelevance: 5,
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

describe("ScoringAutoTuner", () => {
  it("returns dry-run output without mutating weights", async () => {
    const root = createFixtureRoot();

    try {
      const initialWeights = loadRuleWeightsConfig(root).categoryWeights;
      const getRuleWeightsMock = vi.spyOn(workspaceConfigService, "getRuleWeights").mockResolvedValue(
        loadRuleWeightsConfig(root)
      );
      const setRuleWeightsMock = vi.spyOn(workspaceConfigService, "setWorkspaceRuleWeights").mockResolvedValue();
      const appendLearningMock = vi.spyOn(workspaceConfigService, "appendLearningLogEntry").mockResolvedValue({
        date: "2026-02-25",
        observation: "mock",
      });
      const tuner = new ScoringAutoTuner(root, {
        fetchImpl: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
      });

      const result = await tuner.run({
        dryRun: true,
        periodDays: 30,
        k: 3,
        minLabeledActions: 2,
        ndcgImprovementThreshold: -1,
      });

      expect(result.status).toBe("dry_run");
      expect(result.proposedCategoryWeights).toBeDefined();
      expect(setRuleWeightsMock).not.toHaveBeenCalled();

      const afterWeights = loadRuleWeightsConfig(root).categoryWeights;
      expect(afterWeights).toEqual(initialWeights);

      getRuleWeightsMock.mockRestore();
      setRuleWeightsMock.mockRestore();
      appendLearningMock.mockRestore();
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("applies tuned weights, writes history, and enforces cooldown", async () => {
    const root = createFixtureRoot();

    try {
      let runtimeWeights = loadRuleWeightsConfig(root);
      const getRuleWeightsMock = vi.spyOn(workspaceConfigService, "getRuleWeights").mockImplementation(async () => runtimeWeights);
      const setRuleWeightsMock = vi.spyOn(workspaceConfigService, "setWorkspaceRuleWeights").mockImplementation(async (_workspace, config) => {
        runtimeWeights = mergeRuleWeights(config);
      });
      const appendLearningMock = vi.spyOn(workspaceConfigService, "appendLearningLogEntry").mockResolvedValue({
        date: "2026-02-25",
        observation: "mock",
      });
      const tuner = new ScoringAutoTuner(root, {
        fetchImpl: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
      });

      const applied = await tuner.run({
        periodDays: 30,
        k: 3,
        minLabeledActions: 2,
        ndcgImprovementThreshold: -1,
      });

      expect(applied.status).toBe("applied");
      expect(applied.historyEntry?.reason).toBe("auto_tune");
      expect(applied.proposedCategoryWeights).toBeDefined();
      expect(applied.reingestTriggered).toBe(true);

      const currentWeights = runtimeWeights.categoryWeights;
      expect(currentWeights).toEqual(applied.proposedCategoryWeights);

      const historyService = new WeightHistoryService(root);
      expect(historyService.getHistory().length).toBeGreaterThan(0);

      const cooldown = await tuner.run({
        periodDays: 30,
        k: 3,
        minLabeledActions: 2,
      });
      expect(cooldown.status).toBe("cooldown");

      getRuleWeightsMock.mockRestore();
      setRuleWeightsMock.mockRestore();
      appendLearningMock.mockRestore();
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
