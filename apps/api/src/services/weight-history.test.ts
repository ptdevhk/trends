import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadRuleWeightsConfig } from "./rule-scoring";
import { WeightHistoryService } from "./weight-history";
import { workspaceConfigService } from "./workspace-config-service";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "weight-history-"));
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
          skillMatch: 15,
          roleMatch: 10,
          experienceMatch: 25,
          educationMatch: 15,
          locationMatch: 15,
          industryMatch: 10,
          brandRelevance: 10,
        },
        after: {
          skillMatch: 17,
          roleMatch: 9,
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
      expect(history[0].after.skillMatch).toBe(17);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("logs malformed JSONL lines while reading valid history entries", () => {
    const root = createFixtureRoot();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      fs.writeFileSync(
        path.join(root, "output", "weight-history.jsonl"),
        "{bad json\n",
        "utf8"
      );

      const service = new WeightHistoryService(root);
      service.appendEntry({
        ts: "2026-02-25T00:00:00.000Z",
        reason: "auto_tune",
        before: {
          skillMatch: 15,
          roleMatch: 10,
          experienceMatch: 25,
          educationMatch: 15,
          locationMatch: 15,
          industryMatch: 10,
          brandRelevance: 10,
        },
        after: {
          skillMatch: 17,
          roleMatch: 9,
          experienceMatch: 24,
          educationMatch: 14,
          locationMatch: 14,
          industryMatch: 12,
          brandRelevance: 9,
        },
      });

      const history = service.getHistory();

      expect(history).toHaveLength(1);
      expect(history[0].reason).toBe("auto_tune");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to parse weight history line"),
        expect.any(SyntaxError)
      );
    } finally {
      errorSpy.mockRestore();
      cleanupFixtureRoot(root);
    }
  });

  it("rolls back weights to a previous entry", async () => {
    const root = createFixtureRoot();

    try {
      const service = new WeightHistoryService(root);
      service.appendEntry({
        ts: "2026-02-25T00:00:00.000Z",
        reason: "auto_tune",
        jobDescriptionId: "lathe-sales",
        before: {
          skillMatch: 15,
          roleMatch: 10,
          experienceMatch: 25,
          educationMatch: 15,
          locationMatch: 15,
          industryMatch: 10,
          brandRelevance: 10,
        },
        after: {
          skillMatch: 17,
          roleMatch: 9,
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
    skillMatch: 17,
    roleMatch: 9,
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

      const getRuleWeightsMock = vi.spyOn(workspaceConfigService, "getRuleWeights").mockResolvedValue(
        loadRuleWeightsConfig(root)
      );
      const setRuleWeightsMock = vi.spyOn(workspaceConfigService, "setWorkspaceRuleWeights").mockResolvedValue();

      const rollback = await service.rollback("2026-02-25T00:00:00.000Z", "dev");
      expect(rollback.restored.reason).toBe("auto_tune");
      expect(getRuleWeightsMock).toHaveBeenCalledWith("dev");
      expect(setRuleWeightsMock).toHaveBeenCalledTimes(1);

      const history = service.getHistory();
      expect(history.some((entry) => entry.reason.startsWith("rollback:"))).toBe(true);

      getRuleWeightsMock.mockRestore();
      setRuleWeightsMock.mockRestore();
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
