import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadRuleWeightsConfig } from "./rule-scoring";
import { WeightHistoryService } from "./weight-history";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "weight-history-"));
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");

  fs.writeFileSync(
    path.join(root, "config", "resume", "rule-weights.json5"),
    `{
  categoryWeights: {
    skillMatch: 25,
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

  return root;
}

function cleanupFixtureRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("WeightHistoryService", () => {
  it("appends and reads weight history entries", () => {
    const root = createFixtureRoot();

    try {
      const service = new WeightHistoryService(root);
      service.appendEntry({
        ts: "2026-02-25T00:00:00.000Z",
        reason: "auto_tune",
        jobDescriptionId: "lathe-sales",
        before: {
          skillMatch: 25,
          experienceMatch: 25,
          educationMatch: 15,
          locationMatch: 15,
          industryMatch: 10,
          brandRelevance: 10,
        },
        after: {
          skillMatch: 27,
          experienceMatch: 24,
          educationMatch: 14,
          locationMatch: 14,
          industryMatch: 12,
          brandRelevance: 9,
        },
        metrics: {
          currentNdcgAtK: 0.52,
          projectedNdcgAtK: 0.58,
        },
      });

      const history = service.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].reason).toBe("auto_tune");
      expect(history[0].after.skillMatch).toBe(27);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("rolls back weights to a previous entry", () => {
    const root = createFixtureRoot();

    try {
      const service = new WeightHistoryService(root);
      service.appendEntry({
        ts: "2026-02-25T00:00:00.000Z",
        reason: "auto_tune",
        jobDescriptionId: "lathe-sales",
        before: {
          skillMatch: 25,
          experienceMatch: 25,
          educationMatch: 15,
          locationMatch: 15,
          industryMatch: 10,
          brandRelevance: 10,
        },
        after: {
          skillMatch: 27,
          experienceMatch: 24,
          educationMatch: 14,
          locationMatch: 14,
          industryMatch: 12,
          brandRelevance: 9,
        },
      });

      // Simulate current config already using tuned values.
      fs.writeFileSync(
        path.join(root, "config", "resume", "rule-weights.json5"),
        `{
  categoryWeights: {
    skillMatch: 27,
    experienceMatch: 24,
    educationMatch: 14,
    locationMatch: 14,
    industryMatch: 12,
    brandRelevance: 9,
  },
  brandContextWithTarget: { employer: 10, sales: 9, equipment: 7, technical: 6, general: 4 },
  brandContextNoTarget: { employer: 4, sales: 3, equipment: 2, technical: 2, general: 1 },
  brandRoleMultipliers: { employer: 1, equipment: 0.7, both: 1 },
  recommendationThresholds: { strongMatch: 85, match: 70, potential: 50 },
}
`,
        "utf8"
      );

      const rollback = service.rollback("2026-02-25T00:00:00.000Z");
      expect(rollback.restored.reason).toBe("auto_tune");

      const weights = loadRuleWeightsConfig(root);
      expect(weights.categoryWeights.skillMatch).toBe(25);
      expect(weights.categoryWeights.industryMatch).toBe(10);

      const history = service.getHistory();
      expect(history.some((entry) => entry.reason.startsWith("rollback:"))).toBe(true);
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
